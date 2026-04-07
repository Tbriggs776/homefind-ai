import React, { useState } from 'react';

// GA4 initialization
if (typeof window !== 'undefined' && !window.gtagLoaded) {
  window.gtagLoaded = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-DP4XXP5DQW';
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-DP4XXP5DQW');
}
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Home, Heart, LayoutDashboard, LogOut, User, Menu, X, Search } from 'lucide-react';

import MortgageRateTicker from '@/components/MortgageRateTicker';
import { motion, AnimatePresence } from 'framer-motion';

export default function Layout({ children, currentPageName }) {
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const mainNavLinks = [
    { name: 'Home', path: 'Home', icon: Home, show: true },
    { name: 'Search Homes', path: 'Search', icon: Search, show: !!user },
    { name: 'Saved Homes', path: 'SavedProperties', icon: Heart, show: !!user },
  ];

  const isAdmin = user?.role === 'admin' || user?.is_user_admin === true;

  const adminLinks = [
    { name: 'Admin Dashboard', path: 'AdminDashboard', icon: LayoutDashboard },
    { name: 'Manage Users', path: 'ManageUsers', icon: User },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header
        className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm relative"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex justify-between items-center h-14 md:h-16">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center group">
              <img
                src="/balboa-realty-logo.png"
                alt="Crandell Real Estate Team - Balboa Realty"
                className="h-10 md:h-12 w-auto object-contain group-hover:opacity-90 transition-opacity"
              />
            </Link>

            {/* Desktop Navigation - Main Links */}
            <nav className="hidden md:flex items-center gap-1">
              {mainNavLinks.filter(link => link.show).map((link) => {
                const Icon = link.icon;
                const isActive = currentPageName === link.path;
                return (
                  <Link key={link.path} to={createPageUrl(link.path)}>
                    <Button
                      variant="ghost"
                      className={`flex items-center gap-2 select-none ${
                        isActive
                          ? 'bg-crandell-primary/10 text-crandell-primary'
                          : 'text-black hover:text-crandell-primary hover:bg-crandell-primary/10'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {link.name}
                    </Button>
                  </Link>
                );
              })}
            </nav>

            {/* Right side: Sign In or Hamburger Menu */}
            <div className="flex items-center gap-2">
              {!user && (
                <Link to="/Login">
                  <Button
                    className="bg-crandell-primary hover:bg-crandell-primary-hover text-white select-none font-semibold"
                  >
                    Sign In
                  </Button>
                </Link>
              )}
              {user && (
                <button
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                  {mobileMenuOpen ? (
                    <X className="h-6 w-6 text-slate-600" />
                  ) : (
                    <Menu className="h-6 w-6 text-slate-600" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hamburger Menu (all screen sizes, for logged-in users) */}
        {mobileMenuOpen && user && (
          <div className="border-t border-slate-200 bg-white absolute right-0 top-full w-64 shadow-xl rounded-bl-xl z-50">
            <div className="px-4 py-4 space-y-1">
              {/* Mobile-only: show main nav links */}
              <div className="md:hidden space-y-1 mb-2">
                {mainNavLinks.filter(link => link.show).map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.path}
                      to={createPageUrl(link.path)}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Button variant="ghost" className="w-full justify-start gap-2 text-black">
                        <Icon className="h-4 w-4" />
                        {link.name}
                      </Button>
                    </Link>
                  );
                })}
                <div className="border-t border-gray-200 my-2" />
              </div>

              {/* Profile link */}
              <Link to={createPageUrl('Profile')} onClick={() => setMobileMenuOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2 text-black">
                  <User className="h-4 w-4" />
                  {user.full_name || 'Profile'}
                </Button>
              </Link>

              {/* Admin links */}
              {isAdmin && (
                <>
                  <div className="border-t border-gray-200 my-2" />
                  <p className="text-xs text-gray-400 uppercase tracking-wider px-3 py-1">Admin</p>
                  {adminLinks.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.path}
                        to={createPageUrl(link.path)}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <Button variant="ghost" className="w-full justify-start gap-2 text-black">
                          <Icon className="h-4 w-4" />
                          {link.name}
                        </Button>
                      </Link>
                    );
                  })}
                </>
              )}

              <div className="border-t border-gray-200 my-2" />
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full justify-start gap-2 text-red-500 hover:text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content with Page Transitions */}
      <main className="pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mortgage Rate Ticker - fixed at bottom on all devices */}
      <div className="fixed bottom-0 left-0 right-0 z-50" style={{ bottom: 'env(safe-area-inset-bottom)' }}>
        <MortgageRateTicker />
      </div>

      {/* Footer */}
      <footer
        className="bg-black text-gray-300 mt-20 mb-16 md:mb-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-crandell-primary font-bold text-lg mb-2">Crandell Real Estate Team</h3>
              <p className="text-sm text-gray-400 font-medium">Balboa Realty</p>
              <p className="text-sm text-gray-400 mt-2">
                Your premier destination for finding the perfect home in Arizona.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Quick Links</h4>

              <div className="space-y-2">
                <Link to={createPageUrl('Home')} className="block text-sm hover:text-white transition-colors">
                      Home
                    </Link>
                    <Link to={createPageUrl('Search')} className="block text-sm hover:text-white transition-colors">
                      Search Homes
                    </Link>
                {user && (
                  <Link to={createPageUrl('SavedProperties')} className="block text-sm hover:text-white transition-colors">
                    Saved Properties
                  </Link>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Contact</h4>
              <p className="text-sm text-gray-400">
                Ready to connect external listings and CRM integrations.
              </p>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p className="mb-2">&copy; {new Date().getFullYear()} Crandell Real Estate Team — Balboa Realty. All rights reserved.</p>
            <p className="text-xs text-gray-500">All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.</p>
            <p className="text-xs text-gray-500 mt-1">Listings displayed may be from the ARMLS IDX program. Information source: ARMLS. Listing data last updated subject to availability.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
