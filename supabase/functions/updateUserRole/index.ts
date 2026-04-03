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
    const { user_id, new_role } = await req.json();
    if (!user_id || !new_role) {
      return jsonResponse(
        { error: 'Missing required fields: user_id, new_role' },
        400
      );
    }

    // Validate new_role
    if (!['admin', 'user'].includes(new_role)) {
      return jsonResponse(
        { error: 'Invalid role. Must be "admin" or "user"' },
        400
      );
    }

    // Prevent changing own role
    if (user_id === currentUser.id) {
      return jsonResponse(
        { error: 'Cannot change your own role' },
        400
      );
    }

    // Update profiles.role
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .update({ role: new_role })
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
      message: `User role updated to ${new_role}`,
      data: data[0],
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
