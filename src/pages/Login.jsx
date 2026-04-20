import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Mail, Lock, ArrowRight, Home } from 'lucide-react';

export default function Login() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'magic'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // If already authenticated, redirect to home
  if (!isLoadingAuth && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
    }
    setLoading(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (authError) {
      setError(authError.message);
    } else {
      setMessage('Check your email for a confirmation link to complete your sign-up.');
    }
    setLoading(false);
  };

  const handleMagicLink = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (authError) {
      setError(authError.message);
    } else {
      setMessage('Check your email for a magic link to sign in.');
    }
    setLoading(false);
  };

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Background */}
      <div className="relative min-h-screen flex items-center justify-center">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1920&q=80)',
          }}
        >
          <div className="absolute inset-0 bg-black/50"></div>
        </div>

        <div className="relative z-10 w-full max-w-md mx-auto px-4">
          {/* Logo / Title */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Home className="h-8 w-8 text-white" />
              <h1 className="text-3xl font-bold text-white">Crandell Home Intelligence</h1>
            </div>
            <p className="text-white/80">Your AI-powered home search platform</p>
          </div>

          <Card className="shadow-2xl border-0">
            <CardContent className="p-6">
              {/* Tab Switcher */}
              <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => { setMode('login'); setError(''); setMessage(''); }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'login' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setMode('signup'); setError(''); setMessage(''); }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'signup' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign Up
                </button>
                <button
                  onClick={() => { setMode('magic'); setError(''); setMessage(''); }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'magic' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Magic Link
                </button>
              </div>

              {/* Error / Success Messages */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
              {message && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                  {message}
                </div>
              )}

              {/* Login Form */}
              {mode === 'login' && (
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div>
                    <Label htmlFor="email" className="text-slate-700">Email</Label>
                    <div className="relative mt-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="password" className="text-slate-700">Password</Label>
                    <div className="relative mt-1">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="Your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold py-5"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                      <span className="flex items-center gap-2">Sign In <ArrowRight className="h-4 w-4" /></span>
                    )}
                  </Button>
                </form>
              )}

              {/* Sign Up Form */}
              {mode === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div>
                    <Label htmlFor="fullName" className="text-slate-700">Full Name</Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="John Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="signupEmail" className="text-slate-700">Email</Label>
                    <div className="relative mt-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        id="signupEmail"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="signupPassword" className="text-slate-700">Password</Label>
                    <div className="relative mt-1">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        id="signupPassword"
                        type="password"
                        placeholder="Min 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                        minLength={6}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold py-5"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                      <span className="flex items-center gap-2">Create Account <ArrowRight className="h-4 w-4" /></span>
                    )}
                  </Button>
                </form>
              )}

              {/* Magic Link Form */}
              {mode === 'magic' && (
                <form onSubmit={handleMagicLink} className="space-y-4">
                  <p className="text-sm text-slate-600 mb-2">
                    We'll send you a link to sign in instantly — no password needed.
                  </p>
                  <div>
                    <Label htmlFor="magicEmail" className="text-slate-700">Email</Label>
                    <div className="relative mt-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        id="magicEmail"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold py-5"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                      <span className="flex items-center gap-2">Send Magic Link <Mail className="h-4 w-4" /></span>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-white/60 text-sm mt-6">
            &copy; {new Date().getFullYear()} Crandell Real Estate Team &mdash; Balboa Realty
          </p>
        </div>
      </div>
    </div>
  );
}
