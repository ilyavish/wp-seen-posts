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

function current_datetime() {
	return new DateTimeImmutable( '2026-08-22', new DateTimeZone( 'Asia/Tbilisi' ) );
}

function get_posts() {
	return array( 18, 17 );
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

echo "PHP Top Seen widget checks passed.\n";
