import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, ArrowLeft, Check, Home, MapPin, DollarSign, Bed, Sparkles } from 'lucide-react';

/**
 * Onboarding — buyer preference quiz shown after first signup.
 *
 * Five-step flow:
 *   1. What matters most to you? (multi-select priorities)
 *   2. What's your budget range? (min/max price dropdowns)
 *   3. Where are you looking? (city chips + other text input)
 *   4. Bedrooms & bathrooms (simple selectors)
 *   5. Anything else? (free-text)
 *
 * On completion, writes to `user_preferences` (upsert on user_id) and sets
 * `profiles.has_completed_onboarding = true`. User is then redirected to
 * the home page.
 *
 * If the user is not logged in, they're redirected to /Login. If they've
 * already completed onboarding, they're redirected to /.
 */

const PRIORITY_OPTIONS = [
  { value: 'price', label: 'Price', icon: DollarSign },
  { value: 'location', label: 'Location', icon: MapPin },
  { value: 'school_district', label: 'School District', icon: Home },
  { value: 'pool', label: 'Pool', icon: Sparkles },
  { value: 'lot_size', label: 'Lot Size', icon: Home },
  { value: 'new_construction', label: 'New Construction', icon: Home },
  { value: 'single_story', label: 'Single Story', icon: Home },
];

const PRICE_OPTIONS = [
  { value: '', label: 'No minimum' },
  { value: '200000', label: '$200,000' },
  { value: '300000', label: '$300,000' },
  { value: '400000', label: '$400,000' },
  { value: '500000', label: '$500,000' },
  { value: '600000', label: '$600,000' },
  { value: '750000', label: '$750,000' },
  { value: '1000000', label: '$1,000,000' },
  { value: '1500000', label: '$1,500,000' },
  { value: '2000000', label: '$2,000,000' },
];

const MAX_PRICE_OPTIONS = [
  { value: '', label: 'No maximum' },
  { value: '300000', label: '$300,000' },
  { value: '400000', label: '$400,000' },
  { value: '500000', label: '$500,000' },
  { value: '600000', label: '$600,000' },
  { value: '750000', label: '$750,000' },
  { value: '1000000', label: '$1,000,000' },
  { value: '1500000', label: '$1,500,000' },
  { value: '2000000', label: '$2,000,000' },
  { value: '3000000', label: '$3,000,000+' },
];

const CITY_OPTIONS = [
  'Queen Creek', 'San Tan Valley', 'Gilbert', 'Mesa', 'Chandler',
  'Scottsdale', 'Phoenix', 'Surprise', 'Peoria', 'Buckeye',
  'Goodyear', 'Maricopa', 'Casa Grande', 'Tempe',
];

const STEPS = [
  { title: 'What matters most to you?', subtitle: 'Select all that apply — this helps us prioritize what you see.' },
  { title: "What's your budget?", subtitle: 'Give us a range and we\'ll focus your search.' },
  { title: 'Where are you looking?', subtitle: 'Pick the areas you\'re most interested in.' },
  { title: 'Home size', subtitle: 'How much space do you need?' },
  { title: 'Anything else?', subtitle: 'Tell us anything specific — we\'ll factor it in.' },
];

