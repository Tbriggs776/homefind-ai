<?php
/**
 * Plugin Name:       homeFinder AI Featured Listings
 * Plugin URI:        https://homefind.ai
 * Description:       Embeds homeFinder AI featured property cards on any WordPress site via shortcode, Gutenberg block, and classic widget.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            homeFinder AI
 * Author URI:        https://homefind.ai
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       homefinder-ai-widget
 * Domain Path:       /languages
 */

defined( 'ABSPATH' ) || exit;

define( 'HFAI_VERSION',     '1.0.0' );
define( 'HFAI_PLUGIN_DIR',  plugin_dir_path( __FILE__ ) );
define( 'HFAI_PLUGIN_URL',  plugin_dir_url( __FILE__ ) );
define( 'HFAI_TEXT_DOMAIN', 'homefinder-ai-widget' );

// ---------------------------------------------------------------------------
// Auto-load includes
// ---------------------------------------------------------------------------
require_once HFAI_PLUGIN_DIR . 'includes/class-settings.php';
require_once HFAI_PLUGIN_DIR . 'includes/class-shortcode.php';
require_once HFAI_PLUGIN_DIR . 'includes/class-block.php';
require_once HFAI_PLUGIN_DIR . 'includes/class-widget.php';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
add_action( 'plugins_loaded', 'hfai_boot' );

function hfai_boot(): void {
	// Settings / admin page.
	HomeFinder_AI\Settings::init();

	// Shortcode.
	HomeFinder_AI\Shortcode::init();

	// Gutenberg block.
	HomeFinder_AI\Block::init();

	// Classic widget.
	add_action( 'widgets_init', static function () {
		register_widget( 'HomeFinder_AI\Widget' );
	} );

	// Front-end assets.
	add_action( 'wp_enqueue_scripts', 'hfai_enqueue_frontend_assets' );
}

/**
 * Enqueue CSS (always) and carousel JS (only when needed).
 * The carousel flag is set by the shortcode/block renderer before wp_footer.
 */
function hfai_enqueue_frontend_assets(): void {
	wp_register_style(
		'homefinder-ai-widget',
		HFAI_PLUGIN_URL . 'assets/css/homefinder-widget.css',
		[],
		HFAI_VERSION
	);

	wp_register_script(
		'homefinder-ai-carousel',
		HFAI_PLUGIN_URL . 'assets/js/homefinder-widget.js',
		[],
		HFAI_VERSION,
		true
	);

	// Always enqueue the stylesheet; JS is enqueued conditionally by the renderer.
	wp_enqueue_style( 'homefinder-ai-widget' );
}
