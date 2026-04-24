import React, { useState, useEffect } from 'react';
import { invokeFunction } from '@/api/supabaseClient';

// Bumped cache key so old 5-rate cached payloads (stale hardcoded fallbacks
// from the pre-FRED-API version) are ignored on existing visitors' browsers.
const RATES_CACHE_KEY = 'mortgage_rates_cache_v2';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Validate that all rates are real numbers — prevents cache poisoning
function isValidRatesArray(arr) {
  return Array.isArray(arr)
    && arr.length === 2
    && arr.every(r => r && typeof r.rate === 'number' && r.rate > 0 && r.rate < 30);
}

// Shown only while the first fetch is in flight or if the edge function errors.
// Real rates come from Freddie Mac PMMS via FRED (updated weekly on Thursdays).
const FALLBACK_RATES = [
  { label: '30-Yr Fixed', rate: null },
  { label: '15-Yr Fixed', rate: null },
];

export default function MortgageRateTicker() {
  const [rates, setRates] = useState(FALLBACK_RATES);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    // Check cache — but ONLY use it if the data is valid
    const cached = localStorage.getItem(RATES_CACHE_KEY);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (isValidRatesArray(data) && Date.now() - timestamp < CACHE_TTL_MS) {
          setRates(data);
          setLastUpdated(new Date(timestamp));
          setLoading(false);
          return;
        } else {
          // Stale or corrupt — clear it
          localStorage.removeItem(RATES_CACHE_KEY);
        }
      } catch (_) {
        localStorage.removeItem(RATES_CACHE_KEY);
      }
    }

    fetchRates();
  }, []);

  const fetchRates = async () => {
    try {
      const result = await invokeFunction('getMortgageRates', {});

      const newRates = [
        { label: '30-Yr Fixed', rate: result.thirty_year_fixed },
        { label: '15-Yr Fixed', rate: result.fifteen_year_fixed },
      ];

      // Only cache if the data is valid — prevents poisoning the cache
      if (isValidRatesArray(newRates)) {
        setRates(newRates);
        setLastUpdated(new Date());
        localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({
          data: newRates,
          timestamp: Date.now(),
        }));
      } else {
        // Edge function returned incomplete data — show fallback, don't cache
        console.warn('getMortgageRates returned incomplete data, using fallback');
        setRates(FALLBACK_RATES);
      }
    } catch (err) {
      console.error('Mortgage ticker fetch failed:', err);
      setRates(FALLBACK_RATES);
    } finally {
      setLoading(false);
    }
  };

  // Duplicate 4× for a seamless scroll — with only 2 unique rates, 2× felt sparse.
  // Animation still translates -50% (half the track), so perceived density stays smooth.
  const tickerItems = [...rates, ...rates, ...rates, ...rates];

  return (
    <div className="bg-gray-900 text-white overflow-hidden border-t border-gray-700 max-w-[100vw]" style={{ height: '36px' }}>
      <div className="flex items-center h-full">
        {/* Label — uses brand primary instead of hardcoded #52ADEA */}
        <div className="flex-shrink-0 bg-primary px-3 h-full flex items-center z-10">
          <span className="text-xs font-bold tracking-wide whitespace-nowrap text-primary-foreground">MORTGAGE RATES</span>
        </div>

        {/* Scrolling ticker */}
        <div className="relative flex-1 overflow-hidden h-full">
          {loading ? (
            <div className="flex items-center h-full px-4">
              <span className="text-xs text-gray-400 animate-pulse">Loading rates...</span>
            </div>
          ) : (
            <div className="flex items-center h-full animate-ticker whitespace-nowrap">
              {tickerItems.map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 mx-6 text-xs">
                  <span className="text-gray-400 font-medium">{item.label}</span>
                  <span className="text-white font-bold">
                    {item.rate != null ? `${item.rate.toFixed(2)}%` : '—'}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Last updated */}
        {lastUpdated && (
          <div className="flex-shrink-0 px-3 h-full hidden md:flex items-center border-l border-gray-700">
            <span className="text-xs text-gray-500">
              {lastUpdated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker 30s linear infinite;
        }
        .animate-ticker:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
