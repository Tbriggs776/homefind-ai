import { createClient } from '@supabase/supabase-js';
import debug from '@/lib/debug';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bfnudxyxgjhdqwlcqyar.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmbnVkeHl4Z2poZHF3bGNxeWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzMyMjEsImV4cCI6MjA5MDgwOTIyMX0.H6LBxejXxnsqzsjtVFUPF4qq21ra1yRiXIRoWLlxHLQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Bypass navigator.locks to prevent deadlock with browser extensions / multiple tabs.
    // Safe because our AuthContext serializes auth operations.
    lock: (_name, _acquireTimeout, fn) => fn(),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Helper to invoke Supabase Edge Functions — with debug tracking
export async function invokeFunction(functionName, body = {}) {
  const start = Date.now();
  debug.logEdgeCall(functionName, 'pending', null, body);

  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    const duration = Date.now() - start;

    if (error) {
      debug.logEdgeCall(functionName, 'error', duration, { error: error.message });
      throw error;
    }

    debug.logEdgeCall(functionName, 'success', duration);
    return data;
  } catch (err) {
    const duration = Date.now() - start;
    debug.logEdgeCall(functionName, 'error', duration, { error: err.message });
    debug.logError(`invokeFunction:${functionName}`, err);
    throw err;
  }
}
