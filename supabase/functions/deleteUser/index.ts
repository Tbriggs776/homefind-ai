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

    // Check authorization - must be admin or is_user_admin
    const isAuthorized =
      currentUser.role === 'admin' || currentUser.is_user_admin === true;
    if (!isAuthorized) {
      return jsonResponse({ error: 'Forbidden - insufficient permissions' }, 403);
    }

    // Parse request body
    const { user_id } = await req.json();
    if (!user_id) {
      return jsonResponse({ error: 'Missing required field: user_id' }, 400);
    }

    // Prevent self-deletion
    if (user_id === currentUser.id) {
      return jsonResponse({ error: 'Cannot delete your own account' }, 400);
    }

    // If user_admin (not admin), check if they invited this user
    if (currentUser.is_user_admin && currentUser.role !== 'admin') {
      const admin = getServiceClient();
      const { data: targetUser } = await admin
        .from('profiles')
        .select('invited_by')
        .eq('id', user_id)
        .single();

      if (!targetUser || targetUser.invited_by !== currentUser.email) {
        return jsonResponse(
          {
            error:
              'Forbidden - you can only delete users you have invited',
          },
          403
        );
      }
    }

    // Delete from profiles table
    const admin = getServiceClient();
    const { error: profileError } = await admin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (profileError) {
      return jsonResponse({ error: profileError.message }, 500);
    }

    // Delete from auth.users via admin
    const { error: authError } = await admin.auth.admin.deleteUser(user_id);
    if (authError) {
      return jsonResponse({ error: authError.message }, 500);
    }

    return jsonResponse({
      success: true,
      message: `User ${user_id} deleted successfully`,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
