import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
// v3 - rate limit safe with retry
// ─── Strategy ────────────────────────────────────────────────────────────────
// Timestamp-based incremental sync from ARMLS via Spark Replication API.
// Subsequent runs: only fetches listings modified since the last successful sync.
// Includes retry with exponential backoff on Base44 429 rate limits.
// ─────────────────────────────────────────────────────────────────────────────

const PAUL_AGENT_ID = 'pc295';
const BATCH_SIZE = 3;            // Listings per Spark API call (minimized to reduce DB ops)
const MAX_BATCHES_PER_RUN = 1;   // 1 batch per invocation
const BULK_CREATE_SIZE = 1;      // Create one record at a time to avoid rate limits
const DELAY_BETWEEN_DB_OPS = 4000;  // 4 seconds between each DB operation
const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches

// ─── Retry helper with exponential backoff for Base44 rate limits ────────────
async function withRetry(fn, label = 'operation', maxRetries = 4) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const errMsg = String(err?.message || err || '').toLowerCase();
            const isRateLimit = err?.response?.status === 429 || err?.status === 429 ||
                          errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('too many');
            if (isRateLimit && attempt < maxRetries) {
                // Very aggressive backoff: 10s, 20s, 40s, 80s
                const backoff = 10000 * Math.pow(2, attempt) + Math.random() * 2000;
                console.log(`⚠️ Rate limited on ${label} (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(backoff / 1000)}s...`);
                await new Promise(r => setTimeout(r, backoff));
            } else {
                throw err;
            }
        }
    }
}

function mapPropertyType(subType) {
    if (!subType) return 'single_family';
    const s = subType.toLowerCase();
    if (s.includes('single family') || s.includes('residential')) return 'single_family';
    if (s.includes('condo') || s.includes('condominium')) return 'condo';
    if (s.includes('townhouse') || s.includes('townhome')) return 'townhouse';
    if (s.includes('multi') || s.includes('duplex') || s.includes('triplex') || s.includes('fourplex')) return 'multi_family';
    if (s.includes('land') || s.includes('lot') || s.includes('vacant')) return 'land';
    return 'single_family';
}

function mapStatus(mlsStatus) {
    if (!mlsStatus) return 'active';
    const s = mlsStatus.toLowerCase();
    if (s.includes('pending') || s.includes('ucb') || s.includes('under contract')) return 'pending';
    if (s.includes('closed') || s.includes('sold')) return 'sold';
    if (s.includes('coming soon')) return 'coming_soon';
    return 'active';
}

function sparkFieldToText(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && !Array.isArray(val)) return Object.keys(val).join(' ');
    if (Array.isArray(val)) return val.join(' ');
    return String(val);
}

function extractFeatures(data) {
    const features = [];
    const poolText = sparkFieldToText(data.PoolFeatures).toLowerCase();
    if (poolText.includes('pool') || poolText.includes('private')) features.push('Pool');
    if (data.GarageSpaces > 0) features.push(`${data.GarageSpaces}-Car Garage`);
    if (data.WaterfrontYN) features.push('Waterfront');
    if (data.FireplacesTotal > 0) features.push('Fireplace');
    const basementText = sparkFieldToText(data.Basement).toLowerCase();
    if (basementText && basementText !== 'none' && basementText !== 'no') features.push('Basement');
    if (data.PatioAndPorchFeatures && sparkFieldToText(data.PatioAndPorchFeatures)) features.push('Patio');
    if (data.Cooling) features.push('Central Air');
    const flooringText = sparkFieldToText(data.Flooring).toLowerCase();
    if (flooringText.includes('hardwood')) features.push('Hardwood Floors');
    const parkingStr = [
        sparkFieldToText(data.ParkingFeatures),
        typeof data.PublicRemarks === 'string' ? data.PublicRemarks : '',
    ].join(' ').toLowerCase();
    if (/rv garage|rv gate|rv parking|rv access/.test(parkingStr)) features.push('RV Garage');
    return features;
}

