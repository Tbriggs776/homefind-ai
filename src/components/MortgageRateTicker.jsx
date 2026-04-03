import React, { useState, useEffect } from 'react';
import { invokeFunction } from '@/api/supabaseClient';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

const RATES_CACHE_KEY = 'mortgage_rates_cache';

export default function MortgageRateTicker() {
  const [rates, setRates] = useState([
    { label: '30-Yr Fixed', rate: null },
    { label: '15-Yr Fixed', rate: null },
    { label: '5/1 ARM', rate: null },
    { label: 'FHA 30-Yr', rate: null },
    { label: 'VA 30-Yr', rate: null },
  ]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    // Check localStorage cache first (cache for 6 hours)
    const cached = localStorage.getItem(RATES_CACHE_KEY);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const sixHours = 6 * 60 * 60 * 1000;
        if (Date.now() - timestamp < sixHours) {
          setRates(data);
          setLastUpdated(new Date(timestamp));
          setLoading(false);
          return;
        }
      } catch (_) {}
    }

    fetchRates();
  }, []);

  const fetchRates = async () => {
    try {
      const result = await invokeFunction('invokeLLM', {
        prompt: `Fetch the current average US mortgage interest rates as of today (${new Date().toLocaleDateString()}).
        Return ONLY a JSON object with these exact keys and their current rates as numbers (e.g. 6.85):
        - thirty_year_fixed
        - fifteen_year_fixed
        - five_one_arm
        - fha_thirty_year
        - va_thirty_year
        Use the most recent Freddie Mac or Bankrate data. Return only the JSON, no other text.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            thirty_year_fixed: { type: 'number' },
            fifteen_year_fixed: { type: 'number' },
            five_one_arm: { type: 'number' },
            fha_thirty_year: { type: 'number' },
            va_thirty_year: { type: 'number' },
          }
        }
      });

      const newRates = [
        { label: '30-Yr Fixed', rate: result.thirty_year_fixed },
        { label: '15-Yr Fixed', rate: result.fifteen_year_fixed },
        { label: '5/1 ARM', rate: result.five_one_arm },
        { label: 'FHA 30-Yr', rate: result.fha_thirty_year },
        { label: 'VA 30-Yr', rate: result.va_thirty_year },
      ];

      setRates(newRates);
      setLastUpdated(new Date());
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ data: newRates, timestamp: Date.now() }));
    } catch (_) {
      // Use fallback rates
      setRates([
        { label: '30-Yr Fixed', rate: 6.87 },
        { label: '15-Yr Fixed', rate: 6.13 },
        { label: '5/1 ARM', rate: 6.44 },
        { label: 'FHA 30-Yr', rate: 6.55 },
        { label: 'VA 30-Yr', rate: 6.28 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const tickerItems = [...rates, ...rates]; // duplicate for seamless loop

  return (
    <div className="bg-gray-900 text-white overflow-hidden border-t border-gray-700" style={{ height: '36px' }}>
      <div className="flex items-center h-full">
        {/* Label */}
        <div className="flex-shrink-0 bg-[#52ADEA] px-3 h-full flex items-center z-10">
          <span className="text-xs font-bold tracking-wide whitespace-nowrap">MORTGAGE RATES</span>
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