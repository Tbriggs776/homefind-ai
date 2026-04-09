import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * generateAISummary — User engagement summary for the admin dashboard
 *
 * Generates a concise, actionable AI summary of a user's engagement with the
 * HomeFind AI platform: what they're looking for, what they've viewed, what
 * they've saved, and recommended next steps for the agent. Summary is both
 * returned in the response AND persisted to profiles.ai_summary so the admin
 * dashboard can display the latest summary inline without regenerating every
 * page load.
 *
 * Request body: { user_id: string }
 * Response: { summary: string, generated_at: string }
 *
 * Data sources pulled for context:
 *   - profiles: name, email, created_at
 *   - user_preferences: search criteria (price range, cities, beds, etc.)
 *   - property_views: recent viewing activity + favorites
 *   - saved_properties: explicitly saved listings
 *
 * Note: the previous version of this function expected { propertyId } and
 * wrote listing blurbs — but it was being incorrectly called from the admin
 * dashboard with { user_id }, which silently failed (threw "Property not
 * found" internally and returned an error to the frontend). This rewrite
 * makes the function match what the dashboard actually wants.
 */

const OPENAI_MODEL = 'gpt-4o-mini'; // cheap, fast, plenty smart for a 150-word summary
const MAX_VIEWED_PROPERTIES = 20;
const MAX_SAVED_PROPERTIES = 20;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set');

    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.user_id;
    if (!userId) throw new Error('user_id is required');

    // ── 1. Fetch the user profile ────────────────────────────────────────────
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', userId)
      .single();
    if (profileErr || !profile) throw new Error(`Profile not found: ${userId}`);

    // ── 2. Fetch user preferences (optional) ─────────────────────────────────
    const { data: prefs } = await supabaseAdmin
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // ── 3. Fetch recent property views ───────────────────────────────────────
    const { data: views } = await supabaseAdmin
      .from('property_views')
      .select('property_id, interaction_type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_VIEWED_PROPERTIES);

    const viewedIds = (views || []).map((v: any) => v.property_id).filter(Boolean);
    const favoriteIds = (views || [])
      .filter((v: any) => v.interaction_type === 'favorite')
      .map((v: any) => v.property_id)
      .filter(Boolean);

    // ── 4. Fetch the actual viewed property details for richer context ──────
    let viewedProps: any[] = [];
    if (viewedIds.length > 0) {
      const { data: props } = await supabaseAdmin
        .from('properties')
        .select('id, address, city, price, bedrooms, bathrooms, square_feet, property_type')
        .in('id', viewedIds.slice(0, 10)); // top 10 most recent
      viewedProps = props || [];
    }

    // ── 5. Fetch saved properties for explicit signal ───────────────────────
    const { data: saved } = await supabaseAdmin
      .from('saved_properties')
      .select('property_id')
      .eq('user_id', userId)
      .limit(MAX_SAVED_PROPERTIES);
    const savedIds = (saved || []).map((s: any) => s.property_id).filter(Boolean);

    // Quick-exit case: user has no engagement data at all.
    if ((views?.length ?? 0) === 0 && savedIds.length === 0 && !prefs) {
      const summary =
        `${profile.full_name || profile.email} has signed up but has not yet viewed or saved any properties. ` +
        `Recommended action: send a welcome message with a handful of popular listings in the Queen Creek / East Valley area to re-engage.`;
      await persistSummary(userId, summary);
      return jsonResponse({ summary, generated_at: new Date().toISOString() });
    }

    // ── 6. Build a structured context block for the LLM ─────────────────────
    const ctxLines: string[] = [];
    ctxLines.push(`User: ${profile.full_name || '(no name)'} <${profile.email}>`);
    ctxLines.push(`Signed up: ${profile.created_at?.slice(0, 10) || 'unknown'}`);

    if (prefs) {
      const prefBits: string[] = [];
      if (prefs.min_price || prefs.max_price) {
        prefBits.push(
          `price $${prefs.min_price?.toLocaleString() || '0'}–$${prefs.max_price?.toLocaleString() || '∞'}`
        );
      }
      if (prefs.min_beds) prefBits.push(`${prefs.min_beds}+ beds`);
      if (prefs.min_baths) prefBits.push(`${prefs.min_baths}+ baths`);
      if (prefs.cities?.length) prefBits.push(`cities: ${prefs.cities.join(', ')}`);
      if (prefs.property_types?.length) prefBits.push(`types: ${prefs.property_types.join(', ')}`);
      if (prefs.pool) prefBits.push('wants a pool');
      if (prefBits.length) ctxLines.push(`Stated preferences: ${prefBits.join('; ')}`);
    }

    ctxLines.push(`Total property views: ${views?.length ?? 0}`);
    ctxLines.push(`Properties favorited: ${favoriteIds.length}`);
    ctxLines.push(`Properties explicitly saved: ${savedIds.length}`);

    if (viewedProps.length > 0) {
      ctxLines.push('');
      ctxLines.push('Recently viewed properties:');
      for (const p of viewedProps) {
        ctxLines.push(
          `  - ${p.address || 'Address unknown'}, ${p.city || ''} — ` +
            `$${(p.price || 0).toLocaleString()} | ${p.bedrooms || 0}bd/${p.bathrooms || 0}ba | ` +
            `${(p.square_feet || 0).toLocaleString()} sqft | ${p.property_type || 'unknown'}`
        );
      }
    }

    const context = ctxLines.join('\n');

    // ── 7. Prompt the model ──────────────────────────────────────────────────
    const systemPrompt =
      `You are a real estate agent's assistant analyzing a buyer lead's engagement with an IDX property search platform. ` +
      `Write a concise 3–5 sentence summary for the agent that answers: (1) what this buyer appears to be looking for based on their search behavior, ` +
      `(2) how engaged they are (active, lukewarm, dormant), and (3) one specific recommended next action the agent should take. ` +
      `Be direct, specific, and avoid filler. Reference concrete numbers and cities when possible. Do not use bullet points — write it as a short paragraph.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ],
        max_tokens: 300,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const summary: string = data.choices?.[0]?.message?.content?.trim() || '';
    if (!summary) throw new Error('OpenAI returned an empty summary');

    // ── 8. Persist the summary back to profiles ─────────────────────────────
    await persistSummary(userId, summary);

    return jsonResponse({ summary, generated_at: new Date().toISOString() });
  } catch (err: any) {
    console.error('[generateAISummary] Error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});

// ─── Persist helper ──────────────────────────────────────────────────────────
async function persistSummary(userId: string, summary: string) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      ai_summary: summary,
      ai_summary_generated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) {
    console.error('[generateAISummary] Failed to persist summary:', error);
    // Non-fatal — we still return the summary to the caller so the UI can show
    // something. The UI will just have to regenerate next time.
  }
}
