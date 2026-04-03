import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { propertyId } = await req.json();
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set');

    const { data: property } = await supabaseAdmin.from('properties').select('*').eq('id', propertyId).single();
    if (!property) throw new Error('Property not found');

    const prompt = `Write a compelling 2-3 sentence property summary for: ${property.beds}bd/${property.baths_total}ba, ${property.sqft} sqft in ${property.city}, AZ. Listed at $${property.list_price?.toLocaleString()}. Built ${property.year_built}. ${property.pool ? 'Has pool.' : ''} ${property.subdivision ? `In ${property.subdivision}.` : ''}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 200 }),
    });
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content || '';

    return jsonResponse({ summary });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
