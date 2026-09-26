import React from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, X } from 'lucide-react';

export default function NearbyBanner({ locationStatus, onRequestLocation, onDismiss }) {
  if (locationStatus === 'granted' || locationStatus === 'dismissed') return null;

  return (
    <div className="bg-primary/10 border border-primary/30 rounded-lg px-3 py-2 md:p-4 mb-4 md:mb-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden md:flex h-10 w-10 bg-primary/20 rounded-full items-center justify-center flex-shrink-0">
          <MapPin className="h-5 w-5 text-primary" />
        </div>
        <MapPin className="md:hidden h-4 w-4 text-primary flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-slate-900 text-sm">See homes near you</p>
          <p className="hidden md:block text-xs text-slate-500">Allow location access to sort by proximity</p>
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
        {locationStatus === 'loading' ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <>
            <Button size="sm" onClick={onRequestLocation} className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground select-none h-9">
              Enable
            </Button>
            <button onClick={onDismiss} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600 p-2">
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
