// Human-readable summary of Search page filters, used to name saved searches
// and describe them on the Saved Homes page.
const money = (n) => {
  const v = Number(n);
  if (!v) return '';
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M` : `$${Math.round(v / 1000)}K`;
};

export function summarizeSearchFilters(f = {}) {
  const parts = [];
  if (f.cities_label) parts.push(f.cities_label);
  else if (f.cities?.length) parts.push(f.cities.join(', '));
  else if (f.city) parts.push(f.city);
  if (f.subdivision) parts.push(f.subdivision);
  if (f.zip_code) parts.push(f.zip_code);
  if (f.query_text) parts.push(`"${f.query_text}"`);
  if (f.min_price && f.max_price) parts.push(`${money(f.min_price)}–${money(f.max_price)}`);
  else if (f.max_price) parts.push(`under ${money(f.max_price)}`);
  else if (f.min_price) parts.push(`${money(f.min_price)}+`);
  if (f.bedrooms) parts.push(`${f.bedrooms}+ bd`);
  if (f.bathrooms) parts.push(`${f.bathrooms}+ ba`);
  if (f.property_types?.length) parts.push(f.property_types.map((t) => t.replace(/_/g, ' ')).join('/'));
  if (f.private_pool) parts.push('pool');
  if (f.single_story) parts.push('single story');
  if (f.rv_garage) parts.push('RV garage');
  return parts.join(' · ');
}
