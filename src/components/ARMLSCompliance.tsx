/**
 * ARMLS IDX Compliance Components
 * HomeFind AI - crandellrealestate.com
 *
 * These components satisfy ARMLS Rules & Regulations Section 23:
 *   Rule 23.2.12 - Listing firm name + agent contact on every listing
 *   Rule 23.3.3  - ARMLS data source attribution
 *   Rule 23.3.4  - Accuracy disclaimer
 *   Rule 23.3.7  - Brokerage name visible on every page without scrolling
 *   Rule 23.3.9  - Brokerage name fully spelled out
 */

import React from 'react';

// =============================================================================
// Rule 23.3.7 + 23.3.9: Brokerage name visible on EVERY page without scrolling
// Must be fully spelled out - no abbreviations
// =============================================================================
export const BrokerageHeader = () => (
  <div
    style={{
      width: '100%',
      backgroundColor: '#1a1a2e',
      color: '#ffffff',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      borderBottom: '2px solid #e94560',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '0.02em' }}>
        Balboa Realty, LLC
      </span>
      <span style={{ opacity: 0.6, fontSize: '12px' }}>|</span>
      <span style={{ opacity: 0.8, fontSize: '13px' }}>
        Tanner Crandell, Salesperson
      </span>
    </div>
    <div style={{ opacity: 0.7, fontSize: '12px' }}>
      Crandell Real Estate
    </div>
  </div>
);


// =============================================================================
// Rule 23.2.12: Listing firm name + agent email or phone on EVERY listing
// Must be in readable size not smaller than median text on the page
// =============================================================================
interface ListingAttributionProps {
  listingOfficeName: string | null;
  listingAgentName: string | null;
  listingAgentEmail: string | null;
  listingAgentPhone: string | null;
}

export const ListingAttribution: React.FC<ListingAttributionProps> = ({
  listingOfficeName,
  listingAgentName,
  listingAgentEmail,
  listingAgentPhone,
}) => {
  // Must show listing firm name AND agent email or phone
  // Font size must not be smaller than median text on page (14px baseline)
  return (
    <div
      style={{
        padding: '12px 16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '6px',
        border: '1px solid #dee2e6',
        fontSize: '14px', // Must be >= median page text size per Rule 23.2.12
        fontFamily: 'system-ui, -apple-system, sans-serif',
        lineHeight: 1.5,
        marginTop: '12px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {listingOfficeName && (
          <div style={{ fontWeight: 600, color: '#1a1a2e' }}>
            Listed by: {listingOfficeName}
          </div>
        )}
        {listingAgentName && (
          <div style={{ color: '#495057' }}>
            Listing Agent: {listingAgentName}
          </div>
        )}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {listingAgentEmail && (
            <a
              href={`mailto:${listingAgentEmail}`}
              style={{ color: '#0066cc', textDecoration: 'none', fontSize: '14px' }}
            >
              {listingAgentEmail}
            </a>
          )}
          {listingAgentPhone && (
            <a
              href={`tel:${listingAgentPhone}`}
              style={{ color: '#0066cc', textDecoration: 'none', fontSize: '14px' }}
            >
              {listingAgentPhone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
};


// =============================================================================
// Rule 23.3.3: Must display ARMLS as the data source
// Rule 23.3.4: Must display accuracy disclaimer
// Combined into a single footer component for every page showing listing data
// =============================================================================
export const ARMLSDisclaimer = () => (
  <div
    style={{
      width: '100%',
      padding: '16px 20px',
      backgroundColor: '#f8f9fa',
      borderTop: '1px solid #dee2e6',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      color: '#6c757d',
      lineHeight: 1.6,
    }}
  >
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Rule 23.3.3: ARMLS as data source */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, color: '#495057' }}>
          Data Source: ARMLS
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span>Arizona Regional Multiple Listing Service</span>
      </div>

      {/* Rule 23.3.4: Accuracy disclaimer - exact required language */}
      <p style={{ margin: '0 0 8px 0' }}>
        All information should be verified by the recipient and none is guaranteed
        as accurate by ARMLS.
      </p>

      {/* Additional context */}
      <p style={{ margin: 0, opacity: 0.8 }}>
        Listing information last updated {new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}. Listing data is refreshed every 12 hours.
      </p>
    </div>
  </div>
);


// =============================================================================
// Compact ARMLS source badge for search results / grid cards
// Satisfies Rule 23.3.3 in compact form for listing cards
// =============================================================================
export const ARMLSSourceBadge = () => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 8px',
      backgroundColor: '#e9ecef',
      borderRadius: '4px',
      fontSize: '11px',
      color: '#6c757d',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 500,
    }}
  >
    Source: ARMLS
  </span>
);


// =============================================================================
// Wrapper: Full compliance layout for any page showing listing data
// Includes BrokerageHeader (top) + ARMLSDisclaimer (bottom)
// =============================================================================
interface ComplianceLayoutProps {
  children: React.ReactNode;
}

export const ComplianceLayout: React.FC<ComplianceLayoutProps> = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
    <BrokerageHeader />
    <main style={{ flex: 1 }}>
      {children}
    </main>
    <ARMLSDisclaimer />
  </div>
);


// =============================================================================
// Usage example for property detail page:
//
// import { ComplianceLayout, ListingAttribution, ARMLSSourceBadge } from './ARMLSCompliance';
//
// const PropertyDetail = ({ property }) => (
//   <ComplianceLayout>
//     <div className="property-detail">
//       <h1>{property.address}</h1>
//       <ARMLSSourceBadge />
//       <p>{property.description}</p>
//       <ListingAttribution
//         listingOfficeName={property.listing_office_name}
//         listingAgentName={property.listing_agent_name}
//         listingAgentEmail={property.listing_agent_email}
//         listingAgentPhone={property.listing_agent_phone}
//       />
//     </div>
//   </ComplianceLayout>
// );
//
// Usage example for search results page:
//
// const SearchResults = ({ listings }) => (
//   <ComplianceLayout>
//     <div className="search-grid">
//       {listings.map(listing => (
//         <div key={listing.mls_number} className="listing-card">
//           <img src={listing.primary_photo_url} />
//           <h3>{listing.address}</h3>
//           <p>{listing.listing_office_name}</p>
//           <ARMLSSourceBadge />
//         </div>
//       ))}
//     </div>
//   </ComplianceLayout>
// );
// =============================================================================
