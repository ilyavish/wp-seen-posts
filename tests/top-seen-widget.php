<?php
/** Dependency-free checks for Top Seen widget periods, SQL, cache, and settings. */

define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );

if ( ! class_exists( 'WP_Widget' ) ) {
	class WP_Widget {
		public $id_base;
		public function __construct( $id_base ) {
			$this->id_base = $id_base;
		}
	}
}

if ( ! class_exists( 'WP_Post' ) ) {
	class WP_Post {
		public $ID;
		public $post_type = 'post';
		public $post_status = 'publish';
		public function __construct( $post_id ) {
			$this->ID = (int) $post_id;
		}
	}
}

function __( $text ) {
	return $text;
}

function _n( $single, $plural, $count ) {
	return 1 === (int) $count ? $single : $plural;
}

function apply_filters( $hook, $value ) {
	return $value;
}

function absint( $value ) {
	return abs( (int) $value );
}

function sanitize_text_field( $value ) {
	return trim( strip_tags( (string) $value ) );
}

function esc_attr( $value ) {
	return htmlspecialchars( (string) $value, ENT_QUOTES, 'UTF-8' );
}

function esc_html( $value ) {
	return htmlspecialchars( (string) $value, ENT_QUOTES, 'UTF-8' );
}

function esc_url( $value ) {
	return (string) $value;
}

function number_format_i18n( $value ) {
	return number_format( (int) $value );
}

function current_datetime() {
	return new DateTimeImmutable( '2026-08-22', new DateTimeZone( 'Asia/Tbilisi' ) );
}

function get_posts( $args = array() ) {
	if ( isset( $args['fields'] ) && 'ids' === $args['fields'] ) {
		return array( 18, 17 );
	}
	$post_ids = isset( $args['post__in'] ) ? $args['post__in'] : array( 18, 17 );
	return array_map(
		static function ( $post_id ) {
			return new WP_Post( $post_id );
		},
		$post_ids
	);
}

function wp_list_pluck( $items, $field ) {
	return array_map(
		static function ( $item ) use ( $field ) {
			return is_array( $item ) ? $item[ $field ] : $item->{$field};
		},
		$items
	);
}

function get_the_title( $post ) {
	return 'Article ' . $post->ID;
}

function get_permalink( $post ) {
	return 'https://example.test/article-' . $post->ID . '/';
}

$GLOBALS['wp_seen_widget_transients'] = array();
$GLOBALS['wp_seen_widget_ttls']       = array();

function get_transient( $key ) {
	return array_key_exists( $key, $GLOBALS['wp_seen_widget_transients'] )
		? $GLOBALS['wp_seen_widget_transients'][ $key ]
		: false;
}

function set_transient( $key, $value, $ttl ) {
	$GLOBALS['wp_seen_widget_transients'][ $key ] = $value;
	$GLOBALS['wp_seen_widget_ttls'][ $key ]       = $ttl;
	return true;
}

/** Captures ranking queries without requiring WordPress or MySQL. */
class WP_Seen_Posts_Widget_DB {
	public $prefix = 'test_';
	public $posts = 'test_posts';
	public $prepared = array();
	public $queries = array();

	public function prepare( $sql, ...$args ) {
		$this->prepared[] = $args;
		return $sql;
	}

	public function get_results( $sql ) {
		$this->queries[] = $sql;
		if ( false !== strpos( $sql, 'test_hmv_seen_counts' ) ) {
			return array(
				array( 'post_id' => 18, 'seen_count' => 120 ),
				array( 'post_id' => 17, 'seen_count' => 80 ),
			);
		}
		return array(
			array( 'post_id' => 18, 'seen_count' => 41, 'latest_seen' => '2026-08-22' ),
			array( 'post_id' => 17, 'seen_count' => 30, 'latest_seen' => '2026-08-22' ),
			array( 'post_id' => 16, 'seen_count' => 20, 'latest_seen' => '2026-08-21' ),
			array( 'post_id' => 15, 'seen_count' => 18, 'latest_seen' => '2026-08-21' ),
			array( 'post_id' => 14, 'seen_count' => 16, 'latest_seen' => '2026-08-20' ),
			array( 'post_id' => 13, 'seen_count' => 14, 'latest_seen' => '2026-08-20' ),
			array( 'post_id' => 12, 'seen_count' => 12, 'latest_seen' => '2026-08-19' ),
			array( 'post_id' => 11, 'seen_count' => 9, 'latest_seen' => '2026-08-18' ),
			array( 'post_id' => 10, 'seen_count' => 5, 'latest_seen' => '2026-08-17' ),
			array( 'post_id' => 9, 'seen_count' => 4, 'latest_seen' => '2026-08-16' ),
		);
	}
}

$GLOBALS['wpdb'] = new WP_Seen_Posts_Widget_DB();

