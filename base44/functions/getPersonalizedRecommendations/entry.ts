import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import OpenAI from 'npm:openai@4.75.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get("OPENAI_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        // Fetch user's viewing history and preferences
        const views = await base44.entities.PropertyView.filter({ user_email: user.email }, '-created_date', 100);
        const savedProperties = await base44.entities.SavedProperty.filter({ user_email: user.email });
        const preferences = await base44.entities.SearchPreference.filter({ user_email: user.email });
        
        // Get IDs of properties the user has interacted with
        const viewedIds = [...new Set(views.map(v => v.property_id))];
        const savedIds = savedProperties.map(s => s.property_id);
        const interestIds = [...new Set([...viewedIds, ...savedIds])];

        // Fetch a sample of the user's interest properties for pattern analysis (max 10)
        const interestProperties = [];
        for (const id of interestIds.slice(0, 10)) {
            try {
                const props = await base44.entities.Property.filter({ id });
                if (props[0]) interestProperties.push(props[0]);
            } catch {}
        }

        // Fetch a limited pool of candidate properties (not already viewed/saved)
        // Use preferences to narrow down if available
        const candidateQuery = { status: 'active' };
        const pref = preferences[0];
        if (pref?.min_price) candidateQuery.price = { $gte: pref.min_price };
        if (pref?.max_price) candidateQuery.price = { ...candidateQuery.price, $lte: pref.max_price };
        if (pref?.min_bedrooms) candidateQuery.bedrooms = { $gte: pref.min_bedrooms };

        const candidates = await base44.entities.Property.filter(candidateQuery, '-created_date', 200);
        const availableProperties = candidates.filter(p => !interestIds.includes(p.id));

        if (availableProperties.length === 0) {
            return Response.json({ recommendations: [], reason: 'No new properties available.' });
        }

        if (interestProperties.length === 0) {
            // No history — return newest listings as full property objects
            return Response.json({ 
                recommendations: availableProperties.slice(0, 6),
                reason: 'No viewing history yet. Showing latest listings.'
            });
        }

        // Use AI to pick the best matches
        const prompt = `Based on this user's home search activity, identify the TOP 6 property IDs from the available listings that best match their preferences.

User's Interest History:
${interestProperties.map(p => 
    `ID: ${p.id} - ${p.address}, ${p.city} - $${p.price?.toLocaleString()} (${p.bedrooms}bd/${p.bathrooms}ba, ${p.square_feet} sqft)`
).join('\n')}

Available Properties to Recommend From:
${availableProperties.slice(0, 40).map(p => 
    `ID: ${p.id} - ${p.address}, ${p.city} - $${p.price?.toLocaleString()} (${p.bedrooms}bd/${p.bathrooms}ba, ${p.square_feet} sqft)`
).join('\n')}

Return a JSON object with a "property_ids" array of exactly 6 property IDs ordered by relevance.`;

        const openai = new OpenAI({ apiKey });
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a real estate recommendation engine. Analyze patterns and return ONLY a JSON object with a property_ids array."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        let recommendedIds;
        try {
            const parsed = JSON.parse(response.choices[0].message.content);
            recommendedIds = parsed.property_ids || parsed.recommendations || parsed.ids || [];
        } catch {
            recommendedIds = [];
        }

        // Build full property objects for recommended IDs
        const recommendedProperties = recommendedIds
            .map(id => availableProperties.find(p => p.id === id))
            .filter(Boolean);

        // Fill up to 6 if AI didn't return enough
        if (recommendedProperties.length < 6) {
            const existing = new Set(recommendedProperties.map(p => p.id));
            for (const p of availableProperties) {
                if (recommendedProperties.length >= 6) break;
                if (!existing.has(p.id)) {
                    recommendedProperties.push(p);
                    existing.add(p.id);
                }
            }
        }

        return Response.json({
            recommendations: recommendedProperties.slice(0, 6),
            reason: 'AI-personalized based on your viewing history'
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});