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

      const rows = listings.map((l: any) => ({
        listing_key: l.ListingKey || l.Id,
        listing_id: l.ListingId || l.ListNumber,
        mls_status: l.MlsStatus || l.StandardStatus || 'Active',
        property_type: l.PropertyType,
        property_sub_type: l.PropertySubType,
        street_number: l.StreetNumber,
        street_name: l.StreetName,
        street_suffix: l.StreetSuffix,
        unit_number: l.UnitNumber,
        city: l.City,
        state: l.StateOrProvince || 'AZ',
        zip_code: l.PostalCode,
        county: l.CountyOrParish,
        subdivision: l.SubdivisionName,
        list_price: parseFloat(l.ListPrice) || null,
        original_list_price: parseFloat(l.OriginalListPrice) || null,
        beds: parseInt(l.BedroomsTotal) || null,
        baths_full: parseInt(l.BathroomsFull) || null,
        baths_half: parseInt(l.BathroomsHalf) || null,
        baths_total: parseFloat(l.BathroomsTotalDecimal) || null,
        sqft: parseInt(l.LivingArea) || null,
        lot_size_sqft: parseFloat(l.LotSizeSquareFeet) || null,
        lot_size_acres: parseFloat(l.LotSizeAcres) || null,
        year_built: parseInt(l.YearBuilt) || null,
        days_on_market: parseInt(l.DaysOnMarket) || null,
        listing_date: l.ListingContractDate || null,
        description: l.PublicRemarks,
        latitude: parseFloat(l.Latitude) || null,
        longitude: parseFloat(l.Longitude) || null,
        photos: (l.Photos || []).map((p: any) => ({
          uri_300: p.Uri300, uri_640: p.Uri640, uri_800: p.Uri800,
          uri_1024: p.Uri1024, uri_1280: p.Uri1280,
          caption: p.Caption, primary: p.Primary,
        })),
        photo_count: l.PhotosCount || (l.Photos || []).length,
        primary_photo: (l.Photos || []).find((p: any) => p.Primary)?.Uri640 || (l.Photos || [])[0]?.Uri640 || null,
        virtual_tour_url: l.VirtualTourURLUnbranded || l.VirtualTourURLBranded || null,
        garage_spaces: parseInt(l.GarageSpaces) || null,
        pool: l.PoolPrivateYN === true || l.PoolFeatures?.length > 0 || false,
        stories: parseInt(l.Stories) || null,
        hoa_fee: parseFloat(l.AssociationFee) || null,
        hoa_frequency: l.AssociationFeeFrequency || null,
        heating: Array.isArray(l.Heating) ? l.Heating.join(', ') : l.Heating,
        cooling: Array.isArray(l.Cooling) ? l.Cooling.join(', ') : l.Cooling,
        school_district: l.SchoolDistrict,
        elementary_school: l.ElementarySchool,
        middle_school: l.MiddleSchool,
        high_school: l.HighSchool,
        listing_office_name: l.ListOfficeName,
        listing_office_phone: l.ListOfficePhone,
        listing_agent_name: l.ListAgentFullName || `${l.ListAgentFirstName || ''} ${l.ListAgentLastName || ''}`.trim(),
        listing_agent_id: l.ListAgentMlsId,
        listing_agent_email: l.ListAgentEmail,
        modification_timestamp: l.ModificationTimestamp,
        status_change_timestamp: l.StatusChangeTimestamp,
        is_featured: false,
        raw_data: l,
      }));

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from('properties')
          .upsert(batch, { onConflict: 'listing_key' });
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