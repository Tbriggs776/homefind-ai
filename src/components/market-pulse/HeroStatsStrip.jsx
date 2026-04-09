import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Home, DollarSign, Clock, Package } from 'lucide-react';

/**
 * HeroStatsStrip — the 4-card KPI row at the top of Market Pulse
 *
 * Visual style matches AnalyticsDashboard's MetricCard pattern exactly so
 * the two pages feel like siblings. Each card has: small label, big number,
 * optional subtext, icon in a soft pill on the right.
 */

function formatCurrency(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}
function formatMoI(moi) {
  if (moi == null) return { value: '—', subtext: '' };
  const rounded = Math.round(moi * 10) / 10;
  let subtext;
  if (moi < 3) subtext = "Seller's market — tight supply";
  else if (moi < 6) subtext = 'Balanced market';
  else subtext = "Buyer's market — excess supply";
  return { value: `${rounded.toFixed(1)} mo`, subtext };
}

function StatCard({ label, value, subtext, icon: Icon }) {
  return (
    <Card className="bg-white shadow-sm border-slate-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">{label}</p>
            <p className="text-3xl font-bold text-slate-900 leading-none">{value}</p>
            {subtext && <p className="text-xs text-slate-400 mt-2 truncate">{subtext}</p>}
          </div>
          <div className="p-2.5 rounded-xl bg-[#00AFE5]/10 flex-shrink-0 ml-3">
            <Icon className="h-5 w-5 text-[#00AFE5]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HeroStatsStrip({ data }) {
  const d = data || {};
  const moi = formatMoI(d.months_of_inventory);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Active Listings"
        value={formatNumber(d.active_total)}
        subtext="Residential, metro-wide"
        icon={Home}
      />
      <StatCard
        label="Closed · Last 30 Days"
        value={formatNumber(d.closed_30d)}
        subtext={`Median ${formatCurrency(d.closed_30d_median)}`}
        icon={DollarSign}
      />
      <StatCard
        label="Median DOM"
        value={d.median_dom != null ? `${d.median_dom} days` : '—'}
        subtext="Listing → contract, last 30d sales"
        icon={Clock}
      />
      <StatCard
        label="Months of Inventory"
        value={moi.value}
        subtext={moi.subtext}
        icon={Package}
      />
    </div>
  );
}
