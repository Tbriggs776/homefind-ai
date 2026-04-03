import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { license, agent_mls_id } = body;
        
        if (!license && !agent_mls_id) {
            return Response.json({ error: 'Either license or agent_mls_id parameter required' }, { status: 400 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        
        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        // Check cache first - 3 minute TTL to respect rate limits
        const cacheKey = agent_mls_id ? `agent_listings_mlsid_${agent_mls_id}` : `agent_listings_${license}`;
        const existingCache = await base44.asServiceRole.entities.SyncCache.filter({ 
            sync_key: cacheKey 
        });

        if (existingCache.length > 0) {
            const cache = existingCache[0];
            const cacheAge = Date.now() - new Date(cache.last_sync_date).getTime();
            const threeMinutes = 3 * 60 * 1000;
            
            if (cache.sync_status === 'success' && cacheAge < threeMinutes && cache.cached_data?.listings) {
                return Response.json({ 
                    listings: cache.cached_data.listings,
                    cached: true,
                    cache_age_seconds: Math.floor(cacheAge / 1000)
                });
            }
        }

        // Build filter based on provided identifier
        const filters = agent_mls_id
            ? `MlsStatus Eq 'Active' And ListAgentMlsId Eq '${agent_mls_id}'`
            : `MlsStatus Eq 'Active' And ListAgentStateLicense Eq '${license}'`;
        const params = new URLSearchParams({
            _filter: filters,
            _limit: '20',
            _expand: 'PrimaryPhoto',
            _orderby: '-ModificationTimestamp'
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(
            `https://replication.sparkapi.com/v1/listings?${params.toString()}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-SparkApi-User-Agent': apiKey
                },
                signal: controller.signal
            }
        );
        
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Spark API returned ${response.status}`);
        }

        const data = await response.json();
        const sparkListings = data.D?.Results || [];

        // Get matching properties from DB for coordinates
        const externalIds = sparkListings.map(l => String(l.Id)).filter(Boolean);
        const dbPropertiesMap = new Map();
        
        if (externalIds.length > 0) {
            const dbProperties = await base44.asServiceRole.entities.Property.filter({
                listing_source: 'flexmls_idx',
                external_listing_id: { $in: externalIds }
            });
            
            dbProperties.forEach(prop => {
                dbPropertiesMap.set(prop.external_listing_id, prop);
            });
        }

        // Transform to our format, following PHP sample structure
        const enrichedListings = sparkListings.map(listing => {
            const sf = listing.StandardFields || {};
            const dbProperty = dbPropertiesMap.get(String(listing.Id));
            
            // Extract primary photo (following PHP sample pattern)
            const images = [];
            if (sf.Photos && Array.isArray(sf.Photos) && sf.Photos.length > 0) {
                // Use Uri800 for good quality, with fallbacks
                const photo = sf.Photos[0];
                const imageUrl = photo.Uri800 || photo.Uri640 || photo.UriLarge || photo.Uri1024 || photo.UriThumb;
                if (imageUrl) {
                    images.push(imageUrl);
                }
                
                // Add additional photos if available
                for (let i = 1; i < Math.min(sf.Photos.length, 10); i++) {
                    const p = sf.Photos[i];
                    const url = p.Uri800 || p.Uri640 || p.UriLarge || p.Uri1024;
                    if (url) images.push(url);
                }
            }

            // Build address (following PHP sample pattern)
            const address = [
                sf.StreetNumber,
                sf.StreetName,
                sf.StreetSuffix
            ].filter(Boolean).join(' ') || sf.UnparsedAddress || 'Address Not Available';

            return {
                id: dbProperty?.id || listing.Id,
                external_listing_id: String(listing.Id),
                address,
                city: sf.City || '',
                state: sf.StateOrProvince || '',
                zip_code: sf.PostalCode || '',
                latitude: dbProperty?.latitude || null,
                longitude: dbProperty?.longitude || null,
                price: parseFloat(sf.ListPrice || 0),
                bedrooms: parseInt(sf.BedsTotal) || 0,
                bathrooms: parseFloat(sf.BathsTotal || 0),
                square_feet: parseInt(sf.BuildingAreaTotal || sf.LivingArea || 0),
                year_built: parseInt(sf.YearBuilt || 0),
                description: sf.PublicRemarks || '',
                images,
                days_on_market: parseInt(sf.DaysOnMarket || 0),
                mls_number: String(sf.ListingId || listing.Id || ''),
                listing_source: 'flexmls_idx',
                status: 'active',
                features: extractFeatures(sf)
            };
        });

        // Update cache with listings
        const cacheData = {
            sync_key: cacheKey,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            total_fetched: enrichedListings.length,
            cached_data: {
                listings: enrichedListings
            }
        };

        if (existingCache.length > 0) {
            await base44.asServiceRole.entities.SyncCache.update(existingCache[0].id, cacheData);
        } else {
            await base44.asServiceRole.entities.SyncCache.create(cacheData);
        }

        return Response.json({ 
            listings: enrichedListings,
            cached: false
        });

    } catch (error) {
        console.error('getAgentListings error:', error);
        return Response.json({ 
            error: error.message,
            listings: []
        }, { status: 500 });
    }
});

function extractFeatures(sf) {
    const features = [];
    
    if (sf.PoolFeatures) features.push('Pool');
    if (sf.GarageSpaces > 0) features.push(`${sf.GarageSpaces}-Car Garage`);
    if (sf.WaterfrontYN) features.push('Waterfront');
    if (sf.FireplacesTotal > 0) features.push('Fireplace');
    
    return features;
}