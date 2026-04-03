import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface ComparisonRequest {
  property_ids: string[];
}

interface PropertyData {
  id: string;
  address: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  [key: string]: unknown;
}

async function callOpenAI(messages: unknown[], systemPrompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { property_ids } = (await req.json()) as ComparisonRequest;

    if (!property_ids || property_ids.length < 2) {
      return jsonResponse({ error: 'At least 2 properties required' }, 400);
    }

    const admin = getServiceClient();

    // Fetch properties
    const { data: properties } = await admin
      .from('properties')
      .select('*')
      .in('id', property_ids);

    if (!properties || properties.length < 2) {
      return jsonResponse({ error: 'Properties not found' }, 404);
    }

    // Prepare comparison data
    const comparisonText = properties
      .map((prop: PropertyData) => {
        return `
Property: ${prop.address}
- Price: $${prop.price}
- Beds: ${prop.beds}
- Baths: ${prop.baths}
- Square Feet: ${prop.sqft}
- Details: ${JSON.stringify(prop)}
`;
      })
      .join('\n---\n');

    const systemPrompt =
      'You are a real estate analyst. Compare the given properties and provide detailed analysis highlighting strengths, weaknesses, and recommendations.';

    const comparison = await callOpenAI(
      [
        {
          role: 'user',
          content: `Please analyze and compare these properties:\n${comparisonText}`,
        },
      ],
      systemPrompt
    );

    // Save comparison
    const { data: savedComparison } = await admin
      .from('property_comparisons')
      .insert({
        user_id: user.id,
        property_ids,
        comparison,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    return jsonResponse({
      comparison,
      properties,
      comparison_id: savedComparison?.id,
    });
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
