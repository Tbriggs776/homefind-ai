import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * postDailyActivitySummary
 *
 * For each active user with a FUB contact ID who had ≥2 meaningful actions
 * in the last 24 hours:
 *   1. Gather their property views, saves, contact-agent clicks, and AI chat messages
 *   2. Generate a 3-4 sentence AI summary via GPT-4o for the agent
 *   3. POST it as a note to the user's FUB contact via POST /v1/notes
 *   4. Log the result in daily_summary_log to enforce once-per-day-per-user
 *
 * Triggered by:
 *   - pg_cron daily at 15:00 UTC (8 AM Arizona)
 *   - Manual POST with { "userId": "..." } to test a single user
 *   - Manual POST with { "force": true } to bypass the once-per-day check
 */

const ACTIVITY_THRESHOLD = 2; // Users need ≥2 actions in last 24h to qualify

interface ActivityBundle {
  userId: string;
  fubContactId: string;
  fullName: string;
  email: string;
  views: any[];
  saves: any[];
  chats: any[];
  totalActivity: number;
}

async function gatherActivityForUser(userId: string): Promise<ActivityBundle | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Profile (must have fub_contact_id)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, fub_contact_id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.fub_contact_id) return null;

  // Property views with property details
  const { data: views } = await supabaseAdmin
    .from('property_views')
    .select(`
      created_at, interaction_type, duration_seconds,
      property:properties(address, city, price, bedrooms, bathrooms, square_feet)
    `)
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // Saved properties (favorites added in last 24h)
  const { data: saves } = await supabaseAdmin
    .from('saved_properties')
    .select(`
      created_at,
      property:properties(address, city, price, bedrooms, bathrooms, square_feet)
    `)
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // Chat messages (user's own messages — what they asked the AI about)
  const { data: chats } = await supabaseAdmin
    .from('chat_messages')
    .select('content, created_at')
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  const totalActivity = (views?.length || 0) + (saves?.length || 0) + (chats?.length || 0);

  return {
    userId: profile.id,
    fubContactId: profile.fub_contact_id,
    fullName: profile.full_name || profile.email || 'Unknown',
    email: profile.email,
    views: views || [],
    saves: saves || [],
    chats: chats || [],
    totalActivity,
  };
}

function buildPrompt(b: ActivityBundle): string {
  const viewLines = b.views.slice(0, 15).map((v: any) => {
    const p = v.property;
    if (!p) return null;
    return `  • ${p.address || '?'}, ${p.city || '?'} — $${p.price?.toLocaleString() || '?'} · ${p.bedrooms || '?'}bd/${p.bathrooms || '?'}ba · ${p.square_feet?.toLocaleString() || '?'} sqft`;
  }).filter(Boolean).join('\n');

  const saveLines = b.saves.slice(0, 10).map((s: any) => {
    const p = s.property;
    if (!p) return null;
    return `  • ${p.address || '?'}, ${p.city || '?'} — $${p.price?.toLocaleString() || '?'} · ${p.bedrooms || '?'}bd/${p.bathrooms || '?'}ba`;
  }).filter(Boolean).join('\n');

  const chatLines = b.chats.slice(0, 10).map((c: any) =>
    `  • "${(c.content || '').slice(0, 200)}"`
  ).join('\n');

  return `You are summarizing a real-estate client's home search activity for their agent at Crandell Real Estate Team. The agent will read this in Follow Up Boss as a note. Be specific, factual, and 3-4 sentences max. Highlight intent signals: price range, target locations, must-have features, and any urgency/seriousness indicators.

CLIENT: ${b.fullName} (${b.email})
ACTIVITY WINDOW: Last 24 hours

PROPERTIES VIEWED (${b.views.length}):
${viewLines || '  (none)'}

PROPERTIES SAVED/FAVORITED (${b.saves.length}):
${saveLines || '  (none)'}

QUESTIONS ASKED OF AI ASSISTANT (${b.chats.length}):
${chatLines || '  (none)'}

Write the agent-facing summary now. Lead with the most actionable insight. Do NOT use bullet points — use prose. Do NOT exceed 4 sentences.`;
}