const TOTAL_STEPS = STEPS.length;

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [priorities, setPriorities] = useState([]);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [cities, setCities] = useState([]);
  const [otherCity, setOtherCity] = useState('');
  const [minBeds, setMinBeds] = useState('');
  const [minBaths, setMinBaths] = useState('');
  const [freeText, setFreeText] = useState('');

  // Redirect if not logged in
  if (!user) {
    navigate('/Login');
    return null;
  }

  // If already completed onboarding, skip to home
  if (user.has_completed_onboarding) {
    navigate('/');
    return null;
  }

  const togglePriority = (value) => {
    setPriorities(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const toggleCity = (city) => {
    setCities(prev =>
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  };

  const canProceed = () => {
    // All steps are optional — user can skip any of them
    return true;
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      // Build the cities array including any "other" city typed in
      const allCities = [...cities];
      if (otherCity.trim()) {
        allCities.push(otherCity.trim());
      }

      // Derive boolean flags from priorities
      const wantsPool = priorities.includes('pool');
      const wantsSingleStory = priorities.includes('single_story');

      // Upsert user_preferences
      const { error: prefError } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          min_price: minPrice ? parseFloat(minPrice) : null,
          max_price: maxPrice ? parseFloat(maxPrice) : null,
          min_beds: minBeds ? parseInt(minBeds) : null,
          min_baths: minBaths ? parseInt(minBaths) : null,
          cities: allCities.length > 0 ? allCities : null,
          pool: wantsPool,
          single_story: wantsSingleStory,
          priorities: priorities.length > 0 ? priorities : null,
          free_text: freeText.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (prefError) {
        console.error('Failed to save preferences:', prefError);
      }

      // Mark onboarding as complete
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ has_completed_onboarding: true })
        .eq('id', user.id);

      if (profileError) {
        console.error('Failed to update onboarding status:', profileError);
      }

      // Redirect to home
      navigate('/');
      // Force a reload so AuthContext picks up the updated profile
      window.location.href = '/';
    } catch (err) {
      console.error('Onboarding error:', err);
    } finally {
      setSaving(false);
    }
  };

  const progressPct = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Progress bar */}
      <div className="w-full h-1 bg-slate-200">
        <div
          className="h-full bg-[#00AFE5] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          {/* Skip link */}
          <div className="text-right mb-4">
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Skip for now
            </button>
          </div>

          {/* Step header */}
          <div className="text-center mb-8">
            <p className="text-xs text-[#00AFE5] font-semibold uppercase tracking-wider mb-2">
              Step {step + 1} of {TOTAL_STEPS}
            </p>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              {STEPS[step].title}
            </h1>
            <p className="text-slate-500">
              {STEPS[step].subtitle}
            </p>
          </div>

          {/* Step content */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 md:p-8 mb-6">
            {/* Step 1: Priorities */}
            {step === 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {PRIORITY_OPTIONS.map((opt) => {
                  const selected = priorities.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => togglePriority(opt.value)}
                      className={`flex items-center gap-2.5 px-4 py-3.5 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                        selected
                          ? 'border-[#00AFE5] bg-[#00AFE5]/5 text-[#00AFE5]'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {selected && <Check className="h-4 w-4 flex-shrink-0" />}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step 2: Budget */}
            {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Minimum price</label>
                  <select
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00AFE5] focus:border-transparent"
                  >
                    {PRICE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Maximum price</label>
                  <select
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00AFE5] focus:border-transparent"
                  >
                    {MAX_PRICE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Step 3: Cities */}
            {step === 2 && (
              <div>
                <div className="flex flex-wrap gap-2.5 mb-6">
                  {CITY_OPTIONS.map((city) => {
                    const selected = cities.includes(city);
                    return (
                      <button
                        key={city}
                        type="button"
                        onClick={() => toggleCity(city)}
                        className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                          selected
                            ? 'bg-[#00AFE5] text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {city}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Other area not listed above?
                  </label>
                  <input
                    type="text"
                    value={otherCity}
                    onChange={(e) => setOtherCity(e.target.value)}
                    placeholder="Type a city or area name"
                    className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#00AFE5] focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Beds & Baths */}
            {step === 3 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-3">Bedrooms</label>
                  <div className="flex gap-2">
                    {['', '2', '3', '4', '5'].map((val) => {
                      const label = val === '' ? 'Any' : `${val}+`;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setMinBeds(val)}
                          className={`flex-1 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                            minBeds === val
                              ? 'border-[#00AFE5] bg-[#00AFE5]/5 text-[#00AFE5]'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-3">Bathrooms</label>
                  <div className="flex gap-2">
                    {['', '2', '3', '4'].map((val) => {
                      const label = val === '' ? 'Any' : `${val}+`;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setMinBaths(val)}
                          className={`flex-1 py-3 rounded-lg text-sm font-medium border-2 transition-all ${
                            minBaths === val
                              ? 'border-[#00AFE5] bg-[#00AFE5]/5 text-[#00AFE5]'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Free text */}
            {step === 4 && (
              <div>
                <Textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Tell us anything specific you're looking for — casita, horse property, specific school, gated community, RV garage, whatever matters to you."
                  className="min-h-[140px] text-sm resize-none focus:ring-2 focus:ring-[#00AFE5] focus:border-transparent"
                />
                <p className="text-xs text-slate-400 mt-2">
                  This helps our AI give you better recommendations and smarter search results.
                </p>
              </div>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between">
            <div>
              {step > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBack}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
            </div>

            <Button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="bg-[#00AFE5] hover:bg-[#0095c5] text-white px-8 py-3 font-semibold"
            >
              {saving ? (
                'Saving...'
              ) : step === TOTAL_STEPS - 1 ? (
                <>
                  Get started
                  <Check className="h-4 w-4 ml-2" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