function buildPropertyData(listing, externalId) {
    const data = listing.StandardFields || listing || {};
    const listPrice = parseFloat(data.ListPrice || 0);
    if (listPrice < 50000) return null;

    // Collect ALL photos — no limit
    const photos = [];
    if (Array.isArray(data.Photos)) {
        for (const photo of data.Photos) {
            const photoUrl = photo.Uri1024 || photo.Uri800 || photo.UriLarge || photo.Uri640 || photo.Uri300;
            if (photoUrl) photos.push(photoUrl);
        }
    }
    if (photos.length === 0) return null;

    const addressParts = [
        data.StreetNumber, data.StreetDirPrefix, data.StreetName,
        data.StreetSuffix, data.StreetDirSuffix
    ].filter(Boolean).join(' ');
    const address = addressParts || data.UnparsedAddress || 'Address Not Available';

    const allText = [
        data.PublicRemarks,
        sparkFieldToText(data.CommunityFeatures),
        sparkFieldToText(data.InteriorFeatures),
        sparkFieldToText(data.ExteriorFeatures),
        sparkFieldToText(data.ParkingFeatures),
        sparkFieldToText(data.OtherStructures),
        sparkFieldToText(data.ArchitecturalStyle),
        sparkFieldToText(data.PropertyCondition),
        sparkFieldToText(data.PoolFeatures),
        sparkFieldToText(data.GreenEnergyEfficient),
        sparkFieldToText(data.GreenEnergyGeneration),
        sparkFieldToText(data.LotFeatures),
        sparkFieldToText(data.Basement),
        sparkFieldToText(data.PatioAndPorchFeatures)
    ].filter(Boolean).join(' ').toLowerCase();

    // Structured lot features from Spark (more reliable than regex on remarks)
    const lotFeaturesText = sparkFieldToText(data.LotFeatures).toLowerCase();

    const stories = parseFloat(data.Stories || data.Levels || 0);
    const poolText = sparkFieldToText(data.PoolFeatures).toLowerCase();
    const assocVal = String(data.AssociationYN || '').toLowerCase();
    const hasAssociation = assocVal === 'true' || assocVal === 'yes' || assocVal === 'y' || data.AssociationYN === true || (parseFloat(data.AssociationFee) > 0);
    const communityText = sparkFieldToText(data.CommunityFeatures).toLowerCase();

    const agentId = (data.ListAgentMlsId || '').toLowerCase();
    const coAgentId = (data.CoListAgentMlsId || '').toLowerCase();
    const isPaulListing = agentId === PAUL_AGENT_ID || coAgentId === PAUL_AGENT_ID;

    let virtualTourUrl = data.VirtualTourURLUnbranded || '';
    if (!virtualTourUrl && Array.isArray(data.VirtualTours)) {
        const tour = data.VirtualTours.find(t => t.Uri || t.Url);
        if (tour) virtualTourUrl = tour.Uri || tour.Url || '';
    }

    const viewText = sparkFieldToText(data.View).toLowerCase();
    const hasView = data.ViewYN === true || data.ViewYN === 'Yes' || !!viewText;
    const spaText = sparkFieldToText(data.SpaFeatures).toLowerCase();
    const hasSpa = data.SpaYN === true || data.SpaYN === 'Yes' || spaText.includes('spa') || spaText.includes('hot tub') || allText.includes('hot tub') || allText.includes(' spa');

    return {
        address,
        city: data.City || '',
        state: data.StateOrProvince || '',
        zip_code: data.PostalCode || '',
        county: data.CountyOrParish || '',
        subdivision: data.SubdivisionName || '',
        cross_street: data.CrossStreet || '',
        latitude: parseFloat(data.Latitude) || null,
        longitude: parseFloat(data.Longitude) || null,
        price: listPrice,
        original_list_price: parseFloat(data.OriginalListPrice) || null,
        previous_list_price: parseFloat(data.PreviousListPrice) || null,
        price_change_date: data.PriceChangeTimestamp || null,
        bedrooms: parseInt(data.BedsTotal) || 0,
        bathrooms: (parseFloat(data.BathsFull) || 0) + (parseFloat(data.BathsHalf) || 0) * 0.5,
        square_feet: parseInt(data.BuildingAreaTotal || data.LivingArea || 0),
        lot_size: parseFloat(data.LotSizeAcres || 0),
        year_built: parseInt(data.YearBuilt || 0),
        property_type: mapPropertyType(data.PropertySubType),
        listing_source: 'flexmls_idx',
        external_listing_id: externalId,
        description: data.PublicRemarks || '',
        features: extractFeatures(data),
        images: photos,
        virtual_tour_url: virtualTourUrl,
        status: mapStatus(data.MlsStatus),
        days_on_market: parseInt(data.CumulativeDaysOnMarket || data.DaysOnMarket || 0),
        mls_number: String(data.ListingId || externalId),
        garage_spaces: parseInt(data.GarageSpaces) || 0,
        private_pool: poolText.includes('private') || poolText.includes('pool') || allText.includes('private pool'),
        rv_garage: /rv garage|rv parking|rv gate|rv access|rv bay|oversized rv|pull.?through rv|rv height|motorhome garage|toy hauler|rv parking pad|gated rv|rv side yard|rv driveway|rv hookup|rv storage|rv friendly|room for rv|rv accessible/.test(allText),
        single_story: stories === 1 || allText.includes('single level') || allText.includes('single story') || allText.includes('one level'),
        horse_property: allText.includes('horse') || allText.includes('equestrian'),
        corner_lot: lotFeaturesText.includes('corner') || allText.includes('corner lot'),
        cul_de_sac: lotFeaturesText.includes('cul-de-sac') || lotFeaturesText.includes('cul de sac') || allText.includes('cul-de-sac') || allText.includes('cul de sac'),
        waterfront: data.WaterfrontYN === true || data.WaterfrontYN === 'Yes' || allText.includes('waterfront') || allText.includes('lakefront'),
        golf_course_lot: lotFeaturesText.includes('golf') || allText.includes('golf course') || communityText.includes('golf'),
        community_pool: communityText.includes('pool') || communityText.includes('community pool'),
        gated_community: communityText.includes('gated') || allText.includes('gated community') || allText.includes('gated entrance'),
        hoa_required: hasAssociation,
        hoa_fee: parseFloat(data.AssociationFee) || null,
        hoa_fee_frequency: data.AssociationFeeFrequency || '',
        tax_annual_amount: parseFloat(data.TaxAnnualAmount) || null,
        age_restricted_55plus: data.SeniorCommunityYN === true || data.SeniorCommunityYN === 'Yes' || allText.includes('55+') || allText.includes('55 and older') || allText.includes('senior community') || allText.includes('age restricted') || communityText.includes('55+'),
        casita_guest_house: /casita|guest house|guest quarters|accessory dwelling|adu|in.?law suite|mother.?in.?law|multigenerational|next.?gen suite|private guest suite|detached guest|secondary living|secondary dwelling|garage apartment|carriage house|coach house|granny flat|backyard cottage|accessory apartment|separate guest suite|private entrance suite/.test(allText),
        office_den: allText.includes('office') || allText.includes(' den') || allText.includes('bonus room') || allText.includes('study'),
        basement: !!data.Basement && data.Basement !== 'None' && data.Basement !== 'No',
        open_floor_plan: /open floor plan|open concept|great room floor|open great room|open living concept|seamless living|expansive great room|open kitchen living|open kitchen great|open main living|connected living|flowing floor plan|open entertaining|large great room|open gathering|open family room|airy open layout|integrated living|modern open layout/.test(allText),
        recently_remodeled: /updated kitchen|updated bathroom|updated interior|updated finishes|modern updates|upgraded kitchen|upgraded bathroom|upgraded flooring|new flooring|new interior paint|fresh paint|new countertop|quartz countertop|granite countertop|new cabinets|refaced cabinets|new fixtures|updated lighting|modern finishes|refreshed interior|remodel|renovated|renovation/.test(allText),
        energy_efficient: /energy efficient|energy saving|energy efficient windows|dual pane|low.?e windows|upgraded insulation|spray foam|tankless water heater|high efficiency hvac|new hvac|energy star|led lighting|smart thermostat|ev charger|electric vehicle charging/.test(allText) || !!data.GreenEnergyEfficient,
        solar_owned: /solar owned|owned solar|solar energy system/.test(allText) || (allText.includes('solar') && allText.includes('owned')),
        solar_leased: /solar lease|leased solar/.test(allText) || (allText.includes('solar') && allText.includes('lease')),
        spa_hot_tub: hasSpa,
        has_view: hasView,
        view_description: sparkFieldToText(data.View) || '',
        is_featured: isPaulListing,
        list_agent_mls_id: data.ListAgentMlsId || '',
        list_office_name: data.ListOfficeName || '',
        elementary_school: data.ElementarySchool || '',
        middle_school: data.MiddleOrJuniorSchool || '',
        high_school: data.HighSchool || '',
        listing_date: data.OriginalEntryTimestamp || data.ListingContractDate || data.OnMarketDate || null,
        ...extractOpenHouseData(data),
    };
}

