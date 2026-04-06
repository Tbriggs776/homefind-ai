import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bfnudxyxgjhdqwlcqyar.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmbnVkeHl4Z2poZHF3bGNxeWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzMyMjEsImV4cCI6MjA5MDgwOTIyMX0.H6LBxejXxnsqzsjtVFUPF4qq21ra1yRiXIRoWLlxHLQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: (name, acquireTimeout, fn) => {
      // Disable navigator.locks to prevent deadlock with Chrome extensions / multiple tabs
      return fn();
    },
  },
});

// Helper to invoke Supabase Edge Functions
export async function invokeFunction(functionName, body = {}) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  return data;
}
