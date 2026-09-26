import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Service-role client for admin operations (bypasses RLS)
export function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

// Get the authenticated user from the request JWT
export async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  // Fetch profile
  const admin = getServiceClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return profile ? { ...profile, auth_id: user.id } : null;
}

// Full admins and user-admins (the team). Matches the frontend's isAdmin.
export function isAdminProfile(profile: { role?: string; is_user_admin?: boolean } | null | undefined) {
  return profile?.role === 'admin' || profile?.is_user_admin === true;
}

// Resolve the signed-in caller or produce a 401. The public anon key is not
// a user session, so getUser() returns null for it.
export async function requireUser(req: Request) {
  const user = await getUser(req);
  return user
    ? { user, error: null }
    : { user: null, error: jsonResponse({ error: 'Please sign in' }, 401) };
}

export async function requireAdmin(req: Request) {
  const user = await getUser(req);
  if (!user) return { user: null, error: jsonResponse({ error: 'Please sign in' }, 401) };
  if (!isAdminProfile(user)) return { user: null, error: jsonResponse({ error: 'Admin access required' }, 403) };
  return { user, error: null };
}

// Convenience: direct admin client export
export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Standard CORS headers for edge functions
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to return JSON with CORS
export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
