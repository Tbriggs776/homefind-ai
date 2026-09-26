import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/api/supabaseClient';
import { toast } from '@/components/ui/use-toast';
import { summarizeSearchFilters } from '@/lib/savedSearches';

export const ALERT_FREQUENCIES = [
  { value: 'instant', label: 'As soon as they hit', hint: 'Checked hourly' },
  { value: 'daily', label: 'Daily digest', hint: 'One email a day' },
  { value: 'weekly', label: 'Weekly digest', hint: 'One email a week' },
];

// Filters worth saving: drop empty values and UI-only bookkeeping.
function cleanFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters ?? {}).filter(([, v]) =>
      v !== '' && v != null && v !== false && !(Array.isArray(v) && v.length === 0)),
  );
}

export default function SaveSearchDialog({ user, filters }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [saving, setSaving] = useState(false);

  const openDialog = () => {
    if (!user) {
      navigate('/Login');
      return;
    }
    setName(summarizeSearchFilters(filters) || 'My Arizona home search');
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('saved_searches').insert({
      user_id: user.id,
      name: name.trim().slice(0, 120) || 'My home search',
      filters: cleanFilters(filters),
      frequency,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save this search", description: 'Please try again.', variant: 'destructive' });
      return;
    }
    setOpen(false);
    toast({ title: 'Search saved', description: "We'll email you when new homes match. Manage alerts under Saved Homes." });
  };

  return (
    <>
      <Button variant="brandOutline" size="sm" onClick={openDialog} className="flex-shrink-0">
        <Bell className="h-4 w-4" />
        <span>Save search</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Save this search</DialogTitle>
              <DialogDescription>
                Get an email when new homes match, prices drop, or a home comes back on the market.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 my-4">
              <div>
                <label htmlFor="saved-search-name" className="text-sm font-medium text-foreground">Name</label>
                <Input id="saved-search-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required className="mt-1" />
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-foreground mb-2">Email me</legend>
                <div className="space-y-2">
                  {ALERT_FREQUENCIES.map((f) => (
                    <label key={f.value} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 cursor-pointer ${frequency === f.value ? 'border-primary bg-primary/5' : 'border-border'}`}>
                      <span className="flex items-center gap-2">
                        <input type="radio" name="frequency" value={f.value} checked={frequency === f.value} onChange={() => setFrequency(f.value)} className="accent-primary" />
                        <span className="text-sm text-foreground">{f.label}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{f.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="brandOutline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="brand" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                Save &amp; get alerts
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
