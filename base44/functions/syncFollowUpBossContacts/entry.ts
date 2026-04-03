import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || (user.role !== 'admin' && user.is_user_admin !== true)) {
            return Response.json({ error: 'Forbidden: Admin or User Admin access required' }, { status: 403 });
        }

        const apiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'Follow Up Boss API key not configured' }, { status: 500 });
        }

        // Fetch people from Follow Up Boss using Basic auth
        // If user admin, fetch only their assigned contacts
        let fetchUrl = 'https://api.followupboss.com/v1/people';
        if (user.is_user_admin === true) {
            // Get user admin's FUB user ID to filter assigned contacts
            const userResponse = await fetch('https://api.followupboss.com/v1/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(apiKey + ':')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (userResponse.ok) {
                const users = await userResponse.json();
                // Try to match by email (case-insensitive and trimmed)
                const fubUser = users.find(u => 
                    u.email?.toLowerCase().trim() === user.email?.toLowerCase().trim()
                );
                if (fubUser) {
                    fetchUrl = `https://api.followupboss.com/v1/people?assigned=${fubUser.id}`;
                } else {
                    // No matching user found in FUB, return empty result
                    return Response.json({
                        total_contacts: 0,
                        invited_users: 0,
                        uninvited_contacts: 0,
                        contacts: [],
                        message: `No Follow Up Boss user found with email: ${user.email}`
                    });
                }
            }
        }
        
        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${btoa(apiKey + ':')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return Response.json({ 
                error: 'Failed to fetch Follow Up Boss contacts',
                status: response.status 
            }, { status: response.status });
        }

        const data = await response.json();
        // Handle both array response and object with data property
        const people = Array.isArray(data) ? data : (data.people || data.data || []);

        // Get existing invited users
        const existingUsers = await base44.asServiceRole.entities.User.list('-created_date', 500);
        const invitedEmails = existingUsers.map(u => u.email);

        // Filter people not yet invited
        const uninvitedContacts = people.filter(person => {
            let email = person.email;
            if (typeof email !== 'string' && person.emails && Array.isArray(person.emails) && person.emails.length > 0) {
                email = person.emails[0].value || person.emails[0];
            }
            return email && !invitedEmails.includes(email);
        });

        // Build validation map: check each FUB contact against HomeFinder users by email, first name, or last name
        const extractEmail = (person) => {
            if (typeof person.email === 'string') return person.email;
            if (person.emails?.length > 0) return person.emails[0].value || person.emails[0];
            if (person.email?.value) return person.email.value;
            return null;
        };

        const extractPhone = (person) => {
            if (typeof person.phone === 'string') return person.phone;
            if (person.phones?.length > 0) return person.phones[0].value || person.phones[0];
            if (person.phone?.value) return person.phone.value;
            return null;
        };

        const matchContact = (person, homefinderUsers) => {
            const fubEmail = extractEmail(person)?.toLowerCase().trim();
            const fubFirst = person.firstName?.toLowerCase().trim();
            const fubLast = person.lastName?.toLowerCase().trim();

            for (const u of homefinderUsers) {
                const uEmail = u.email?.toLowerCase().trim();
                const [uFirst, ...uLastParts] = (u.full_name || '').toLowerCase().split(' ');
                const uLast = uLastParts.join(' ').trim();

                if (fubEmail && uEmail && fubEmail === uEmail) return { matched: true, match_type: 'email', homefinder_user: u };
                if (fubFirst && fubLast && uFirst && uLast && fubFirst === uFirst && fubLast === uLast) return { matched: true, match_type: 'full_name', homefinder_user: u };
                if (fubEmail && uEmail && fubEmail === uEmail) return { matched: true, match_type: 'email', homefinder_user: u };
            }
            return { matched: false, match_type: null, homefinder_user: null };
        };

        return Response.json({
            total_contacts: people.length,
            invited_users: invitedEmails.length,
            uninvited_contacts: uninvitedContacts.length,
            contacts: people.map(person => {
                const email = extractEmail(person) || 'No email';
                const phone = extractPhone(person);
                const { matched, match_type, homefinder_user } = matchContact(person, existingUsers);
                const isInvited = email !== 'No email' && invitedEmails.includes(email);

                return {
                    id: person.id,
                    name: person.firstName && person.lastName
                        ? `${person.firstName} ${person.lastName}`
                        : person.firstName || 'Unknown',
                    first_name: person.firstName || null,
                    last_name: person.lastName || null,
                    email,
                    phone,
                    company: person.companyName || null,
                    created_at: person.dateAdded,
                    // Validation fields
                    is_invited_to_homefinder: isInvited,
                    homefinder_match: matched,
                    match_type: match_type,
                    homefinder_email: homefinder_user?.email || null,
                    homefinder_name: homefinder_user?.full_name || null
                };
            })
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});