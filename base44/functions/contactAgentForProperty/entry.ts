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

        const { property } = await req.json();

        // Auto-save the property for the user
        const existingSaved = await base44.entities.SavedProperty.filter({
            user_email: user.email,
            property_id: property.id
        });

        if (existingSaved.length === 0) {
            await base44.entities.SavedProperty.create({
                user_email: user.email,
                property_id: property.id
            });
        }

        const appDomain = Deno.env.get("BASE44_APP_DOMAIN");
        const propertyUrl = appDomain ? `https://${appDomain}/PropertyDetail?id=${property.id}` : `PropertyDetail?id=${property.id}`;
        
        // Build property inquiry message
        const inquiryMessage = `Property Inquiry: ${property.address}, ${property.city}, ${property.state} ${property.zip_code || ''}
MLS#: ${property.mls_number || 'N/A'}
Price: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(property.price)}
Beds: ${property.bedrooms} | Baths: ${property.bathrooms} | Sq Ft: ${property.square_feet?.toLocaleString() || 'N/A'}
View on HomeFinder: ${propertyUrl}`;

        // Use Events API - this automatically handles deduplication
        const nameParts = (user.full_name || user.email).split(' ');
        const eventPayload = {
            type: 'Property Inquiry',
            source: 'HomeFinder App',
            message: inquiryMessage,
            person: {
                firstName: nameParts[0] || user.email,
                lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
                emails: [{ value: user.email }]
            },
            property: {
                address: property.address,
                city: property.city,
                state: property.state,
                zip: property.zip_code,
                price: property.price,
                beds: property.bedrooms,
                baths: property.bathrooms,
                sqft: property.square_feet,
                listingId: property.mls_number,
                propertyUrl: propertyUrl
            }
        };

        console.log('Sending event to Follow Up Boss for:', user.email);
        
        const eventResponse = await fetch('https://api.followupboss.com/v1/events', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${btoa(apiKey + ':')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
        });

        if (!eventResponse.ok) {
            const errorText = await eventResponse.text();
            console.error('Failed to send event:', errorText);
            return Response.json({ 
                error: 'Failed to send inquiry to Follow Up Boss',
                details: errorText 
            }, { status: eventResponse.status });
        }

        const result = await eventResponse.json();
        const isNewLead = eventResponse.status === 201;
        
        console.log(isNewLead ? 'Created new contact:' : 'Updated existing contact:', result.id);

        return Response.json({ 
            success: true, 
            message: 'Your request has been sent to the agent',
            action: isNewLead ? 'lead_created' : 'event_added',
            leadId: result.id
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});