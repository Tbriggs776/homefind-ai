/**
 * ARMLS IDX Compliance Components
 * crandellrealestate.com — Balboa Realty, LLC
 *
 * Rule 23.2.12 — Listing firm name + agent contact on every listing
 * Rule 23.3.3  — ARMLS data source attribution
 * Rule 23.3.4  — Accuracy disclaimer
 * Rule 23.3.7  — Brokerage name visible on every page without scrolling
 * Rule 23.3.9  — Brokerage name fully spelled out
 */

import React from 'react';

/* ── Rule 23.3.7 + 23.3.9: Brokerage header, sticky, fully spelled out ── */
export function BrokerageHeader() {
  return (
    <div style={{
      width: '100%',
      background: '#0f1923',
      color: '#fff',
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '14px',
      borderBottom: '2px solid #c9703e',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '0.01em' }}>
          Crandell Real Estate Team
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span style={{ opacity: 0.7 }}>Balboa Realty, LLC</span>
      </div>
      <div style={{ opacity: 0.6, fontSize: '12px' }}>
        IDX provided by ARMLS
      </div>
    </div>
  );
}

/* ── Rule 23.3.3 + 23.3.4: ARMLS disclaimer footer ── */
export function ARMLSDisclaimer() {
  return (
    <div style={{
      width: '100%',
      background: '#f5f5f0',
      borderTop: '1px solid #ddd',
      padding: '24px',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '12px',
      color: '#666',
      lineHeight: 1.6,
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#333' }}>
          Data Source: Arizona Regional Multiple Listing Service (ARMLS)
        </p>
        <p style={{ margin: '0 0 8px' }}>
          All listing data is derived from the Arizona Regional Multiple Listing Service.
          IDX information is provided exclusively for personal, non-commercial use and may
          not be used for any purpose other than to identify prospective properties consumers
          may be interested in purchasing.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          Listing information is deemed reliable but is not guaranteed accurate by ARMLS or
          Balboa Realty, LLC. Listing data last updated{' '}
          {new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}.
        </p>
        <p style={{ margin: 0, opacity: 0.8 }}>
          &copy; {new Date().getFullYear()} Arizona Regional Multiple Listing Service. All rights reserved.
        </p>
      </div>
    </div>
  );
}

/* ── Rule 23.2.12: Listing attribution on detail pages ── */
export function ListingAttribution({ listingOfficeName, listingAgentName, listingAgentEmail, listingAgentPhone }) {
  if (!listingOfficeName) return null;
  return (
    <div style={{
      padding: '14px 18px',
      background: '#f8f8f5',
      borderRadius: '8px',
      border: '1px solid #e0ddd6',
      fontSize: '14px',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      lineHeight: 1.6,
      marginTop: '16px',
    }}>
      <div style={{ fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Listed by: {listingOfficeName}
      </div>
      {listingAgentName && (
        <div style={{ color: '#555' }}>Agent: {listingAgentName}</div>
      )}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
        {listingAgentEmail && (
          <a href={`mailto:${listingAgentEmail}`} style={{ color: '#c9703e', textDecoration: 'none' }}>
            {listingAgentEmail}
          </a>
        )}
        {listingAgentPhone && (
          <a href={`tel:${listingAgentPhone}`} style={{ color: '#c9703e', textDecoration: 'none' }}>
            {listingAgentPhone}
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Rule 23.3.3: Compact badge for listing cards ── */
export function ARMLSSourceBadge() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 8px',
      background: '#eee',
      borderRadius: '4px',
      fontSize: '10px',
      color: '#888',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontWeight: 500,
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
    }}>
      ARMLS IDX
    </span>
  );
}

/* ── Wrapper: ComplianceLayout for any page with listing data ── */
export function ComplianceLayout({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <BrokerageHeader />
      <main style={{ flex: 1 }}>{children}</main>
      <ARMLSDisclaimer />
    </div>
  );
}
