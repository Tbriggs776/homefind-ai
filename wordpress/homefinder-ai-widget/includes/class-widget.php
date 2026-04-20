<?php
/**
 * Classic WP_Widget subclass for homeFinder AI Featured Listings.
 *
 * @package HomeFinder_AI
 */

defined( 'ABSPATH' ) || exit;

namespace HomeFinder_AI;

class Widget extends \WP_Widget {

	public function __construct() {
		parent::__construct(
			'homefinder_ai_featured',
			__( 'homeFinder AI Featured Listings', HFAI_TEXT_DOMAIN ),
			[
				'description'                 => __( 'Displays featured property cards from homeFinder AI.', HFAI_TEXT_DOMAIN ),
				'customize_selective_refresh' => true,
			]
		);
	}

	// -----------------------------------------------------------------------
	// Front-end output
	// -----------------------------------------------------------------------

	/**
	 * @param array $args     Widget display args (before_widget, after_widget, etc.).
	 * @param array $instance Current widget settings.
	 */
	public function widget( $args, $instance ): void {
		$title   = ! empty( $instance['title'] ) ? apply_filters( 'widget_title', $instance['title'] ) : '';
		$limit   = isset( $instance['limit'] )  ? max( 1, min( 24, (int) $instance['limit'] ) )  : (int) Settings::get( 'hfai_default_limit', 6 );
		$layout  = isset( $instance['layout'] ) && in_array( $instance['layout'], [ 'grid', 'carousel', 'list' ], true )
			? $instance['layout']
			: Settings::get( 'hfai_default_layout', 'grid' );
		$columns = isset( $instance['columns'] ) ? max( 1, min( 4, (int) $instance['columns'] ) ) : 3;

		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- before_widget is registered by the theme.
		echo $args['before_widget'];

		if ( $title ) {
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- before_title/after_title are theme-registered.
			echo $args['before_title'] . esc_html( $title ) . $args['after_title'];
		}

		echo Shortcode::render( [
			'limit'   => $limit,
			'layout'  => $layout,
			'columns' => $columns,
		] );

		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo $args['after_widget'];
	}

	// -----------------------------------------------------------------------
	// Settings form (admin)
	// -----------------------------------------------------------------------

	/**
	 * @param array $instance Current widget settings.
	 */
	public function form( $instance ): void {
		$title   = $instance['title']   ?? '';
		$limit   = $instance['limit']   ?? Settings::get( 'hfai_default_limit', 6 );
		$layout  = $instance['layout']  ?? Settings::get( 'hfai_default_layout', 'grid' );
		$columns = $instance['columns'] ?? 3;
		?>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'title' ) ); ?>">
				<?php esc_html_e( 'Title (optional):', HFAI_TEXT_DOMAIN ); ?>
			</label>
			<input
				class="widefat"
				id="<?php echo esc_attr( $this->get_field_id( 'title' ) ); ?>"
				name="<?php echo esc_attr( $this->get_field_name( 'title' ) ); ?>"
				type="text"
				value="<?php echo esc_attr( $title ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'limit' ) ); ?>">
				<?php esc_html_e( 'Number of cards (1–24):', HFAI_TEXT_DOMAIN ); ?>
			</label>
			<input
				class="tiny-text"
				id="<?php echo esc_attr( $this->get_field_id( 'limit' ) ); ?>"
				name="<?php echo esc_attr( $this->get_field_name( 'limit' ) ); ?>"
				type="number"
				min="1"
				max="24"
				value="<?php echo esc_attr( (string) $limit ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'layout' ) ); ?>">
				<?php esc_html_e( 'Layout:', HFAI_TEXT_DOMAIN ); ?>
			</label>
			<select
				class="widefat"
				id="<?php echo esc_attr( $this->get_field_id( 'layout' ) ); ?>"
				name="<?php echo esc_attr( $this->get_field_name( 'layout' ) ); ?>"
			>
				<?php
				foreach ( [ 'grid' => 'Grid', 'carousel' => 'Carousel', 'list' => 'List' ] as $val => $label ) {
					printf(
						'<option value="%s"%s>%s</option>',
						esc_attr( $val ),
						selected( $layout, $val, false ),
						esc_html( $label )
					);
				}
				?>
			</select>
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'columns' ) ); ?>">
				<?php esc_html_e( 'Grid columns (1–4):', HFAI_TEXT_DOMAIN ); ?>
			</label>
			<input
				class="tiny-text"
				id="<?php echo esc_attr( $this->get_field_id( 'columns' ) ); ?>"
				name="<?php echo esc_attr( $this->get_field_name( 'columns' ) ); ?>"
				type="number"
				min="1"
				max="4"
				value="<?php echo esc_attr( (string) $columns ); ?>"
			/>
		</p>
		<?php
	}

	// -----------------------------------------------------------------------
	// Save settings
	// -----------------------------------------------------------------------

	/**
	 * @param array $new_instance New widget settings.
	 * @param array $old_instance Previous widget settings.
	 * @return array Sanitized settings.
	 */
	public function update( $new_instance, $old_instance ): array {
		return [
			'title'   => sanitize_text_field( $new_instance['title']   ?? '' ),
			'limit'   => max( 1, min( 24, (int) ( $new_instance['limit']   ?? 6 ) ) ),
			'layout'  => in_array( $new_instance['layout'] ?? '', [ 'grid', 'carousel', 'list' ], true )
				? $new_instance['layout']
				: 'grid',
			'columns' => max( 1, min( 4, (int) ( $new_instance['columns'] ?? 3 ) ) ),
		];
	}
}
