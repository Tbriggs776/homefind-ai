import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface ChatRequest {
  message: string;
  image?: string; // base64 encoded image
  model?: 'gpt-4o' | 'gpt-4o-mini';
}

interface ChatResponse {
  response: string;
  filters?: Record<string, unknown>;
}

async function callOpenAI(
  messages: unknown[],
  systemPrompt: string,
  model: string = 'gpt-4o-mini'
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

async function extractSearchFilters(userMessage: string, admin: ReturnType<typeof getServiceClient>) {
  const filterExtractPrompt = `Extract search filters from this user message. Return JSON with fields like: price_range, location, property_type, beds, baths, etc.
Message: "${userMessage}"
Return ONLY valid JSON.`;

  const result = await callOpenAI(
    [{ role: 'user', content: filterExtractPrompt }],
    'You are a real estate search filter extraction assistant.'
  );

  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
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

    const { message, image, model = 'gpt-4o-mini' } = (await req.json()) as ChatRequest;

    if (!message) {
      return jsonResponse({ error: 'Missing message' }, 400);
    }

    const admin = getServiceClient();

    // Fetch user context
    const [savedPropsRes, prefsRes, viewsRes] = await Promise.all([
      admin
        .from('saved_properties')
        .select('*, properties(*)')
        .eq('user_id', user.id)
        .limit(10),
      admin
        .from('search_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single(),
      admin
        .from('property_views')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const savedProps = (savedPropsRes.data || []).map((sp: Record<string, unknown>) => sp.properties);
    const prefs = prefsRes.data || {};
    const views = viewsRes.data || [];

    // Build context
    const context = `
User Profile:
- Saved Properties: ${savedProps.length} properties
- Search Preferences: ${JSON.stringify(prefs)}
- Recent Views: ${views.length} properties viewed recently

Recent Properties Viewed:
${views.map((v: Record<string, unknown>) => `- ${v.property_id} (${new Date(v.created_at as string).toLocaleDateString()})`).join('\n')}
`;

    // Extract filters from user message
    const filters = await extractSearchFilters(message, admin);

    // Build messages for OpenAI
    const contentArray: unknown[] = [
      {
        type: 'text',
        text: message,
      },
    ];

    // Add image if provided and using gpt-4o
    if (image && model === 'gpt-4o') {
      contentArray.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${image}`,
          detail: 'low',
        },
      });
    }

    const systemPrompt = `You are a helpful real estate assistant. Use the user context to provide personalized recommendations and advice.

${context}

Help the user find properties, answer questions about the market, and provide insights.`;

    const response = await callOpenAI(
      [
        {
          role: 'user',
          content: contentArray,
        },
      ],
      systemPrompt,
      model
    );

    // Save chat message
    await admin.from('chat_messages').insert({
      user_id: user.id,
      role: 'user',
      content: message,
      filters,
      created_at: new Date().toISOString(),
    });

    await admin.from('chat_messages').insert({
      user_id: user.id,
      role: 'assistant',
      content: response,
      created_at: new Date().toISOString(),
    });

    return jsonResponse({
      response,
      filters,
    } as ChatResponse);
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
