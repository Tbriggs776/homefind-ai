import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { propertyIds, userId } = await req.json();
    if (!propertyIds?.length || propertyIds.length < 2) throw new Error('At least 2 propertyIds required');

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set');

    const { data: properties } = await supabaseAdmin
      .from('properties')
      .select('*')
      .in('id', propertyIds);

    if (!properties?.length) throw new Error('Properties not found');

    const propSummaries = properties.map(p =>
      `${p.street_number} ${p.street_name} ${p.street_suffix}, ${p.city} ${p.zip_code}: $${p.list_price?.toLocaleString()}, ${p.beds}bd/${p.baths_total}ba, ${p.sqft?.toLocaleString()} sqft, built ${p.year_built}, ${p.pool ? 'pool' : 'no pool'}, HOA $${p.hoa_fee || 0}/${p.hoa_frequency || 'N/A'}, ${p.subdivision || 'N/A'} subdivision`
    ).join('\n\n');

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a real estate expert. Compare these properties highlighting pros/cons, value proposition, and who each property is best suited for. Be specific and data-driven.' },
          { role: 'user', content: `Compare these properties:\n\n${propSummaries}` },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    const openaiData = await openaiRes.json();
    const comparison = openaiData.choices?.[0]?.message?.content || 'Unable to generate comparison.';

    if (userId) {
      await supabaseAdmin.from('property_comparisons').insert({
        user_id: userId,
        property_ids: propertyIds,
        comparison_data: { text: comparison, properties: properties.map(p => ({ id: p.id, address: `${p.street_number} ${p.street_name}`, price: p.list_price })) },
      });
    }

    return jsonResponse({ comparison, properties });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
