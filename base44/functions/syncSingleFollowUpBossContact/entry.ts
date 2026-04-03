import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || (user.role !== 'admin' && !user.is_user_admin)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { contact_email, contact_name, contact_id } = await req.json();

    if (!contact_email) {
      return Response.json({ error: 'contact_email is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Follow Up Boss API key not configured' }, { status: 500 });
    }

    // Get active field mappings
    const fieldMappings = await base44.asServiceRole.entities.FollowUpBossFieldMapping.filter(
      { is_active: true }
    );

    // Fetch contact details from Follow Up Boss
    let contactData = null;
    if (contact_id) {
      const contactResponse = await fetch(
        `https://api.followupboss.com/v1/people/${contact_id}`,
        {
          headers: {
            'Authorization': `Basic ${btoa(apiKey + ':')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (contactResponse.ok) {
        contactData = await contactResponse.json();
      }
    }

    try {
      // Check if user already exists
      const existingUsers = await base44.asServiceRole.entities.User.filter({ email: contact_email });
      
      let syncedFields = {
        email: contact_email,
        full_name: contact_name
      };

      // Apply custom field mappings if contact data is available
      if (contactData && fieldMappings.length > 0) {
        for (const mapping of fieldMappings) {
          const fubValue = contactData[mapping.fub_field_name];
          if (fubValue !== undefined && fubValue !== null) {
            syncedFields[mapping.user_field_name] = fubValue;
          }
        }
      }

      if (existingUsers.length === 0) {
        // Invite new user
        await base44.asServiceRole.users.inviteUser(contact_email, 'user');
        
        // Wait a bit for user to be created
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Update with synced fields
        const newUsers = await base44.asServiceRole.entities.User.filter({ email: contact_email });
        if (newUsers.length > 0) {
          await base44.asServiceRole.entities.User.update(newUsers[0].id, {
            full_name: contact_name,
            invited_by: user.email,
            assigned_role: 'lead',
            ...syncedFields
          });
        }
      } else {
        // Update existing user with synced fields
        await base44.asServiceRole.entities.User.update(existingUsers[0].id, syncedFields);
      }

      // Log successful sync
      await base44.asServiceRole.entities.FollowUpBossSyncHistory.create({
        contact_email,
        contact_name: contact_name || contact_email,
        sync_type: 'manual',
        status: 'success',
        synced_fields: syncedFields,
        triggered_by: user.email
      });

      return Response.json({ 
        success: true, 
        message: 'Contact synced successfully',
        synced_fields: syncedFields
      });

    } catch (syncError) {
      // Log failed sync
      await base44.asServiceRole.entities.FollowUpBossSyncHistory.create({
        contact_email,
        contact_name: contact_name || contact_email,
        sync_type: 'manual',
        status: 'failed',
        error_message: syncError.message,
        triggered_by: user.email
      });

      throw syncError;
    }

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});