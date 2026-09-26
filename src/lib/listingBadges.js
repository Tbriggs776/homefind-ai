// ============================================================================
// Listing badges & labels shared by PropertyCard and PropertyDetail.
//
// Data sources:
// - Price cuts: previous_list_price / price_change_date are maintained by the
//   track_property_price_change trigger (the MLS feed doesn't include prior
//   prices), so they only exist for changes since 2026-09-26.
// - Open houses: open_house_date / open_house_end come from syncOpenHouses.
// ============================================================================

const AZ_TZ = 'America/Phoenix';
const PRICE_CUT_WINDOW_DAYS = 60;

// Boolean amenity columns → buyer-facing labels (same flags Search filters on).
export const AMENITY_LABELS = {
  private_pool: 'Private pool',
  spa_hot_tub: 'Spa / hot tub',
  community_pool: 'Community pool',
  single_story: 'Single story',
  rv_garage: 'RV garage',
  casita_guest_house: 'Casita / guest house',
  office_den: 'Office / den',
  basement: 'Basement',
  open_floor_plan: 'Open floor plan',
  recently_remodeled: 'Recently remodeled',
  energy_efficient: 'Energy efficient',
  solar_owned: 'Solar (owned)',
  solar_leased: 'Solar (leased)',
  has_view: 'View',
  corner_lot: 'Corner lot',
  cul_de_sac: 'Cul-de-sac',
  golf_course_lot: 'Golf course lot',
  waterfront: 'Waterfront',
  horse_property: 'Horse property',
  gated_community: 'Gated community',
  age_restricted_55plus: '55+ community',
};

export function getAmenities(property) {
  return Object.entries(AMENITY_LABELS)
    .filter(([key]) => property?.[key] === true)
    .map(([, label]) => label);
}

const shortMoney = (n) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}M` : `$${Math.round(n / 1000)}K`;

// { amount, percent, label, date } for a recent price reduction, else null.
export function getPriceCut(property) {
  const prev = Number(property?.previous_list_price);
  const price = Number(property?.price);
  if (!(prev > price) || !(price > 0)) return null;
  const changed = property.price_change_date ? new Date(property.price_change_date) : null;
  if (changed && Date.now() - changed.getTime() > PRICE_CUT_WINDOW_DAYS * 86_400_000) return null;
  const amount = prev - price;
  return {
    amount,
    percent: Math.round((amount / prev) * 100),
    label: `Price cut ${shortMoney(amount)}`,
    date: changed,
  };
}

// { start, end, label, isToday } for an upcoming or in-progress open house, else null.
export function getOpenHouse(property) {
  if (!property?.open_house_date) return null;
  const start = new Date(property.open_house_date);
  const end = property.open_house_end ? new Date(property.open_house_end) : null;
  if ((end ?? start).getTime() < Date.now()) return null;

  const day = new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, weekday: 'short' }).format(start);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, month: 'short', day: 'numeric' }).format(start);
  const time = (d) =>
    new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, hour: 'numeric', minute: '2-digit' })
      .format(d)
      .replace(':00', '');
  const todayAz = new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, dateStyle: 'short' }).format(new Date());
  const startAz = new Intl.DateTimeFormat('en-US', { timeZone: AZ_TZ, dateStyle: 'short' }).format(start);
  const isToday = todayAz === startAz;

  return {
    start,
    end,
    isToday,
    short: `Open ${isToday ? 'today' : day} ${time(start)}${end ? `–${time(end)}` : ''}`,
    long: `${isToday ? 'Today' : `${day}, ${date}`} · ${time(start)}${end ? ` – ${time(end)}` : ''}`,
  };
}

// "Listed today" / "Listed 1 day ago" / "Listed 12 days ago"
export function getListedLabel(property) {
  const listed = property?.listing_date ? new Date(property.listing_date) : null;
  const days = listed
    ? Math.max(0, Math.floor((Date.now() - listed.getTime()) / 86_400_000))
    : Number.isFinite(property?.days_on_market) ? Math.round(property.days_on_market) : null;
  if (days == null) return null;
  if (days === 0) return 'Listed today';
  return `Listed ${days} ${days === 1 ? 'day' : 'days'} ago`;
}
