<?php
/** Minimal dependency-free checks for pure PHP counter input/formatting behavior. */

define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );

if ( ! function_exists( '__' ) ) {
	function __( $text ) {
		return $text;
	}
}

if ( ! function_exists( '_n' ) ) {
	function _n( $single, $plural, $count ) {
		return 1 === (int) $count ? $single : $plural;
	}
}

if ( ! function_exists( 'number_format_i18n' ) ) {
	function number_format_i18n( $number ) {
		return number_format( $number );
	}
}

if ( ! function_exists( 'esc_attr' ) ) {
	function esc_attr( $value ) {
		return htmlspecialchars( $value, ENT_QUOTES, 'UTF-8' );
	}
}

if ( ! function_exists( 'esc_html' ) ) {
	function esc_html( $value ) {
		return htmlspecialchars( $value, ENT_QUOTES, 'UTF-8' );
	}
}

if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public $code;
		public function __construct( $code ) {
			$this->code = $code;
		}
	}
}

if ( ! function_exists( 'absint' ) ) {
	function absint( $value ) {
		return abs( (int) $value );
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
	function is_wp_error( $value ) {
		return $value instanceof WP_Error;
	}
}

if ( ! function_exists( 'current_time' ) ) {
	function current_time( $format ) {
		if ( 'Y-m-d' !== $format ) {
			throw new RuntimeException( 'Unexpected time format.' );
		}
		return '2026-08-21';
	}
}

if ( ! function_exists( 'current_datetime' ) ) {
	function current_datetime() {
		return new DateTimeImmutable( '2026-08-21', new DateTimeZone( 'Asia/Tbilisi' ) );
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	function apply_filters( $hook, $value ) {
		return $value;
	}
}

require_once dirname( __DIR__ ) . '/includes/class-public-counts.php';

use HoldMyVodka\SeenPosts\Public_Counts;

$cases = array(
	0       => '0',
	18      => '18',
	999     => '999',
	1000    => '1K',
	1284    => '1.2K',
	15860   => '15.9K',
	1240000 => '1.2M',
);

foreach ( $cases as $count => $expected ) {
	$actual = Public_Counts::format_compact( (int) $count );
	if ( $expected !== $actual ) {
		fwrite( STDERR, "Formatting {$count}: expected {$expected}, got {$actual}\n" );
		exit( 1 );
	}
}

$batch = Public_Counts::sanitize_batch( array( 7, '7', '8' ) );
if ( array( 7, 8 ) !== $batch ) {
	fwrite( STDERR, 'Batch sanitization failed.' . PHP_EOL );
	exit( 1 );
}

$invalid = Public_Counts::sanitize_batch( array( 7, 0 ) );
if ( ! $invalid instanceof WP_Error || 'wp_seen_posts_invalid_post_id' !== $invalid->code ) {
	fwrite( STDERR, 'Invalid-ID rejection failed.' . PHP_EOL );
	exit( 1 );
}

$oversized = Public_Counts::sanitize_batch( array_fill( 0, Public_Counts::MAX_BATCH_SIZE + 1, 7 ) );
if ( ! $oversized instanceof WP_Error || 'wp_seen_posts_batch_too_large' !== $oversized->code ) {
	fwrite( STDERR, 'Batch cap validation failed.' . PHP_EOL );
	exit( 1 );
}

/** Small wpdb double proving one transaction contains both multi-row atomic upserts. */
class WP_Seen_Posts_Test_DB {
	public $prefix = 'test_';
	public $queries = array();

	public function prepare( $sql, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		return $sql . ' /* ' . implode( ',', $args ) . ' */';
	}

	public function query( $sql ) {
		$this->queries[] = $sql;
		return 1;
	}

	public function get_results() {
		return array(
			array( 'post_id' => 7, 'seen_count' => 43 ),
			array( 'post_id' => 8, 'seen_count' => 12 ),
		);
	}
}

$GLOBALS['wpdb'] = new WP_Seen_Posts_Test_DB();
$totals          = Public_Counts::increment_counts( array( 7, 8 ) );
$queries         = $GLOBALS['wpdb']->queries;

if ( array( 7 => 43, 8 => 12 ) !== $totals ) {
	fwrite( STDERR, 'Confirmed total retrieval failed.' . PHP_EOL );
	exit( 1 );
}

if (
	4 !== count( $queries )
	|| 'START TRANSACTION' !== $queries[0]
	|| false === strpos( $queries[1], 'test_hmv_seen_counts' )
	|| false === strpos( $queries[1], 'ON DUPLICATE KEY UPDATE seen_count = seen_count + 1' )
	|| 2 !== substr_count( $queries[1], '(%d,1)' )
	|| false === strpos( $queries[2], 'test_hmv_seen_daily' )
	|| false === strpos( $queries[2], '2026-08-21' )
	|| false === strpos( $queries[2], 'ON DUPLICATE KEY UPDATE seen_count = seen_count + 1' )
	|| 2 !== substr_count( $queries[2], '(%d,%s,1)' )
	|| 'COMMIT' !== $queries[3]
) {
	fwrite( STDERR, 'Atomic aggregate SQL verification failed.' . PHP_EOL );
	exit( 1 );
}

$markup = Public_Counts::counter_markup( 11 );
if (
	false === strpos( $markup, 'role="img"' )
	|| false === strpos( $markup, 'data-personal-seen-state="unseen"' )
	|| false === strpos( $markup, 'aria-label="Unseen. Seen by 0 visitors"' )
	|| false === strpos( $markup, '<svg class="wp-seen-posts-public-eye"' )
	|| false === strpos( $markup, 'viewBox="0 0 20 20"' )
	|| false === strpos( $markup, '<path d="M18.3 9.5C15 4.9' )
	|| false !== strpos( $markup, 'dashicons' )
) {
	fwrite( STDERR, 'Accessible inline-eye markup verification failed.' . PHP_EOL );
	exit( 1 );
}

class WP_Seen_Posts_Failing_Daily_DB extends WP_Seen_Posts_Test_DB {
	public function query( $sql ) {
		$this->queries[] = $sql;
		if ( false !== strpos( $sql, 'test_hmv_seen_daily' ) ) {
			return false;
		}
		return 1;
	}
}

$GLOBALS['wpdb'] = new WP_Seen_Posts_Failing_Daily_DB();
$failed          = Public_Counts::increment_counts( array( 9 ) );
if (
	! $failed instanceof WP_Error
	|| 'wp_seen_posts_increment_failed' !== $failed->code
	|| 'ROLLBACK' !== end( $GLOBALS['wpdb']->queries )
) {
	fwrite( STDERR, 'Failed daily write did not roll back the lifetime write.' . PHP_EOL );
	exit( 1 );
}

$GLOBALS['wpdb'] = new WP_Seen_Posts_Test_DB();
Public_Counts::cleanup_daily_counts();
$cleanup_query = end( $GLOBALS['wpdb']->queries );
if (
	false === strpos( $cleanup_query, 'DELETE FROM test_hmv_seen_daily WHERE view_date < %s' )
	|| false === strpos( $cleanup_query, '2025-07-17' )
) {
	fwrite( STDERR, 'Bounded daily-retention cleanup verification failed.' . PHP_EOL );
	exit( 1 );
}

echo "PHP public-count checks passed.\n";
