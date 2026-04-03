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

        const { message, conversation_history, context, image_urls } = await req.json();

        // Build context from user's activity
        const savedProperties = await base44.entities.SavedProperty.filter({ user_email: user.email });
        const preferences = await base44.entities.SearchPreference.filter({ user_email: user.email });
        const recentViews = await base44.entities.PropertyView.filter({ user_email: user.email });

        let systemContext = `You are an expert real estate assistant for HomeFinder with deep knowledge in:

🏡 **Property Analysis**: Evaluate homes based on features, condition, layout, and value
📸 **Photo Analysis**: Identify architectural styles, materials, renovations needed, and quality indicators
📚 **Homebuyer Guidance**: Provide step-by-step guides for first-time buyers, financing, inspections, and negotiations
🔍 **Market Insights**: Offer pricing analysis, neighborhood information, and investment potential

When analyzing images:
- Identify architectural style, materials, and construction quality
- Note positive features (natural light, modern updates, quality finishes)
- Highlight potential concerns (wear, outdated features, maintenance needs)
- Suggest questions to ask or areas to inspect further

When providing guides:
- Be comprehensive yet concise
- Use numbered steps or bullet points
- Include actionable advice
- Mention typical costs or timelines when relevant

User's Search Preferences:`;

        if (preferences[0]) {
            const pref = preferences[0];
            systemContext += `
- Budget: $${pref.min_price?.toLocaleString() || '0'} - $${pref.max_price?.toLocaleString() || 'unlimited'}
- Bedrooms: ${pref.min_bedrooms || 'any'}+
- Bathrooms: ${pref.min_bathrooms || 'any'}+
- Cities: ${pref.cities?.join(', ') || 'any'}
- Property Types: ${pref.property_types?.join(', ') || 'any'}`;
        }

        systemContext += `\n\nUser Activity:
- Saved Properties: ${savedProperties.length}
- Total Views: ${recentViews.length}`;

        if (context?.currentProperty) {
            const prop = context.currentProperty;
            systemContext += `\n\nCurrently Viewing Property:
Address: ${prop.address}, ${prop.city}, ${prop.state}
Price: $${prop.price.toLocaleString()}
Beds: ${prop.bedrooms} | Baths: ${prop.bathrooms} | Sq Ft: ${prop.square_feet?.toLocaleString() || 'N/A'}
Type: ${prop.property_type}
${prop.description ? `\nDescription: ${prop.description}` : ''}
${prop.features ? `\nFeatures: ${prop.features.join(', ')}` : ''}`;
        }

        systemContext += `\n\nBe thorough when analyzing properties or photos. For general questions, keep responses friendly and helpful (3-5 sentences). For detailed analysis or guides, provide comprehensive information with structure.

**IMPORTANT - Search Filtering Capability:**
When users express search preferences (e.g., "show me 3 bedroom homes under $400k", "find condos in Phoenix", "I need a house with a pool"), you should:
1. Acknowledge their request naturally in your response
2. Extract the search criteria (price range, bedrooms, bathrooms, city, state, property type, features)
3. The system will automatically apply these filters to refine the visible listings

Available filter parameters:
- min_price, max_price (numbers)
- bedrooms, bathrooms (minimum numbers)
- city, state (strings)
- property_types (array from: single_family, condo, townhouse, multi_family, land, new_construction)

After the conversation, respond with your message and the system will handle filtering.`;

        const messages = [
            { role: "system", content: systemContext }
        ];

        if (conversation_history && conversation_history.length > 0) {
            messages.push(...conversation_history.slice(-10).map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string' ? msg.content : msg.content
            })));
        }

        // Build the user message with image support
        if (image_urls && image_urls.length > 0) {
            const content = [
                { type: "text", text: message }
            ];
            
            for (const url of image_urls) {
                content.push({
                    type: "image_url",
                    image_url: { url }
                });
            }
            
            messages.push({ role: "user", content });
        } else {
            messages.push({ role: "user", content: message });
        }

        const openai = new OpenAI({ apiKey });
        
        const response = await openai.chat.completions.create({
            model: image_urls && image_urls.length > 0 ? "gpt-4o" : "gpt-4o-mini",
            messages,
            temperature: 0.7,
            max_tokens: image_urls && image_urls.length > 0 ? 800 : 400
        });

        const assistantMessage = response.choices[0].message.content;

        // Extract search filters from user message using AI
        let extractedFilters = null;
        const filterKeywords = ['show', 'find', 'search', 'looking for', 'want', 'need', 'bedroom', 'bath', 'price', 'under', 'over', 'condo', 'house', 'home'];
        const hasFilterIntent = filterKeywords.some(keyword => message.toLowerCase().includes(keyword));
        
        if (hasFilterIntent) {
            try {
                const filterExtraction = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `Extract search filters from the user's message. Return ONLY valid JSON with these fields (omit if not mentioned):
{
  "min_price": number,
  "max_price": number,
  "bedrooms": number (minimum),
  "bathrooms": number (minimum),
  "city": "string",
  "state": "string",
  "property_types": ["single_family", "condo", "townhouse", "multi_family", "land", "new_construction"]
}

Examples:
"show me 3 bedroom homes under 400k" -> {"max_price": 400000, "bedrooms": 3}
"find condos in Phoenix Arizona" -> {"city": "Phoenix", "state": "Arizona", "property_types": ["condo"]}
"homes between 300k and 500k with 2 baths" -> {"min_price": 300000, "max_price": 500000, "bathrooms": 2}

If no filters are mentioned, return empty object: {}`
                        },
                        { role: "user", content: message }
                    ],
                    temperature: 0.1
                });

                const filterJson = filterExtraction.choices[0].message.content.trim();
                const parsed = JSON.parse(filterJson);
                if (Object.keys(parsed).length > 0) {
                    extractedFilters = parsed;
                }
            } catch (e) {
                console.log('Filter extraction failed:', e);
            }
        }

        // Save chat messages
        await base44.entities.ChatMessage.create({
            user_email: user.email,
            role: 'user',
            content: message,
            context
        });

        await base44.entities.ChatMessage.create({
            user_email: user.email,
            role: 'assistant',
            content: assistantMessage,
            context
        });

        return Response.json({
            response: assistantMessage,
            filters: extractedFilters
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});