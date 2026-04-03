import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const currentUser = await getUser(req);
    if (!currentUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check authorization - admin only
    if (currentUser.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden - admin access required' }, 403);
    }

    // Parse request body
    const { user_id, is_user_admin } = await req.json();
    if (!user_id || is_user_admin === undefined || is_user_admin === null) {
      return jsonResponse(
        { error: 'Missing required fields: user_id, is_user_admin' },
        400
      );
    }

    // Update profiles.is_user_admin and assigned_role
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .update({
        is_user_admin: is_user_admin,
        assigned_role: is_user_admin ? 'admin' : 'user',
      })
      .eq('id', user_id)
      .select();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    if (!data || data.length === 0) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    return jsonResponse({
      success: true,
      message: `User admin status updated to ${is_user_admin}`,
      data: data[0],
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
