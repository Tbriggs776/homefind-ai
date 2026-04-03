-- =====================================================
-- ARMLS IDX Compliance Migration
-- HomeFind AI - Properties Table Updates
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Add ARMLS compliance fields required by Rule 23.2.12
-- Listing firm name + agent contact must be displayed on every listing

ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_office_name TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_office_mls_id TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_agent_name TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_agent_email TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_agent_phone TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_agent_mls_id TEXT;

-- Add listing_key for sync reconciliation (used by checkInactiveListings)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_key TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS modification_timestamp TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS photo_count INTEGER DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS primary_photo_url TEXT;

-- Create index on listing_key for fast lookups during inactive check
CREATE INDEX IF NOT EXISTS idx_properties_listing_key ON properties(listing_key);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);

-- Verify: Count current listings and their statuses
-- Run this SELECT separately to audit what's in the DB
-- SELECT status, COUNT(*) FROM properties GROUP BY status ORDER BY COUNT(*) DESC;

-- After running the sync with the new filter, purge any non-active listings:
-- DELETE FROM properties WHERE status != 'active';
-- ^^^ ONLY run this AFTER deploying the fixed sync function
