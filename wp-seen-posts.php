<?php
/**
 * Plugin Name:       WP Seen Posts
 * Plugin URI:        https://github.com/ilyavish/wp-seen-posts
 * Description:       Tracks Seen posts, hides them on later feed visits, and provides anonymous public counters and Top Seen rankings.
 * Version:           1.3.3
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            holdmyvodka.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-seen-posts
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VERSION = '1.3.3';
const OPTION  = 'wp_seen_posts_selectors';

require_once __DIR__ . '/includes/class-settings.php';
require_once __DIR__ . '/includes/class-public-counts.php';
require_once __DIR__ . '/includes/class-gamification.php';
require_once __DIR__ . '/includes/functions.php';

/** Load and register the widget only after WordPress initializes its widget API. */
function register_top_seen_widget(): void {
	require_once __DIR__ . '/includes/class-top-seen-widget.php';
	Top_Seen_Widget::register();
}
add_action( 'widgets_init', __NAMESPACE__ . '\\register_top_seen_widget' );

/** Load the small widget stylesheet only when a Top Seen widget is active. */
function enqueue_widget_assets(): void {
	if ( is_admin() || ! is_active_widget( false, false, Top_Seen_Widget::ID_BASE, true ) ) {
		return;
	}

	wp_enqueue_style(
		'wp-seen-posts-top-widget',
		plugins_url( 'assets/css/top-seen-widget.css', __FILE__ ),
		array(),
		VERSION
	);
}
add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_widget_assets' );

/**
 * Whether Seen Posts should enhance this front-end request.
 */
function is_supported_view(): bool {
	$supported = ! is_admin() && ( is_home() || is_archive() || is_search() );

	/**
	 * Filters whether Seen Posts assets are loaded for the current request.
	 *
	 * @param bool $supported Whether the current request is a feed-like view.
	 */
	return (bool) apply_filters( 'wp_seen_posts_is_supported_view', $supported );
}

/**
 * Whether this request is an individual blog post that should be recorded as Seen.
 */
function is_trackable_single_post(): bool {
	$track = ! is_admin() && is_singular( 'post' );

	/** Filters whether individual blog posts are recorded in Seen history. */
	return $track && (bool) apply_filters( 'wp_seen_posts_track_single_posts', $track );
}

/**
 * Return the filtered local history limits used by feed and single-post tracking.
 *
 * @return array{max_entries:int,retention_days:int}
 */
function history_limits(): array {
	$max_entries    = defined( 'WP_SEEN_POSTS_MAX_ENTRIES' ) ? (int) WP_SEEN_POSTS_MAX_ENTRIES : 3000;
	$retention_days = defined( 'WP_SEEN_POSTS_RETENTION_DAYS' ) ? (int) WP_SEEN_POSTS_RETENTION_DAYS : 365;

	/** Filters the maximum number of locally stored post IDs. */
	$max_entries = (int) apply_filters( 'wp_seen_posts_max_entries', $max_entries );
	/** Filters the local Seen history retention period in days. */
	$retention_days = (int) apply_filters( 'wp_seen_posts_retention_days', $retention_days );

	return array(
		'max_entries'    => max( 1, $max_entries ),
		'retention_days' => max( 1, $retention_days ),
	);
}

/** Return a locally bundled, versioned badge URL for long-lived browser caching. */
function badge_asset_url( string $filename ): string {
	return add_query_arg(
		'ver',
		VERSION,
		plugins_url( 'assets/images/badges/' . ltrim( $filename, '/' ), __FILE__ )
	);
}

/**
 * Return the lightweight local milestone artwork and thresholds.
 *
 * @return array<int,array<string,mixed>>
 */
