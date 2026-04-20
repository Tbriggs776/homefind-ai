<?php
/**
 * Gutenberg block registration for homeFinder AI Featured Listings.
 *
 * Uses register_block_type() pointing at build/block.json with a PHP
 * render_callback so no Node build step is required.
 *
 * @package HomeFinder_AI
 */

defined( 'ABSPATH' ) || exit;

namespace HomeFinder_AI;

class Block {

	public static function init(): void {
		add_action( 'init', [ self::class, 'register' ] );
	}

	public static function register(): void {
		// register_block_type reads block.json for metadata.
		register_block_type(
			HFAI_PLUGIN_DIR . 'build/block.json',
			[
				'render_callback' => [ self::class, 'render' ],
			]
		);

		// Enqueue the minimal editor script that provides the block editor UI.
		add_action( 'enqueue_block_editor_assets', [ self::class, 'enqueue_editor_assets' ] );
	}

	/**
	 * Render callback – delegates to the shared shortcode renderer.
	 *
	 * @param array $attributes Block attributes.
	 * @return string HTML output.
	 */
	public static function render( array $attributes ): string {
		$atts = [
			'limit'   => $attributes['limit']   ?? (int) Settings::get( 'hfai_default_limit', 6 ),
			'layout'  => $attributes['layout']  ?? Settings::get( 'hfai_default_layout', 'grid' ),
			'columns' => $attributes['columns'] ?? 3,
		];

		return Shortcode::render( $atts );
	}

	/**
	 * Enqueue a tiny inline editor script that registers the block in JS land
	 * using wp.blocks and wp.element (no build step).
	 */
	public static function enqueue_editor_assets(): void {
		wp_enqueue_script(
			'homefinder-ai-block-editor',
			HFAI_PLUGIN_URL . 'build/editor.js',
			[ 'wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-server-side-render' ],
			HFAI_VERSION,
			true
		);

		wp_enqueue_style(
			'homefinder-ai-widget-editor',
			HFAI_PLUGIN_URL . 'assets/css/homefinder-widget.css',
			[],
			HFAI_VERSION
		);
	}
}
