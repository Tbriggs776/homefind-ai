import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface SummaryRequest {
  user_email: string;
  sync_to_fub?: boolean;
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

    // Check if user is admin
    if (user.role !== 'admin') {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const { user_email, sync_to_fub } = (await req.json()) as SummaryRequest;

    if (!user_email) {
      return jsonResponse({ error: 'Missing user_email' }, 400);
    }

    const admin = getServiceClient();

    // Fetch target user by email
    const { data: targetUserData } = await admin.auth.admin.listUsers();
    const targetAuthUser = targetUserData?.users?.find(
      (u: { email: string }) => u.email === user_email
    );

    if (!targetAuthUser) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    // Fetch property views and properties
    const [viewsRes, propsRes] = await Promise.all([
      admin
        .from('property_views')
        .select('*')
        .eq('user_id', targetAuthUser.id)
        .order('created_at', { ascending: false }),
      admin
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const views = viewsRes.data || [];
    const allProps = propsRes.data || [];

    // Calculate behavior metrics
    const totalViews = views.length;
    const uniqueProps = new Set(views.map((v: Record<string, unknown>) => v.property_id)).size;
    const avgViewsPerProperty = totalViews / uniqueProps || 0;
    const mostViewedPropertyIds = Object.entries(
      views.reduce((acc: Record<string, number>, v: Record<string, unknown>) => {
        const propId = v.property_id as string;
        acc[propId] = (acc[propId] || 0) + 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((e) => e[0]);

    const mostViewedProperties = allProps.filter((p: Record<string, unknown>) =>
      mostViewedPropertyIds.includes(p.id)
    );

    const behaviorText = `
User: ${user_email}
Total Property Views: ${totalViews}
Unique Properties Viewed: ${uniqueProps}
Average Views per Property: ${avgViewsPerProperty.toFixed(2)}

Most Viewed Properties:
${mostViewedProperties
  .map((p: Record<string, unknown>) => `- ${p.address}: $${p.price}`)
  .join('\n')}

View Timeline:
${views
  .slice(0, 10)
  .map((v: Record<string, unknown>) => `- ${new Date(v.created_at as string).toLocaleDateString()}: Property ${v.property_id}`)
  .join('\n')}
`;

    const systemPrompt = `You are a real estate analytics expert. Summarize this user's property viewing behavior, identify patterns, and provide insights into their interests and preferences.

Include:
1. Overall engagement level
2. Property type preferences based on viewing patterns
3. Price range analysis
4. Market segment focus
5. Recommendations for follow-up`;

    const summary = await callOpenAI(
      [
        {
          role: 'user',
          content: `Analyze this user's real estate behavior:\n${behaviorText}`,
        },
      ],
      systemPrompt
    );

    let fubSynced = false;

    // Optionally sync to Follow Up Boss
    if (sync_to_fub) {
      try {
        const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
        if (fubApiKey) {
          // Get Follow Up Boss contact mapping
          const { data: mapping } = await admin
            .from('fub_field_mappings')
            .select('*')
            .eq('user_email', user_email)
            .single();

          if (mapping && mapping.fub_contact_id) {
            // Create note in Follow Up Boss
            const noteResponse = await fetch(
              `https://api.followupboss.com/v1/contacts/${mapping.fub_contact_id}/notes`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${btoa(`${fubApiKey}:X`)}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  note: `AI Summary: ${summary}`,
                  type: 'general',
                }),
              }
            );

            if (noteResponse.ok) {
              // Record sync history
              await admin.from('fub_sync_history').insert({
                user_email,
                sync_type: 'summary',
                status: 'success',
                created_at: new Date().toISOString(),
              });
              fubSynced = true;
            }
          }
        }
      } catch (fubError) {
        console.error('FUB sync error:', fubError);
      }
    }

    return jsonResponse({
      summary,
      fub_synced: fubSynced,
      metrics: {
        total_views: totalViews,
        unique_properties: uniqueProps,
        avg_views_per_property: avgViewsPerProperty,
      },
    });
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
