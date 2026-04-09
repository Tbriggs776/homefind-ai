import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, Building2 } from 'lucide-react';

/**
 * TopCitiesTable — sortable activity table for the top residential cities in
 * the metro. Click any column header to re-sort. Default sort: active desc.
 *
 * Rows are pre-filtered server-side to cities with at least 50 active
 * listings, so tiny neighborhoods don't pollute the view.
 */

function formatCurrency(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}
function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}
function formatPSF(n) {
  if (n == null) return '—';
  return `$${Math.round(n)}`;
}

const COLUMNS = [
  { key: 'city', label: 'City', align: 'left', sortable: true, width: 'w-1/5' },
  { key: 'active', label: 'Active', align: 'right', sortable: true, format: formatNumber },
  { key: 'pending', label: 'Pending', align: 'right', sortable: true, format: formatNumber },
  { key: 'closed_90d', label: 'Closed 90d', align: 'right', sortable: true, format: formatNumber },
  { key: 'avg_close_90d', label: 'Avg Close', align: 'right', sortable: true, format: formatCurrency },
  { key: 'avg_psf_90d', label: '$/SqFt', align: 'right', sortable: true, format: formatPSF },
  { key: 'median_dom_90d', label: 'Median DOM', align: 'right', sortable: true, format: (v) => (v != null ? `${v}d` : '—') },
];

export default function TopCitiesTable({ rows }) {
  const [sortKey, setSortKey] = useState('active');
  const [sortDir, setSortDir] = useState('desc');

  const sortedRows = useMemo(() => {
    const r = [...(rows || [])];
    r.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return r;
  }, [rows, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'city' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ columnKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="h-3 w-3 opacity-30 inline ml-1" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[#00AFE5] inline ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[#00AFE5] inline ml-1" />
    );
  };

  return (
    <Card className="bg-white shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-[#00AFE5]" />
            Top Cities by Activity
          </CardTitle>
          <span className="text-xs text-slate-400">{sortedRows.length} cities · min 50 active</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200">
                {COLUMNS.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`${col.align === 'right' ? 'text-right' : 'text-left'} ${col.width || ''} text-xs font-semibold text-slate-600 uppercase tracking-wide ${col.sortable ? 'cursor-pointer hover:text-slate-900 select-none' : ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    {col.label}
                    {col.sortable && <SortIcon columnKey={col.key} />}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row, idx) => (
                <TableRow
                  key={row.city}
                  className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-[#00AFE5]/5 transition-colors border-b border-slate-100`}
                >
                  {COLUMNS.map((col) => (
                    <TableCell
                      key={col.key}
                      className={`${col.align === 'right' ? 'text-right tabular-nums' : 'text-left font-medium text-slate-900'} py-3`}
                    >
                      {col.format ? col.format(row[col.key]) : row[col.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="text-center py-8 text-sm text-slate-400">
                    No city data available yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
