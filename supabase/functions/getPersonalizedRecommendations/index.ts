import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface RecommendationResponse {
  recommendations: Record<string, unknown>[];
  reason: string;
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
      max_tokens: 1200,
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

    const admin = getServiceClient();

    // Fetch user's property views, saved properties, and search preferences
    const [viewsRes, savedPropsRes, prefsRes] = await Promise.all([
      admin
        .from('property_views')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      admin
        .from('saved_properties')
        .select('*, properties(*)')
        .eq('user_id', user.id),
      admin
        .from('search_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single(),
    ]);

    const views = viewsRes.data || [];
    const savedProps = (savedPropsRes.data || []).map((sp: Record<string, unknown>) => sp.properties);
    const prefs = prefsRes.data || {};

    // Analyze patterns for LLM
    const userBehavior = `
User Search History:
- Total views: ${views.length}
- Saved properties: ${savedProps.length}
- Preferences: ${JSON.stringify(prefs)}

Recently Viewed:
${views
  .slice(0, 5)
  .map((v: Record<string, unknown>) => `- Property ${v.property_id}: ${v.view_count} views`)
  .join('\n')}

Saved Properties Price Range: ${
      savedProps.length > 0
        ? `$${Math.min(...(savedProps.map((p: Record<string, unknown>) => p.price as number) || [0]))} - $${Math.max(...(savedProps.map((p: Record<string, unknown>) => p.price as number) || [0]))}`
        : 'No saved properties'
    }
`;

    const systemPrompt = `You are a real estate recommendation expert. Analyze the user's viewing patterns and preferences to identify key characteristics they value in properties. Based on this analysis, suggest the types of properties that would be a good fit.

Respond with a JSON object containing:
{
  "reason": "explanation of patterns identified",
  "keywords": ["keyword1", "keyword2"],
  "min_price": number,
  "max_price": number,
  "preferred_beds": number,
  "preferred_baths": number
}`;

    const analysisResult = await callOpenAI(
      [
        {
          role: 'user',
          content: `Based on this user behavior, what properties would they likely be interested in?\n${userBehavior}`,
        },
      ],
      systemPrompt
    );

    let analysis;
    try {
      analysis = JSON.parse(analysisResult);
    } catch {
      analysis = {
        reason: analysisResult,
        keywords: [],
      };
    }

    // Build query for recommended properties
    let query = admin.from('properties').select('*');

    // Filter by preferences
    if (analysis.min_price) {
      query = query.gte('price', analysis.min_price);
    }
    if (analysis.max_price) {
      query = query.lte('price', analysis.max_price);
    }
    if (analysis.preferred_beds) {
      query = query.eq('beds', analysis.preferred_beds);
    }

    // Exclude already saved/viewed
    const viewedIds = views.map((v: Record<string, unknown>) => v.property_id as string);
    const savedIds = savedProps.map((p: Record<string, unknown>) => p.id as string);
    const excludeIds = [...viewedIds, ...savedIds];

    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }

    const { data: recommendations } = await query.limit(10);

    return jsonResponse({
      recommendations: recommendations || [],
      reason: analysis.reason || 'Based on your viewing history and preferences',
    } as RecommendationResponse);
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
