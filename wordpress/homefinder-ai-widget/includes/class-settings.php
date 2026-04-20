<?php
/**
 * Admin settings page for homeFinder AI Featured Listings plugin.
 *
 * @package HomeFinder_AI
 */

defined( 'ABSPATH' ) || exit;

namespace HomeFinder_AI;

/**
 * Registers the Settings > homeFinder AI admin page and all plugin options.
 *
 * Option keys (all stored individually via register_setting):
 *   hfai_supabase_url     – Supabase project URL
 *   hfai_supabase_anon_key – Supabase anon/public key
 *   hfai_base_url         – homeFinder production base URL (default https://homefind.ai)
 *   hfai_default_limit    – default number of cards (1-24, default 6)
 *   hfai_default_layout   – grid | carousel | list
 */
class Settings {

	private const OPTION_GROUP = 'hfai_options';
	private const PAGE_SLUG    = 'homefinder-ai-settings';

	public static function init(): void {
		add_action( 'admin_menu',    [ self::class, 'add_menu' ] );
		add_action( 'admin_init',    [ self::class, 'register_settings' ] );
	}

	// -----------------------------------------------------------------------
	// Menu
	// -----------------------------------------------------------------------

	public static function add_menu(): void {
		add_options_page(
			__( 'homeFinder AI Settings', HFAI_TEXT_DOMAIN ),
			__( 'homeFinder AI', HFAI_TEXT_DOMAIN ),
			'manage_options',
			self::PAGE_SLUG,
			[ self::class, 'render_page' ]
		);
	}

	// -----------------------------------------------------------------------
	// Settings registration
	// -----------------------------------------------------------------------

	public static function register_settings(): void {
		$options = [
			'hfai_supabase_url' => [
				'sanitize_callback' => static function ( $v ) {
					return esc_url_raw( trim( $v ) );
				},
				'default' => '',
			],
			'hfai_supabase_anon_key' => [
				'sanitize_callback' => 'sanitize_text_field',
				'default'           => '',
			],
			'hfai_base_url' => [
				'sanitize_callback' => static function ( $v ) {
					$url = esc_url_raw( trim( $v ) );
					return $url ?: 'https://homefind.ai';
				},
				'default' => 'https://homefind.ai',
			],
			'hfai_default_limit' => [
				'sanitize_callback' => static function ( $v ) {
					$int = absint( $v );
					return max( 1, min( 24, $int ) );
				},
				'default' => 6,
			],
			'hfai_default_layout' => [
				'sanitize_callback' => static function ( $v ) {
					return in_array( $v, [ 'grid', 'carousel', 'list' ], true ) ? $v : 'grid';
				},
				'default' => 'grid',
			],
		];

		foreach ( $options as $key => $args ) {
			register_setting(
				self::OPTION_GROUP,
				$key,
				[
					'sanitize_callback' => $args['sanitize_callback'],
					'default'           => $args['default'],
				]
			);
		}

		// Section.
		add_settings_section(
			'hfai_main_section',
			__( 'API Connection', HFAI_TEXT_DOMAIN ),
			static function () {
				echo '<p>' . esc_html__( 'Connect the widget to your Supabase project and set display defaults.', HFAI_TEXT_DOMAIN ) . '</p>';
			},
			self::PAGE_SLUG
		);

		// Fields.
		$fields = [
			[ 'hfai_supabase_url',      __( 'Supabase Project URL', HFAI_TEXT_DOMAIN ),     'field_text',   'https://xyzabc.supabase.co' ],
			[ 'hfai_supabase_anon_key', __( 'Supabase Anon Key',    HFAI_TEXT_DOMAIN ),     'field_text',   'eyJ...' ],
			[ 'hfai_base_url',          __( 'homeFinder Base URL',  HFAI_TEXT_DOMAIN ),     'field_text',   'https://homefind.ai' ],
			[ 'hfai_default_limit',     __( 'Default Card Limit',   HFAI_TEXT_DOMAIN ),     'field_number', '6' ],
			[ 'hfai_default_layout',    __( 'Default Layout',       HFAI_TEXT_DOMAIN ),     'field_layout', '' ],
		];

		foreach ( $fields as [ $id, $label, $method, $placeholder ] ) {
			add_settings_field(
				$id,
				$label,
				[ self::class, $method ],
				self::PAGE_SLUG,
				'hfai_main_section',
				[ 'id' => $id, 'placeholder' => $placeholder ]
			);
		}
	}

