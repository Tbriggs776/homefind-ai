import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronUp } from 'lucide-react';

function FilterCheckbox({ id, label, checked, onChange }) {
  return (
    <div className="flex items-center space-x-2 py-1">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(!!c)} />
      <label htmlFor={id} className="text-sm text-slate-700 cursor-pointer">{label}</label>
    </div>
  );
}

function Section({ title, open, onToggle, children }) {
  return (
    <div className="border-t border-slate-200 pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full text-left"
      >
        <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer">{title}</Label>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  );
}

export default function AdvancedFilters({ filters, onChange, onBatchChange }) {
  const [openSections, setOpenSections] = useState({});

  const toggle = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const handleYearPreset = (preset) => {
    if (preset === 'any' || preset === '') {
      onBatchChange({ year_built_preset: '', min_year_built: '', max_year_built: '' });
    } else if (preset === 'custom') {
      onBatchChange({ year_built_preset: 'custom' });
    } else {
      onBatchChange({ year_built_preset: preset, min_year_built: preset, max_year_built: '' });
    }
  };

  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Advanced</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Lot & Land */}
      <Section title="Lot & Land" open={openSections.lot} onToggle={() => toggle('lot')}>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Min Lot Size</Label>
          <Select value={filters.min_lot_size || ''} onValueChange={(v) => onChange('min_lot_size', v === 'any' ? '' : v)}>
            <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="0.115">5,000 sq ft or less</SelectItem>
              <SelectItem value="0.1149">5,001 sq ft</SelectItem>
              <SelectItem value="0.172">7,500 sq ft</SelectItem>
              <SelectItem value="0.23">10K sq ft</SelectItem>
              <SelectItem value="0.5">½ acre</SelectItem>
              <SelectItem value="0.75">¾ acre</SelectItem>
              <SelectItem value="1">1 acre</SelectItem>
              <SelectItem value="2">2 acres</SelectItem>
              <SelectItem value="3">3+ acres</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FilterCheckbox id="horse_property" label="Horse Property" checked={filters.horse_property} onChange={(v) => onChange('horse_property', v)} />
        <FilterCheckbox id="corner_lot" label="Corner Lot" checked={filters.corner_lot} onChange={(v) => onChange('corner_lot', v)} />
        <FilterCheckbox id="cul_de_sac" label="Cul-de-Sac" checked={filters.cul_de_sac} onChange={(v) => onChange('cul_de_sac', v)} />
        <FilterCheckbox id="waterfront" label="Waterfront" checked={filters.waterfront} onChange={(v) => onChange('waterfront', v)} />
        <FilterCheckbox id="has_view" label="Has View (Mountain/City/Desert)" checked={filters.has_view} onChange={(v) => onChange('has_view', v)} />
      </Section>

      {/* Community */}
      <Section title="Community" open={openSections.community} onToggle={() => toggle('community')}>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">HOA</Label>
          <Select value={filters.hoa_filter || ''} onValueChange={(v) => onChange('hoa_filter', v === 'either' ? '' : v)}>
            <SelectTrigger className="border-slate-300"><SelectValue placeholder="Either" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="either">Either</SelectItem>
              <SelectItem value="yes">Yes (HOA)</SelectItem>
              <SelectItem value="no">No HOA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FilterCheckbox id="gated_community" label="Gated Community" checked={filters.gated_community} onChange={(v) => onChange('gated_community', v)} />
        <FilterCheckbox id="golf_course_lot" label="Golf Course Lot" checked={filters.golf_course_lot} onChange={(v) => onChange('golf_course_lot', v)} />
        <FilterCheckbox id="community_pool" label="Community Pool" checked={filters.community_pool} onChange={(v) => onChange('community_pool', v)} />
        <FilterCheckbox id="age_restricted_55plus" label="55+ Community" checked={filters.age_restricted_55plus} onChange={(v) => onChange('age_restricted_55plus', v)} />
      </Section>

      {/* Structure & Layout */}
      <Section title="Structure & Layout" open={openSections.structure} onToggle={() => toggle('structure')}>
        <FilterCheckbox id="rv_garage" label="RV Garage / Gate" checked={filters.rv_garage} onChange={(v) => onChange('rv_garage', v)} />
        <FilterCheckbox id="casita_guest_house" label="Casita / Guest House" checked={filters.casita_guest_house} onChange={(v) => onChange('casita_guest_house', v)} />
        <FilterCheckbox id="office_den" label="Office / Den" checked={filters.office_den} onChange={(v) => onChange('office_den', v)} />
        <FilterCheckbox id="basement" label="Basement" checked={filters.basement} onChange={(v) => onChange('basement', v)} />
        <FilterCheckbox id="open_floor_plan" label="Open Floor Plan" checked={filters.open_floor_plan} onChange={(v) => onChange('open_floor_plan', v)} />
        <FilterCheckbox id="spa_hot_tub" label="Spa / Hot Tub" checked={filters.spa_hot_tub} onChange={(v) => onChange('spa_hot_tub', v)} />
      </Section>

      {/* Condition & Energy */}
      <Section title="Condition & Energy" open={openSections.condition} onToggle={() => toggle('condition')}>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Year Built</Label>
          <Select value={filters.year_built_preset || ''} onValueChange={handleYearPreset}>
            <SelectTrigger className="border-slate-300"><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="2015">2015+</SelectItem>
              <SelectItem value="2010">2010+</SelectItem>
              <SelectItem value="2000">2000+</SelectItem>
              <SelectItem value="1990">1990+</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filters.year_built_preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">From</Label>
              <Input type="number" placeholder="e.g. 1980" value={filters.min_year_built} onChange={(e) => onChange('min_year_built', e.target.value)} className="border-slate-300" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">To</Label>
              <Input type="number" placeholder="e.g. 2024" value={filters.max_year_built} onChange={(e) => onChange('max_year_built', e.target.value)} className="border-slate-300" />
            </div>
          </div>
        )}
        <FilterCheckbox id="recently_remodeled" label="Recently Remodeled" checked={filters.recently_remodeled} onChange={(v) => onChange('recently_remodeled', v)} />
        <FilterCheckbox id="solar_owned" label="Solar (Owned)" checked={filters.solar_owned} onChange={(v) => onChange('solar_owned', v)} />
        <FilterCheckbox id="solar_leased" label="Solar (Leased)" checked={filters.solar_leased} onChange={(v) => onChange('solar_leased', v)} />
        <FilterCheckbox id="energy_efficient" label="Energy Efficient" checked={filters.energy_efficient} onChange={(v) => onChange('energy_efficient', v)} />
      </Section>

      {/* Schools */}
      <Section title="Schools" open={openSections.schools} onToggle={() => toggle('schools')}>
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">School Name</Label>
          <Input placeholder="Search school name" value={filters.school_name} onChange={(e) => onChange('school_name', e.target.value)} className="border-slate-300" />
        </div>
      </Section>

      {/* Media & Tours */}
      <Section title="Media & Tours" open={openSections.media} onToggle={() => toggle('media')}>
        <FilterCheckbox id="has_virtual_tour" label="Has 3D Virtual Tour" checked={filters.has_virtual_tour} onChange={(v) => onChange('has_virtual_tour', v)} />
      </Section>
    </div>
  );
}