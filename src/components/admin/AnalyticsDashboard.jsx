import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Users, Eye, Heart, TrendingUp, TrendingDown,
  Activity, Home, Search, Star, ExternalLink, Database
} from 'lucide-react';
import { format, subDays, eachDayOfInterval, parseISO, startOfDay } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const COLORS = ['#00AFE5', '#3a9dd8', '#1e7cc0', '#0c5fa8', '#06438a', '#8b5cf6', '#10b981', '#f59e0b'];

function MetricCard({ title, value, change, icon: Icon, color = 'text-[#00AFE5]', subtext }) {
  const isPositive = change >= 0;
  return (
    <Card className="bg-white shadow border-slate-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-slate-500 mb-1">{title}</p>
            <p className="text-3xl font-bold text-slate-900">{value}</p>
            {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
            {change !== undefined && (
              <div className={`flex items-center gap-1 mt-2 text-sm ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                <span>{Math.abs(change)}% vs last 7d</span>
              </div>
            )}
          </div>
          <div className={`p-3 rounded-xl bg-slate-50`}>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsDashboard({ allUsers, allViews, alerts, savedProperties }) {
  const [dateRange, setDateRange] = useState(30);

  // Fetch saved properties if not passed in
  const { data: savedProps = savedProperties || [] } = useQuery({
    queryKey: ['savedPropertiesAll'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_properties')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    enabled: !savedProperties
  });

  const { data: chatMessages = [] } = useQuery({
    queryKey: ['chatMessages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: searchPrefs = [] } = useQuery({
    queryKey: ['searchPrefs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('search_preferences')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all user profiles so we can show names and emails instead of UUIDs
  // in the Most Active Users table. Same pattern as ManageUsers.jsx — admin
  // RLS policy allows reading all profile rows when logged in as admin.
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['analyticsAllProfiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, is_user_admin, last_active_at, created_at')
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  // Build a lookup map keyed by user id so the "Most Active Users" table can
  // resolve a user_id to a display name in constant time.
  const profileMap = useMemo(() => {
    const m = new Map();
    allProfiles.forEach(p => m.set(p.id, p));
    return m;
  }, [allProfiles]);

  // ── Date helpers ─────────────────────────────────────────────────────────────
  const now = new Date();
  const rangeStart = subDays(now, dateRange);
  const prevRangeStart = subDays(now, dateRange * 2);

  const inRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= rangeStart && d <= now;
  };
  const inPrevRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= prevRangeStart && d < rangeStart;
  };

  // ── Core metrics ──────────────────────────────────────────────────────────────
  const viewsInRange = allViews.filter(v => inRange(v.created_at));
  const viewsInPrev = allViews.filter(v => inPrevRange(v.created_at));
  const viewsChange = viewsInPrev.length
    ? Math.round(((viewsInRange.length - viewsInPrev.length) / viewsInPrev.length) * 100)
    : 0;

  const favoritesInRange = savedProps.filter(v => inRange(v.created_at));
  const favoritesInPrev = savedProps.filter(v => inPrevRange(v.created_at));
  const favChange = favoritesInPrev.length
    ? Math.round(((favoritesInRange.length - favoritesInPrev.length) / favoritesInPrev.length) * 100)
    : 0;

  const activeUsersInRange = new Set(viewsInRange.map(v => v.user_id)).size;
  const activeUsersInPrev = new Set(viewsInPrev.map(v => v.user_id)).size;
  const activeUserChange = activeUsersInPrev
    ? Math.round(((activeUsersInRange - activeUsersInPrev) / activeUsersInPrev) * 100)
    : 0;

  const chatsInRange = chatMessages.filter(m => m.role === 'user' && inRange(m.created_at));

  // ── Daily activity chart ──────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const days = eachDayOfInterval({ start: rangeStart, end: now });
    return days.map(day => {
      const dayStr = format(day, 'MMM d');
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const dayViews = allViews.filter(v => {
        const d = new Date(v.created_at);
        return d >= dayStart && d < dayEnd;
      });
      const dayFavs = savedProps.filter(v => {
        const d = new Date(v.created_at);
        return d >= dayStart && d < dayEnd;
      });
      const dayChats = chatMessages.filter(m => {
        const d = new Date(m.created_at);
        return d >= dayStart && d < dayEnd && m.role === 'user';
      });
      const uniqueUsers = new Set(dayViews.map(v => v.user_id)).size;

      return {
        date: dayStr,
        'Property Views': dayViews.length,
        'Favorites': dayFavs.length,
        'AI Chats': dayChats.length,
        'Active Users': uniqueUsers,
      };
    });
  }, [allViews, savedProps, chatMessages, dateRange]);

  // ── Interaction type breakdown ────────────────────────────────────────────────
  const interactionData = useMemo(() => {
    const counts = {};
    viewsInRange.forEach(v => {
      const type = v.interaction_type || 'view';
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [viewsInRange]);

  // Fetch total count of active properties — fast, no data transfer, used for
  // the "Active Properties" KPI card. Replaces the old .length on the truncated
  // allProperties array which capped at PostgREST's 1000-row default.
  const { data: totalPropertiesCount = 0 } = useQuery({
    queryKey: ['totalPropertiesCount'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch city aggregation across ALL ~27k properties via sequential pagination.
  // PostgREST caps single queries at 1000 rows, so we paginate through the full
  // table pulling only the city column (~25KB per page, ~28 pages, ~3s total).
  // Cached by React Query for 5 minutes so subsequent dashboard loads are instant.
  const { data: cityAggregation = [] } = useQuery({
    queryKey: ['cityAggregation'],
    queryFn: async () => {
      const allCities = {};
      const pageSize = 1000;
      const maxPages = 30;  // Safety cap — currently needs 27 pages
      for (let page = 0; page < maxPages; page++) {
        const { data, error } = await supabase
          .from('properties')
          .select('city')
          .order('id', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        data.forEach(row => {
          if (row.city) allCities[row.city] = (allCities[row.city] || 0) + 1;
        });
        if (data.length < pageSize) break;
      }
      return Object.entries(allCities)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    },
    staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
  });

  // Fetch detailed property records ONLY for the specific properties that appear
  // in recent views or favorites. Avoids pulling 27k rows when we only need a
  // handful of rows with address/city/price for display.
  const viewedAndFavoritedPropertyIds = useMemo(() => {
    const ids = new Set();
    allViews.forEach(v => v.property_id && ids.add(v.property_id));
    savedProps.forEach(s => s.property_id && ids.add(s.property_id));
    return Array.from(ids);
  }, [allViews, savedProps]);

  const { data: viewedPropertyDetails = [] } = useQuery({
    queryKey: ['viewedPropertyDetails', viewedAndFavoritedPropertyIds.sort().join(',')],
    queryFn: async () => {
      if (viewedAndFavoritedPropertyIds.length === 0) return [];
      const { data, error } = await supabase
        .from('properties')
        .select('id, address, city, price, bedrooms, bathrooms, square_feet')
        .in('id', viewedAndFavoritedPropertyIds);
      if (error) throw error;
      return data || [];
    },
    enabled: viewedAndFavoritedPropertyIds.length > 0,
  });

  // ── Top cities by listing count ─────────────────────────────────────────────
  // Pulled directly from the full-table city aggregation — shows real counts
  // across all 26k+ properties, not just the first 1000.
  const topCitiesByListings = useMemo(() => {
    return cityAggregation.slice(0, 8);
  }, [cityAggregation]);

  // ── Top properties by views ───────────────────────────────────────────────────
  const topPropertiesByViews = useMemo(() => {
    const counts = {};
    viewsInRange.forEach(v => {
      counts[v.property_id] = (counts[v.property_id] || 0) + 1;
    });
    const propertyMap = new Map(viewedPropertyDetails.map(p => [p.id, p]));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, views]) => {
        const prop = propertyMap.get(id);
        return {
          id,
          views,
          address: prop?.address || 'Unknown',
          city: prop?.city || '',
          price: prop?.price || 0,
        };
      });
  }, [viewsInRange, viewedPropertyDetails]);

  // ── Most favorited properties ───────────────────────────────────────────────
  const topPropertiesByFavorites = useMemo(() => {
    const counts = {};
    savedProps.filter(s => inRange(s.created_at)).forEach(s => {
      counts[s.property_id] = (counts[s.property_id] || 0) + 1;
    });
    const propertyMap = new Map(viewedPropertyDetails.map(p => [p.id, p]));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, favorites]) => {
        const prop = propertyMap.get(id);
        return {
          id,
          favorites,
          address: prop?.address || 'Unknown',
          city: prop?.city || '',
          price: prop?.price || 0,
        };
      });
  }, [savedProps, viewedPropertyDetails, dateRange]);

  // ── Most active users ─────────────────────────────────────────────────────────
  // Enriched with profile data (name, email) so the table shows human-readable
  // references instead of raw user UUIDs.
  const topUsers = useMemo(() => {
    const counts = {};
    viewsInRange.forEach(v => {
      counts[v.user_id] = (counts[v.user_id] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, views]) => {
        const profile = profileMap.get(userId);
        const displayName = profile?.full_name?.trim() || profile?.email || 'Unknown user';
        return {
          userId,
          displayName,
          email: profile?.email || null,
          fullName: profile?.full_name || null,
          views,
          favorites: savedProps.filter(s => s.user_id === userId && inRange(s.created_at)).length,
          chats: chatMessages.filter(m => m.user_id === userId && m.role === 'user' && inRange(m.created_at)).length,
        };
      });
  }, [viewsInRange, savedProps, chatMessages, profileMap]);

  // ── Price range interest ──────────────────────────────────────────────────────
  const priceRangeData = useMemo(() => {
    const buckets = {
      'Under $300k': { min: 0, max: 300000, count: 0 },
      '$300k–$500k': { min: 300000, max: 500000, count: 0 },
      '$500k–$750k': { min: 500000, max: 750000, count: 0 },
      '$750k–$1M': { min: 750000, max: 1000000, count: 0 },
      '$1M+': { min: 1000000, max: Infinity, count: 0 },
    };
    searchPrefs.forEach(pref => {
      if (pref.max_price) {
        const price = pref.max_price;
        for (const [label, { min, max }] of Object.entries(buckets)) {
          if (price > min && price <= max) {
            buckets[label].count++;
            break;
          }
        }
      }
    });
    return Object.entries(buckets).map(([name, { count }]) => ({ name, count }));
  }, [searchPrefs]);

  // ── Session engagement by hour ────────────────────────────────────────────────
  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      views: 0,
    }));
    const formatter = new Intl.DateTimeFormat('en-US', { 
      timeZone: 'America/Phoenix', 
      hour: '2-digit', 
      hour12: false 
    });
    viewsInRange.forEach(v => {
      if (!v.created_at) return;
      const date = new Date(v.created_at);
      if (isNaN(date.getTime())) return;
      try {
        const h = parseInt(formatter.format(date));
        if (h >= 0 && h < 24) hours[h].views++;
      } catch { /* skip invalid dates */ }
    });
    return hours;
  }, [viewsInRange]);

  // ── Alert type distribution ───────────────────────────────────────────────────
  const alertTypeData = useMemo(() => {
    const counts = {};
    alerts.forEach(a => {
      counts[a.alert_type] = (counts[a.alert_type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.replace(/_/g, ' '),
      value
    }));
  }, [alerts]);

  const avgViewsPerUser = activeUsersInRange > 0
    ? (viewsInRange.length / activeUsersInRange).toFixed(1)
    : 0;

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Analytics Overview</h2>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                dateRange === d
                  ? 'bg-[#00AFE5] text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Property Views"
          value={viewsInRange.length.toLocaleString()}
          change={viewsChange}
          icon={Eye}
          color="text-[#00AFE5]"
          subtext={`${avgViewsPerUser} avg per user`}
        />
        <MetricCard
          title="Active Users"
          value={activeUsersInRange}
          change={activeUserChange}
          icon={Users}
          color="text-purple-500"
        />
        <MetricCard
          title="Favorites Added"
          value={favoritesInRange.length}
          change={favChange}
          icon={Heart}
          color="text-red-500"
        />
        <MetricCard
          title="AI Chat Sessions"
          value={chatsInRange.length}
          icon={Activity}
          color="text-green-500"
        />
      </div>

      {/* Database & Sync Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Active Properties"
          value={totalPropertiesCount.toLocaleString()}
          icon={Database}
          color="text-indigo-500"
          subtext={`${cityAggregation.length} cities covered`}
        />
        <MetricCard
          title="Most Viewed City"
          value={(() => {
            const propertyMap = new Map(viewedPropertyDetails.map(p => [p.id, p]));
            const cities = {};
            viewsInRange.forEach(v => {
              const prop = propertyMap.get(v.property_id);
              if (prop?.city) cities[prop.city] = (cities[prop.city] || 0) + 1;
            });
            const sorted = Object.entries(cities).sort((a, b) => b[1] - a[1]);
            return sorted[0]?.[0] || 'N/A';
          })()}
          icon={Search}
          color="text-emerald-500"
          subtext={(() => {
            const propertyMap = new Map(viewedPropertyDetails.map(p => [p.id, p]));
            const cities = {};
            viewsInRange.forEach(v => {
              const prop = propertyMap.get(v.property_id);
              if (prop?.city) cities[prop.city] = (cities[prop.city] || 0) + 1;
            });
            const sorted = Object.entries(cities).sort((a, b) => b[1] - a[1]);
            return sorted[0] ? `${sorted[0][1]} views` : '';
          })()}
        />
        <MetricCard
          title="Largest City"
          value={cityAggregation[0]?.name || 'N/A'}
          icon={Home}
          color="text-amber-500"
          subtext={cityAggregation[0] ? `${cityAggregation[0].count.toLocaleString()} active listings` : ''}
        />
      </div>

      {/* Activity Over Time */}
      <Card className="bg-white shadow border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">User Activity Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00AFE5" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#00AFE5" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFavs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={Math.floor(dailyData.length / 7)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="Property Views" stroke="#00AFE5" fill="url(#colorViews)" strokeWidth={2} />
              <Area type="monotone" dataKey="Favorites" stroke="#ef4444" fill="url(#colorFavs)" strokeWidth={2} />
              <Area type="monotone" dataKey="AI Chats" stroke="#10b981" fill="url(#colorChats)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Row 2: Breakdown charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top Cities by Listings */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base">Top Cities by Listings</CardTitle>
          </CardHeader>
          <CardContent>
            {topCitiesByListings.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topCitiesByListings} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#00AFE5" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Price range interest */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base">Search Price Ranges</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={priceRangeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#00AFE5" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Interaction types + Alert distribution */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base">Interaction Types</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={interactionData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {interactionData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Hourly activity heatmap */}
      <Card className="bg-white shadow border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Peak Activity Hours</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="views" fill="#00AFE5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Row 3: Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Most active users */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              Most Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topUsers.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No activity in this period</p>
            ) : (
              <div className="space-y-2">
                {topUsers.map((u, i) => (
                  <div key={u.userId} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {u.displayName}
                        </p>
                        {u.fullName && u.email && (
                          <p className="text-xs text-slate-500 truncate">{u.email}</p>
                        )}
                        <div className="flex gap-3 text-xs text-slate-400 mt-0.5">
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{u.views}</span>
                          <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{u.favorites}</span>
                          <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{u.chats}</span>
                        </div>
                      </div>
                    </div>
                    <Badge className="bg-[#00AFE5]/10 text-[#00AFE5] border-0 text-xs flex-shrink-0">{u.views} views</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top viewed properties */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base flex items-center gap-2">
              <Home className="h-4 w-4 text-[#00AFE5]" />
              Top Viewed Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPropertiesByViews.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No views in this period</p>
            ) : (
              <div className="space-y-2">
                {topPropertiesByViews.map((p, i) => (
                  <Link
                    key={p.id}
                    to={createPageUrl('PropertyDetail') + `?id=${p.id}`}
                    className="flex items-center justify-between py-2.5 px-2 border-b border-slate-50 last:border-0 rounded-lg hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">#{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate group-hover:text-[#00AFE5] transition-colors">
                          {p.address}{p.city ? `, ${p.city}` : ''}
                        </p>
                        {p.price > 0 && (
                          <p className="text-xs text-slate-400">
                            ${p.price.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="h-2 bg-slate-100 rounded-full w-16 overflow-hidden">
                        <div
                          className="h-2 bg-[#00AFE5] rounded-full"
                          style={{ width: `${(p.views / topPropertiesByViews[0].views) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-700 w-8 text-right">{p.views}</span>
                      <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-[#00AFE5]" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Favorited properties + Alert distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Most favorited properties */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-500" />
              Most Favorited Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPropertiesByFavorites.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No favorites in this period</p>
            ) : (
              <div className="space-y-2">
                {topPropertiesByFavorites.map((p, i) => (
                  <Link
                    key={p.id}
                    to={createPageUrl('PropertyDetail') + `?id=${p.id}`}
                    className="flex items-center justify-between py-2.5 px-2 border-b border-slate-50 last:border-0 rounded-lg hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">#{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate group-hover:text-red-500 transition-colors">
                          {p.address}{p.city ? `, ${p.city}` : ''}
                        </p>
                        {p.price > 0 && (
                          <p className="text-xs text-slate-400">${p.price.toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="h-2 bg-red-50 rounded-full w-16 overflow-hidden">
                        <div
                          className="h-2 bg-red-400 rounded-full"
                          style={{ width: `${(p.favorites / (topPropertiesByFavorites[0]?.favorites || 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-700 w-8 text-right">{p.favorites}</span>
                      <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-red-500" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert distribution */}
        <Card className="bg-white shadow border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-800 text-base">Alert Types</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={alertTypeData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {alertTypeData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            {alertTypeData.length === 0 && (
              <p className="text-center text-slate-400 text-sm pt-8">No alerts yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}