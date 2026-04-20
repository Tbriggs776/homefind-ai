<?php
/**
 * Shortcode handler for homeFinder AI Featured Listings.
 *
 * Usage: [homefinder_featured limit="6" layout="grid" columns="3"]
 *
 * @package HomeFinder_AI
 */

namespace HomeFinder_AI;

defined( 'ABSPATH' ) || exit;

class Shortcode {

	public static function init(): void {
		add_shortcode( 'homefinder_featured', [ self::class, 'render' ] );
	}

	/**
	 * Shortcode render callback. Also called by Block and Widget.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string HTML output.
	 */
	public static function render( $atts = [] ): string {
		$atts = shortcode_atts(
			[
				'limit'   => (int) Settings::get( 'hfai_default_limit', 6 ),
				'layout'  => Settings::get( 'hfai_default_layout', 'grid' ),
				'columns' => 3,
			],
			(array) $atts,
			'homefinder_featured'
		);

		$limit   = max( 1, min( 24, (int) $atts['limit'] ) );
		$layout  = in_array( $atts['layout'], [ 'grid', 'carousel', 'list' ], true ) ? $atts['layout'] : 'grid';
		$columns = max( 1, min( 4, (int) $atts['columns'] ) );

		$properties = self::fetch_properties( $limit );

		if ( 'carousel' === $layout ) {
			// Enqueue the carousel JS only when this layout is actually used.
			wp_enqueue_script( 'homefinder-ai-carousel' );
		}

		ob_start();
		self::render_output( $properties, $layout, $columns );
		return (string) ob_get_clean();
	}

	// -----------------------------------------------------------------------
	// Data fetching with transient cache
	// -----------------------------------------------------------------------

