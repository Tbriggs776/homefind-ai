import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Search, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import AdvancedFilters from './AdvancedFilters';

// ============================================================================
// CONSTANTS
// ============================================================================

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'multi_family', label: 'Multi-Family' },
  { value: 'new_construction', label: 'New Construction' },
  { value: 'land', label: 'Land' },
];

const PRICE_PRESETS = [
  { value: 'any', label: 'Any Price' },
  { value: '0-200000', label: 'Under $200K' },
  { value: '200000-300000', label: '$200K – $300K' },
  { value: '300000-400000', label: '$300K – $400K' },
  { value: '400000-500000', label: '$400K – $500K' },
  { value: '500000-600000', label: '$500K – $600K' },
  { value: '600000-750000', label: '$600K – $750K' },
  { value: '750000-1000000', label: '$750K – $1M' },
  { value: '1000000-1500000', label: '$1M – $1.5M' },
  { value: '1500000-2000000', label: '$1.5M – $2M' },
  { value: '2000000-999999999', label: '$2M+' },
];

const LISTING_STATUSES = [
  { value: 'all', label: 'All Listings' },
  { value: 'active', label: 'Active' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'pending', label: 'Pending / Under Contract' },
];

const EMPTY_FILTERS = {
  status: '',
  city: '',
  zip_code: '',
  subdivision: '',
  query_text: '',
  price_preset: '',
  min_price: '',
  max_price: '',
  bedrooms: '',
  bathrooms: '',
  min_sqft: '',
  property_types: [],
  min_garage_spaces: '',
  private_pool: false,
  min_lot_size: '',
  horse_property: false,
  corner_lot: false,
  cul_de_sac: false,
  waterfront: false,
  hoa_filter: '',
  gated_community: false,
  golf_course_lot: false,
  community_pool: false,
  age_restricted_55plus: false,
  single_story: false,
  rv_garage: false,
  casita_guest_house: false,
  office_den: false,
  basement: false,
  open_floor_plan: false,
  year_built_preset: '',
  min_year_built: '',
  max_year_built: '',
  recently_remodeled: false,
  solar_owned: false,
  solar_leased: false,
  energy_efficient: false,
  spa_hot_tub: false,
  has_view: false,
  has_virtual_tour: false,
  school_name: '',
};

