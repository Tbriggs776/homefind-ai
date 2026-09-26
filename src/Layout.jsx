import React, { useState, useEffect } from 'react';

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
import { Home, Heart, LayoutDashboard, LogOut, User, Menu, X, Search, TrendingUp, Phone, Mail, MapPin, ExternalLink } from 'lucide-react';

import MortgageRateTicker from '@/components/MortgageRateTicker';

// The search app lives on a subdomain of crandellrealestate.com. These links
// send buyers back to the pages the search app doesn't replicate, so the two
// sites read as one product instead of a dead-end search tool.
const MAIN_SITE = 'https://crandellrealestate.com';
const MAIN_SITE_LINKS = [
  { name: 'Sell', href: `${MAIN_SITE}/sell/` },
  { name: 'Our Team', href: `${MAIN_SITE}/our-team/` },
  { name: 'Contact', href: `${MAIN_SITE}/contact/` },
];
const TEAM_PHONE_DISPLAY = '(480) 544-1539';
const TEAM_PHONE_TEL = 'tel:+14805441539';
const TEAM_EMAIL = 'tanner@crandellrealestate.com';
const SOCIAL_LINKS = [
  { name: 'Facebook', href: 'https://www.facebook.com/CrandellRealEstateTeam' },
  { name: 'Instagram', href: 'https://www.instagram.com/crandellrealestateteam' },
  { name: 'LinkedIn', href: 'https://www.linkedin.com/in/crandellrealestate/' },
];

// Pages with their own sticky mobile action bar hide the rate ticker on
// phones so the two fixed bars don't stack.
const HIDE_TICKER_ON_MOBILE = ['PropertyDetail'];

