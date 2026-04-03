# Supabase Edge Functions - Backend/Cron/Debug Functions Created

Successfully ported 29 backend, cron, and debug functions from Base44 to Supabase Edge Functions.

All functions are located in: `/supabase/functions/` and use the shared helper from `_shared/supabaseAdmin.ts`

## Main Backend Functions (21)

### Data Synchronization & Maintenance
1. **backfillPropertyCoordinates** - Geocodes properties without latitude/longitude using Nominatim API
2. **checkInactiveListings** - Checks Spark API for inactive listings and updates their status
3. **checkListingPrice** - Debug function to check listing price fields
4. **cleanupFeaturedFlags** - Removes is_featured flag from properties not belonging to Paul Crandell (pc295)
5. **countMlsListings** - Counts active MLS listings from Spark API
6. **removeDuplicateProperties** - Removes duplicate properties by external_listing_id
7. **removeRentalListings** - Removes rental/lease listings from database
8. **resetPaginationCache** - Resets Spark API pagination cache to offset 0
9. **syncFeaturedProperties** - Marks pc295's properties as featured in database
10. **updateDormantUsers** - Marks users inactive for 30+ days as dormant

### Follow Up Boss Integration
11. **checkEngagementDrops** - Detects user engagement drops and creates alerts/FUB tasks with AI summaries
12. **createFollowUpBossLead** - Creates a lead in Follow Up Boss from user inquiry
13. **postDailyActivitySummary** - Posts daily activity summaries to Follow Up Boss with AI-generated insights
14. **refreshSparkToken** - Refreshes expired Spark OAuth access tokens

### Property & Listing Retrieval
15. **geocodeProperty** - One-off geocoding endpoint using Nominatim
16. **getAgentListings** - Fetches agent's active listings from Spark API with caching
17. **getListingAgentId** - Debug: gets agent ID from a specific listing
18. **getSparkApiListings** - Queries Spark API with filters (city, price range)
19. **getSparkListingDetail** - Fetches full property details from Spark including photos
20. **lookupSparkListing** - Looks up listing by MLS number and returns agent information

### Email & Notifications
21. **sendTodaysWelcomeEmails** - Sends welcome emails to users created today via Resend API

## Debug Functions (8)

1. **debugAgentFields** - Raw Spark API response showing agent field structure
2. **debugAgentId** - Tests multiple variations of agent ID lookup (replication API vs standard API)
3. **debugAgentListingsPC295** - Lists what's in Spark API vs database for agent pc295
4. **debugAgentLookup** - Searches Spark API for agents by office name and returns their listings
5. **debugSparkApi** - Tests Spark API connectivity and checks rate limits
6. **debugSparkEndpoints** - Tests different Spark endpoints (replication vs standard, OAuth vs API key)
7. **debugSparkRawFields** - Inspects all available fields on a specific Spark listing
8. **debugSpecificProperty** - Searches for a property by address and shows photo structure

## Key Conversion Patterns Applied

### Database Operations
- `base44.asServiceRole.entities.X.filter()` → `admin.from('table').select('*').eq(...)`
- `base44.asServiceRole.entities.X.create()` → `admin.from('table').insert()`
- `base44.asServiceRole.entities.X.update()` → `admin.from('table').update().eq()`
- `base44.asServiceRole.entities.X.delete()` → `admin.from('table').delete().eq()`

### Entity-to-Table Mappings
- User → profiles
- Property → properties
- PropertyView → property_views (with user_id UUID)
- SavedProperty → saved_properties (with user_id UUID)
- SearchPreference → search_preferences (with user_id UUID)
- EngagementAlert → engagement_alerts
- SyncCache → sync_cache

### API Integration
- Spark API endpoints preserved as-is (replication.sparkapi.com/v1/listings)
- Follow Up Boss API integration with Basic Auth header conversion
- OpenAI API calls for AI-generated summaries (GPT-4o-mini)
- Nominatim API for geocoding
- Resend API for email delivery

### Response Format
All functions follow the pattern:
```typescript
import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
        // Implementation
        return jsonResponse({ success: true, ... });
    } catch (error) {
        return jsonResponse({ error: error.message }, 500);
    }
});
```

## Notes

1. **Authentication**: Functions check user role via `getUser(req)` and require admin access where appropriate
2. **Timeouts**: Long-running functions (backfillPropertyCoordinates, checkInactiveListings) implement execution time guards
3. **Caching**: Cache TTLs and SyncCache keys preserved from original implementation
4. **Error Handling**: Graceful fallbacks for API errors (especially Spark API rate limits)
5. **AI Summaries**: OpenAI API calls with error fallbacks to ensure functions complete even if AI generation fails
6. **Environment Variables**: All external service credentials read from `Deno.env.get()`