function achievement_badge_definitions(): array {
	$badges = array(
		array(
			'key'         => 'beer',
			'type'        => 'seen_count',
			'threshold'   => 5,
			'label'       => __( 'Beer badge', 'wp-seen-posts' ),
			'requirement' => __( 'See 5 posts', 'wp-seen-posts' ),
			'description' => __( 'You earned the Beer badge for seeing 5 posts.', 'wp-seen-posts' ),
			'locked_description' => __( 'Locked. See 5 posts to unlock the Beer badge.', 'wp-seen-posts' ),
			'alt'         => __( 'Cute beer badge earned after 5 Seen posts', 'wp-seen-posts' ),
			'url'         => badge_asset_url( 'beer.png' ),
		),
		array(
			'key'         => 'vodka',
			'type'        => 'seen_count',
			'threshold'   => 10,
			'label'       => __( 'Vodka badge', 'wp-seen-posts' ),
			'requirement' => __( 'See 10 posts', 'wp-seen-posts' ),
			'description' => __( 'You earned the Vodka badge for seeing 10 posts.', 'wp-seen-posts' ),
			'locked_description' => __( 'Locked. See 10 posts to unlock the Vodka badge.', 'wp-seen-posts' ),
			'alt'         => __( 'Vodka bottle badge earned after 10 Seen posts', 'wp-seen-posts' ),
			'url'         => badge_asset_url( 'vodka.png' ),
		),
		array(
			'key'         => 'gopnik',
			'type'        => 'seen_count',
			'threshold'   => 50,
			'label'       => __( 'Gopnik badge', 'wp-seen-posts' ),
			'requirement' => __( 'See 50 posts', 'wp-seen-posts' ),
			'description' => __( 'You earned the Gopnik badge for seeing 50 posts.', 'wp-seen-posts' ),
			'locked_description' => __( 'Locked. See 50 posts to unlock the Gopnik badge.', 'wp-seen-posts' ),
			'alt'         => __( 'Gopnik character badge earned after 50 Seen posts', 'wp-seen-posts' ),
			'url'         => badge_asset_url( 'gopnik.png' ),
		),
		array(
			'key'         => 'bmw',
			'type'        => 'seen_count',
			'threshold'   => 100,
			'label'       => __( 'Black BMW badge', 'wp-seen-posts' ),
			'requirement' => __( 'See 100 posts', 'wp-seen-posts' ),
			'description' => __( 'You earned the Black BMW badge for seeing 100 posts.', 'wp-seen-posts' ),
			'locked_description' => __( 'Locked. See 100 posts to unlock the Black BMW badge.', 'wp-seen-posts' ),
			'alt'         => __( 'Black BMW badge earned after 100 Seen posts', 'wp-seen-posts' ),
			'url'         => badge_asset_url( 'bmw.png' ),
		),
	);

	if ( Settings::zapoi_enabled() ) {
		$badges[] = array(
			'key'         => 'zapoi',
			'type'        => 'streak',
			'threshold'   => 4,
			'label'       => __( 'Zapoi badge', 'wp-seen-posts' ),
			'requirement' => __( '4-Day Vodka Streak', 'wp-seen-posts' ),
			'description' => __( 'Four days straight. This is officially a zapoi.', 'wp-seen-posts' ),
			'locked_description' => __( 'Locked. Complete a 4-day reading streak to unlock the Zapoi badge.', 'wp-seen-posts' ),
			'alt'         => __( 'Zapoi badge earned for a four-day reading streak', 'wp-seen-posts' ),
			'url'         => badge_asset_url( 'zapoi.png' ),
		);
	}

	/** Filters all Seen achievement badge definitions, including streak badges. */
	$badges = apply_filters( 'wp_seen_posts_achievement_badges', $badges );
	if ( ! is_array( $badges ) ) {
		return array();
	}

	/* Barsetka was permanently retired in 1.3.1. Do not let stale extension
	 * data reintroduce a sixth badge into the shelf or unlock pipeline. */
	return array_values(
		array_filter(
			$badges,
			static function ( $badge ): bool {
				return ! is_array( $badge ) || 'barsetka' !== sanitize_key( (string) ( $badge['key'] ?? '' ) );
			}
		)
	);
}

