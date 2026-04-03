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
When users describe what they're looking for, extract search filters and return them as JSON in a code block.

Available filters: city, zip_code, min_price, max_price, min_beds, max_beds, min_baths, max_baths, min_sqft, max_sqft, property_type, pool, subdivision.

Example: If someone says "3 bedroom homes in Gilbert under 500k with a pool", respond with helpful context AND:
\`\`\`json
{"city": "Gilbert", "min_beds": 3, "max_price": 500000, "pool": true}
\`\`\`

Be conversational, knowledgeable about Arizona real estate, and always helpful. If you don't know something specific, say so honestly.`;

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
    const reply = openaiData.choices?.[0]?.message?.content || 'I apologize, I had trouble processing that. Could you try again?';

    // Extract filters from response if present
    let filters = null;
    const jsonMatch = reply.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try { filters = JSON.parse(jsonMatch[1]); } catch (_) { /* ignore parse errors */ }
    }

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
