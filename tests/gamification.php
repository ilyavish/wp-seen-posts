<?php
/** Dependency-free checks for settings bounds and cached rarity formatting. */

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'HoldMyVodka\\SeenPosts\\OPTION', 'wp_seen_posts_selectors' );

$GLOBALS['wp_seen_posts_test_option'] = array(
	'streaks_enabled'         => true,
	'streak_posts_required'   => 3,
	'rarity_enabled'          => true,
	'rarity_min_readers'      => 20,
	'streak_progress_enabled' => true,
	'zapoi_enabled'           => true,
);
$GLOBALS['wp_seen_posts_test_transients'] = array();

function get_option( $key, $default = false ) {
	return 'wp_seen_posts_selectors' === $key ? $GLOBALS['wp_seen_posts_test_option'] : $default;
}
function apply_filters( $hook, $value ) { return $value; }
function sanitize_key( $value ) { return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', (string) $value ) ); }
function number_format_i18n( $number, $decimals = 0 ) { return number_format( $number, $decimals, '.', ',' ); }
function __( $text ) { return $text; }
function get_transient( $key ) { return $GLOBALS['wp_seen_posts_test_transients'][ $key ] ?? false; }
function set_transient( $key, $value ) { $GLOBALS['wp_seen_posts_test_transients'][ $key ] = $value; return true; }
function delete_transient( $key ) { unset( $GLOBALS['wp_seen_posts_test_transients'][ $key ] ); return true; }
function absint( $value ) { return abs( (int) $value ); }

require_once dirname( __DIR__ ) . '/includes/class-settings.php';
require_once dirname( __DIR__ ) . '/includes/class-gamification.php';

use HoldMyVodka\SeenPosts\Gamification;
use HoldMyVodka\SeenPosts\Settings;

$GLOBALS['wp_seen_posts_test_transients'][ Gamification::RARITY_CACHE_KEY ] = array(
	'eligible_readers' => 1000,
	'badge:beer'       => 270,
	'badge:vodka'      => 84,
	'badge:barsetka'   => 37,
	'badge:gopnik'     => 8,
	'badge:bmw'        => 0,
);

$cases = array(
	'beer'     => 'Unlocked by 27% of readers',
	'vodka'    => 'Unlocked by 8.4% of readers',
	'barsetka' => 'Unlocked by 3.7% of readers',
	'gopnik'   => 'Unlocked by 0.8% of readers',
);
foreach ( $cases as $badge_key => $expected ) {
	$percentage = Gamification::get_badge_rarity_percentage( $badge_key );
	$actual     = null === $percentage ? '' : Gamification::format_rarity( $percentage );
	if ( $expected !== $actual ) {
		fwrite( STDERR, "Rarity {$badge_key}: expected {$expected}, got {$actual}\n" );
		exit( 1 );
	}
}

if ( 'Unlocked by <0.1% of readers' !== Gamification::format_rarity( 0.04 ) ) {
	fwrite( STDERR, 'Sub-0.1 rarity formatting failed.' . PHP_EOL );
	exit( 1 );
}

$sanitized = Settings::sanitize(
	array(
		'streak_posts_required' => 999,
		'rarity_min_readers'    => 1,
		'rarity_enabled'        => '1',
	)
);
if ( 25 !== $sanitized['streak_posts_required'] || 5 !== $sanitized['rarity_min_readers'] || true !== $sanitized['rarity_enabled'] || true === $sanitized['streaks_enabled'] ) {
	fwrite( STDERR, 'Gamification setting bounds failed.' . PHP_EOL );
	exit( 1 );
}

$GLOBALS['wp_seen_posts_test_option']['rarity_min_readers'] = 2000;
if ( null !== Gamification::get_badge_rarity_percentage( 'beer' ) ) {
	fwrite( STDERR, 'Minimum-sample rarity suppression failed.' . PHP_EOL );
	exit( 1 );
}

echo "Gamification PHP tests passed.\n";