	/**
	 * Fetch featured listings from the Supabase Edge Function.
	 * Results cached in a transient for 15 minutes.
	 *
	 * @param int $limit Number of properties to request.
	 * @return array Array of property objects (as associative arrays).
	 */
	private static function fetch_properties( int $limit ): array {
		$transient_key = 'hfai_featured_' . $limit;
		$cached        = get_transient( $transient_key );

		if ( false !== $cached ) {
			return $cached;
		}

		$supabase_url = rtrim( (string) Settings::get( 'hfai_supabase_url', '' ), '/' );
		$anon_key     = (string) Settings::get( 'hfai_supabase_anon_key', '' );

		if ( empty( $supabase_url ) || empty( $anon_key ) ) {
			return [];
		}

		$endpoint = $supabase_url . '/functions/v1/getFeaturedListings';

		$response = wp_remote_post(
			$endpoint,
			[
				'timeout'     => 15,
				'headers'     => [
					'Content-Type'  => 'application/json',
					'apikey'        => $anon_key,
					'Authorization' => 'Bearer ' . $anon_key,
				],
				'body'        => wp_json_encode( [ 'limit' => $limit ] ),
				'data_format' => 'body',
			]
		);

		if ( is_wp_error( $response ) ) {
			return [];
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== (int) $code ) {
			return [];
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		$properties = $body['properties'] ?? [];

		if ( ! is_array( $properties ) ) {
			return [];
		}

		set_transient( $transient_key, $properties, 15 * MINUTE_IN_SECONDS );

		return $properties;
	}

	// -----------------------------------------------------------------------
	// HTML rendering
	// -----------------------------------------------------------------------

	/**
	 * Outputs the full widget HTML.
	 *
	 * @param array  $properties Array of property data arrays.
	 * @param string $layout     grid | carousel | list
	 * @param int    $columns    Number of grid columns.
	 */
	public static function render_output( array $properties, string $layout, int $columns = 3 ): void {
		$base_url  = rtrim( (string) Settings::get( 'hfai_base_url', 'https://homefind.ai' ), '/' );
		$props_url = esc_url( $base_url . '/Properties' );

		echo '<div class="hfai-widget hfai-layout-' . esc_attr( $layout ) . ' hfai-cols-' . esc_attr( (string) $columns ) . '">';

		if ( empty( $properties ) ) {
			echo '<p class="hfai-empty">';
			echo esc_html__( 'No featured listings available right now.', HFAI_TEXT_DOMAIN );
			echo ' <a href="' . $props_url . '" target="_blank" rel="noopener noreferrer">';
			echo esc_html__( 'View all properties', HFAI_TEXT_DOMAIN );
			echo '</a></p>';
			echo '</div>';
			return;
		}

		if ( 'carousel' === $layout ) {
			echo '<div class="hfai-carousel" data-hfai-carousel>';
			echo '<button class="hfai-carousel-btn hfai-carousel-prev" aria-label="' . esc_attr__( 'Previous', HFAI_TEXT_DOMAIN ) . '">&#8249;</button>';
			echo '<div class="hfai-carousel-track">';
		} elseif ( 'list' === $layout ) {
			echo '<div class="hfai-list">';
		} else {
			echo '<div class="hfai-grid">';
		}

		foreach ( $properties as $property ) {
			self::render_card( $property, $base_url, $layout );
		}

		if ( 'carousel' === $layout ) {
			echo '</div>'; // .hfai-carousel-track
			echo '<button class="hfai-carousel-btn hfai-carousel-next" aria-label="' . esc_attr__( 'Next', HFAI_TEXT_DOMAIN ) . '">&#8250;</button>';
			echo '</div>'; // .hfai-carousel
		} else {
			echo '</div>';
		}

		// Footer.
		echo '<p class="hfai-footer">';
		echo esc_html__( 'Powered by ', HFAI_TEXT_DOMAIN );
		echo '<a href="' . esc_url( $base_url ) . '" target="_blank" rel="noopener noreferrer">homeFinder AI</a>';
		echo '</p>';

		echo '</div>'; // .hfai-widget
	}

	/**
	 * Renders a single property card.
	 *
	 * @param array  $p        Property data.
	 * @param string $base_url homeFinder base URL.
	 * @param string $layout   Current layout mode.
	 */
	private static function render_card( array $p, string $base_url, string $layout ): void {
		$detail_url      = esc_url( $base_url . '/PropertyDetail?id=' . rawurlencode( (string) ( $p['id'] ?? '' ) ) );
		$placeholder_url = esc_url( HFAI_PLUGIN_URL . 'assets/images/property-placeholder.jpg' );

		// Image.
		$images = ( ! empty( $p['images'] ) && is_array( $p['images'] ) ) ? $p['images'] : [];
		$img    = ! empty( $images[0] ) ? esc_url( $images[0] ) : $placeholder_url;

		// Price.
		$price          = isset( $p['price'] ) ? (float) $p['price'] : 0;
		$orig_price     = isset( $p['original_list_price'] ) ? (float) $p['original_list_price'] : 0;
		$price_fmt      = '$' . number_format_i18n( $price, 0 );
		$price_reduced  = $orig_price > 0 && $orig_price > $price;

		// Sqft / price per sqft.
		$sqft           = isset( $p['square_feet'] ) ? (int) $p['square_feet'] : 0;
		$price_per_sqft = ( $price > 0 && $sqft > 0 ) ? (int) round( $price / $sqft ) : 0;

		// DOM.
		$dom        = isset( $p['days_on_market'] ) ? (int) $p['days_on_market'] : 0;
		$is_new     = $dom > 0 && $dom <= 7;

		// Status.
		$status     = isset( $p['status'] ) ? (string) $p['status'] : '';

		// ARMLS.
		$is_armls   = isset( $p['listing_source'] ) && 'flexmls_idx' === $p['listing_source'];
		$armls_logo = esc_url( HFAI_PLUGIN_URL . 'assets/images/armls-logo.png' );

		$card_class = 'hfai-card';
		if ( 'list' === $layout ) {
			$card_class .= ' hfai-card--list';
		}

		echo '<div class="' . esc_attr( $card_class ) . '">';
		echo '<a class="hfai-card-link" href="' . $detail_url . '" target="_blank" rel="noopener noreferrer" aria-label="' . esc_attr( ( $p['address'] ?? '' ) . ', ' . ( $p['city'] ?? '' ) ) . '">';

		// -- Image zone --
		echo '<div class="hfai-card-image-wrap">';
		echo '<img class="hfai-card-image" src="' . $img . '" alt="' . esc_attr( $p['address'] ?? '' ) . '" loading="lazy" />';

		// Badges top-left.
		echo '<div class="hfai-badges hfai-badges--tl">';
		if ( 'active' === $status )       echo '<span class="hfai-badge hfai-badge--active">'     . esc_html__( 'Active',       HFAI_TEXT_DOMAIN ) . '</span>';
		if ( 'coming_soon' === $status )  echo '<span class="hfai-badge hfai-badge--coming-soon">' . esc_html__( 'Coming Soon',  HFAI_TEXT_DOMAIN ) . '</span>';
		if ( 'pending' === $status )      echo '<span class="hfai-badge hfai-badge--pending">'     . esc_html__( 'Pending',      HFAI_TEXT_DOMAIN ) . '</span>';
		if ( ! empty( $p['is_featured'] ) ) echo '<span class="hfai-badge hfai-badge--featured">' . esc_html__( 'Featured',     HFAI_TEXT_DOMAIN ) . '</span>';
		if ( $price_reduced )             echo '<span class="hfai-badge hfai-badge--reduced">'     . esc_html__( 'Price Reduced',HFAI_TEXT_DOMAIN ) . '</span>';
		if ( ! empty( $p['virtual_tour_url'] ) ) echo '<span class="hfai-badge hfai-badge--tour">' . esc_html__( '3D Tour',     HFAI_TEXT_DOMAIN ) . '</span>';
		if ( isset( $p['property_type'] ) && 'new_construction' === $p['property_type'] ) {
			echo '<span class="hfai-badge hfai-badge--new-construction">' . esc_html__( 'New Construction', HFAI_TEXT_DOMAIN ) . '</span>';
		}
		echo '</div>'; // .hfai-badges--tl

		echo '</div>'; // .hfai-card-image-wrap

		// -- Content zone --
		echo '<div class="hfai-card-body">';

		// Price row.
		echo '<div class="hfai-price-row">';
		echo '<span class="hfai-price">' . esc_html( $price_fmt ) . '</span>';
		if ( $price_per_sqft > 0 ) {
			echo '<span class="hfai-price-sqft">$' . esc_html( number_format_i18n( $price_per_sqft, 0 ) ) . '/sqft</span>';
		}
		echo '</div>';

		// Address.
		echo '<p class="hfai-address">';
		echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
		echo esc_html( ( $p['address'] ?? '' ) . ', ' . ( $p['city'] ?? '' ) . ', ' . ( $p['state'] ?? '' ) );
		echo '</p>';

		// Days on market.
		if ( $dom > 0 ) {
			echo '<div class="hfai-dom">';
			if ( $is_new ) {
				echo '<span class="hfai-badge hfai-badge--new">' . esc_html__( 'New', HFAI_TEXT_DOMAIN ) . '</span>';
			}
			echo '<span class="hfai-dom-text">';
			echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
			/* translators: %d = number of days */
			echo esc_html( sprintf( _n( '%d day on market', '%d days on market', $dom, HFAI_TEXT_DOMAIN ), $dom ) );
			echo '</span>';
			echo '</div>';
		}

		// Stats row.
		echo '<div class="hfai-stats">';
		$beds  = isset( $p['bedrooms'] )   ? (int) $p['bedrooms']   : 0;
		$baths = isset( $p['bathrooms'] )  ? (float) $p['bathrooms'] : 0;
		$lot   = isset( $p['lot_size'] )   ? (float) $p['lot_size']  : 0;

		if ( $beds > 0 ) {
			echo '<span class="hfai-stat">';
			echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><line x1="12" y1="4" x2="12" y2="10"/></svg>';
			/* translators: %d = bed count */
			echo esc_html( sprintf( _n( '%d bed', '%d beds', $beds, HFAI_TEXT_DOMAIN ), $beds ) );
			echo '</span>';
		}
		if ( $baths > 0 ) {
			echo '<span class="hfai-stat">';
			echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6 C9 5 10 3 12 3 C14 3 15 5 15 6"/><path d="M4 12 H20 V17 C20 18.5 18.5 20 17 20 H7 C5.5 20 4 18.5 4 17 Z"/><line x1="4" y1="12" x2="4" y2="8"/></svg>';
			echo esc_html( $baths . ( 1 === $baths ? ' bath' : ' baths' ) );
			echo '</span>';
		}
		if ( $sqft > 0 ) {
			echo '<span class="hfai-stat">';
			echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
			echo esc_html( number_format_i18n( $sqft ) . ' sqft' );
			echo '</span>';
		}
		if ( $lot > 0 ) {
			echo '<span class="hfai-stat">';
			echo '<svg class="hfai-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8C8 10 5 16 3 22"/><path d="M9.5 3.5C9.5 3.5 11 8 14 9.5c3 1.5 5.5.5 5.5.5"/></svg>';
			echo esc_html( $lot . ' ac' );
			echo '</span>';
		}
		echo '</div>'; // .hfai-stats

		// Feature tags.
		if ( ! empty( $p['features'] ) && is_array( $p['features'] ) ) {
			$features = array_slice( $p['features'], 0, 3 );
			$extra    = count( $p['features'] ) - 3;
			echo '<div class="hfai-features">';
			foreach ( $features as $feature ) {
				echo '<span class="hfai-feature-tag">' . esc_html( (string) $feature ) . '</span>';
			}
			if ( $extra > 0 ) {
				echo '<span class="hfai-feature-tag">+' . esc_html( (string) $extra ) . ' more</span>';
			}
			echo '</div>';
		}

		// ARMLS compliance row.
		echo '<div class="hfai-armls-row">';
		if ( $is_armls ) {
			echo '<img class="hfai-armls-logo" src="' . $armls_logo . '" alt="ARMLS" />';
		}
		if ( ! empty( $p['list_office_name'] ) ) {
			echo '<span class="hfai-listed-by">' . esc_html__( 'Listed by: ', HFAI_TEXT_DOMAIN ) . esc_html( (string) $p['list_office_name'] ) . '</span>';
		}
		echo '</div>';

		// Agent contact (ARMLS Rule 23.2.12).
		$agent_contact = ! empty( $p['listing_agent_email'] ) ? $p['listing_agent_email']
			: ( ! empty( $p['listing_agent_phone'] ) ? $p['listing_agent_phone'] : '' );
		if ( '' !== $agent_contact ) {
			echo '<p class="hfai-agent-contact">' . esc_html( (string) $agent_contact ) . '</p>';
		}

		// ARMLS disclaimer.
		echo '<p class="hfai-disclaimer">' . esc_html__( 'All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.', HFAI_TEXT_DOMAIN ) . '</p>';

		echo '</div>'; // .hfai-card-body
		echo '</a>'; // .hfai-card-link
		echo '</div>'; // .hfai-card
	}
}
