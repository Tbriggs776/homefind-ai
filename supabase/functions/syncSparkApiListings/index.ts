import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const SPARK_API_BASE = 'https://replication.sparkapi.com/v1';
const BATCH_SIZE = 500;
const MAX_PAGES = 100;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const { data: cache } = await supabaseAdmin
      .from('sync_cache')
      .select('cache_value')
      .eq('cache_key', 'spark_last_sync')
      .single();

    const lastSync = cache?.cache_value?.timestamp || '';
    const syncStartTime = new Date().toISOString();
    let totalSynced = 0;
    let skipToken = '';
    let page = 0;

    while (page < MAX_PAGES) {
      let url = `${SPARK_API_BASE}/listings?_limit=1000&_orderby=ModificationTimestamp&_expand=Photos`;
      if (lastSync) {
        url += `&_filter=ModificationTimestamp bt ${lastSync},${syncStartTime}`;
      }
      if (skipToken) url += `&_skiptoken=${skipToken}`;

      const sparkRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });

      if (!sparkRes.ok) {
        const errText = await sparkRes.text();
        throw new Error(`Spark API error ${sparkRes.status}: ${errText}`);
      }

      const sparkData = await sparkRes.json();
      const listings = sparkData?.D?.Results || [];
      if (listings.length === 0) break;

      // Map Spark fields to ACTUAL database columns
      const rows = listings.map((l: any) => {
        const streetParts = [l.StreetNumber, l.StreetName, l.StreetSuffix].filter(Boolean).join(' ');
        const unitPart = l.UnitNumber ? `, Unit ${l.UnitNumber}` : '';
        const address = `${streetParts}${unitPart}`;

        return {
          mls_number: l.ListingKey || l.Id || l.ListingId,
          status: l.MlsStatus || l.StandardStatus || 'Active',
          property_type: l.PropertyType,
          address: address,
          city: l.City,
          state: l.StateOrProvince || 'AZ',
          zip_code: l.PostalCode,
          county: l.CountyOrParish,
          subdivision: l.SubdivisionName,
          price: parseFloat(l.ListPrice) || null,
          bedrooms: parseInt(l.BedroomsTotal) || null,
          bathrooms: parseFloat(l.BathroomsTotalDecimal || l.BathroomsFull) || null,
          square_feet: parseInt(l.LivingArea) || null,
          lot_size: parseFloat(l.LotSizeSquareFeet) || null,
          year_built: parseInt(l.YearBuilt) || null,
          days_on_market: parseInt(l.DaysOnMarket) || null,
          listing_date: l.ListingContractDate || null,
          description: l.PublicRemarks,
          latitude: parseFloat(l.Latitude) || null,
          longitude: parseFloat(l.Longitude) || null,
          virtual_tour_url: l.VirtualTourURLUnbranded || l.VirtualTourURLBranded || null,
          garage_spaces: parseInt(l.GarageSpaces) || null,
          hoa_fee: parseFloat(l.AssociationFee) || null,
          elementary_school: l.ElementarySchool,
          middle_school: l.MiddleSchool,
          high_school: l.HighSchool,
          is_featured: false,
        };
      });

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('properties')
          .upsert(batch, { onConflict: 'mls_number' });
        if (error) throw error;
        totalSynced += batch.length;
      }

      skipToken = sparkData?.D?.Pagination?.['@odata.nextLink']
        ? new URL(sparkData.D.Pagination['@odata.nextLink']).searchParams.get('_skiptoken') || ''
        : '';
      if (!skipToken) break;
      page++;
    }

    await supabaseAdmin.from('sync_cache').upsert({
      cache_key: 'spark_last_sync',
      cache_value: { timestamp: syncStartTime, listings_synced: totalSynced },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

    return jsonResponse({ success: true, synced: totalSynced, pages: page + 1 });
  } catch (err) {
    console.error('Sync error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});