async function generateSummary(prompt: string, openaiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function postNoteToFub(personId: string, body: string, fubKey: string): Promise<{ ok: boolean; status: number; noteId?: string; error?: string }> {
  const auth = btoa(`${fubKey}:`);
  const res = await fetch('https://api.followupboss.com/v1/notes', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'X-System': 'HomeFind-AI',
      'X-System-Key': 'crandell-real-estate',
    },
    body: JSON.stringify({
      personId: parseInt(personId, 10),
      subject: `HomeFind AI Daily Summary — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      body,
      isHtml: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
  try {
    const j = JSON.parse(text);
    return { ok: true, status: res.status, noteId: String(j?.id || j?.note?.id || '') };
  } catch {
    return { ok: true, status: res.status };
  }
}

async function processOneUser(userId: string, force: boolean, openaiKey: string, fubKey: string) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Idempotency check
  if (!force) {
    const { data: existing } = await supabaseAdmin
      .from('daily_summary_log')
      .select('id')
      .eq('user_id', userId)
      .eq('summary_date', today)
      .maybeSingle();
    if (existing) {
      return { userId, skipped: true, reason: 'already_summarized_today' };
    }
  }

  const bundle = await gatherActivityForUser(userId);
  if (!bundle) return { userId, skipped: true, reason: 'no_fub_contact_id' };
  if (bundle.totalActivity < ACTIVITY_THRESHOLD) {
    return { userId, skipped: true, reason: 'below_activity_threshold', activityCount: bundle.totalActivity };
  }

  const prompt = buildPrompt(bundle);
  const summary = await generateSummary(prompt, openaiKey);
  if (!summary) return { userId, skipped: true, reason: 'empty_summary' };

  const fub = await postNoteToFub(bundle.fubContactId, summary, fubKey);

  // Always log, even on FUB failure — so we don't retry forever
  const { error: logError } = await supabaseAdmin.from('daily_summary_log').insert({
    user_id: userId,
    fub_contact_id: bundle.fubContactId,
    summary_date: today,
    summary_text: summary,
    fub_note_id: fub.noteId || null,
    fub_post_status: fub.status,
    activity_count: bundle.totalActivity,
  });

  return {
    userId,
    fullName: bundle.fullName,
    activityCount: bundle.totalActivity,
    summary,
    fub_status: fub.status,
    fub_ok: fub.ok,
    fub_error: fub.error,
    log_error: logError?.message,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const fubKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
    if (!fubKey) throw new Error('FOLLOW_UP_BOSS_API_KEY not set');

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const targetUserId = body.userId || null;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Single-user mode (for testing)
    if (targetUserId) {
      const result = await processOneUser(targetUserId, force, openaiKey, fubKey);
      return jsonResponse({ mode: 'single', result });
    }

    // Bulk mode: find all eligible users with activity in the last 24h
    // We collect candidate user IDs from views, saves, and chats, then filter
    const [{ data: viewUsers }, { data: saveUsers }, { data: chatUsers }] = await Promise.all([
      supabaseAdmin.from('property_views').select('user_id').gte('created_at', since),
      supabaseAdmin.from('saved_properties').select('user_id').gte('created_at', since),
      supabaseAdmin.from('chat_messages').select('user_id').eq('role', 'user').gte('created_at', since),
    ]);

    const candidateIds = new Set<string>();
    (viewUsers || []).forEach(r => r.user_id && candidateIds.add(r.user_id));
    (saveUsers || []).forEach(r => r.user_id && candidateIds.add(r.user_id));
    (chatUsers || []).forEach(r => r.user_id && candidateIds.add(r.user_id));

    const results: any[] = [];
    for (const id of candidateIds) {
      try {
        const r = await processOneUser(id, force, openaiKey, fubKey);
        results.push(r);
      } catch (err: any) {
        results.push({ userId: id, error: err.message });
      }
    }

    const summary = {
      mode: 'bulk',
      candidates: candidateIds.size,
      processed: results.length,
      summarized: results.filter((r: any) => r.summary).length,
      skipped: results.filter((r: any) => r.skipped).length,
      errors: results.filter((r: any) => r.error || r.fub_ok === false).length,
      results,
    };

    return jsonResponse(summary);
  } catch (err: any) {
    console.error('postDailyActivitySummary error:', err);
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
