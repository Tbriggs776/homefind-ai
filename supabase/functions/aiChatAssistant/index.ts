import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { message, userId, conversationHistory = [] } = await req.json();
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set');

    // Build system prompt with property search context
    const systemPrompt = `You are a helpful real estate assistant for Crandell Real Estate Team / Balboa Realty, serving the Phoenix metro area (ARMLS listings).
You help users find properties, understand neighborhoods, and answer real estate questions.

When users describe what they're looking for, extract search filters and return them as JSON in a code block at the end of your message.

ALWAYS use these EXACT field names — no others — and only include keys the user actually mentioned:

| Field | Type | Notes |
|---|---|---|
| city | string | E.g. "Queen Creek", "Gilbert", "Scottsdale" |
| zip_code | string | 5-digit ZIP |
| subdivision | string | E.g. "Eastmark", "Verrado" |
| min_price | number | Dollars, no formatting |
| max_price | number | Dollars, no formatting |
| bedrooms | number | Treated as MINIMUM (e.g. 3 means "3+ bedrooms") |
| bathrooms | number | Treated as MINIMUM |
| min_sqft | number | Square feet |
| property_types | array of strings | One or more of: "single_family", "condo", "townhouse", "multi_family", "land" |
| private_pool | boolean | Set true if user wants a pool on the property |
| community_pool | boolean | Set true ONLY if user specifically asks for a community/HOA pool |

Examples:

User: "Show me 3 bedroom homes in Gilbert under 500k with a pool"
Response: Sure! Here are some 3+ bedroom homes in Gilbert under $500k with a pool. Take a look at the filtered results.
\`\`\`json
{"city": "Gilbert", "bedrooms": 3, "max_price": 500000, "private_pool": true}
\`\`\`

User: "I want a 4 bedroom 3 bath single family in Queen Creek between 600k and 800k"
Response: I'll filter for 4+ bedroom, 3+ bath single-family homes in Queen Creek between $600k and $800k.
\`\`\`json
{"city": "Queen Creek", "bedrooms": 4, "bathrooms": 3, "min_price": 600000, "max_price": 800000, "property_types": ["single_family"]}
\`\`\`

User: "What's the best neighborhood in Phoenix for families?"
Response: (conversational answer with no filters JSON, since they didn't request a search)

Only include the JSON block if the user is explicitly searching for properties. Be conversational, knowledgeable about Arizona real estate, and always helpful. If you don't know something specific, say so honestly.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: 'user', content: message },
    ];

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI error: ${errText}`);
    }

    const openaiData = await openaiRes.json();
    const rawReply = openaiData.choices?.[0]?.message?.content || 'I apologize, I had trouble processing that. Could you try again?';

    // Extract filters from response if present
    let filters = null;
    const jsonMatch = rawReply.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try { filters = JSON.parse(jsonMatch[1]); } catch (_) { /* ignore parse errors */ }
    }

    // Strip the JSON block from the user-facing reply
    const reply = rawReply.replace(/```json\n?[\s\S]*?\n?```/g, '').trim();

    // Save chat message if userId provided
    if (userId) {
      await supabaseAdmin.from('chat_messages').insert([
        { user_id: userId, role: 'user', content: message },
        { user_id: userId, role: 'assistant', content: reply, metadata: filters ? { filters } : null },
      ]);
    }

    return new Response(
      JSON.stringify({ reply, filters }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
