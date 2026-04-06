import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import debug from '@/lib/debug';

const AuthContext = createContext();

const AUTH_TIMEOUT_MS = 5000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const profileFetchedRef = useRef(false);
  const timeoutRef = useRef(null);

  const fetchProfile = useCallback(async (userId, email) => {
    if (profileFetchedRef.current) {
      debug.logAuth('fetchProfile:skipped', 'Already fetched');
      return;
    }
    profileFetchedRef.current = true;
    debug.logAuth('fetchProfile:start', { userId, email });

    try {
      let { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      debug.logQuery('profiles', 'select', { data: profile, error });

      if (error && error.code === 'PGRST116') {
        debug.logAuth('fetchProfile:creating', 'No profile found, creating new one');
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email: email,
            full_name: '',
            role: 'user',
            is_user_admin: false,
            welcome_email_sent: false,
            last_active_at: new Date().toISOString(),
          })
          .select()
          .single();

        debug.logQuery('profiles', 'insert', { data: newProfile, error: insertError });

        if (insertError) {
          debug.logError('fetchProfile:insert', insertError);
        }
        profile = newProfile;
      } else if (error) {
        debug.logError('fetchProfile:select', error);
      }

      if (profile) {
        debug.logAuth('fetchProfile:success', { role: profile.role, is_admin: profile.is_user_admin });
        setUser(profile);
        setIsAuthenticated(true);
      } else {
        debug.logAuth('fetchProfile:noProfile', 'Profile is null after fetch attempt');
      }
    } catch (err) {
      debug.logError('fetchProfile:exception', err);
    } finally {
      debug.logAuth('fetchProfile:done', 'Setting isLoadingAuth=false');
      setIsLoadingAuth(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    debug.logAuth('init', 'AuthProvider mounting, setting up auth listener');

    // Safety timeout
    timeoutRef.current = setTimeout(() => {
      if (isLoadingAuth) {
        debug.logAuth('timeout', `Auth loading timed out after ${AUTH_TIMEOUT_MS}ms — rendering app without auth`);
        setIsLoadingAuth(false);
      }
    }, AUTH_TIMEOUT_MS);

    // Single source of truth for auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        debug.logAuth('onAuthStateChange', { event, hasUser: !!s?.user, email: s?.user?.email });
        setSession(s);

        if (s?.user) {
          // Defer to next tick to let Supabase client settle
          setTimeout(() => {
            fetchProfile(s.user.id, s.user.email);
          }, 0);
        } else {
          debug.logAuth('noSession', 'Clearing auth state');
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
          profileFetchedRef.current = false;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      }
    );

    return () => {
      debug.logAuth('cleanup', 'AuthProvider unmounting');
      subscription.unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    debug.logAuth('logout', 'Signing out');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAuthenticated(false);
    profileFetchedRef.current = false;
  }, []);

  const updateProfile = useCallback(async (updates) => {
    if (!user) return;
    debug.logAuth('updateProfile', updates);
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single();

    debug.logQuery('profiles', 'update', { data, error });
    if (!error && data) {
      setUser(data);
    }
    return { data, error };
  }, [user]);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    debug.logAuth('refreshProfile', 'Manual profile refresh');
    profileFetchedRef.current = false;
    await fetchProfile(session.user.id, session.user.email);
  }, [session, fetchProfile]);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      isAuthenticated,
      isLoadingAuth,
      logout,
      updateProfile,
      fetchProfile: refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
