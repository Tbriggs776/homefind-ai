import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (!user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const apiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
        if (!apiKey) {
            return jsonResponse({ error: 'Follow Up Boss API key not configured' }, 500);
        }

        const { property_id, message, phone } = await req.json();

        let property = null;
        if (property_id) {
            const { data } = await admin
                .from('properties')
                .select('*')
                .eq('id', property_id)
                .single();
            property = data;
        }

        const { data: savedProperties } = await admin
            .from('saved_properties')
            .select('*')
            .eq('user_id', user.id);

        const { data: preferences } = await admin
            .from('search_preferences')
            .select('*')
            .eq('user_id', user.id);

        const personPayload = {
            email: user.email,
            name: user.full_name || user.email.split('@')[0],
            phones: phone ? [{ number: phone, type: 'mobile' }] : [],
            source: 'HomeFinder App',
            tags: ['website_inquiry'],
            custom_fields: {
                saved_properties_count: (savedProperties || []).length,
                price_range: preferences && preferences[0] ? `$${preferences[0].min_price || 0} - $${preferences[0].max_price || 'Any'}` : null,
                preferred_bedrooms: preferences?.[0]?.min_bedrooms || null,
                preferred_cities: preferences?.[0]?.cities?.join(', ') || null,
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
            return jsonResponse({
                error: 'Failed to create lead in Follow Up Boss',
                details: errorText
            }, 500);
        }

        const personData = await personResponse.json();

        let noteBody = message || 'User expressed interest through HomeFinder.';

        if (property) {
            noteBody += `\n\n🏠 Property of Interest:\n${property.address}, ${property.city}, ${property.state}\n💰 Price: $${(property.price || 0).toLocaleString()}\n🛏️ ${property.bedrooms} bed, ${property.bathrooms} bath\n📐 ${property.square_feet} sqft`;
        }

        if (savedProperties && savedProperties.length > 0) {
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

        return jsonResponse({
            success: true,
            person_id: personData.id,
            message: 'Lead created in Follow Up Boss'
        });

    } catch (error) {
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
