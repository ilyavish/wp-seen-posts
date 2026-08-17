<?php
/**
 * Plugin Name:       WP Seen Posts
 * Plugin URI:        https://github.com/ilyavish/wp-seen-posts
 * Description:       Tracks posts viewed in archive feeds, hides previously seen posts on later visits, and integrates with progressive infinite scrolling.
 * Version:           1.0.17
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

const VERSION = '1.0.17';
const OPTION  = 'wp_seen_posts_selectors';

require_once __DIR__ . '/includes/class-settings.php';

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

/**
 * Return the lightweight local milestone artwork and thresholds.
 *
 * @return array<int,array{key:string,threshold:int,label:string,description:string,alt:string,url:string}>
 */
function achievement_badges(): array {
	return array(
		array(
			'key'         => 'beer',
			'threshold'   => 5,
			'label'       => __( 'Beer badge', 'wp-seen-posts' ),
			'description' => __( 'You earned the Beer badge for seeing 5 posts.', 'wp-seen-posts' ),
			'alt'         => __( 'Cute beer badge earned after 5 Seen posts', 'wp-seen-posts' ),
			'url'         => plugins_url( 'assets/images/badges/beer.png', __FILE__ ),
		),
		array(
			'key'         => 'vodka',
			'threshold'   => 10,
			'label'       => __( 'Vodka badge', 'wp-seen-posts' ),
			'description' => __( 'You earned the Vodka badge for seeing 10 posts.', 'wp-seen-posts' ),
			'alt'         => __( 'Vodka bottle badge earned after 10 Seen posts', 'wp-seen-posts' ),
			'url'         => plugins_url( 'assets/images/badges/vodka.png', __FILE__ ),
		),
		array(
			'key'         => 'tracksuit',
			'threshold'   => 20,
			'label'       => __( 'Tracksuit badge', 'wp-seen-posts' ),
			'description' => __( 'You earned the Tracksuit badge for seeing 20 posts.', 'wp-seen-posts' ),
			'alt'         => __( 'Black tracksuit badge earned after 20 Seen posts', 'wp-seen-posts' ),
			'url'         => plugins_url( 'assets/images/badges/adidas.png', __FILE__ ),
		),
		array(
			'key'         => 'gopnik',
			'threshold'   => 50,
			'label'       => __( 'Gopnik badge', 'wp-seen-posts' ),
			'description' => __( 'You earned the Gopnik badge for seeing 50 posts.', 'wp-seen-posts' ),
			'alt'         => __( 'Gopnik character badge earned after 50 Seen posts', 'wp-seen-posts' ),
			'url'         => plugins_url( 'assets/images/badges/gopnik.png', __FILE__ ),
		),
	);
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

	wp_enqueue_style(
		'wp-seen-posts',
		plugins_url( 'assets/css/seen-posts.css', __FILE__ ),
		array(),
		VERSION
	);

	if ( $single_view ) {
		wp_enqueue_script(
			'wp-seen-posts-single',
			plugins_url( 'assets/js/single-post.js', __FILE__ ),
			array(),
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
						'seen'                => __( 'Seen', 'wp-seen-posts' ),
						'achievements'        => __( 'Your badges', 'wp-seen-posts' ),
						'badgeHint'            => __( 'Tap a badge to see why you earned it.', 'wp-seen-posts' ),
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
		array( 'wp-seen-posts-adapters' ),
		VERSION,
		true
	);

	$config = array(
		'theme'              => $theme_id,
		'selectors'          => Settings::get_selectors(),
		'storageKey'         => 'wp_seen_posts_v1',
		'threshold'          => 0.5,
		'dwellTime'          => 1000,
		'reloadPreviewCount' => 2,
		'hasMorePages'       => $has_more_pages,
		'maxEntries'         => $limits['max_entries'],
		'retentionDays'      => $limits['retention_days'],
		'badges'             => achievement_badges(),
		'i18n'               => array(
			'showSeen'       => __( 'Show seen', 'wp-seen-posts' ),
			'hideSeen'       => __( 'Hide seen', 'wp-seen-posts' ),
			'seen'           => __( 'Seen', 'wp-seen-posts' ),
			'reset'          => __( 'Reset seen history', 'wp-seen-posts' ),
			'confirmReset'   => __( 'Reset your Seen history and mark the loaded posts as unseen?', 'wp-seen-posts' ),
			'loadingUnseen'  => __( 'Loading unseen posts…', 'wp-seen-posts' ),
			'noUnseenPage'   => __( 'No unseen posts on this page.', 'wp-seen-posts' ),
			'caughtUp'       => __( "You're all caught up.", 'wp-seen-posts' ),
			'achievements'   => __( 'Your badges', 'wp-seen-posts' ),
			'badgeHint'      => __( 'Tap a badge to see why you earned it.', 'wp-seen-posts' ),
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
					'seenLabel'       => isset( $config['i18n']['seen'] ) ? (string) $config['i18n']['seen'] : __( 'Seen', 'wp-seen-posts' ),
					'badges'          => isset( $config['badges'] ) && is_array( $config['badges'] ) ? $config['badges'] : array(),
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

	if ( is_admin() ) {
		Settings::init();
	}
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\bootstrap' );
