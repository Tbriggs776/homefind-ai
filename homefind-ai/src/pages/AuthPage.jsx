import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function AuthPage() {
  const [mode, setMode] = useState('signin'); // signin | signup | magic
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn, signUp, signInWithMagicLink } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email, password);
        if (err) { setError(err.message); setLoading(false); return; }
        navigate('/');
      } else if (mode === 'signup') {
        const { error: err } = await signUp(email, password, fullName);
        if (err) { setError(err.message); setLoading(false); return; }
        setMessage('Check your email for a confirmation link.');
      } else {
        const { error: err } = await signInWithMagicLink(email);
        if (err) { setError(err.message); setLoading(false); return; }
        setMessage('Magic link sent! Check your email.');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>
          {mode === 'signin' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Magic Link'}
        </h1>

        {error && <div className="auth-error">{error}</div>}
        {message && <div style={{ color: 'var(--color-success)', fontSize: '0.875rem', textAlign: 'center', marginBottom: 16 }}>{message}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {mode !== 'magic' && (
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading}
            style={{ width: '100%', marginTop: 8, padding: '12px' }}
          >
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Magic Link'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          {mode === 'signin' ? (
            <>
              Don't have an account?{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => { setMode('signup'); setError(''); setMessage(''); }}>Sign Up</button>
              <br />
              <button className="btn btn-ghost btn-sm" onClick={() => { setMode('magic'); setError(''); setMessage(''); }}>Use Magic Link</button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => { setMode('signin'); setError(''); setMessage(''); }}>Sign In</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
