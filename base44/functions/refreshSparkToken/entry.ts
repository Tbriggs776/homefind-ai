import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// ─── Spark OAuth Token Refresh ────────────────────────────────────────────────
// Refreshes the Spark OAuth access token using the refresh token.
// Should be called periodically (e.g., every 30 minutes) to prevent token expiration.
// Spark access tokens expire after ~24 hours but refresh tokens are long-lived.
// ────────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Admin-only or scheduled automation
        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) { /* scheduled automation — no user */ }

        const clientId = Deno.env.get("SPARK_OAUTH_KEY");
        const clientSecret = Deno.env.get("SPARK_OAUTH_SECRET");
        const refreshToken = Deno.env.get("SPARK_OAUTH_REFRESH_TOKEN");

        if (!clientId || !clientSecret || !refreshToken) {
            return Response.json({ 
                error: 'Spark OAuth credentials not configured',
                missing: {
                    clientId: !clientId,
                    clientSecret: !clientSecret,
                    refreshToken: !refreshToken
                }
            }, { status: 500 });
        }

        // Request new access token using refresh token
        // Spark Platform OpenID Connect token endpoint (replaces deprecated sparkapi.com/v1/oauth2/grant)
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
            return Response.json({ 
                error: 'Token refresh failed',
                status: response.status,
                details: errorText.slice(0, 500)
            }, { status: 500 });
        }

        const tokenData = await response.json();
        
        // Log success (but don't expose the actual token in logs)
        console.log('Token refresh successful:', {
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            has_access_token: !!tokenData.access_token,
            has_refresh_token: !!tokenData.refresh_token
        });

        // Store refresh result in SyncCache for monitoring
        const cacheKey = 'spark_token_refresh';
        const existingCache = await base44.asServiceRole.entities.SyncCache.filter({ sync_key: cacheKey });
        
        const cacheData = {
            sync_key: cacheKey,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            cached_data: {
                refreshed_at: new Date().toISOString(),
                expires_in_seconds: tokenData.expires_in,
                token_type: tokenData.token_type,
                // Store new access token for sync functions to use
                access_token: tokenData.access_token,
                // If a new refresh token was issued, store it too
                new_refresh_token: tokenData.refresh_token || null
            }
        };

        if (existingCache.length > 0) {
            await base44.asServiceRole.entities.SyncCache.update(existingCache[0].id, cacheData);
        } else {
            await base44.asServiceRole.entities.SyncCache.create(cacheData);
        }

        return Response.json({
            success: true,
            message: 'Token refreshed successfully',
            expires_in: tokenData.expires_in,
            refreshed_at: new Date().toISOString(),
            // IMPORTANT: The new access_token is stored in SyncCache.
            // Update your SPARK_OAUTH_ACCESS_TOKEN secret with the value from:
            // Dashboard > Data > SyncCache > spark_token_refresh > cached_data.access_token
            note: 'New access token stored in SyncCache (sync_key: spark_token_refresh). Update SPARK_OAUTH_ACCESS_TOKEN secret if needed.'
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});