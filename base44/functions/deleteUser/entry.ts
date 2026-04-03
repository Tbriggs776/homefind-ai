import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || (user.role !== 'admin' && user.is_user_admin !== true)) {
            return Response.json({ error: 'Forbidden: Admin or User Admin access required' }, { status: 403 });
        }

        const { user_id } = await req.json();

        if (!user_id) {
            return Response.json({ error: 'User ID is required' }, { status: 400 });
        }

        // Get the user to delete
        const userToDelete = await base44.asServiceRole.entities.User.filter({ id: user_id });
        
        if (userToDelete.length === 0) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Check permissions: user admins can only delete users they invited
        if (user.role !== 'admin' && userToDelete[0].invited_by !== user.email) {
            return Response.json({ error: 'Forbidden: You can only delete users you invited' }, { status: 403 });
        }

        // Prevent deleting yourself
        if (userToDelete[0].email === user.email) {
            return Response.json({ error: 'Cannot delete your own account' }, { status: 400 });
        }

        // Delete the user
        await base44.asServiceRole.entities.User.delete(user_id);

        return Response.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});