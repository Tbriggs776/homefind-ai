import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';

/**
 * CrandellTeamSpotlight — focused panel showing just the Crandell team's
 * activity, rolled up from all deals where is_crandell_listing = true.
 *
 * Shows three KPIs at the top (active / pending / closed-last-12mo), then
 * a short list of the 5 most recent closed deals below.
 */

function formatCurrency(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function CrandellTeamSpotlight({ deals }) {
  const stats = useMemo(() => {
    const active = deals.filter((d) => d.mls_status === 'Active').length;
    const pending = deals.filter((d) => d.mls_status === 'Pending').length;
    const oneYearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const closed12mo = deals.filter((d) => d.mls_status === 'Closed' && d.close_date && d.close_date >= oneYearAgo);
    const closed24mo = deals.filter((d) => d.mls_status === 'Closed');
    const totalClosedValue = closed12mo.reduce((s, d) => s + (d.close_price || 0), 0);
    const medianClose = (() => {
      const prices = closed12mo.map((d) => d.close_price).filter(Boolean).sort((a, b) => a - b);
      return prices.length ? prices[Math.floor(prices.length / 2)] : null;
    })();
    const recentClosed = closed24mo
      .filter((d) => d.close_date)
      .sort((a, b) => b.close_date.localeCompare(a.close_date))
      .slice(0, 5);
    return {
      active,
      pending,
      closed12mo: closed12mo.length,
      closed24mo: closed24mo.length,
      totalClosedValue,
      medianClose,
      recentClosed,
    };
  }, [deals]);

  return (
    <Card className="bg-white shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="h-4 w-4 text-[#00AFE5]" />
          Crandell Team Spotlight
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Top row: three mini stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-slate-50">
            <div className="text-2xl font-bold text-slate-900">{stats.active}</div>
            <div className="text-xs text-slate-500 mt-1">Active</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-slate-50">
            <div className="text-2xl font-bold text-slate-900">{stats.pending}</div>
            <div className="text-xs text-slate-500 mt-1">Pending</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-[#00AFE5]/10">
            <div className="text-2xl font-bold text-[#00AFE5]">{stats.closed12mo}</div>
            <div className="text-xs text-slate-500 mt-1">Closed 12mo</div>
          </div>
        </div>

        {/* Middle row: totals */}
        <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-100">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Sold (12mo)</div>
            <div className="text-lg font-bold text-slate-900">{formatCurrency(stats.totalClosedValue)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Median Sale (12mo)</div>
            <div className="text-lg font-bold text-slate-900">{formatCurrency(stats.medianClose)}</div>
          </div>
        </div>

        {/* Recent deals list */}
        <div>
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Recent Closings
          </div>
          {stats.recentClosed.length === 0 && (
            <p className="text-sm text-slate-400 italic">No recent closings in the 24-month window.</p>
          )}
          <div className="space-y-2">
            {stats.recentClosed.map((deal, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50/50 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm text-slate-900 truncate">
                    <MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{deal.unparsed_address || 'Address not available'}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 ml-4.5">
                    {deal.city} ·{' '}
                    {deal.close_date
                      ? format(parseISO(deal.close_date), 'MMM d, yyyy')
                      : '—'}
                  </div>
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <div className="text-sm font-bold text-slate-900 tabular-nums">
                    {formatCurrency(deal.close_price)}
                  </div>
                  {deal.days_listing_to_close != null && (
                    <div className="text-xs text-slate-400">{deal.days_listing_to_close}d</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
