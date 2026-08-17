<?php
/**
 * Plugin Name:       WP Seen Posts
 * Plugin URI:        https://github.com/ilyavish/wp-seen-posts
 * Description:       Tracks posts viewed in archive feeds, hides previously seen posts on later visits, and integrates with progressive infinite scrolling.
 * Version:           1.0.2
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

const VERSION = '1.0.2';
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
 * Enqueue the dependency-free feed enhancement.
 */
function enqueue_assets(): void {
	global $wp_query;

	if ( ! is_supported_view() ) {
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

	$max_entries    = defined( 'WP_SEEN_POSTS_MAX_ENTRIES' ) ? (int) WP_SEEN_POSTS_MAX_ENTRIES : 3000;
	$retention_days = defined( 'WP_SEEN_POSTS_RETENTION_DAYS' ) ? (int) WP_SEEN_POSTS_RETENTION_DAYS : 365;
	$current_page   = max( 1, (int) get_query_var( 'paged' ) );
	$has_more_pages = isset( $wp_query->max_num_pages ) && $current_page < (int) $wp_query->max_num_pages;

	/** Filters the maximum number of locally stored post IDs. */
	$max_entries = (int) apply_filters( 'wp_seen_posts_max_entries', $max_entries );
	/** Filters the local Seen history retention period in days. */
	$retention_days = (int) apply_filters( 'wp_seen_posts_retention_days', $retention_days );

	wp_enqueue_style(
		'wp-seen-posts',
		plugins_url( 'assets/css/seen-posts.css', __FILE__ ),
		array(),
		VERSION
	);

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
		'theme'         => $theme_id,
		'selectors'     => Settings::get_selectors(),
		'storageKey'    => 'wp_seen_posts_v1',
		'threshold'     => 0.5,
		'dwellTime'     => 750,
		'collapseDelay' => 120,
		'recentBuffer'  => 2,
		'hasMorePages'  => $has_more_pages,
		'maxEntries'    => max( 1, $max_entries ),
		'retentionDays' => max( 1, $retention_days ),
		'i18n'          => array(
			'showSeen'       => __( 'Show seen', 'wp-seen-posts' ),
			'hideSeen'       => __( 'Hide seen', 'wp-seen-posts' ),
			'seen'           => __( 'Seen', 'wp-seen-posts' ),
			'reset'          => __( 'Reset seen history', 'wp-seen-posts' ),
			'confirmReset'   => __( 'Reset your Seen history and mark the loaded posts as unseen?', 'wp-seen-posts' ),
			'caughtUp'       => __( "You're all caught up.", 'wp-seen-posts' ),
		),
	);

	/** Filters the public JavaScript configuration. */
	$config = apply_filters( 'wp_seen_posts_script_config', $config );

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
