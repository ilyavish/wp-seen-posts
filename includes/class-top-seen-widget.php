<?php
/**
 * Top Seen Posts sidebar widget.
 *
 * @package WP_Seen_Posts
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Displays posts ranked by this plugin's anonymous daily Seen aggregates. */
final class Top_Seen_Widget extends \WP_Widget {
	public const ID_BASE       = 'wp_seen_posts_top';
	public const DEFAULT_LIMIT = 5;
	public const MAX_LIMIT     = 10;

	/** Configure the legacy widget, which also appears in the block Widgets screen. */
	public function __construct() {
		parent::__construct(
			self::ID_BASE,
			__( 'Top Seen Posts', 'wp-seen-posts' ),
			array(
				'classname'                   => 'widget_wp_seen_posts_top',
				'description'                 => __( 'Popular posts ranked by this plugin’s anonymous Seen analytics.', 'wp-seen-posts' ),
				'customize_selective_refresh' => true,
			)
		);
	}

	/** Register the widget with WordPress. */
	public static function register(): void {
		register_widget( __CLASS__ );
	}

	/** Render one configured widget instance. */
	public function widget( $args, $instance ): void {
		$settings = self::sanitize_instance( is_array( $instance ) ? $instance : array() );
		$rows     = self::get_ranked_rows( $settings['period'], $settings['limit'] );
		if ( ! $rows ) {
			return;
		}

		$post_ids = wp_list_pluck( $rows, 'post_id' );
		$posts    = get_posts(
			array(
				'post_type'              => 'post',
				'post_status'            => 'publish',
				'post__in'               => $post_ids,
				'orderby'                => 'post__in',
				'posts_per_page'         => count( $post_ids ),
				'ignore_sticky_posts'    => true,
				'no_found_rows'          => true,
				'update_post_meta_cache' => 'text' !== $settings['display'],
				'update_post_term_cache' => false,
				'suppress_filters'       => false,
			)
		);
		if ( ! $posts ) {
			return;
		}

		$scores = array();
		foreach ( $rows as $row ) {
			$scores[ $row['post_id'] ] = $row['seen_count'];
		}

		$title = apply_filters( 'widget_title', $settings['title'], $instance, $this->id_base );
		echo $args['before_widget']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		if ( '' !== $title ) {
			echo $args['before_title'] . esc_html( $title ) . $args['after_title']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
		printf(
			'<ul class="wp-seen-posts-top-list wp-seen-posts-top-list-%s">',
			esc_attr( $settings['display'] )
		);

		foreach ( $posts as $post ) {
			$post_id = (int) $post->ID;
			if ( ! isset( $scores[ $post_id ] ) ) {
				continue;
			}
			$this->render_item( $post, $scores[ $post_id ], $settings );
		}

		echo '</ul>';
		echo $args['after_widget']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/** Render the administration form. */
	public function form( $instance ): void {
		$settings = self::sanitize_instance( is_array( $instance ) ? $instance : array() );
		?>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'title' ) ); ?>"><?php esc_html_e( 'Title:', 'wp-seen-posts' ); ?></label>
			<input class="widefat" id="<?php echo esc_attr( $this->get_field_id( 'title' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'title' ) ); ?>" type="text" value="<?php echo esc_attr( $settings['title'] ); ?>">
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'period' ) ); ?>"><?php esc_html_e( 'Time range:', 'wp-seen-posts' ); ?></label>
			<select class="widefat" id="<?php echo esc_attr( $this->get_field_id( 'period' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'period' ) ); ?>">
				<?php foreach ( self::period_options() as $value => $label ) : ?>
					<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $settings['period'], $value ); ?>><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'limit' ) ); ?>"><?php esc_html_e( 'Number of posts:', 'wp-seen-posts' ); ?></label>
			<input class="tiny-text" id="<?php echo esc_attr( $this->get_field_id( 'limit' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'limit' ) ); ?>" type="number" min="1" max="<?php echo esc_attr( (string) self::MAX_LIMIT ); ?>" step="1" value="<?php echo esc_attr( (string) $settings['limit'] ); ?>">
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'display' ) ); ?>"><?php esc_html_e( 'Display:', 'wp-seen-posts' ); ?></label>
			<select class="widefat" id="<?php echo esc_attr( $this->get_field_id( 'display' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'display' ) ); ?>">
				<?php foreach ( self::display_options() as $value => $label ) : ?>
					<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $settings['display'], $value ); ?>><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<?php
	}

	/** Sanitize settings saved by the Widgets screen. */
	public function update( $new_instance, $old_instance ): array {
		return self::sanitize_instance( is_array( $new_instance ) ? $new_instance : array() );
	}

	/**
	 * Query cached rankings for a supported period.
	 *
	 * @return array<int,array{post_id:int,seen_count:int}>
	 */
	public static function get_ranked_rows( string $period, int $limit ): array {
		return Public_Counts::ranked_posts( $period, $limit );
	}

	/** Normalize all widget settings, including defaults. */
	private static function sanitize_instance( array $instance ): array {
		$periods  = self::period_options();
		$displays = self::display_options();
		$period   = isset( $instance['period'] ) && array_key_exists( $instance['period'], $periods ) ? $instance['period'] : 'week';
		$display  = isset( $instance['display'] ) && array_key_exists( $instance['display'], $displays ) ? $instance['display'] : 'text';
		$limit    = isset( $instance['limit'] ) ? (int) $instance['limit'] : self::DEFAULT_LIMIT;

		return array(
			'title'   => isset( $instance['title'] ) ? sanitize_text_field( $instance['title'] ) : __( 'Top Seen Posts', 'wp-seen-posts' ),
			'period'  => $period,
			'limit'   => max( 1, min( self::MAX_LIMIT, $limit ) ),
			'display' => $display,
		);
	}

	/** Supported ranking windows. */
	private static function period_options(): array {
		return array(
			'today' => __( 'Today', 'wp-seen-posts' ),
			'week'  => __( 'Last 7 days', 'wp-seen-posts' ),
			'month' => __( 'Last 30 days', 'wp-seen-posts' ),
		);
	}

	/** Familiar Jetpack-style presentation choices. */
	private static function display_options(): array {
		return array(
			'text'  => __( 'Text list', 'wp-seen-posts' ),
			'image' => __( 'Image list', 'wp-seen-posts' ),
			'grid'  => __( 'Image grid', 'wp-seen-posts' ),
		);
	}

	/** Render one ranked post link. */
	private function render_item( \WP_Post $post, int $seen_count, array $settings ): void {
		$title       = get_the_title( $post );
		$url         = get_permalink( $post );
		$show_image  = 'text' !== $settings['display'];
		$count_label = self::count_label( $settings['period'], $seen_count );
		?>
		<li class="wp-seen-posts-top-item">
			<a class="wp-seen-posts-top-link" href="<?php echo esc_url( $url ); ?>">
				<?php if ( $show_image ) : ?>
					<span class="wp-seen-posts-top-media" aria-hidden="true">
						<?php
						if ( has_post_thumbnail( $post ) ) {
							echo get_the_post_thumbnail( $post, 'thumbnail', array( 'class' => 'wp-seen-posts-top-thumbnail', 'loading' => 'lazy', 'decoding' => 'async', 'alt' => '' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						} else {
							echo '<span class="wp-seen-posts-top-placeholder">' . Public_Counts::eye_svg_markup() . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						}
						?>
					</span>
				<?php endif; ?>
				<span class="wp-seen-posts-top-copy">
					<span class="wp-seen-posts-top-title"><?php echo esc_html( $title ); ?></span>
					<span class="wp-seen-posts-top-count" aria-label="<?php echo esc_attr( $count_label ); ?>" title="<?php echo esc_attr( $count_label ); ?>">
						<?php echo Public_Counts::eye_svg_markup(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
						<span aria-hidden="true"><?php echo esc_html( Public_Counts::format_compact( $seen_count ) ); ?></span>
					</span>
				</span>
			</a>
		</li>
		<?php
	}

	/** Accessible exact-count label for the selected period. */
	private static function count_label( string $period, int $count ): string {
		$number = number_format_i18n( $count );
		if ( 'today' === $period ) {
			$template = _n( 'Seen by %s visitor today', 'Seen by %s visitors today', $count, 'wp-seen-posts' );
		} elseif ( 'month' === $period ) {
			$template = _n( 'Seen by %s visitor in the last 30 days', 'Seen by %s visitors in the last 30 days', $count, 'wp-seen-posts' );
		} else {
			$template = _n( 'Seen by %s visitor in the last 7 days', 'Seen by %s visitors in the last 7 days', $count, 'wp-seen-posts' );
		}
		return sprintf( $template, $number );
	}
}
