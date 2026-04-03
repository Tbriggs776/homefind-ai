import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const MAX_EXECUTION_MS = 12000;
const NOMINATIM_DELAY_MS = 1050;
const FETCH_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (res.status === 429) return [];
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();
    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user && user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { data: properties, error } = await admin
            .from('properties')
            .select('*')
            .is('latitude', null)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(3);

        if (error || !properties || properties.length === 0) {
            return jsonResponse({ success: true, message: 'No properties need geocoding', total: 0 });
        }

        let geocodedCount = 0;
        let failedCount = 0;
        let skippedTimeout = 0;
        const failed: unknown[] = [];

        const timeLeft = () => MAX_EXECUTION_MS - (Date.now() - startTime);

        for (let i = 0; i < properties.length; i++) {
            const property = properties[i];

            if (timeLeft() < 2000) {
                skippedTimeout = properties.length - geocodedCount - failedCount;
                console.log(`Time guard hit at ${Date.now() - startTime}ms, skipping remaining ${skippedTimeout}`);
                break;
            }

            if (!property.address || !property.city || !property.state) {
                failedCount++;
                failed.push({ id: property.id, reason: 'Missing address/city/state' });
                continue;
            }

            try {
                const fullAddress = `${property.address}, ${property.city}, ${property.state} ${property.zip_code || ''}`.trim();
                const headers = { 'User-Agent': 'CrandellHomeIntelligence/1.0' };

                const structuredUrl = `https://nominatim.openstreetmap.org/search?` +
                    `street=${encodeURIComponent(property.address)}` +
                    `&city=${encodeURIComponent(property.city)}` +
                    `&state=${encodeURIComponent(property.state)}` +
                    (property.zip_code ? `&postalcode=${encodeURIComponent(property.zip_code)}` : '') +
                    `&countrycodes=us&format=json&limit=1`;

                let data: any = await fetchWithTimeout(structuredUrl, { headers });

                if (data.length === 0 && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const freeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(freeUrl, { headers });
                }

                if (data.length === 0 && property.cross_street && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const crossStreetQuery = `${property.cross_street}, ${property.city}, ${property.state}`;
                    const crossUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(crossStreetQuery)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(crossUrl, { headers });
                }

                if (data.length === 0 && property.zip_code && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const zipUrl = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(property.zip_code)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(zipUrl, { headers });
                }

                if (data.length > 0) {
                    const latitude = parseFloat(data[0].lat);
                    const longitude = parseFloat(data[0].lon);

                    if (!isNaN(latitude) && !isNaN(longitude) && latitude !== 0 && longitude !== 0) {
                        await admin
                            .from('properties')
                            .update({ latitude, longitude })
                            .eq('id', property.id);
                        geocodedCount++;
                        console.log(`Geocoded: ${fullAddress} => ${latitude}, ${longitude}`);
                    } else {
                        failedCount++;
                        failed.push({ id: property.id, address: fullAddress, reason: 'Invalid coordinates' });
                    }
                } else {
                    failedCount++;
                    failed.push({ id: property.id, address: fullAddress, reason: 'Address not found' });
                }

                if (i < properties.length - 1) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                }

            } catch (error) {
                failedCount++;
                failed.push({ id: property.id, address: property.address, reason: (error as Error).message });
            }
        }

        return jsonResponse({
            success: true,
            duration_ms: Date.now() - startTime,
            total_properties: properties.length,
            geocoded: geocodedCount,
            failed: failedCount,
            skipped_timeout: skippedTimeout,
            failed_details: failed.slice(0, 10)
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message, duration_ms: Date.now() - startTime }, 500);
    }
});
