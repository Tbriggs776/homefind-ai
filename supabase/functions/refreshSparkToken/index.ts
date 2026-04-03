import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sparkKey = Deno.env.get('SPARK_OAUTH_KEY');
    const sparkSecret = Deno.env.get('SPARK_OAUTH_SECRET');
    const refreshToken = Deno.env.get('SPARK_OAUTH_REFRESH_TOKEN');

    if (!sparkKey || !sparkSecret || !refreshToken) {
      throw new Error('Missing Spark OAuth credentials');
    }

    const tokenRes = await fetch('https://sparkplatform.com/v1/oauth2/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: sparkKey,
        client_secret: sparkSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token refresh failed: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token;

    // Store tokens in sync_cache for other functions to use
    await supabaseAdmin.from('sync_cache').upsert({
      cache_key: 'spark_tokens',
      cache_value: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        refreshed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

    return new Response(
      JSON.stringify({ success: true, refreshed_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