	// -----------------------------------------------------------------------
	// Field renderers
	// -----------------------------------------------------------------------

	public static function field_text( array $args ): void {
		$id    = esc_attr( $args['id'] );
		$value = esc_attr( (string) get_option( $args['id'], '' ) );
		$ph    = esc_attr( $args['placeholder'] ?? '' );
		printf(
			'<input type="text" id="%1$s" name="%1$s" value="%2$s" placeholder="%3$s" class="regular-text" />',
			$id, $value, $ph
		);
	}

	public static function field_number( array $args ): void {
		$id    = esc_attr( $args['id'] );
		$value = absint( get_option( $args['id'], 6 ) );
		printf(
			'<input type="number" id="%1$s" name="%1$s" value="%2$d" min="1" max="24" class="small-text" />
			<p class="description">%3$s</p>',
			$id,
			$value,
			esc_html__( 'Number of property cards to display (1–24).', HFAI_TEXT_DOMAIN )
		);
	}

	public static function field_layout( array $args ): void {
		$id      = esc_attr( $args['id'] );
		$current = get_option( $args['id'], 'grid' );
		$options = [
			'grid'     => __( 'Grid', HFAI_TEXT_DOMAIN ),
			'carousel' => __( 'Carousel', HFAI_TEXT_DOMAIN ),
			'list'     => __( 'List', HFAI_TEXT_DOMAIN ),
		];
		echo '<select id="' . $id . '" name="' . $id . '">';
		foreach ( $options as $val => $label ) {
			printf(
				'<option value="%s"%s>%s</option>',
				esc_attr( $val ),
				selected( $current, $val, false ),
				esc_html( $label )
			);
		}
		echo '</select>';
	}

	// -----------------------------------------------------------------------
	// Page render
	// -----------------------------------------------------------------------

	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have sufficient permissions to access this page.', HFAI_TEXT_DOMAIN ) );
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'homeFinder AI Featured Listings', HFAI_TEXT_DOMAIN ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( self::OPTION_GROUP );
				do_settings_sections( self::PAGE_SLUG );
				submit_button();
				?>
			</form>
			<hr />
			<h2><?php esc_html_e( 'Usage', HFAI_TEXT_DOMAIN ); ?></h2>
			<p><strong><?php esc_html_e( 'Shortcode:', HFAI_TEXT_DOMAIN ); ?></strong>
				<code>[homefinder_featured]</code> &nbsp;|&nbsp;
				<code>[homefinder_featured limit="6" layout="grid" columns="3"]</code>
			</p>
			<p><strong><?php esc_html_e( 'Block:', HFAI_TEXT_DOMAIN ); ?></strong>
				<?php esc_html_e( 'Search for "homeFinder Featured Listings" in the block inserter.', HFAI_TEXT_DOMAIN ); ?>
			</p>
			<p><strong><?php esc_html_e( 'Widget:', HFAI_TEXT_DOMAIN ); ?></strong>
				<?php esc_html_e( 'Add the "homeFinder AI Featured Listings" widget from Appearance > Widgets.', HFAI_TEXT_DOMAIN ); ?>
			</p>
		</div>
		<?php
	}

	// -----------------------------------------------------------------------
	// Helpers (used by shortcode / block / widget)
	// -----------------------------------------------------------------------

	public static function get( string $key, $default = '' ) {
		return get_option( $key, $default );
	}
}