/** Return badge definitions enriched from the cached aggregate rarity map. */
function achievement_badges(): array {
	$badges   = achievement_badge_definitions();
	$rarities = Gamification::rarities_for_badges( wp_list_pluck( $badges, 'key' ) );
	foreach ( $badges as &$badge ) {
		$key             = isset( $badge['key'] ) ? sanitize_key( $badge['key'] ) : '';
		$badge['rarity'] = $key && isset( $rarities[ $key ] ) ? $rarities[ $key ] : '';
	}
	unset( $badge );
	return $badges;
}

/** Discover the always-visible roadmap images before footer JavaScript builds the shelf. */
function preload_badge_assets(): void {
	if ( ! is_supported_view() && ! is_trackable_single_post() ) {
		return;
	}

	foreach ( achievement_badges() as $badge ) {
		printf(
			'<link rel="preload" as="image" href="%s">' . "\n",
			esc_url( $badge['url'] )
		);
	}
}
add_action( 'wp_head', __NAMESPACE__ . '\\preload_badge_assets', 2 );

/** Return the small browser-side streak configuration. */
function gamification_script_config(): array {
	return array(
		'enabled'          => Settings::streaks_enabled(),
		'showProgress'     => Settings::streak_progress_enabled(),
		'zapoiEnabled'     => Settings::zapoi_enabled(),
		'dailyRequirement' => Settings::streak_daily_requirement(),
		'storageKey'       => 'wp_seen_posts_gamification_v1',
		'endpoint'         => Settings::rarity_enabled() ? rest_url( Gamification::REST_NAMESPACE . Gamification::REST_ROUTE ) : '',
		'siteTimeZone'     => wp_timezone_string(),
		'siteUtcOffset'    => current_datetime()->getOffset(),
		'serverDate'       => current_time( 'Y-m-d' ),
		'badges'           => achievement_badges(),
		'i18n'             => array(
			'streak'        => __( '🔥 %d-day vodka streak', 'wp-seen-posts' ),
			'progress'      => __( '🔥 %1$d / %2$d posts to keep your streak', 'wp-seen-posts' ),
			'progressStart' => __( '🔥 %1$d / %2$d posts toward a vodka streak', 'wp-seen-posts' ),
		),
	);
}

/** Enqueue streak state once; shortcode-only pages use the same lightweight file. */
function enqueue_gamification_assets(): void {
	static $configured = false;

	if ( is_admin() ) {
		return;
	}
	wp_enqueue_style( 'wp-seen-posts', plugins_url( 'assets/css/seen-posts.css', __FILE__ ), array(), VERSION );
	wp_enqueue_script( 'wp-seen-posts-gamification', plugins_url( 'assets/js/gamification.js', __FILE__ ), array(), VERSION, true );
	if ( ! $configured ) {
		wp_add_inline_script(
			'wp-seen-posts-gamification',
			'window.wpSeenGamificationConfig = ' . wp_json_encode( gamification_script_config() ) . ';',
			'before'
		);
		$configured = true;
	}
}

/**
 * Enqueue the dependency-free feed enhancement.
 */
