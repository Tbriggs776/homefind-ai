import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface LLMRequest {
  prompt: string;
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

interface LLMResponse {
  result: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      prompt,
      system_prompt,
      model = 'gpt-4o-mini',
      temperature = 0.7,
      max_tokens = 1000,
    } = (await req.json()) as LLMRequest;

    if (!prompt) {
      return jsonResponse({ error: 'Missing prompt' }, 400);
    }

    const messages: unknown[] = [];

    if (system_prompt) {
      messages.push({
        role: 'system',
        content: system_prompt,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI error:', error);
      return jsonResponse({ error: 'OpenAI API error' }, 500);
    }

    const data = await response.json();
    const result = data.choices[0].message.content;

    return jsonResponse({
      result,
    } as LLMResponse);
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
