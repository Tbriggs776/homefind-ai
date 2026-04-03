import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.75.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        const fubApiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");

        const { user_email } = await req.json();

        // Fetch user's property views
        const views = await base44.asServiceRole.entities.PropertyView.filter({ user_email });
        const properties = await base44.asServiceRole.entities.Property.list('-created_date', 1000);
        
        const viewedProperties = properties.filter(p => 
            views.some(v => v.property_id === p.id)
        );

        if (viewedProperties.length === 0) {
            return Response.json({ summary: 'No property viewing activity yet.', fub_synced: false });
        }

        const prompt = `Analyze this user's home search behavior and provide a concise, actionable summary:

User Email: ${user_email}
Total Properties Viewed: ${views.length}
Unique Properties: ${[...new Set(views.map(v => v.property_id))].length}

Recent Properties Viewed:
${viewedProperties.slice(0, 5).map(p => 
    `- ${p.address}, ${p.city} - $${p.price.toLocaleString()} (${p.bedrooms}bd/${p.bathrooms}ba, ${p.property_type})`
).join('\n')}

Property Types Viewed: ${[...new Set(viewedProperties.map(p => p.property_type))].join(', ')}
Price Range: $${Math.min(...viewedProperties.map(p => p.price)).toLocaleString()} - $${Math.max(...viewedProperties.map(p => p.price)).toLocaleString()}

Provide a brief 2-3 sentence summary of their preferences and buying readiness. Then suggest ONE specific follow-up action.`;

        const openai = new OpenAI({ apiKey: openaiKey });
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a real estate analyst helping agents understand their clients' home search behavior. Be concise and actionable."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        const summary = response.choices[0].message.content;

        // Post summary to Follow Up Boss as a note
        let fubSynced = false;
        if (fubApiKey) {
            const fubHeaders = {
                'Authorization': `Basic ${btoa(fubApiKey + ':')}`,
                'Content-Type': 'application/json'
            };

            // Look up person in FUB
            const searchRes = await fetch(
                `https://api.followupboss.com/v1/people?email=${encodeURIComponent(user_email)}&limit=1`,
                { headers: fubHeaders }
            );

            let personId = null;
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                const people = searchData.people || searchData._embedded?.people || [];
                personId = people[0]?.id || null;
            }

            // Auto-create contact if not found
            if (!personId) {
                const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
                const userData = users[0];
                const nameParts = (userData?.full_name || user_email.split('@')[0]).trim().split(' ');
                const createRes = await fetch('https://api.followupboss.com/v1/people', {
                    method: 'POST',
                    headers: fubHeaders,
                    body: JSON.stringify({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        emails: [{ value: user_email }],
                        source: 'Crandell Home Intelligence'
                    })
                });
                if (createRes.ok) {
                    const createData = await createRes.json();
                    personId = createData.id || createData.person?.id;
                }
            }

            if (personId) {
                const noteRes = await fetch('https://api.followupboss.com/v1/notes', {
                    method: 'POST',
                    headers: fubHeaders,
                    body: JSON.stringify({
                        personId,
                        body: `🧠 AI Search Analysis — ${new Date().toLocaleDateString()}\n\n${summary}`
                    })
                });
                fubSynced = noteRes.ok;
                if (!noteRes.ok) {
                    console.error('Failed to post AI summary to FUB:', await noteRes.text());
                }
            }
        }

        return Response.json({ summary, fub_synced: fubSynced });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});