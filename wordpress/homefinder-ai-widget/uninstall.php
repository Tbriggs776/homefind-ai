<?php
/**
 * Fired when the plugin is uninstalled (Delete from WP admin).
 * Removes all plugin options and cached transients.
 *
 * @package HomeFinder_AI
 */

// Exit if not called from WordPress uninstall context.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// ---------------------------------------------------------------------------
// Delete plugin options.
// ---------------------------------------------------------------------------
$options = [
	'hfai_supabase_url',
	'hfai_supabase_anon_key',
	'hfai_base_url',
	'hfai_default_limit',
	'hfai_default_layout',
];

foreach ( $options as $option ) {
	delete_option( $option );
}

// ---------------------------------------------------------------------------
// Delete all hfai_featured_* transients.
// Limits range from 1 to 24 so iterate all possible keys.
// ---------------------------------------------------------------------------
for ( $i = 1; $i <= 24; $i++ ) {
	delete_transient( 'hfai_featured_' . $i );
}

// Also attempt a broader cleanup via direct DB query in case of unexpected keys.
global $wpdb;
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like( '_transient_hfai_featured_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_hfai_featured_' ) . '%'
	)
);
