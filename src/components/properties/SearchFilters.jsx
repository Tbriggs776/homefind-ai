import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Search, SlidersHorizontal } from 'lucide-react';
import AdvancedFilters from './AdvancedFilters';


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
  { value: 'custom', label: 'Custom Range' },
];

const LISTING_STATUSES = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'pending', label: 'Pending / Under Contract' },
];

const EMPTY_FILTERS = {
  status: '',
  city: '',
  zip_code: '',
  subdivision: '',
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

function FiltersForm({ filters, onChange, onBatchChange }) {
  const handlePropertyTypeToggle = (type) => {
    const newTypes = filters.property_types.includes(type)
      ? filters.property_types.filter(t => t !== type)
      : [...filters.property_types, type];
    onChange('property_types', newTypes);
  };

  return (
    <div className="space-y-5">
      {/* ===== CORE FILTERS ===== */}

      {/* Listing Status */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Listing Status</Label>
        <Select value={filters.status || 'all'} onValueChange={(v) => onChange('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="border-slate-300"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            {LISTING_STATUSES.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Location</Label>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">City</Label>
            <Input placeholder="Enter city" value={filters.city} onChange={(e) => onChange('city', e.target.value)} className="border-slate-300" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Zip Code</Label>
            <Input placeholder="Enter zip code" value={filters.zip_code} onChange={(e) => onChange('zip_code', e.target.value)} className="border-slate-300" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Subdivision</Label>
            <Input placeholder="e.g. Verrado, Eastmark" value={filters.subdivision} onChange={(e) => onChange('subdivision', e.target.value)} className="border-slate-300" />
          </div>
        </div>
      </div>

      {/* Price Range */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Price Range</Label>
        <Select value={filters.price_preset || ''} onValueChange={(v) => {
          if (v === 'any' || v === '') {
            onBatchChange({ price_preset: '', min_price: '', max_price: '' });
          } else if (v === 'custom') {
            onBatchChange({ price_preset: 'custom' });
          } else {
            const [min, max] = v.split('-');
            onBatchChange({ price_preset: v, min_price: min, max_price: max === '999999999' ? '' : max });
          }
        }}>
          <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any Price" /></SelectTrigger>
          <SelectContent>
            {PRICE_PRESETS.map(p => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.price_preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Min Price</Label>
              <Input type="number" placeholder="e.g. 300000" value={filters.min_price} onChange={(e) => onChange('min_price', e.target.value)} className="border-slate-300" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Max Price</Label>
              <Input type="number" placeholder="e.g. 600000" value={filters.max_price} onChange={(e) => onChange('max_price', e.target.value)} className="border-slate-300" />
            </div>
          </div>
        )}
      </div>

      {/* Bedrooms */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Bedrooms</Label>
        <Select value={filters.bedrooms || ''} onValueChange={(v) => onChange('bedrooms', v === 'any' ? '' : v)}>
          <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {['1','2','3','4','5','6'].map(n => <SelectItem key={n} value={n}>{n}+</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bathrooms */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Bathrooms</Label>
        <Select value={filters.bathrooms || ''} onValueChange={(v) => onChange('bathrooms', v === 'any' ? '' : v)}>
          <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {['1','2','3','4','5'].map(n => <SelectItem key={n} value={n}>{n}+</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Square Footage */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Min Square Footage</Label>
        <Input type="number" placeholder="Any" value={filters.min_sqft} onChange={(e) => onChange('min_sqft', e.target.value)} className="border-slate-300" />
      </div>

      {/* Property Type */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Property Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {PROPERTY_TYPES.map((type) => (
            <div key={type.value} className="flex items-center space-x-2">
              <Checkbox
                id={`type-${type.value}`}
                checked={filters.property_types.includes(type.value)}
                onCheckedChange={() => handlePropertyTypeToggle(type.value)}
              />
              <label htmlFor={`type-${type.value}`} className="text-sm text-slate-700 cursor-pointer">{type.label}</label>
            </div>
          ))}
        </div>
      </div>

      {/* Garage Spaces */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Min Garage Spaces</Label>
        <Select value={filters.min_garage_spaces || ''} onValueChange={(v) => onChange('min_garage_spaces', v === 'any' ? '' : v)}>
          <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {['1','2','3','4'].map(n => <SelectItem key={n} value={n}>{n}+</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Private Pool */}
      <div className="flex items-center space-x-2 py-1">
        <Checkbox id="private-pool" checked={filters.private_pool} onCheckedChange={(checked) => onChange('private_pool', !!checked)} />
        <label htmlFor="private-pool" className="text-sm font-medium text-slate-700 cursor-pointer">Private Pool</label>
      </div>

      {/* Single Story */}
      <div className="flex items-center space-x-2 py-1">
        <Checkbox id="single-story-core" checked={filters.single_story} onCheckedChange={(checked) => onChange('single_story', !!checked)} />
        <label htmlFor="single-story-core" className="text-sm font-medium text-slate-700 cursor-pointer">Single Story Only</label>
      </div>

      {/* ===== ADVANCED FILTERS ===== */}
      <AdvancedFilters filters={filters} onChange={onChange} onBatchChange={onBatchChange} />
    </div>
  );
}

export default function SearchFilters({ onFilterChange, initialFilters = {} }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });

  const handleChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleBatchChange = (changes) => {
    setFilters(prev => ({ ...prev, ...changes }));
  };

  const applyFilters = () => onFilterChange(filters);

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    onFilterChange(EMPTY_FILTERS);
  };

  return (
    <>
      {/* Mobile Drawer */}
      <div className="md:hidden mb-4">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" className="w-full select-none">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
            </Button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[85vh] flex flex-col">
            <DrawerHeader className="flex-shrink-0">
              <DrawerTitle>Search Filters</DrawerTitle>
              <DrawerDescription>Refine your home search</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4 overscroll-contain -webkit-overflow-scrolling-touch">
              <FiltersForm filters={filters} onChange={handleChange} onBatchChange={handleBatchChange} />
            </div>
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-3 flex gap-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <DrawerClose asChild>
                <Button onClick={applyFilters} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white select-none h-12 text-base">
                  <Search className="h-4 w-4 mr-2" />
                  Apply Filters
                </Button>
              </DrawerClose>
              <Button onClick={clearFilters} variant="outline" className="select-none h-12">Clear</Button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {/* Desktop Card */}
      <Card className="hidden md:block bg-white shadow-lg border-slate-200 sticky top-20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-slate-900">Search Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 max-h-[calc(100vh-10rem)] overflow-y-auto pr-2">
          <FiltersForm filters={filters} onChange={handleChange} onBatchChange={handleBatchChange} />
          <div className="flex gap-3 pt-4">
            <Button onClick={applyFilters} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white select-none">
              <Search className="h-4 w-4 mr-2" />
              Apply Filters
            </Button>
            <Button onClick={clearFilters} variant="outline" className="select-none">Clear</Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}