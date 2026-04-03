import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="nav">
      <Link to="/" className="nav-brand">HomeFind AI</Link>
      <div className="nav-links">
        <Link to="/search">Search</Link>
        {user ? (
          <>
            <Link to="/saved">Saved</Link>
            <button className="btn btn-ghost btn-sm" onClick={() => { signOut(); navigate('/'); }}>
              Sign Out
            </button>
          </>
        ) : (
          <Link to="/auth">Sign In</Link>
        )}
      </div>
    </nav>
  );
}
