import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3 } from 'lucide-react';

/**
 * PriceBandChart — horizontal bar chart showing how active residential
 * inventory is distributed across price bands. Helps visualize where the
 * market inventory is concentrated.
 */

const COLORS = ['#00AFE5', '#3a9dd8', '#1e7cc0', '#0c5fa8', '#06438a', '#03306b'];

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2">
      <div className="text-xs font-semibold text-slate-900">{row.label}</div>
      <div className="text-sm text-[#00AFE5] font-bold">{row.count.toLocaleString()} listings</div>
      {row.pct != null && <div className="text-xs text-slate-400 mt-0.5">{row.pct}% of active inventory</div>}
    </div>
  );
}

export default function PriceBandChart({ bands }) {
  const total = (bands || []).reduce((s, b) => s + (b.count || 0), 0);
  const data = (bands || []).map((b) => ({
    ...b,
    pct: total > 0 ? Math.round((b.count / total) * 100) : 0,
  }));

  return (
    <Card className="bg-white shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-[#00AFE5]" />
            Active Inventory by Price Band
          </CardTitle>
          <span className="text-xs text-slate-400">{total.toLocaleString()} total listings</span>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 5, right: 40, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={(v) => v.toLocaleString()}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }}
                width={110}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {data.map((entry, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
