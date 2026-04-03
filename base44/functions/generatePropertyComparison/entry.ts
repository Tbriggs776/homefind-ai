import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
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

        const { property_ids } = await req.json();

        if (!property_ids || property_ids.length < 2) {
            return Response.json({ error: 'At least 2 properties required for comparison' }, { status: 400 });
        }

        // Fetch all properties
        const properties = await Promise.all(
            property_ids.map(id => base44.entities.Property.get(id))
        );

        // Build comparison context
        const propertiesContext = properties.map((p, idx) => `
**Property ${idx + 1}**: ${p.address}, ${p.city}, ${p.state}
- Price: $${p.price.toLocaleString()}
- Bedrooms: ${p.bedrooms} | Bathrooms: ${p.bathrooms}
- Square Feet: ${p.square_feet?.toLocaleString() || 'N/A'}
- Year Built: ${p.year_built || 'N/A'}
- Lot Size: ${p.lot_size ? p.lot_size + ' acres' : 'N/A'}
- Property Type: ${p.property_type}
- Features: ${p.features?.join(', ') || 'None listed'}
- Days on Market: ${p.days_on_market || 0}
${p.description ? `- Description: ${p.description}` : ''}
`).join('\n\n');

        const openai = new OpenAI({ apiKey });
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a real estate expert analyzing properties for comparison. Provide a detailed, structured comparison highlighting:
1. **Best Value**: Which property offers the best value for money?
2. **Key Differences**: Major differences in features, condition, location
3. **Pros & Cons**: List 2-3 pros and cons for each property
4. **Recommendation**: Based on typical buyer priorities, which property might be best for different buyer types (first-time buyer, family, investor, etc.)

Be concise but thorough. Use bullet points for clarity.`
                },
                {
                    role: "user",
                    content: `Compare these properties:\n\n${propertiesContext}`
                }
            ],
            temperature: 0.7,
            max_tokens: 1000
        });

        const comparison = response.choices[0].message.content;

        // Save comparison
        await base44.entities.PropertyComparison.create({
            user_email: user.email,
            property_ids,
            ai_comparison: comparison
        });

        return Response.json({
            comparison,
            properties
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});