function extractOpenHouseData(data) {
    // Find the next upcoming open house
    if (!Array.isArray(data.OpenHouses) || data.OpenHouses.length === 0) {
        return { open_house_date: null, open_house_end: null, open_house_remarks: null };
    }

    const now = new Date();
    const futureOpenHouses = data.OpenHouses
        .filter(oh => {
            const start = oh.StartTime || oh.Date;
            return start && new Date(start) >= now;
        })
        .sort((a, b) => new Date(a.StartTime || a.Date) - new Date(b.StartTime || b.Date));

    if (futureOpenHouses.length === 0) {
        return { open_house_date: null, open_house_end: null, open_house_remarks: null };
    }

    const nextOH = futureOpenHouses[0];
    return {
        open_house_date: nextOH.StartTime || nextOH.Date || null,
        open_house_end: nextOH.EndTime || null,
        open_house_remarks: nextOH.Comments || nextOH.Remarks || null,
    };
}

Deno.serve(async (req) => {
    console.log('Function invoked — starting sync');
    try {
        const base44 = createClientFromRequest(req);
        console.log('SDK initialized');

        try {
            const user = await base44.auth.me();
            console.log('Auth check passed:', user?.email || 'automation');
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) { console.log('No user auth — running as automation'); }

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        console.log('Access token present:', !!accessToken);
        if (!accessToken) {
            return Response.json({ error: 'Spark OAuth access token not configured' }, { status: 500 });
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        // ── Load timestamp cursor ─────────────────────────────────────────────────
        const CURSOR_KEY = 'spark_api_pagination';
        const cursorArr = await withRetry(() => base44.asServiceRole.entities.SyncCache.filter({ sync_key: CURSOR_KEY }), 'load cursor');
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));
        let cursorRecord = cursorArr.length > 0 ? cursorArr[0] : null;
        const lastTimestamp = cursorRecord?.cached_data?.lastModTimestamp || null;
        // For first-ever run, we start from the epoch to pull everything
        const sinceTimestamp = lastTimestamp || '1970-01-01T00:00:00Z';

        console.log(`Starting sync from ModificationTimestamp > ${sinceTimestamp}`);

        const CACHE_KEY = 'spark_api_listings';

        const selectFields = [
            'ListingKey','ListingId','MlsStatus','PropertyType','PropertySubType',
            'StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','StreetDirSuffix','UnparsedAddress',
            'City','StateOrProvince','PostalCode','CountyOrParish','SubdivisionName',
            'CrossStreet','Directions',
            'Latitude','Longitude','ListPrice','OriginalListPrice',
            'PreviousListPrice','PriceChangeTimestamp',
            'BedsTotal','BathsFull','BathsHalf',
            'BuildingAreaTotal','LivingArea',
            'LotSizeAcres','LotSizeArea','YearBuilt','PublicRemarks',
            'CumulativeDaysOnMarket','DaysOnMarket',
            'ModificationTimestamp','ListingContractDate','OnMarketDate','OriginalEntryTimestamp',
            'PoolFeatures','GarageSpaces','WaterfrontYN','FireplacesTotal',
            'Basement','PatioAndPorchFeatures','Cooling','Flooring',
            'ParkingFeatures','LotFeatures',
            'Stories','Levels','AssociationYN','AssociationFee','AssociationFeeFrequency',
            'CommunityFeatures','SeniorCommunityYN',
            'GreenEnergyEfficient','GreenEnergyGeneration',
            'OtherStructures','ArchitecturalStyle','InteriorFeatures',
            'PropertyCondition','Roof','ExteriorFeatures',
            'SpaFeatures','SpaYN','View','ViewYN',
            'TaxAnnualAmount',
            'ElementarySchool','MiddleOrJuniorSchool','HighSchool',
            'VirtualTourURLUnbranded',
            'ListAgentMlsId','CoListAgentMlsId','ListOfficeName'
        ].join(',');

        // ── Filter: Active+Pending residential, modified since last cursor ────────
        const sparkFilter = `(MlsStatus Eq 'Active' Or MlsStatus Eq 'Pending' Or MlsStatus Eq 'UCB (Under Contract-Backups)') And PropertyType Eq 'A' And ModificationTimestamp Gt ${sinceTimestamp}`;

        let totalFetched = 0;
        let syncedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let highestTimestamp = sinceTimestamp;
        let offset = 0;
        let batchCount = 0;

        while (batchCount < MAX_BATCHES_PER_RUN) {
            batchCount++;

            const url = `https://replication.sparkapi.com/v1/listings` +
                `?_filter=${encodeURIComponent(sparkFilter)}` +
                `&_orderby=ModificationTimestamp` +
                `&_expand=Photos,VirtualTours,OpenHouses` +
                `&_select=${selectFields}` +
                `&_limit=${BATCH_SIZE}` +
                `&_offset=${offset}`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            let response;
            try {
                response = await fetch(url, { headers, signal: controller.signal });
                clearTimeout(timeout);
            } catch (e) {
                clearTimeout(timeout);
                console.log(`Fetch error at offset ${offset}: ${e.message}`);
                break;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`Spark API ${response.status}: ${errorText.slice(0, 300)}`);
                break;
            }

            const responseData = await response.json();
            const listings = responseData.D?.Results || [];

            if (listings.length === 0) {
                console.log(`No more listings at offset ${offset} — sync complete for this window`);
                break;
            }

            totalFetched += listings.length;

            // Track highest ModificationTimestamp for cursor
            for (const listing of listings) {
                const modTs = (listing.StandardFields || listing)?.ModificationTimestamp;
                if (modTs && modTs > highestTimestamp) {
                    highestTimestamp = modTs;
                }
            }

            // ── Lookup existing DB records (with retry) ─────────────────────────
            const externalIds = listings.map(l => String(l.Id || l.ListingKey || '')).filter(Boolean);
            const existingProperties = externalIds.length > 0
                ? await withRetry(() => base44.asServiceRole.entities.Property.filter({
                    listing_source: 'flexmls_idx',
                    external_listing_id: { $in: externalIds }
                  }), `lookup batch ${batchCount}`)
                : [];
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));

            const existingMap = new Map();
            for (const prop of existingProperties) {
                if (!existingMap.has(prop.external_listing_id)) {
                    existingMap.set(prop.external_listing_id, prop);
                }
            }

            // ── Build create/update batches ──────────────────────────────────────
            const newListings = [];
            const updates = [];
            const seenIds = new Set();

            for (const listing of listings) {
                const externalId = String(listing.Id || listing.ListingKey || '');
                if (!externalId || seenIds.has(externalId)) continue;
                seenIds.add(externalId);

                const propertyData = buildPropertyData(listing, externalId);
                if (!propertyData) { skippedCount++; continue; }

                if (existingMap.has(externalId)) {
                    updates.push({ id: existingMap.get(externalId).id, existing: existingMap.get(externalId), data: propertyData });
                } else {
                    newListings.push(propertyData);
                }
            }

            // ── Persist new listings in small chunks with retry ──────────────
            console.log(`📝 Batch ${batchCount}: Starting DB writes — ${newListings.length} new, ${updates.length} updates`);
            for (let i = 0; i < newListings.length; i += BULK_CREATE_SIZE) {
                const chunk = newListings.slice(i, i + BULK_CREATE_SIZE);
                console.log(`  → Creating records ${i + 1}-${i + chunk.length} of ${newListings.length}...`);
                await withRetry(() => base44.asServiceRole.entities.Property.bulkCreate(chunk), `bulkCreate ${i}`);
                syncedCount += chunk.length;
                console.log(`  ✓ Created ${chunk.length} records, waiting ${DELAY_BETWEEN_DB_OPS / 1000}s...`);
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));
            }

            // ── Persist updates sequentially with retry + delay ────────────
            for (let i = 0; i < updates.length; i++) {
                const u = updates[i];
                console.log(`  → Updating record ${i + 1}/${updates.length} (${u.id})...`);
                await withRetry(() => base44.asServiceRole.entities.Property.update(u.id, u.data), `update ${u.id}`);
                updatedCount++;
                console.log(`  ✓ Updated, waiting ${DELAY_BETWEEN_DB_OPS / 1000}s...`);
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));
            }

            offset += listings.length;

            console.log(`✅ Batch ${batchCount} complete: fetched ${listings.length}, new ${newListings.length}, updated ${updates.length}, skipped ${skippedCount}`);

            // ── Save cursor after each batch so progress is preserved on timeout ──
            const batchCursorData = {
                sync_key: CURSOR_KEY,
                last_sync_date: new Date().toISOString(),
                sync_status: 'success',
                cached_data: {
                    lastModTimestamp: highestTimestamp,
                    lastRun: new Date().toISOString(),
                    totalFetchedThisRun: totalFetched
                }
            };
            if (cursorRecord) {
                await withRetry(() => base44.asServiceRole.entities.SyncCache.update(cursorRecord.id, batchCursorData), 'save cursor');
            } else {
                const created = await withRetry(() => base44.asServiceRole.entities.SyncCache.create(batchCursorData), 'create cursor');
                cursorRecord = created;
            }
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));

            // Pause between batches
            if (batchCount < MAX_BATCHES_PER_RUN) {
                console.log(`⏳ Pausing ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
            }
        }

        // ── Update sync result cache ──────────────────────────────────────────────
        const finalCache = await withRetry(() => base44.asServiceRole.entities.SyncCache.filter({ sync_key: CACHE_KEY }), 'load final cache');
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_DB_OPS));
        const resultData = {
            sync_key: CACHE_KEY,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            total_fetched: totalFetched,
            new_items: syncedCount,
            updated_items: updatedCount,
            cached_data: { skipped: skippedCount, highestTimestamp, sinceTimestamp }
        };
        if (finalCache.length > 0) {
            await withRetry(() => base44.asServiceRole.entities.SyncCache.update(finalCache[0].id, resultData), 'save final cache');
        } else {
            await withRetry(() => base44.asServiceRole.entities.SyncCache.create(resultData), 'create final cache');
        }

        return Response.json({
            success: true,
            strategy: 'timestamp_incremental',
            total_fetched: totalFetched,
            new_listings: syncedCount,
            updated_listings: updatedCount,
            skipped: skippedCount,
            cursor_from: sinceTimestamp,
            cursor_to: highestTimestamp
        });

    } catch (error) {
        console.error('Sync error:', error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});