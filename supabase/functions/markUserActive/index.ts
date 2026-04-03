import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Update user's status and last_activity_date
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .update({
        status: 'active',
        last_activity_date: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ success: true, data });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
