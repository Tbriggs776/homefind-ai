import React from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, X } from 'lucide-react';

export default function NearbyBanner({ locationStatus, onRequestLocation, onDismiss }) {
  if (locationStatus === 'granted' || locationStatus === 'dismissed') return null;

  return (
    <div className="bg-[#52ADEA]/10 border border-[#52ADEA]/30 rounded-lg p-4 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 bg-[#52ADEA]/20 rounded-full flex items-center justify-center flex-shrink-0">
          <MapPin className="h-5 w-5 text-[#52ADEA]" />
        </div>
        <div>
          <p className="font-medium text-slate-900 text-sm">See homes near you</p>
          <p className="text-xs text-slate-500">Allow location access to sort by proximity</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {locationStatus === 'loading' ? (
          <Loader2 className="h-5 w-5 animate-spin text-[#52ADEA]" />
        ) : (
          <>
            <Button size="sm" onClick={onRequestLocation} className="bg-[#52ADEA] hover:bg-[#3a9dd8] text-white select-none">
              Enable
            </Button>
            <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 p-1">
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}