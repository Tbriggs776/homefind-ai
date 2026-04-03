import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const MAX_EXECUTION_MS = 12000; // Must finish well before platform kills us
const NOMINATIM_DELAY_MS = 1050;
const FETCH_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (res.status === 429) return []; // Rate limited, treat as empty
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return []; // Timeout or network error
    } finally {
        clearTimeout(timer);
    }
}

Deno.serve(async (req) => {
    const startTime = Date.now();
    try {
        const base44 = createClientFromRequest(req);

        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) {
            // No user = scheduled automation, allow through
        }

        const properties = await base44.asServiceRole.entities.Property.filter(
            { latitude: null, status: 'active' },
            '-created_date',
            3
        );

        if (properties.length === 0) {
            return Response.json({ success: true, message: 'No properties need geocoding', total: 0 });
        }

        let geocodedCount = 0;
        let failedCount = 0;
        let skippedTimeout = 0;
        const failed = [];

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

                // Try structured search first
                const structuredUrl = `https://nominatim.openstreetmap.org/search?` +
                    `street=${encodeURIComponent(property.address)}` +
                    `&city=${encodeURIComponent(property.city)}` +
                    `&state=${encodeURIComponent(property.state)}` +
                    (property.zip_code ? `&postalcode=${encodeURIComponent(property.zip_code)}` : '') +
                    `&countrycodes=us&format=json&limit=1`;

                let data = await fetchWithTimeout(structuredUrl, { headers });

                // Fallback: free-text search (only if time allows)
                if (data.length === 0 && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const freeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(freeUrl, { headers });
                }

                // Fallback: use cross_street + city for approximate location (only if time allows)
                if (data.length === 0 && property.cross_street && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const crossStreetQuery = `${property.cross_street}, ${property.city}, ${property.state}`;
                    const crossUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(crossStreetQuery)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(crossUrl, { headers });
                }

                // Fallback: zip code only (only if time allows)
                if (data.length === 0 && property.zip_code && timeLeft() > 4000) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                    const zipUrl = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(property.zip_code)}&countrycodes=us&format=json&limit=1`;
                    data = await fetchWithTimeout(zipUrl, { headers });
                }

                if (data.length > 0) {
                    const latitude = parseFloat(data[0].lat);
                    const longitude = parseFloat(data[0].lon);

                    if (!isNaN(latitude) && !isNaN(longitude) && latitude !== 0 && longitude !== 0) {
                        await base44.asServiceRole.entities.Property.update(property.id, {
                            latitude,
                            longitude
                        });
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

                // Rate limit delay only if more properties remain
                if (i < properties.length - 1) {
                    await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
                }

            } catch (error) {
                failedCount++;
                failed.push({ id: property.id, address: property.address, reason: error.message });
            }
        }

        return Response.json({
            success: true,
            duration_ms: Date.now() - startTime,
            total_properties: properties.length,
            geocoded: geocodedCount,
            failed: failedCount,
            skipped_timeout: skippedTimeout,
            failed_details: failed.slice(0, 10)
        });

    } catch (error) {
        return Response.json({ error: error.message, duration_ms: Date.now() - startTime }, { status: 500 });
    }
});