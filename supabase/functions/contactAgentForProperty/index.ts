import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const ANON_KEY_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI';
const FUB_BASE = 'https://api.followupboss.com/v1';

// ── FUB helpers ──────────────────────────────────────────────────────────
function fubAuth(key: string) {
  return `Basic ${btoa(key + ':')}`;
}

async function findFubPersonByEmail(fubKey: string, email: string) {
  // FUB people endpoint supports filtering by email
  const url = `${FUB_BASE}/people?email=${encodeURIComponent(email)}&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: fubAuth(fubKey), 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.people?.[0] || null;
}

async function createFubPerson(fubKey: string, person: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  source: string;
}) {
  const res = await fetch(`${FUB_BASE}/people`, {
    method: 'POST',
    headers: { Authorization: fubAuth(fubKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: person.firstName,
      lastName: person.lastName,
      emails: [{ value: person.email }],
      phones: person.phone ? [{ value: person.phone }] : [],
      source: person.source,
    }),
  });
  if (!res.ok) throw new Error(`FUB person create failed: ${res.status}`);
  return await res.json();
}

async function logFubInquiryEvent(fubKey: string, personId: number, payload: {
  propertyAddress: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  propertyPrice?: number;
  mlsNumber?: string;
  propertyUrl: string;
  message: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}) {
  // FUB events API attaches activity to a person and creates one if needed.
  // Including the same email here ensures FUB auto-merges to the existing person.
  const res = await fetch(`${FUB_BASE}/events`, {
    method: 'POST',
    headers: { Authorization: fubAuth(fubKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'HomeFind AI',
      type: 'Property Inquiry',
      person: {
        firstName: payload.firstName,
        lastName: payload.lastName,
        emails: [{ value: payload.email }],
        phones: payload.phone ? [{ value: payload.phone }] : [],
      },
      property: {
        street: payload.propertyAddress,
        city: payload.propertyCity,
        state: payload.propertyState,
        code: payload.propertyZip,
        price: payload.propertyPrice,
        mlsNumber: payload.mlsNumber,
        url: payload.propertyUrl,
      },
      message: payload.message,
    }),
  });
  return { status: res.status, ok: res.ok };
}

// ── Main handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    // Accept either flat fields or nested property object
    const propertyId = body.propertyId || body.property?.id;
    let { userId, name, email, phone, message } = body;

    // Try to get user from JWT auth header
    const authHeader = req.headers.get('Authorization');
    if (authHeader && !authHeader.includes(ANON_KEY_PREFIX)) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          userId = userId || user.id;
          email = email || user.email;
        }
      } catch (_) { /* ignore */ }
    }

    if (!propertyId) {
      return jsonResponse({ error: 'propertyId required' }, 400);
    }

    // Pull user profile for richer info AND existing fub_contact_id
    let existingFubContactId: number | null = null;
    if (userId) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email, phone, fub_contact_id')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        name = name || profile.full_name;
        email = email || profile.email;
        phone = phone || profile.phone;
        existingFubContactId = profile.fub_contact_id || null;
      }
    }

    if (!email) {
      return jsonResponse({ error: 'Could not determine user email. Please update your profile.' }, 400);
    }

    // Fetch property details
    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('address, city, state, zip_code, price, listing_agent_name, listing_office_name, mls_number')
      .eq('id', propertyId)
      .maybeSingle();

    const fullAddress = property
      ? `${property.address}, ${property.city}, ${property.state} ${property.zip_code || ''}`.trim()
      : 'Property';

    // Parse name into first/last
    const nameParts = (name || email.split('@')[0]).split(' ');
    const firstName = nameParts[0] || 'HomeFind';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    // ── FUB DEDUPE FLOW ────────────────────────────────────────────────
    const fubKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    let fubResult: any = { sent: false };
    let fubContactId: number | null = existingFubContactId;
    let leadAction: 'linked_existing' | 'linked_by_email' | 'created_new' | 'none' = 'none';

    if (fubKey) {
      try {
        // Step 1: If we already have a fub_contact_id stored, use it
        // Step 2: Otherwise search FUB by email to find existing lead
        // Step 3: If no lead exists, create one
        if (!fubContactId) {
          const existing = await findFubPersonByEmail(fubKey, email);
          if (existing?.id) {
            fubContactId = existing.id;
            leadAction = 'linked_by_email';
            // Persist the link back to the profile so future calls skip the search
            if (userId) {
              await supabaseAdmin
                .from('profiles')
                .update({ fub_contact_id: fubContactId })
                .eq('id', userId);
            }
          } else {
            // Create new person in FUB
            const created = await createFubPerson(fubKey, {
              firstName,
              lastName,
              email,
              phone,
              source: 'HomeFind AI',
            });
            fubContactId = created?.id || null;
            leadAction = 'created_new';
            if (userId && fubContactId) {
              await supabaseAdmin
                .from('profiles')
                .update({ fub_contact_id: fubContactId })
                .eq('id', userId);
            }
          }
        } else {
          leadAction = 'linked_existing';
        }

        // Step 4: Log the property inquiry as an event on the (now-known) person.
        // FUB will auto-attach this to the matching person by email.
        const eventResult = await logFubInquiryEvent(fubKey, fubContactId || 0, {
          propertyAddress: property?.address || fullAddress,
          propertyCity: property?.city,
          propertyState: property?.state,
          propertyZip: property?.zip_code,
          propertyPrice: property?.price,
          mlsNumber: property?.mls_number,
          propertyUrl: `https://homefind-ai.vercel.app/PropertyDetail?id=${propertyId}`,
          message: message || `${name || 'A user'} is interested in ${fullAddress}`,
          email,
          firstName,
          lastName,
          phone,
        });

        fubResult = {
          sent: true,
          fub_contact_id: fubContactId,
          lead_action: leadAction,
          event_status: eventResult.status,
        };
      } catch (fubErr: any) {
        console.error('FUB error:', fubErr);
        fubResult = { sent: false, error: fubErr.message, lead_action: leadAction };
      }
    }

    // Log engagement_alerts for admin dashboard
    if (userId) {
      try {
        await supabaseAdmin.from('engagement_alerts').insert({
          user_id: userId,
          user_email: email,
          user_name: name || email,
          status: 'new',
          drop_percentage: 0,
          ai_summary: `Contacted agent about ${fullAddress}`,
          recommended_action: 'Follow up within 24 hours',
        });
      } catch (alertErr) {
        console.error('Alert insert error:', alertErr);
      }
    }

    return jsonResponse({
      success: true,
      message: `Your interest has been sent to ${property?.listing_agent_name || 'the listing agent'}. They will contact you soon.`,
      agent: property?.listing_agent_name,
      fub: fubResult,
    });
  } catch (err: any) {
    console.error('contactAgentForProperty error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