export default function Layout({ children, currentPageName }) {
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Redirect new users to onboarding if they haven't completed it yet.
  // Skip the redirect if they're already on the Onboarding or Login page.
  useEffect(() => {
    if (
      user &&
      !user.has_completed_onboarding &&
      user.role !== 'admin' &&
      user.is_user_admin !== true &&
      currentPageName !== 'Onboarding' &&
      currentPageName !== 'Login'
    ) {
      navigate('/Onboarding');
    }
  }, [user, currentPageName, navigate]);

  // Search is available to everyone (anonymous browsing is critical for an
  // IDX site — Zillow/Redfin let buyers search before any sign-in). Saved
  // Homes stays gated because saving genuinely requires an account.
  const mainNavLinks = [
    { name: 'Home', path: 'Home', icon: Home, show: true },
    { name: 'Search Homes', path: 'Search', icon: Search, show: true },
    { name: 'Saved Homes', path: 'SavedProperties', icon: Heart, show: !!user },
  ];

  const isAdmin = user?.role === 'admin' || user?.is_user_admin === true;

  const adminLinks = [
    { name: 'Admin Dashboard', path: 'AdminDashboard', icon: LayoutDashboard },
    { name: 'Market Pulse', path: 'MarketPulse', icon: TrendingUp },
    { name: 'Manage Users', path: 'ManageUsers', icon: User },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header
        className="bg-white border-b border-border sticky top-0 z-50 shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="crandell-container">
          <div className="flex justify-between items-center h-14 md:h-16">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center group">
              <img
                src="/crandell-balboa-logo.png"
                alt="Crandell Real Estate Team - Balboa Realty"
                loading="eager"
                decoding="async"
                width="736"
                height="121"
                className="h-6 min-[400px]:h-7 md:h-10 w-auto object-contain group-hover:opacity-90 transition-opacity"
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
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:text-primary hover:bg-primary/10'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {link.name}
                    </Button>
                  </Link>
                );
              })}
              <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
              {MAIN_SITE_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-3 py-2 text-sm text-foreground hover:text-primary transition-colors select-none"
                >
                  {link.name}
                </a>
              ))}
            </nav>

            {/* Right side: Sign In + menu. Anonymous visitors get the menu on
                mobile only (desktop shows every link inline); signed-in users
                get it on every size for Profile / Admin / Sign Out. */}
            <div className="flex items-center gap-2">
              {!user && (
                <Link to="/Login">
                  <Button variant="brand" className="select-none h-9 px-3 text-xs md:h-9 md:px-4 md:text-sm">
                    Sign In
                  </Button>
                </Link>
              )}
              <button
                className={`p-2 rounded-lg hover:bg-muted transition-colors ${user ? '' : 'md:hidden'}`}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <X className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <Menu className="h-6 w-6 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Hamburger menu */}
        {mobileMenuOpen && (
          <div className="border-t border-border bg-white absolute right-0 top-full w-64 shadow-xl rounded-bl-xl z-50">
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
                      <Button variant="ghost" className="w-full justify-start gap-2 text-foreground">
                        <Icon className="h-4 w-4" />
                        {link.name}
                      </Button>
                    </Link>
                  );
                })}
                {MAIN_SITE_LINKS.map((link) => (
                  <a key={link.href} href={link.href}>
                    <Button variant="ghost" className="w-full justify-start gap-2 text-foreground">
                      <ExternalLink className="h-4 w-4" />
                      {link.name}
                    </Button>
                  </a>
                ))}
                <a href={TEAM_PHONE_TEL}>
                  <Button variant="ghost" className="w-full justify-start gap-2 text-foreground">
                    <Phone className="h-4 w-4" />
                    {TEAM_PHONE_DISPLAY}
                  </Button>
                </a>
                {user && <div className="border-t border-border my-2" />}
              </div>

              {user && (<>
              {/* Profile link */}
              <Link to={createPageUrl('Profile')} onClick={() => setMobileMenuOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2 text-foreground">
                  <User className="h-4 w-4" />
                  {user.full_name || 'Profile'}
                </Button>
              </Link>

              {/* Admin links */}
              {isAdmin && (
                <>
                  <div className="border-t border-border my-2" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-1">Admin</p>
                  {adminLinks.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.path}
                        to={createPageUrl(link.path)}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <Button variant="ghost" className="w-full justify-start gap-2 text-foreground">
                          <Icon className="h-4 w-4" />
                          {link.name}
                        </Button>
                      </Link>
                    );
                  })}
                </>
              )}

              <div className="border-t border-border my-2" />
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
              </>)}
            </div>
          </div>
        )}
      </header>

      {/* Main Content — plain div, no AnimatePresence wrapper.
          The previous AnimatePresence + motion.div wrapper was breaking the
          sticky header by transforming the page content during route
          transitions. Page-transition animations were not worth the cost
          of a broken sticky header on every scroll. */}
      <main className="pb-0">
        {children}
      </main>

      {/* Mortgage Rate Ticker - fixed at bottom (hidden on phones for pages
          that have their own sticky action bar) */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 ${HIDE_TICKER_ON_MOBILE.includes(currentPageName) ? 'hidden md:block' : ''}`}
        style={{ bottom: 'env(safe-area-inset-bottom)' }}
      >
        <MortgageRateTicker />
      </div>

      {/* Footer */}
      <footer
        className="bg-secondary text-gray-300 mt-20 mb-16 md:mb-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="crandell-container py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-primary font-bold text-lg mb-2">Crandell Real Estate Team</h3>
              <p className="text-sm text-gray-400 font-medium">Balboa Realty</p>
              <p className="text-sm text-gray-400 mt-2">
                Strategic real estate representation in Queen Creek and the East Valley.
              </p>
              <div className="flex gap-4 mt-4">
                {SOCIAL_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {link.name}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 uppercase tracking-[0.08em] text-sm">Quick Links</h4>
              <div className="grid grid-cols-2 gap-y-2 gap-x-6 max-w-xs">
                <Link to={createPageUrl('Home')} className="block text-sm hover:text-white transition-colors">
                  Home
                </Link>
                <Link to={createPageUrl('Search')} className="block text-sm hover:text-white transition-colors">
                  Search Homes
                </Link>
                {user && (
                  <Link to={createPageUrl('SavedProperties')} className="block text-sm hover:text-white transition-colors">
                    Saved Homes
                  </Link>
                )}
                {MAIN_SITE_LINKS.map((link) => (
                  <a key={link.href} href={link.href} className="block text-sm hover:text-white transition-colors">
                    {link.name}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 uppercase tracking-[0.08em] text-sm">Contact</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href={TEAM_PHONE_TEL} className="inline-flex items-center gap-2 hover:text-white transition-colors">
                    <Phone className="h-4 w-4 text-primary" /> {TEAM_PHONE_DISPLAY}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${TEAM_EMAIL}`} className="inline-flex items-center gap-2 hover:text-white transition-colors">
                    <Mail className="h-4 w-4 text-primary" /> {TEAM_EMAIL}
                  </a>
                </li>
                <li className="inline-flex items-start gap-2 text-gray-400">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>21227 E Stacey Rd, Queen Creek, AZ 85142</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 mt-8 pt-8 text-center text-sm text-gray-400">
            <p className="mb-2">&copy; {new Date().getFullYear()} Crandell Real Estate Team — Balboa Realty. All rights reserved.</p>
            <p className="text-xs text-gray-500">All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.</p>
            <p className="text-xs text-gray-500 mt-1">Listings displayed may be from the ARMLS IDX program. Information source: ARMLS. Listing data last updated subject to availability.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