function enqueue_assets(): void {
	global $wp_query;

	$feed_view   = is_supported_view();
	$single_view = is_trackable_single_post();

	if ( ! $feed_view && ! $single_view ) {
		return;
	}

	$limits = history_limits();
	$initial_counts = $feed_view && isset( $wp_query->posts )
		? Public_Counts::counts_for_posts( (array) $wp_query->posts )
		: array();

	wp_enqueue_style(
		'wp-seen-posts',
		plugins_url( 'assets/css/seen-posts.css', __FILE__ ),
		array(),
		VERSION
	);
	enqueue_gamification_assets();

	wp_enqueue_script(
		'wp-seen-posts-public-counts',
		plugins_url( 'assets/js/public-counts.js', __FILE__ ),
		array(),
		VERSION,
		true
	);
	wp_add_inline_script(
		'wp-seen-posts-public-counts',
		'window.wpSeenPublicCountsConfig = ' . wp_json_encode(
			array(
				'endpoint'           => rest_url( Public_Counts::REST_NAMESPACE . Public_Counts::REST_ROUTE ),
				'readEndpoint'       => rest_url( Public_Counts::REST_NAMESPACE . Public_Counts::REST_READ_ROUTE ),
				'maxBatchSize'       => Public_Counts::MAX_BATCH_SIZE,
				'batchDelay'         => 100,
				'initialCounts'      => (object) $initial_counts,
				'weeklyHotPostIds'   => Public_Counts::weekly_hot_post_ids(),
				'ledgerStorageKey'   => 'wp_seen_posts_counted_v1',
				'historyStorageKey'  => 'wp_seen_posts_v1',
				'labelSingular'      => __( 'Seen by %s visitor', 'wp-seen-posts' ),
				'labelPlural'        => __( 'Seen by %s visitors', 'wp-seen-posts' ),
				'personalSeen'       => _x( 'Seen', 'personal post state', 'wp-seen-posts' ),
				'personalUnseen'     => _x( 'Unseen', 'personal post state', 'wp-seen-posts' ),
				'loadingLabel'       => __( 'Loading Seen count', 'wp-seen-posts' ),
				'weeklyHotLabel'     => __( 'Hot this week', 'wp-seen-posts' ),
			)
		) . ';',
		'before'
	);

	if ( $single_view ) {
		wp_enqueue_script(
			'wp-seen-posts-single',
			plugins_url( 'assets/js/single-post.js', __FILE__ ),
			array( 'wp-seen-posts-public-counts', 'wp-seen-posts-gamification' ),
			VERSION,
			true
		);
		wp_add_inline_script(
			'wp-seen-posts-single',
			'window.wpSeenSinglePostConfig = ' . wp_json_encode(
				array(
					'postId'        => get_queried_object_id(),
					'storageKey'    => 'wp_seen_posts_v1',
					'dwellTime'     => 1000,
					'maxEntries'    => $limits['max_entries'],
					'retentionDays' => $limits['retention_days'],
					'badges'        => achievement_badges(),
					'i18n'          => array(
						'achievementUnlocked' => __( 'Achievement unlocked!', 'wp-seen-posts' ),
					),
				)
			) . ';',
			'before'
		);
		return;
	}

	$theme    = wp_get_theme();
	$template = strtolower( (string) $theme->get_template() );
	$style    = strtolower( (string) $theme->get_stylesheet() );
	$theme_id = 'generic';

	if ( 'p2' === $template || 'p2' === $style ) {
		$theme_id = 'p2';
	} elseif ( 'p2-resurrected' === $template || 'p2-resurrected' === $style ) {
		$theme_id = 'p2-resurrected';
	}

	$current_page   = max( 1, (int) get_query_var( 'paged' ) );
	$has_more_pages = isset( $wp_query->max_num_pages ) && $current_page < (int) $wp_query->max_num_pages;

	wp_enqueue_script(
		'wp-seen-posts-adapters',
		plugins_url( 'assets/js/adapters.js', __FILE__ ),
		array(),
		VERSION,
		true
	);

	wp_enqueue_script(
		'wp-seen-posts',
		plugins_url( 'assets/js/seen-posts.js', __FILE__ ),
		array( 'wp-seen-posts-adapters', 'wp-seen-posts-public-counts', 'wp-seen-posts-gamification' ),
		VERSION,
		true
	);

	$config = array(
		'theme'                   => $theme_id,
		'selectors'               => Settings::get_selectors(),
		'storageKey'              => 'wp_seen_posts_v1',
		'threshold'               => 0.5,
		'dwellTime'               => 1000,
		'reloadPreviewCount'      => 2,
		'previewLoadingDelay'     => 500,
		'unseenPrefetchPageLimit' => 6,
		'hasMorePages'            => $has_more_pages,
		'maxEntries'              => $limits['max_entries'],
		'retentionDays'           => $limits['retention_days'],
		'badges'                  => achievement_badges(),
		'i18n'                    => array(
			'showSeen'       => __( 'Show seen', 'wp-seen-posts' ),
			'hideSeen'       => __( 'Hide seen', 'wp-seen-posts' ),
			'reset'          => __( 'Reset seen history', 'wp-seen-posts' ),
			'confirmReset'   => __( 'Reset your Seen history and mark the loaded posts as unseen?', 'wp-seen-posts' ),
			'loadingUnseen'  => __( 'Loading unseen posts…', 'wp-seen-posts' ),
			'findingUnseen'  => __( 'Finding unseen posts…', 'wp-seen-posts' ),
			'noUnseenPage'   => __( 'No unseen posts on this page.', 'wp-seen-posts' ),
			'caughtUp'       => __( "You're all caught up.", 'wp-seen-posts' ),
			'achievements'   => __( 'Your badges', 'wp-seen-posts' ),
			'badgeHint'      => __( 'Tap a badge to see how it unlocks.', 'wp-seen-posts' ),
			'badgeLocked'    => __( 'Locked. See %1$d posts to unlock %2$s.', 'wp-seen-posts' ),
			'achievementUnlocked' => __( 'Achievement unlocked!', 'wp-seen-posts' ),
		),
	);

	/** Filters the public JavaScript configuration. */
	$config = apply_filters( 'wp_seen_posts_script_config', $config );
	$storage_key = isset( $config['storageKey'] ) && is_string( $config['storageKey'] ) ? $config['storageKey'] : 'wp_seen_posts_v1';
	$preview_count = isset( $config['reloadPreviewCount'] ) ? max( 0, (int) $config['reloadPreviewCount'] ) : 2;
	$preview_selector = in_array( $theme_id, array( 'p2', 'p2-resurrected' ), true )
		? '#postlist > li.post'
		: '.wp-block-post-template > .wp-block-post';

	$early_script = file_get_contents( __DIR__ . '/assets/js/early-hide.js' );
	if ( false !== $early_script ) {
		wp_register_script( 'wp-seen-posts-early-hide', false, array(), VERSION, false );
		wp_enqueue_script( 'wp-seen-posts-early-hide' );
		wp_add_inline_script(
			'wp-seen-posts-early-hide',
			'window.wpSeenPostsEarlyConfig = ' . wp_json_encode(
				array(
					'storageKey'      => $storage_key,
					'previewCount'    => $preview_count,
					'previewSelector' => $preview_selector,
					'maxEntries'      => $limits['max_entries'],
					'retentionDays'   => $limits['retention_days'],
				)
			) . ';' . "\n" . $early_script
		);
	}

	wp_add_inline_script(
		'wp-seen-posts',
		'window.wpSeenPostsConfig = ' . wp_json_encode( $config ) . ';',
		'before'
	);
}
add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_assets', 110 );

/** Load translations and the small settings screen. */
function bootstrap(): void {
	load_plugin_textdomain( 'wp-seen-posts', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
	Public_Counts::maybe_upgrade_schema();
	Public_Counts::init();
	Gamification::maybe_upgrade_schema();
	Gamification::init();
	add_shortcode( 'seen_unseen_streak', __NAMESPACE__ . '\\streak_shortcode' );
	add_shortcode( 'wp_seen_posts_streak', __NAMESPACE__ . '\\streak_shortcode' );

	if ( is_admin() ) {
		Settings::init();
	}
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\bootstrap' );

/** Create the aggregate counter schema when the plugin is activated. */
function activate(): void {
	Public_Counts::install_schema();
	Gamification::install_schema();
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\\activate' );

/** Remove the maintenance schedule while the plugin is inactive. */
function deactivate(): void {
	Public_Counts::unschedule_cleanup();
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\\deactivate' );
