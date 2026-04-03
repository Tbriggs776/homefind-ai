import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'Follow Up Boss API key not configured' }, { status: 500 });
        }

        const { property_id, message, phone } = await req.json();

        // Get property details
        const property = property_id ? await base44.entities.Property.get(property_id) : null;

        // Get user's saved properties and preferences
        const savedProperties = await base44.entities.SavedProperty.filter({ user_email: user.email });
        const preferences = await base44.entities.SearchPreference.filter({ user_email: user.email });

        // Create comprehensive person data
        const personPayload = {
            email: user.email,
            name: user.full_name || user.email.split('@')[0],
            phones: phone ? [{ number: phone, type: 'mobile' }] : [],
            source: 'HomeFinder App',
            tags: ['website_inquiry'],
            custom_fields: {
                saved_properties_count: savedProperties.length,
                price_range: preferences[0] ? `$${preferences[0].min_price || 0} - $${preferences[0].max_price || 'Any'}` : null,
                preferred_bedrooms: preferences[0]?.min_bedrooms || null,
                preferred_cities: preferences[0]?.cities?.join(', ') || null,
                inquiry_date: new Date().toISOString()
            }
        };

        const personResponse = await fetch('https://api.followupboss.com/v1/people', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(apiKey + ':'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(personPayload)
        });

        if (!personResponse.ok) {
            const errorText = await personResponse.text();
            return Response.json({ 
                error: 'Failed to create lead in Follow Up Boss',
                details: errorText 
            }, { status: 500 });
        }

        const personData = await personResponse.json();

        // Create a note about the inquiry
        let noteBody = message || 'User expressed interest through HomeFinder.';
        
        if (property) {
            noteBody += `\n\n🏠 Property of Interest:\n${property.address}, ${property.city}, ${property.state}\n💰 Price: $${property.price.toLocaleString()}\n🛏️ ${property.bedrooms} bed, ${property.bathrooms} bath\n📐 ${property.square_feet} sqft`;
        }

        if (savedProperties.length > 0) {
            noteBody += `\n\n📋 Has ${savedProperties.length} saved properties`;
        }

        const notePayload = {
            personId: personData.id,
            body: noteBody,
            subject: property ? `Inquiry: ${property.address}` : 'Website Inquiry',
            source: 'HomeFinder App'
        };

        await fetch('https://api.followupboss.com/v1/events', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(apiKey + ':'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(notePayload)
        });

        return Response.json({
            success: true,
            person_id: personData.id,
            message: 'Lead created in Follow Up Boss'
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});