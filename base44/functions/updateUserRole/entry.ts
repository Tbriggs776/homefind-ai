import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { user_id, new_role } = await req.json();

        if (!user_id || !new_role) {
            return Response.json({ error: 'User ID and new role are required' }, { status: 400 });
        }

        if (!['admin', 'user'].includes(new_role)) {
            return Response.json({ error: 'Invalid role. Must be admin or user' }, { status: 400 });
        }

        // Get the user to update
        const userToUpdate = await base44.asServiceRole.entities.User.filter({ id: user_id });
        
        if (userToUpdate.length === 0) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Prevent changing your own role
        if (userToUpdate[0].email === user.email) {
            return Response.json({ error: 'Cannot change your own role' }, { status: 400 });
        }

        // Update the user role
        await base44.asServiceRole.entities.User.update(user_id, { role: new_role });

        return Response.json({
            success: true,
            message: `User role updated to ${new_role}`
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});