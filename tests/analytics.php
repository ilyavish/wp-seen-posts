<?php
/** Dependency-free contract checks for first-party route analytics. */

namespace {
	define( 'ABSPATH', __DIR__ . '/' );
	define( 'ARRAY_A', 'ARRAY_A' );
	define( 'HOUR_IN_SECONDS', 3600 );
	$GLOBALS['wp_seen_analytics_now'] = new \DateTimeImmutable( '2026-08-28 12:00:00', new \DateTimeZone( 'Asia/Tbilisi' ) );
	$GLOBALS['wp_seen_analytics_context'] = 'none';

	class WP_Error {
		public $code;
		public function __construct( $code ) { $this->code = $code; }
	}
	class WP_Term {
		public $term_id;
		public $taxonomy;
		public $name;
		public function __construct( $id, $taxonomy, $name ) {
			$this->term_id = $id;
			$this->taxonomy = $taxonomy;
			$this->name = $name;
		}
	}

	function __( $text ) { return $text; }
	function _n( $single, $plural, $count ) { return 1 === (int) $count ? $single : $plural; }
	function sanitize_key( $value ) { return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', (string) $value ) ); }
	function sanitize_text_field( $value ) { return trim( strip_tags( (string) $value ) ); }
	function esc_url_raw( $value ) { return filter_var( (string) $value, FILTER_SANITIZE_URL ); }
	function absint( $value ) { return abs( (int) $value ); }
	function wp_parse_url( $url, $part = -1 ) { return parse_url( $url, $part ); }
	function home_url( $path = '/' ) { return 'https://holdmyvodka.com' . ( '/' === $path ? '/' : $path ); }
	function wp_json_encode( $value ) { return json_encode( $value ); }
	function wp_salt( $scheme = 'auth' ) { return 'test-salt-' . $scheme; }
	function apply_filters( $hook, $value ) { return $value; }
	function current_time( $format ) { return $GLOBALS['wp_seen_analytics_now']->format( $format ); }
	function current_datetime() { return $GLOBALS['wp_seen_analytics_now']; }
	function is_wp_error( $value ) { return $value instanceof WP_Error; }
	function add_action() {}
	function wp_next_scheduled() { return true; }
	function wp_schedule_event() {}
	function wp_clear_scheduled_hook() {}
	function is_front_page() { return 'home' === $GLOBALS['wp_seen_analytics_context']; }
	function is_home() { return false; }
	function is_singular() { return false; }
	function is_tag() { return 'tag' === $GLOBALS['wp_seen_analytics_context']; }
	function is_category() { return false; }
	function is_tax() { return false; }
	function is_author() { return false; }
	function is_date() { return false; }
	function is_post_type_archive() { return false; }
	function is_search() { return false; }
	function is_404() { return false; }
	function is_archive() { return 'tag' === $GLOBALS['wp_seen_analytics_context']; }
	function get_queried_object() { return new WP_Term( 55, 'post_tag', 'Vodka' ); }
	function get_term_link() { return 'https://holdmyvodka.com/tag/vodka/'; }
}

namespace HoldMyVodka\SeenPosts {
	final class Settings {
		public static function analytics_dedupe_minutes(): int { return 30; }
	}
}

namespace {
	require_once dirname( __DIR__ ) . '/includes/class-analytics.php';

	use HoldMyVodka\SeenPosts\Analytics;

	function analytics_assert( $condition, $message ) {
		if ( ! $condition ) {
			fwrite( STDERR, $message . PHP_EOL );
			exit( 1 );
		}
	}

