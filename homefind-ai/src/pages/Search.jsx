import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchProperties, toggleSaveProperty, fetchSavedPropertyIds, logSearchEvent } from '@/api/useSupabase';
import { useAuth } from '@/lib/AuthContext';
import ListingCard from '@/components/ListingCard';

const SORT_OPTIONS = [
  { value: 'list_date-desc', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low → High' },
  { value: 'price-desc', label: 'Price: High → Low' },
  { value: 'square_feet-desc', label: 'Largest' },
  { value: 'bedrooms-desc', label: 'Most Bedrooms' },
];

const PROPERTY_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'Residential', label: 'Single Family' },
  { value: 'Condo/Townhouse', label: 'Condo / Townhouse' },
  { value: 'Multi-Family', label: 'Multi-Family' },
  { value: 'Land', label: 'Land' },
];

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState(new Set());

  // Filters from URL params
  const [filters, setFilters] = useState({
    city: searchParams.get('q') || '',
    zip: searchParams.get('zip') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    minBeds: searchParams.get('beds') || '',
    minBaths: searchParams.get('baths') || '',
    propertyType: searchParams.get('type') || 'all',
    minSqft: searchParams.get('minSqft') || '',
    hasPool: searchParams.get('pool') === 'true',
  });
  const [sort, setSort] = useState(searchParams.get('sort') || 'list_date-desc');
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1'));

  // Load saved IDs for heart state
  useEffect(() => {
    if (user) {
      fetchSavedPropertyIds(user.id).then(({ ids }) => setSavedIds(new Set(ids)));
    }
  }, [user]);

  // Fetch results when filters/sort/page change
  const doSearch = useCallback(async () => {
    setLoading(true);
    const [sortBy, sortDir] = sort.split('-');
    const cleanFilters = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v && v !== 'all' && v !== false) cleanFilters[k] = v;
    });

    const res = await fetchProperties({
      filters: cleanFilters,
      page,
      pageSize: 24,
      sortBy,
      sortAsc: sortDir === 'asc',
    });

    setResults(res.properties);
    setTotal(res.total);
    setTotalPages(res.totalPages);
    setLoading(false);

    // Log search event (fire and forget)
    logSearchEvent(cleanFilters, res.total, user?.id);
  }, [filters, sort, page, user]);

  useEffect(() => { doSearch(); }, [doSearch]);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.city) params.set('q', filters.city);
    if (filters.zip) params.set('zip', filters.zip);
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    if (filters.minBeds) params.set('beds', filters.minBeds);
    if (filters.minBaths) params.set('baths', filters.minBaths);
    if (filters.propertyType && filters.propertyType !== 'all') params.set('type', filters.propertyType);
    if (filters.minSqft) params.set('minSqft', filters.minSqft);
    if (filters.hasPool) params.set('pool', 'true');
    if (sort !== 'list_date-desc') params.set('sort', sort);
    if (page > 1) params.set('page', page.toString());
    setSearchParams(params, { replace: true });
  }, [filters, sort, page, setSearchParams]);

  function updateFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  }

  async function handleToggleSave(propertyId) {
    if (!user) return;
    const { saved } = await toggleSaveProperty(user.id, propertyId);
    setSavedIds(prev => {
      const next = new Set(prev);
      saved ? next.add(propertyId) : next.delete(propertyId);
      return next;
    });
  }

  return (
    <>
      {/* Filters */}
      <div className="filters-panel">
        <div className="filter-group">
          <label>City / Area</label>
          <input
            type="text"
            placeholder="e.g. Queen Creek"
            value={filters.city}
            onChange={(e) => updateFilter('city', e.target.value)}
            style={{ minWidth: 160 }}
          />
        </div>
        <div className="filter-group">
          <label>ZIP</label>
          <input
            type="text"
            placeholder="85142"
            value={filters.zip}
            onChange={(e) => updateFilter('zip', e.target.value)}
            style={{ minWidth: 90 }}
          />
        </div>
        <div className="filter-group">
          <label>Min Price</label>
          <select value={filters.minPrice} onChange={(e) => updateFilter('minPrice', e.target.value)}>
            <option value="">Any</option>
            <option value="100000">$100k</option>
            <option value="200000">$200k</option>
            <option value="300000">$300k</option>
            <option value="400000">$400k</option>
            <option value="500000">$500k</option>
            <option value="750000">$750k</option>
            <option value="1000000">$1M</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Max Price</label>
          <select value={filters.maxPrice} onChange={(e) => updateFilter('maxPrice', e.target.value)}>
            <option value="">Any</option>
            <option value="300000">$300k</option>
            <option value="500000">$500k</option>
            <option value="750000">$750k</option>
            <option value="1000000">$1M</option>
            <option value="1500000">$1.5M</option>
            <option value="2000000">$2M</option>
            <option value="5000000">$5M+</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Beds</label>
          <select value={filters.minBeds} onChange={(e) => updateFilter('minBeds', e.target.value)}>
            <option value="">Any</option>
            <option value="1">1+</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
            <option value="5">5+</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Baths</label>
          <select value={filters.minBaths} onChange={(e) => updateFilter('minBaths', e.target.value)}>
            <option value="">Any</option>
            <option value="1">1+</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Type</label>
          <select value={filters.propertyType} onChange={(e) => updateFilter('propertyType', e.target.value)}>
            {PROPERTY_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Sort</label>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            {SORT_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group" style={{ alignSelf: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text)' }}>
            <input
              type="checkbox"
              checked={filters.hasPool}
              onChange={(e) => updateFilter('hasPool', e.target.checked)}
            />
            Pool
          </label>
        </div>
      </div>

      {/* Results header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 24px 0', maxWidth: 1400, margin: '0 auto',
      }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
          {loading ? 'Searching...' : `${total.toLocaleString()} results`}
          {filters.city && !loading && ` in "${filters.city}"`}
        </div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', opacity: 0.6 }}>
          Page {page} of {totalPages || 1}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="spinner" />
      ) : results.length > 0 ? (
        <div className="listing-grid" style={{ maxWidth: 1400, margin: '0 auto' }}>
          {results.map((p) => (
            <ListingCard
              key={p.id}
              property={p}
              onToggleSave={user ? handleToggleSave : null}
              isSaved={savedIds.has(p.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No listings found</h3>
          <p>Try adjusting your filters or searching a different area.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let pageNum;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (page <= 4) {
              pageNum = i + 1;
            } else if (page >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = page - 3 + i;
            }
            return (
              <button
                key={pageNum}
                className={page === pageNum ? 'active' : ''}
                onClick={() => setPage(pageNum)}
              >
                {pageNum}
              </button>
            );
          })}
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}
