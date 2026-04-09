import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import { format, parseISO } from 'date-fns';

/**
 * RecentSalesFeed — live feed of the 10 most recent metro closings.
 * Helps the team keep a pulse on "what's closing around me" without needing
 * to build a report — just scroll the feed.
 */

function formatCurrency(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPSF(n) {
  if (n == null) return null;
  return `$${Math.round(n)}/sqft`;
}

export default function RecentSalesFeed({ sales }) {
  const rows = (sales || []).slice(0, 10);

  return (
    <Card className="bg-white shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-[#00AFE5]" />
            Recent Metro Sales
          </CardTitle>
          <span className="text-xs text-slate-400">Latest {rows.length} closed</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 && (
          <p className="p-6 text-sm text-slate-400 italic">No recent sales data.</p>
        )}
        <div className="divide-y divide-slate-100">
          {rows.map((sale, idx) => {
            const beds = sale.beds_total ?? '—';
            const baths = sale.baths_total_integer ?? '—';
            const sqft = sale.living_area_sqft
              ? `${Number(sale.living_area_sqft).toLocaleString()} sqft`
              : null;
            const psf = formatPSF(Number(sale.close_price_per_sqft_calculated));
            const dom = sale.days_listing_to_close != null ? `${sale.days_listing_to_close}d DOM` : null;
            const specBits = [`${beds}bd`, `${baths}ba`, sqft].filter(Boolean).join(' · ');

            return (
              <div
                key={sale.spark_listing_key || idx}
                className="px-5 py-3 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {sale.unparsed_address || 'Address not available'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {sale.city}
                      {specBits && ` · ${specBits}`}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatCurrency(sale.close_price)}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 justify-end">
                      {psf && <span>{psf}</span>}
                      {psf && dom && <span className="text-slate-300">·</span>}
                      {dom && <span>{dom}</span>}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Closed{' '}
                  {sale.close_date ? format(parseISO(sale.close_date), 'MMM d, yyyy') : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