	$route = Analytics::sanitize_route(
		array(
			'key'       => 'tag:post_tag:55',
			'type'      => 'tag',
			'object_id' => 55,
			'path'      => 'https://holdmyvodka.com/tag/vodka/',
			'title'     => 'Tag: Vodka',
		)
	);
	$GLOBALS['wp_seen_analytics_context'] = 'home';
	$home_route = Analytics::current_route();
	analytics_assert( 'home' === $home_route['key'] && 'https://holdmyvodka.com/' === $home_route['path'], 'The front page was not mapped to the stable homepage route.' );
	$GLOBALS['wp_seen_analytics_context'] = 'tag';
	$tag_route = Analytics::current_route();
	analytics_assert( 'tag:post_tag:55' === $tag_route['key'], 'A tag archive did not use its stable taxonomy route key.' );
	analytics_assert( 'https://holdmyvodka.com/tag/vodka/' === $tag_route['path'], 'The tag archive did not retain its canonical parent URL.' );
	$GLOBALS['wp_seen_analytics_context'] = 'none';
	analytics_assert( is_array( $route ) && 'tag' === $route['type'], 'A valid local tag route was rejected.' );
	analytics_assert(
		null === Analytics::sanitize_route(
			array(
				'key' => 'tag:bad', 'type' => 'tag', 'object_id' => 1,
				'path' => 'https://example.net/stolen/', 'title' => 'External',
			)
		),
		'An external route path was accepted.'
	);
	analytics_assert( '' === Analytics::sanitize_visitor_token( 'short' ), 'A short visitor token was accepted.' );
	$visitor_token = str_repeat( 'ab', 16 );
	analytics_assert( $visitor_token === Analytics::sanitize_visitor_token( strtoupper( $visitor_token ) ), 'A valid visitor token was not normalized.' );
	$signature = Analytics::route_signature( $route );
	$renamed   = $route;
	$renamed['title'] = 'Changed';
	analytics_assert( $signature !== Analytics::route_signature( $renamed ), 'The route signature did not cover display metadata.' );

	class Analytics_Test_DB {
		public $prefix = 'test_';
		public $queries = array();
		public $responses = array();

		public function prepare( $sql, ...$args ) {
			if ( 1 === count( $args ) && is_array( $args[0] ) ) {
				$args = $args[0];
			}
			return $sql . ' /* ' . json_encode( $args ) . ' */';
		}

		public function query( $sql ) {
			$this->queries[] = $sql;
			if ( in_array( $sql, array( 'START TRANSACTION', 'COMMIT', 'ROLLBACK' ), true ) ) {
				return 1;
			}
			return array_shift( $this->responses );
		}
	}

	$GLOBALS['wpdb'] = new Analytics_Test_DB();
	$GLOBALS['wpdb']->responses = array( 1, 1, 1, 1, 1 );
	$first = Analytics::record_view( $route, $visitor_token );
	analytics_assert( ! is_wp_error( $first ) && $first['counted'] && $first['routeVisitor'] && $first['dailyVisitor'], 'The first qualified route visit was not counted as a new visitor.' );
	$first_queries = implode( "\n", $GLOBALS['wpdb']->queries );
	analytics_assert( 2 === substr_count( $first_queries, 'test_hmv_analytics_daily' ), 'Route and site daily aggregates were not both updated.' );
	analytics_assert( false !== strpos( $first_queries, 'test_hmv_analytics_realtime' ), 'The qualified view was not added to realtime analytics.' );
	analytics_assert( false === strpos( $first_queries, $visitor_token ), 'The raw visitor token leaked into analytics storage.' );

	$GLOBALS['wpdb']->queries = array();
	$GLOBALS['wpdb']->responses = array( 0, 0 );
	$reload = Analytics::record_view( $route, $visitor_token );
	analytics_assert( ! is_wp_error( $reload ) && ! $reload['counted'] && ! $reload['routeVisitor'], 'A reload inside 30 minutes was counted again.' );
	analytics_assert( false === strpos( implode( "\n", $GLOBALS['wpdb']->queries ), 'test_hmv_analytics_daily' ), 'A suppressed reload changed daily aggregates.' );

	$GLOBALS['wp_seen_analytics_now'] = $GLOBALS['wp_seen_analytics_now']->modify( '+31 minutes' );
	$GLOBALS['wpdb']->queries = array();
	$GLOBALS['wpdb']->responses = array( 0, 1, 0, 1, 1, 1, 1 );
	$return = Analytics::record_view( $route, $visitor_token );
	analytics_assert( ! is_wp_error( $return ) && $return['counted'] && ! $return['routeVisitor'] && ! $return['dailyVisitor'], 'A return after the dedupe window did not add a view without adding another visitor.' );

	echo "PHP analytics checks passed.\n";
}