require_once dirname( __DIR__ ) . '/includes/class-public-counts.php';
require_once dirname( __DIR__ ) . '/includes/class-top-seen-widget.php';

use HoldMyVodka\SeenPosts\Public_Counts;
use HoldMyVodka\SeenPosts\Top_Seen_Widget;

$week = Top_Seen_Widget::get_ranked_rows( 'week', 5 );
if (
	array(
		array( 'post_id' => 18, 'seen_count' => 41 ),
		array( 'post_id' => 17, 'seen_count' => 30 ),
		array( 'post_id' => 16, 'seen_count' => 20 ),
		array( 'post_id' => 15, 'seen_count' => 18 ),
		array( 'post_id' => 14, 'seen_count' => 16 ),
	) !== $week
) {
	fwrite( STDERR, 'Weekly ranking normalization failed.' . PHP_EOL );
	exit( 1 );
}

if (
	array( '2026-08-16', '2026-08-22', 10 ) !== $GLOBALS['wpdb']->prepared[0]
	|| false === strpos( $GLOBALS['wpdb']->queries[0], 'FROM test_hmv_seen_daily d' )
	|| false === strpos( $GLOBALS['wpdb']->queries[0], 'INNER JOIN test_posts p' )
	|| false === strpos( $GLOBALS['wpdb']->queries[0], 'GROUP BY d.post_id' )
	|| false === strpos( $GLOBALS['wpdb']->queries[0], 'ORDER BY seen_count DESC, latest_seen DESC' )
) {
	fwrite( STDERR, 'Weekly ranking SQL or site-local date range failed.' . PHP_EOL );
	exit( 1 );
}

Top_Seen_Widget::get_ranked_rows( 'today', 3 );
Top_Seen_Widget::get_ranked_rows( 'month', 10 );
if (
	array( '2026-08-22', '2026-08-22', 10 ) !== $GLOBALS['wpdb']->prepared[1]
	|| array( '2026-07-24', '2026-08-22', 10 ) !== $GLOBALS['wpdb']->prepared[2]
	|| array( 300 ) !== array_values( array_unique( $GLOBALS['wp_seen_widget_ttls'] ) )
) {
	fwrite( STDERR, 'Today/month widget ranges or transient lifetime failed.' . PHP_EOL );
	exit( 1 );
}

$query_count = count( $GLOBALS['wpdb']->queries );
Top_Seen_Widget::get_ranked_rows( 'week', 5 );
Top_Seen_Widget::get_ranked_rows( 'week', 7 );
$weekly_hot = Public_Counts::weekly_hot_post_ids();
if (
	$query_count !== count( $GLOBALS['wpdb']->queries )
	|| array( 16, 15, 14, 13, 12, 11, 10 ) !== $weekly_hot
) {
	fwrite( STDERR, 'Discovery-focused weekly-hot filtering or shared ranking cache failed.' . PHP_EOL );
	exit( 1 );
}

$widget   = new Top_Seen_Widget();
$settings = $widget->update(
	array( 'title' => '<b>Popular</b>', 'period' => 'invalid', 'limit' => 99, 'display' => 'invalid' ),
	array()
);
if (
	'Popular' !== $settings['title']
	|| 'week' !== $settings['period']
	|| 10 !== $settings['limit']
	|| 'text' !== $settings['display']
	|| Top_Seen_Widget::ID_BASE !== $widget->id_base
) {
	fwrite( STDERR, 'Widget settings sanitization failed.' . PHP_EOL );
	exit( 1 );
}

if (
	false === strpos( Public_Counts::eye_svg_markup(), 'wp-seen-posts-public-eye' )
	|| false === strpos( Public_Counts::eye_svg_markup(), 'viewBox="0 0 20 20"' )
) {
	fwrite( STDERR, 'Shared widget eye icon failed.' . PHP_EOL );
	exit( 1 );
}

ob_start();
$widget->widget(
	array(
		'before_widget' => '<section>',
		'after_widget'  => '</section>',
		'before_title'  => '<h2>',
		'after_title'   => '</h2>',
	),
	array(
		'title'   => 'Top Seen Posts',
		'period'  => 'week',
		'limit'   => 2,
		'display' => 'text',
	)
);
$widget_output = ob_get_clean();
if (
	false === strpos( $widget_output, '<p class="wp-seen-posts-top-period">Last 7 days</p>' )
	|| false === strpos( $widget_output, 'data-seen-post-id="18" data-seen-count="120"' )
	|| false === strpos( $widget_output, 'aria-label="Seen by 120 visitors"' )
	|| false !== strpos( $widget_output, 'Seen by 41 visitors' )
) {
	fwrite( STDERR, 'Widget output must explain its ranking period while displaying reconciled lifetime totals.' . PHP_EOL );
	exit( 1 );
}

echo "PHP Top Seen widget checks passed.\n";
