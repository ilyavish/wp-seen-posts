<?php
/**
 * Minimal compatibility settings for themes that cannot be detected safely.
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Settings {
	/** @var array<string,string> */
	private const FIELDS = array(
		'feed' => 'Feed/container selector',
		'post' => 'Individual post selector',
	);

	/** @var array<string,mixed> */
	private const GAMIFICATION_DEFAULTS = array(
		'streaks_enabled'        => true,
		'streak_posts_required'  => 3,
		'rarity_enabled'         => true,
		'rarity_min_readers'     => 20,
		'streak_progress_enabled'=> true,
		'zapoi_enabled'          => true,
	);

	/** @var array<string,mixed> */
	private const ANALYTICS_DEFAULTS = array(
		'analytics_enabled'        => true,
		'analytics_delay_ms'       => 1000,
		'analytics_dedupe_minutes' => 30,
		'analytics_respect_dnt'    => true,
	);

	public static function init(): void {
		add_action( 'admin_init', array( self::class, 'register' ) );
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	public static function register(): void {
		register_setting(
			'wp_seen_posts',
			OPTION,
			array(
				'type'              => 'array',
				'default'           => array(),
				'sanitize_callback' => array( self::class, 'sanitize' ),
			)
		);

		add_settings_section(
			'wp_seen_posts_selectors',
			__( 'Theme compatibility', 'wp-seen-posts' ),
			array( self::class, 'section' ),
			'wp_seen_posts'
		);

		foreach ( self::FIELDS as $key => $label ) {
			add_settings_field(
				'wp_seen_posts_' . $key,
				esc_html__( $label, 'wp-seen-posts' ),
				array( self::class, 'field' ),
				'wp_seen_posts',
				'wp_seen_posts_selectors',
				array( 'key' => $key )
			);
		}

		add_settings_section(
			'wp_seen_posts_gamification',
			__( 'Streaks & Rarity', 'wp-seen-posts' ),
			array( self::class, 'gamification_section' ),
			'wp_seen_posts'
		);

		$fields = array(
			'streaks_enabled'         => array( 'label' => __( 'Enable streaks', 'wp-seen-posts' ), 'type' => 'checkbox' ),
			'streak_posts_required'   => array( 'label' => __( 'Posts required per streak day', 'wp-seen-posts' ), 'type' => 'number', 'min' => 1, 'max' => 25 ),
			'rarity_enabled'          => array( 'label' => __( 'Enable badge rarity', 'wp-seen-posts' ), 'type' => 'checkbox' ),
			'rarity_min_readers'      => array( 'label' => __( 'Minimum tracked readers for rarity', 'wp-seen-posts' ), 'type' => 'number', 'min' => 5, 'max' => 1000000 ),
			'streak_progress_enabled' => array( 'label' => __( 'Show progress before the daily goal', 'wp-seen-posts' ), 'type' => 'checkbox' ),
			'zapoi_enabled'           => array( 'label' => __( 'Enable the Zapoi badge', 'wp-seen-posts' ), 'type' => 'checkbox' ),
		);

		foreach ( $fields as $key => $field ) {
			add_settings_field(
				'wp_seen_posts_' . $key,
				$field['label'],
				array( self::class, 'gamification_field' ),
				'wp_seen_posts',
				'wp_seen_posts_gamification',
				array_merge( $field, array( 'key' => $key ) )
			);
		}

		add_settings_section(
			'wp_seen_posts_analytics',
			__( 'First-party analytics', 'wp-seen-posts' ),
			array( self::class, 'analytics_section' ),
			'wp_seen_posts'
		);

		$analytics_fields = array(
			'analytics_enabled'        => array( 'label' => __( 'Enable page analytics', 'wp-seen-posts' ), 'type' => 'checkbox' ),
			'analytics_delay_ms'       => array( 'label' => __( 'Visible time before counting (milliseconds)', 'wp-seen-posts' ), 'type' => 'number', 'min' => 250, 'max' => 10000 ),
			'analytics_dedupe_minutes' => array( 'label' => __( 'Reload deduplication window (minutes)', 'wp-seen-posts' ), 'type' => 'number', 'min' => 5, 'max' => 240 ),
			'analytics_respect_dnt'    => array( 'label' => __( 'Respect browser privacy signals', 'wp-seen-posts' ), 'type' => 'checkbox' ),
		);
		foreach ( $analytics_fields as $key => $field ) {
			add_settings_field(
				'wp_seen_posts_' . $key,
				$field['label'],
				array( self::class, 'analytics_field' ),
				'wp_seen_posts',
				'wp_seen_posts_analytics',
				array_merge( $field, array( 'key' => $key ) )
			);
		}
	}

	public static function menu(): void {
		add_options_page(
			__( 'Seen Posts', 'wp-seen-posts' ),
			__( 'Seen Posts', 'wp-seen-posts' ),
			'manage_options',
			'wp-seen-posts',
			array( self::class, 'page' )
		);
	}

	/** @return array<string,string> */
	public static function get_selectors(): array {
		$value = get_option( OPTION, array() );
		return is_array( $value ) ? array_intersect_key( $value, self::FIELDS ) : array();
	}

	/** Return normalized streak and rarity settings. */
	public static function get_gamification(): array {
		$value = get_option( OPTION, array() );
		$value = is_array( $value ) ? $value : array();
		return array(
			'streaks_enabled'         => isset( $value['streaks_enabled'] ) ? (bool) $value['streaks_enabled'] : self::GAMIFICATION_DEFAULTS['streaks_enabled'],
			'streak_posts_required'   => isset( $value['streak_posts_required'] ) ? min( 25, max( 1, (int) $value['streak_posts_required'] ) ) : self::GAMIFICATION_DEFAULTS['streak_posts_required'],
			'rarity_enabled'          => isset( $value['rarity_enabled'] ) ? (bool) $value['rarity_enabled'] : self::GAMIFICATION_DEFAULTS['rarity_enabled'],
			'rarity_min_readers'      => isset( $value['rarity_min_readers'] ) ? min( 1000000, max( 5, (int) $value['rarity_min_readers'] ) ) : self::GAMIFICATION_DEFAULTS['rarity_min_readers'],
			'streak_progress_enabled' => isset( $value['streak_progress_enabled'] ) ? (bool) $value['streak_progress_enabled'] : self::GAMIFICATION_DEFAULTS['streak_progress_enabled'],
			'zapoi_enabled'           => isset( $value['zapoi_enabled'] ) ? (bool) $value['zapoi_enabled'] : self::GAMIFICATION_DEFAULTS['zapoi_enabled'],
		);
	}

	public static function streaks_enabled(): bool {
		return (bool) self::get_gamification()['streaks_enabled'];
	}

	public static function streak_daily_requirement(): int {
		$value = (int) self::get_gamification()['streak_posts_required'];
		/** Filters the number of unique Seen posts required to complete one streak day. */
		return min( 25, max( 1, (int) apply_filters( 'wp_seen_posts_streak_daily_requirement', $value ) ) );
	}

	public static function rarity_enabled(): bool {
		return (bool) self::get_gamification()['rarity_enabled'];
	}

	public static function rarity_minimum_readers(): int {
		$value = (int) self::get_gamification()['rarity_min_readers'];
		/** Filters the minimum denominator required before badge rarity is shown. */
		return max( 1, (int) apply_filters( 'wp_seen_posts_rarity_minimum_readers', $value ) );
	}

	public static function streak_progress_enabled(): bool {
		return (bool) self::get_gamification()['streak_progress_enabled'];
	}

	public static function zapoi_enabled(): bool {
		return self::streaks_enabled() && (bool) self::get_gamification()['zapoi_enabled'];
	}

	/** Return normalized standalone analytics settings. */
	public static function get_analytics(): array {
		$value = get_option( OPTION, array() );
		$value = is_array( $value ) ? $value : array();
		return array(
			'analytics_enabled'        => isset( $value['analytics_enabled'] ) ? (bool) $value['analytics_enabled'] : self::ANALYTICS_DEFAULTS['analytics_enabled'],
			'analytics_delay_ms'       => isset( $value['analytics_delay_ms'] ) ? min( 10000, max( 250, (int) $value['analytics_delay_ms'] ) ) : self::ANALYTICS_DEFAULTS['analytics_delay_ms'],
			'analytics_dedupe_minutes' => isset( $value['analytics_dedupe_minutes'] ) ? min( 240, max( 5, (int) $value['analytics_dedupe_minutes'] ) ) : self::ANALYTICS_DEFAULTS['analytics_dedupe_minutes'],
			'analytics_respect_dnt'    => isset( $value['analytics_respect_dnt'] ) ? (bool) $value['analytics_respect_dnt'] : self::ANALYTICS_DEFAULTS['analytics_respect_dnt'],
		);
	}

	public static function analytics_enabled(): bool {
		return (bool) self::get_analytics()['analytics_enabled'];
	}

	public static function analytics_delay_ms(): int {
		return (int) self::get_analytics()['analytics_delay_ms'];
	}

	public static function analytics_dedupe_minutes(): int {
		return (int) self::get_analytics()['analytics_dedupe_minutes'];
	}

	public static function analytics_respects_dnt(): bool {
		return (bool) self::get_analytics()['analytics_respect_dnt'];
	}

	/** @param mixed $input @return array<string,mixed> */
	public static function sanitize( $input ): array {
		if ( ! is_array( $input ) ) {
			return array_merge( self::GAMIFICATION_DEFAULTS, self::ANALYTICS_DEFAULTS );
		}
		$output = array(
			'streaks_enabled'         => ! empty( $input['streaks_enabled'] ),
			'streak_posts_required'   => isset( $input['streak_posts_required'] ) ? min( 25, max( 1, absint( $input['streak_posts_required'] ) ) ) : self::GAMIFICATION_DEFAULTS['streak_posts_required'],
			'rarity_enabled'          => ! empty( $input['rarity_enabled'] ),
			'rarity_min_readers'      => isset( $input['rarity_min_readers'] ) ? min( 1000000, max( 5, absint( $input['rarity_min_readers'] ) ) ) : self::GAMIFICATION_DEFAULTS['rarity_min_readers'],
			'streak_progress_enabled' => ! empty( $input['streak_progress_enabled'] ),
			'zapoi_enabled'           => ! empty( $input['zapoi_enabled'] ),
			'analytics_enabled'       => ! empty( $input['analytics_enabled'] ),
			'analytics_delay_ms'      => isset( $input['analytics_delay_ms'] ) ? min( 10000, max( 250, absint( $input['analytics_delay_ms'] ) ) ) : self::ANALYTICS_DEFAULTS['analytics_delay_ms'],
			'analytics_dedupe_minutes'=> isset( $input['analytics_dedupe_minutes'] ) ? min( 240, max( 5, absint( $input['analytics_dedupe_minutes'] ) ) ) : self::ANALYTICS_DEFAULTS['analytics_dedupe_minutes'],
			'analytics_respect_dnt'   => ! empty( $input['analytics_respect_dnt'] ),
		);
		foreach ( self::FIELDS as $key => $label ) {
			if ( empty( $input[ $key ] ) ) {
				continue;
			}
			$value = trim( sanitize_text_field( wp_unslash( $input[ $key ] ) ) );
			if ( strlen( $value ) <= 250 && ! preg_match( '/[{}<>]/', $value ) ) {
				$output[ $key ] = $value;
			}
		}
		return $output;
	}

	public static function section(): void {
		echo '<p>' . esc_html__( 'P2, P2 Resurrected, Query Loop blocks, and conservative classic markup are detected automatically. Only set both selectors when automatic detection does not find your feed.', 'wp-seen-posts' ) . '</p>';
	}

	public static function gamification_section(): void {
		echo '<p>' . esc_html__( 'Streak state stays in each reader’s browser. Only salted anonymous identifiers and aggregate badge totals are stored for rarity.', 'wp-seen-posts' ) . '</p>';
	}

	public static function analytics_section(): void {
		echo '<p>' . esc_html__( 'Counts qualified views and anonymous visitors on posts, pages, the homepage, archives, categories, tags, search, and 404 routes. It never stores IP addresses, search terms, or Seen history.', 'wp-seen-posts' ) . '</p>';
	}

	/** @param array{key:string} $args */
	public static function field( array $args ): void {
		$key   = $args['key'];
		$value = self::get_selectors()[ $key ] ?? '';
		printf(
			'<input class="regular-text code" type="text" name="%1$s[%2$s]" value="%3$s" autocomplete="off">',
			esc_attr( OPTION ),
			esc_attr( $key ),
			esc_attr( $value )
		);
	}

	/** Render one compact checkbox or bounded number setting. */
	public static function gamification_field( array $args ): void {
		$key      = (string) $args['key'];
		$settings = self::get_gamification();
		$value    = $settings[ $key ] ?? '';
		if ( 'checkbox' === $args['type'] ) {
			printf(
				'<label><input type="checkbox" name="%1$s[%2$s]" value="1" %3$s> %4$s</label>',
				esc_attr( OPTION ),
				esc_attr( $key ),
				checked( (bool) $value, true, false ),
				esc_html__( 'Enabled', 'wp-seen-posts' )
			);
			return;
		}

		printf(
			'<input class="small-text" type="number" name="%1$s[%2$s]" value="%3$d" min="%4$d" max="%5$d" step="1">',
			esc_attr( OPTION ),
			esc_attr( $key ),
			(int) $value,
			(int) $args['min'],
			(int) $args['max']
		);
	}

	/** Render one analytics setting with the same bounded controls. */
	public static function analytics_field( array $args ): void {
		$key      = (string) $args['key'];
		$settings = self::get_analytics();
		$value    = $settings[ $key ] ?? '';
		if ( 'checkbox' === $args['type'] ) {
			printf(
				'<label><input type="checkbox" name="%1$s[%2$s]" value="1" %3$s> %4$s</label>',
				esc_attr( OPTION ),
				esc_attr( $key ),
				checked( (bool) $value, true, false ),
				esc_html__( 'Enabled', 'wp-seen-posts' )
			);
			return;
		}

		printf(
			'<input class="small-text" type="number" name="%1$s[%2$s]" value="%3$d" min="%4$d" max="%5$d" step="1">',
			esc_attr( OPTION ),
			esc_attr( $key ),
			(int) $value,
			(int) $args['min'],
			(int) $args['max']
		);
	}

	public static function page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Seen Posts', 'wp-seen-posts' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'wp_seen_posts' );
				do_settings_sections( 'wp_seen_posts' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