// ============================================================================
// CHIP — a button that opens a popover. Hand-rolled with click-outside
// detection so we don't depend on shadcn Popover (which may or may not be
// installed in this codebase).
// ============================================================================
function FilterChip({ label, isActive, children, popoverWidth = 280 }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Click-outside detection
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-primary/10 text-primary border-primary'
            : 'bg-white text-foreground border-border hover:border-primary/50'
        }`}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 z-50 bg-white rounded-lg shadow-xl border border-border p-4"
          style={{ width: popoverWidth, maxWidth: '90vw' }}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function SearchFilters({ onFilterChange, initialFilters = {} }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });

  // Sync with initialFilters changes (e.g., from URL params on Search.jsx mount)
  useEffect(() => {
    setFilters(prev => ({ ...prev, ...initialFilters }));
  }, [initialFilters.city, initialFilters.subdivision, initialFilters.zip_code, initialFilters.query_text]);

  // Apply on every change — no Apply button anymore
  const handleChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleBatchChange = (changes) => {
    const newFilters = { ...filters, ...changes };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handlePropertyTypeToggle = (type) => {
    const newTypes = filters.property_types.includes(type)
      ? filters.property_types.filter(t => t !== type)
      : [...filters.property_types, type];
    handleChange('property_types', newTypes);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    onFilterChange(EMPTY_FILTERS);
  };

  const clearOne = (key, value = '') => {
    handleChange(key, value);
  };

  // Active filter labels for the tag pill row below the chips
  const activeFilterTags = [];
  if (filters.query_text) activeFilterTags.push({ key: 'query_text', label: `"${filters.query_text}"`, clearTo: '' });
  if (filters.city) activeFilterTags.push({ key: 'city', label: filters.city, clearTo: '' });
  if (filters.zip_code) activeFilterTags.push({ key: 'zip_code', label: filters.zip_code, clearTo: '' });
  if (filters.subdivision) activeFilterTags.push({ key: 'subdivision', label: filters.subdivision, clearTo: '' });
  if (filters.status && filters.status !== '') {
    const statusLabel = LISTING_STATUSES.find(s => s.value === filters.status)?.label;
    if (statusLabel) activeFilterTags.push({ key: 'status', label: statusLabel, clearTo: '' });
  }
  if (filters.price_preset && filters.price_preset !== 'custom') {
    const priceLabel = PRICE_PRESETS.find(p => p.value === filters.price_preset)?.label;
    if (priceLabel && priceLabel !== 'Any Price') {
      activeFilterTags.push({
        key: 'price_preset',
        label: priceLabel,
        clearAll: () => handleBatchChange({ price_preset: '', min_price: '', max_price: '' })
      });
    }
  }
  if (filters.price_preset === 'custom' && (filters.min_price || filters.max_price)) {
    const min = filters.min_price ? `$${(filters.min_price / 1000).toFixed(0)}K` : 'Any';
    const max = filters.max_price ? `$${(filters.max_price / 1000).toFixed(0)}K` : 'Any';
    activeFilterTags.push({
      key: 'custom_price',
      label: `${min} – ${max}`,
      clearAll: () => handleBatchChange({ price_preset: '', min_price: '', max_price: '' })
    });
  }
  if (filters.bedrooms) activeFilterTags.push({ key: 'bedrooms', label: `${filters.bedrooms}+ beds`, clearTo: '' });
  if (filters.bathrooms) activeFilterTags.push({ key: 'bathrooms', label: `${filters.bathrooms}+ baths`, clearTo: '' });
  if (filters.property_types?.length > 0) {
    activeFilterTags.push({
      key: 'property_types',
      label: `${filters.property_types.length} type${filters.property_types.length === 1 ? '' : 's'}`,
      clearTo: []
    });
  }
  if (filters.min_sqft) activeFilterTags.push({ key: 'min_sqft', label: `${Number(filters.min_sqft).toLocaleString()}+ sqft`, clearTo: '' });
  if (filters.private_pool) activeFilterTags.push({ key: 'private_pool', label: 'Pool', clearTo: false });
  if (filters.single_story) activeFilterTags.push({ key: 'single_story', label: 'Single Story', clearTo: false });

  const hasAnyFilter = activeFilterTags.length > 0;

  // Chip labels — show current selection if active
  const statusLabel = filters.status
    ? LISTING_STATUSES.find(s => s.value === filters.status)?.label || 'For Sale'
    : 'For Sale';
  const priceLabel = (() => {
    if (filters.price_preset === 'custom' && (filters.min_price || filters.max_price)) {
      const min = filters.min_price ? `$${(filters.min_price / 1000).toFixed(0)}K` : 'Any';
      const max = filters.max_price ? `$${(filters.max_price / 1000).toFixed(0)}K` : 'Any';
      return `${min} – ${max}`;
    }
    if (filters.price_preset && filters.price_preset !== '') {
      const found = PRICE_PRESETS.find(p => p.value === filters.price_preset);
      if (found && found.label !== 'Any Price') return found.label;
    }
    return 'Price';
  })();
  const bedsLabel = filters.bedrooms ? `${filters.bedrooms}+ beds` : 'Beds';
  const bathsLabel = filters.bathrooms ? `${filters.bathrooms}+ baths` : 'Baths';
  const homeTypeLabel = filters.property_types?.length > 0
    ? `${filters.property_types.length} type${filters.property_types.length === 1 ? '' : 's'}`
    : 'Home Type';

  // ============================================================================
  // INNER POPOVER CONTENTS
  // ============================================================================

  const StatusPopover = (close) => (
    <div className="space-y-1">
      {LISTING_STATUSES.map(s => (
        <button
          key={s.value}
          onClick={() => { handleChange('status', s.value === 'all' ? '' : s.value); close(); }}
          className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${
            (filters.status === s.value || (s.value === 'all' && !filters.status)) ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const PricePopover = (close) => (
    <div className="space-y-1 max-h-[400px] overflow-y-auto">
      {PRICE_PRESETS.map(p => (
        <button
          key={p.value}
          onClick={() => {
            if (p.value === 'any') {
              handleBatchChange({ price_preset: '', min_price: '', max_price: '' });
            } else {
              const [min, max] = p.value.split('-');
              handleBatchChange({ price_preset: p.value, min_price: min, max_price: max === '999999999' ? '' : max });
            }
            close();
          }}
          className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${
            filters.price_preset === p.value ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground'
          }`}
        >
          {p.label}
        </button>
      ))}
      <div className="border-t border-border pt-2 mt-2">
        <p className="text-xs text-muted-foreground mb-2 px-1">Custom range</p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={filters.min_price}
            onChange={(e) => handleBatchChange({ price_preset: 'custom', min_price: e.target.value })}
            className="text-sm"
          />
          <Input
            type="number"
            placeholder="Max"
            value={filters.max_price}
            onChange={(e) => handleBatchChange({ price_preset: 'custom', max_price: e.target.value })}
            className="text-sm"
          />
        </div>
      </div>
    </div>
  );

  const BedsPopover = (close) => (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Minimum bedrooms</p>
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => { handleChange('bedrooms', ''); close(); }}
          className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
            !filters.bedrooms ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border hover:border-primary'
          }`}
        >
          Any
        </button>
        {['1','2','3','4','5','6'].map(n => (
          <button
            key={n}
            onClick={() => { handleChange('bedrooms', n); close(); }}
            className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
              filters.bedrooms === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border hover:border-primary'
            }`}
          >
            {n}+
          </button>
        ))}
      </div>
    </div>
  );

  const BathsPopover = (close) => (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Minimum bathrooms</p>
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => { handleChange('bathrooms', ''); close(); }}
          className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
            !filters.bathrooms ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border hover:border-primary'
          }`}
        >
          Any
        </button>
        {['1','2','3','4','5'].map(n => (
          <button
            key={n}
            onClick={() => { handleChange('bathrooms', n); close(); }}
            className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
              filters.bathrooms === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border hover:border-primary'
            }`}
          >
            {n}+
          </button>
        ))}
      </div>
    </div>
  );

  const HomeTypePopover = (close) => (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Select one or more</p>
      <div className="space-y-2">
        {PROPERTY_TYPES.map(type => (
          <div key={type.value} className="flex items-center space-x-2">
            <Checkbox
              id={`chip-type-${type.value}`}
              checked={filters.property_types.includes(type.value)}
              onCheckedChange={() => handlePropertyTypeToggle(type.value)}
            />
            <label htmlFor={`chip-type-${type.value}`} className="text-sm text-foreground cursor-pointer">
              {type.label}
            </label>
          </div>
        ))}
      </div>
    </div>
  );

  // The "More" drawer content — square footage, garage, lot, single story, pool, plus AdvancedFilters
  const MoreDrawerContent = (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold text-foreground">Min Square Footage</Label>
        <Input
          type="number"
          placeholder="Any"
          value={filters.min_sqft}
          onChange={(e) => handleChange('min_sqft', e.target.value)}
          className="mt-1"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold text-foreground">Min Garage Spaces</Label>
        <div className="grid grid-cols-5 gap-2 mt-1">
          <button
            onClick={() => handleChange('min_garage_spaces', '')}
            className={`py-2 rounded-md text-sm font-medium border ${
              !filters.min_garage_spaces ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border'
            }`}
          >
            Any
          </button>
          {['1','2','3','4'].map(n => (
            <button
              key={n}
              onClick={() => handleChange('min_garage_spaces', n)}
              className={`py-2 rounded-md text-sm font-medium border ${
                filters.min_garage_spaces === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground border-border'
              }`}
            >
              {n}+
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="more-private-pool"
          checked={filters.private_pool}
          onCheckedChange={(checked) => handleChange('private_pool', !!checked)}
        />
        <label htmlFor="more-private-pool" className="text-sm font-medium text-foreground cursor-pointer">
          Private Pool
        </label>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="more-single-story"
          checked={filters.single_story}
          onCheckedChange={(checked) => handleChange('single_story', !!checked)}
        />
        <label htmlFor="more-single-story" className="text-sm font-medium text-foreground cursor-pointer">
          Single Story Only
        </label>
      </div>

      <div className="border-t border-border pt-4">
        <AdvancedFilters filters={filters} onChange={handleChange} onBatchChange={handleBatchChange} />
      </div>
    </div>
  );

  return (
    <div className="bg-background">
      {/* ====================================================================
          TEXT SEARCH INPUT — single combined field for city/zip/subdivision
          ==================================================================== */}
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Address, city, neighborhood, ZIP, or subdivision"
            value={filters.query_text || filters.city || filters.subdivision || filters.zip_code || ''}
            onChange={(e) => {
              const val = e.target.value;
              // Pure digits → precise zip_code match (faster, indexed column)
              // Anything else → query_text fuzzy search across address, city,
              // and subdivision so users find homes by neighborhood name
              if (/^\d+$/.test(val)) {
                handleBatchChange({ zip_code: val, query_text: '', city: '', subdivision: '' });
              } else {
                handleBatchChange({ query_text: val, zip_code: '', city: '', subdivision: '' });
              }
            }}
            className="pl-9"
          />
        </div>
      </div>

      {/* ====================================================================
          CHIP ROW — primary filters as horizontal pills
          ==================================================================== */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChip label={statusLabel} isActive={!!filters.status}>
          {StatusPopover}
        </FilterChip>

        <FilterChip label={priceLabel} isActive={!!filters.price_preset || !!filters.min_price || !!filters.max_price} popoverWidth={300}>
          {PricePopover}
        </FilterChip>

        <FilterChip label={bedsLabel} isActive={!!filters.bedrooms}>
          {BedsPopover}
        </FilterChip>

        <FilterChip label={bathsLabel} isActive={!!filters.bathrooms}>
          {BathsPopover}
        </FilterChip>

        <FilterChip label={homeTypeLabel} isActive={filters.property_types?.length > 0} popoverWidth={240}>
          {HomeTypePopover}
        </FilterChip>

        {/* More — uses Drawer (proven working in this codebase) */}
        <Drawer>
          <DrawerTrigger asChild>
            <button
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap bg-white text-foreground border-border hover:border-primary/50`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              More
            </button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[85vh] flex flex-col">
            <DrawerHeader className="flex-shrink-0">
              <DrawerTitle>More filters</DrawerTitle>
              <DrawerDescription>Square footage, garage, lot, schools, and more</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4 overscroll-contain">
              {MoreDrawerContent}
            </div>
            <div
              className="flex-shrink-0 border-t border-border bg-white px-4 py-3 flex gap-3"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <DrawerClose asChild>
                <Button className="flex-1 bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground select-none h-12 text-base">
                  Done
                </Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>

        {/* Clear all — only shows when filters are active */}
        {hasAnyFilter && (
          <button
            onClick={clearFilters}
            className="ml-auto text-sm text-muted-foreground hover:text-destructive underline transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* ====================================================================
          ACTIVE FILTER TAGS — small removable pills below the chip row
          ==================================================================== */}
      {activeFilterTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-border">
          <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mr-1">Active:</span>
          {activeFilterTags.map((tag) => (
            <button
              key={tag.key}
              onClick={() => tag.clearAll ? tag.clearAll() : clearOne(tag.key, tag.clearTo)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
            >
              {tag.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
