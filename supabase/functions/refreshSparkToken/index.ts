import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user && user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const clientId = Deno.env.get("SPARK_OAUTH_KEY");
        const clientSecret = Deno.env.get("SPARK_OAUTH_SECRET");
        const refreshToken = Deno.env.get("SPARK_OAUTH_REFRESH_TOKEN");

        if (!clientId || !clientSecret || !refreshToken) {
            return jsonResponse({
                error: 'Spark OAuth credentials not configured',
                missing: {
                    clientId: !clientId,
                    clientSecret: !clientSecret,
                    refreshToken: !refreshToken
                }
            }, 500);
        }

        const tokenUrl = 'https://sparkplatform.com/openid/token';

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Token refresh failed:', response.status, errorText);
            return jsonResponse({
                error: 'Token refresh failed',
                status: response.status,
                details: errorText.slice(0, 500)
            }, 500);
        }

        const tokenData = await response.json();

        console.log('Token refresh successful:', {
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            has_access_token: !!tokenData.access_token,
            has_refresh_token: !!tokenData.refresh_token
        });

        const cacheKey = 'spark_token_refresh';
        const { data: existingCache } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', cacheKey);

        const cacheData = {
            sync_key: cacheKey,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            cached_data: {
                refreshed_at: new Date().toISOString(),
                expires_in_seconds: tokenData.expires_in,
                token_type: tokenData.token_type,
                access_token: tokenData.access_token,
                new_refresh_token: tokenData.refresh_token || null
            }
        };

        if (existingCache && existingCache.length > 0) {
            await admin
                .from('sync_cache')
                .update(cacheData)
                .eq('id', existingCache[0].id);
        } else {
            await admin.from('sync_cache').insert(cacheData);
        }

        return jsonResponse({
            success: true,
            message: 'Token refreshed successfully',
            expires_in: tokenData.expires_in,
            refreshed_at: new Date().toISOString(),
            note: 'New access token stored in SyncCache (sync_key: spark_token_refresh). Update SPARK_OAUTH_ACCESS_TOKEN secret if needed.'
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
