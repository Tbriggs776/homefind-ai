import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, Search, Heart, User, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function BottomTabs() {
  const location = useLocation();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin' || user?.is_user_admin === true;

  const tabs = [
    { name: 'Home', path: 'Home', icon: Home, show: true },
    { name: 'Search', path: 'Search', icon: Search, show: true },
    { name: 'Saved', path: 'SavedProperties', icon: Heart, show: true },
    { name: 'Profile', path: 'Profile', icon: User, show: true },
    { name: 'Admin', path: 'AdminDashboard', icon: LayoutDashboard, show: isAdmin },
  ].filter(t => t.show);

  const isActive = (path) => {
    const currentPath = location.pathname.split('/').pop() || 'Home';
    return currentPath === path;
  };

  const handleTabClick = (e, path) => {
    if (isActive(path)) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 z-50 select-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around items-center h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          return (
            <Link
              key={tab.path}
              to={createPageUrl(tab.path)}
              onClick={(e) => handleTabClick(e, tab.path)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors select-none ${
                active
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className={`h-6 w-6 mb-1 ${active ? 'fill-current' : ''}`} />
              <span className="text-xs font-medium">{tab.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
