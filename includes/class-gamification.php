<?php
/**
 * Privacy-safe badge rarity aggregates for anonymous and logged-in readers.
 *
 * Streak state stays in the browser. The server stores only a salted reader
 * hash, a bounded set of unlocked badge keys, and tiny aggregate counters.
 *
 * @package WP_Seen_Posts
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Gamification {
	public const SCHEMA_VERSION        = '1.0.1';
	public const SCHEMA_VERSION_OPTION = 'wp_seen_posts_gamification_schema_version';
	public const REST_NAMESPACE        = 'wp-seen-posts/v1';
	public const REST_ROUTE            = '/progress';
	public const RARITY_CACHE_KEY      = 'wp_seen_posts_badge_stats_v1';
	public const MAX_BADGES_PER_READER = 24;

	/** @var array<string,int>|null */
	private static $stats_cache = null;

	/** Register the anonymous aggregate endpoint. */
	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_rest_route' ) );
	}

	/** Create or upgrade the two compact aggregate tables. */
	public static function install_schema(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$previous_version = (string) get_option( self::SCHEMA_VERSION_OPTION, '' );
		$charset_collate  = $wpdb->get_charset_collate();
		$readers_table   = self::readers_table();
		$stats_table     = self::stats_table();

		$readers_sql = "CREATE TABLE {$readers_table} (
			reader_hash char(64) NOT NULL,
			unlocked_badges varchar(500) NOT NULL DEFAULT '',
			created_date date NOT NULL,
			updated_date date NOT NULL,
			PRIMARY KEY  (reader_hash)
		) ENGINE=InnoDB {$charset_collate};";

		$stats_sql = "CREATE TABLE {$stats_table} (
			stat_key varchar(64) NOT NULL,
			stat_value bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (stat_key)
		) ENGINE=InnoDB {$charset_collate};";

		dbDelta( $readers_sql );
		dbDelta( $stats_sql );

		/* Version 1.3.1 permanently retired Barsetka. Remove its bounded reader
		 * key and aggregate row once during the versioned migration, never during
		 * an ordinary Seen event or page render. */
		if ( $previous_version && version_compare( $previous_version, '1.0.1', '<' ) ) {
			$wpdb->query( "UPDATE {$readers_table} SET unlocked_badges = REPLACE(unlocked_badges, ',barsetka,', ',') WHERE unlocked_badges LIKE '%,barsetka,%'" );
			$wpdb->delete( $stats_table, array( 'stat_key' => 'badge:barsetka' ), array( '%s' ) );
			self::clear_rarity_cache();
		}

		if ( false === get_option( self::SCHEMA_VERSION_OPTION, false ) ) {
			add_option( self::SCHEMA_VERSION_OPTION, self::SCHEMA_VERSION, '', true );
		} else {
			update_option( self::SCHEMA_VERSION_OPTION, self::SCHEMA_VERSION, true );
		}
	}

	/** Run dbDelta only when this feature's schema version changes. */
	public static function maybe_upgrade_schema(): void {
		if ( self::SCHEMA_VERSION !== get_option( self::SCHEMA_VERSION_OPTION, '' ) ) {
			self::install_schema();
		}
	}

	/** Register one lazy endpoint used on reader registration and badge unlocks. */
	public static function register_rest_route(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			self::REST_ROUTE,
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_progress_request' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Register one privacy-safe reader and any newly unlocked badges.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function handle_progress_request( \WP_REST_Request $request ) {
		if ( ! Settings::rarity_enabled() ) {
			return rest_ensure_response( array( 'rarities' => new \stdClass() ) );
		}

		if ( self::is_obvious_bot() ) {
			return new \WP_Error(
				'wp_seen_posts_bot_request',
				__( 'Automated requests are not tracked.', 'wp-seen-posts' ),
				array( 'status' => 403 )
			);
		}

		$raw_token = $request->get_param( 'reader_token' );
		$token     = is_string( $raw_token ) ? strtolower( trim( $raw_token ) ) : '';
		if ( ! preg_match( '/^[a-f0-9]{32,128}$/D', $token ) ) {
			return new \WP_Error(
				'wp_seen_posts_invalid_reader',
				__( 'The anonymous reader token is invalid.', 'wp-seen-posts' ),
				array( 'status' => 400 )
			);
		}

		$badge_keys = self::sanitize_badge_keys( $request->get_param( 'badge_keys' ) );
		if ( is_wp_error( $badge_keys ) ) {
			return $badge_keys;
		}

		$reader_hash = hash_hmac( 'sha256', $token, wp_salt( 'auth' ) );
		$result      = self::record_reader_badges( $reader_hash, $badge_keys );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$response = array(
			'registered'  => true,
			'new_reader'  => $result['new_reader'],
			'new_badges'  => $result['new_badges'],
			'rarities'    => self::rarities_for_badges( array_keys( self::valid_badge_keys() ) ),
		);

		return rest_ensure_response( $response );
	}

	/**
	 * Store one reader row and update aggregate counters in one transaction.
	 *
	 * @param array<int,string> $badge_keys Valid badge keys.
	 * @return array{new_reader:bool,new_badges:array<int,string>}|\WP_Error
	 */
	public static function record_reader_badges( string $reader_hash, array $badge_keys ) {
		global $wpdb;

		if ( ! preg_match( '/^[a-f0-9]{64}$/D', $reader_hash ) ) {
			return new \WP_Error( 'wp_seen_posts_invalid_reader_hash', __( 'The reader identity is invalid.', 'wp-seen-posts' ) );
		}

		$badge_keys = array_values( array_intersect( $badge_keys, array_keys( self::valid_badge_keys() ) ) );
		$today      = current_time( 'Y-m-d' );
		$started    = $wpdb->query( 'START TRANSACTION' );
		if ( false === $started ) {
			return self::database_error();
		}

		$inserted = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO ' . self::readers_table() . ' (reader_hash,unlocked_badges,created_date,updated_date) VALUES (%s,%s,%s,%s)',
				$reader_hash,
				'',
				$today,
				$today
			)
		);

		if ( false === $inserted ) {
			$wpdb->query( 'ROLLBACK' );
			return self::database_error();
		}

		$stored = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT unlocked_badges FROM ' . self::readers_table() . ' WHERE reader_hash = %s FOR UPDATE',
				$reader_hash
			)
		);
		if ( null === $stored ) {
			$wpdb->query( 'ROLLBACK' );
			return self::database_error();
		}

		$existing   = self::decode_badge_keys( (string) $stored );
		$new_badges = array_values( array_diff( $badge_keys, $existing ) );
		$all_badges = array_values( array_unique( array_merge( $existing, $new_badges ) ) );

		if ( $new_badges ) {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE ' . self::readers_table() . ' SET unlocked_badges = %s, updated_date = %s WHERE reader_hash = %s',
					self::encode_badge_keys( $all_badges ),
					$today,
					$reader_hash
				)
			);
			if ( false === $updated ) {
				$wpdb->query( 'ROLLBACK' );
				return self::database_error();
			}
		}

		$increments = array();
		if ( 1 === (int) $inserted ) {
			$increments[] = 'eligible_readers';
		}
		foreach ( $new_badges as $badge_key ) {
			$increments[] = 'badge:' . $badge_key;
		}

		if ( $increments && ! self::increment_stats( $increments ) ) {
			$wpdb->query( 'ROLLBACK' );
			return self::database_error();
		}

		if ( false === $wpdb->query( 'COMMIT' ) ) {
			$wpdb->query( 'ROLLBACK' );
			return self::database_error();
		}

		if ( $increments ) {
			self::clear_rarity_cache();
		}
		if ( 1 === (int) $inserted ) {
			do_action( 'wp_seen_posts_reader_registered' );
		}
		foreach ( $new_badges as $badge_key ) {
			do_action( 'wp_seen_posts_badge_unlocked', $badge_key );
		}

		return array(
			'new_reader' => 1 === (int) $inserted,
			'new_badges' => $new_badges,
		);
	}

	/** Return the exact aggregate unlock count for one known badge. */
	public static function get_badge_unlock_count( string $badge_key ): int {
		$badge_key = sanitize_key( $badge_key );
		$stats     = self::stats();
		return isset( $stats[ 'badge:' . $badge_key ] ) ? max( 0, (int) $stats[ 'badge:' . $badge_key ] ) : 0;
	}

	/** Return a percentage, or null until the configured sample is credible. */
	public static function get_badge_rarity_percentage( string $badge_key ): ?float {
		if ( ! Settings::rarity_enabled() ) {
			return null;
		}

		$stats    = self::stats();
		$eligible = isset( $stats['eligible_readers'] ) ? max( 0, (int) $stats['eligible_readers'] ) : 0;
		$minimum  = Settings::rarity_minimum_readers();
		if ( $eligible < $minimum ) {
			return null;
		}

		$unlocks    = self::get_badge_unlock_count( $badge_key );
		$percentage = min( 100, max( 0, ( $unlocks / $eligible ) * 100 ) );

		/** Filters one calculated badge rarity percentage. */
		$percentage = apply_filters( 'wp_seen_posts_badge_rarity', $percentage, $badge_key, $unlocks, $eligible );
		return is_numeric( $percentage ) ? min( 100, max( 0, (float) $percentage ) ) : null;
	}

	/** Return already-formatted rarity labels without one query per badge. */
	public static function rarities_for_badges( array $badge_keys ): array {
		$rarities = array();
		foreach ( array_unique( array_map( 'sanitize_key', $badge_keys ) ) as $badge_key ) {
			$percentage = self::get_badge_rarity_percentage( $badge_key );
			if ( null !== $percentage ) {
				$rarities[ $badge_key ] = self::format_rarity( $percentage );
			}
		}
		return $rarities;
	}

	/** Render percentages as 27%, 8.4%, or <0.1%. */
	public static function format_rarity( float $percentage ): string {
		if ( $percentage > 0 && $percentage < 0.1 ) {
			return __( 'Unlocked by <0.1% of readers', 'wp-seen-posts' );
		}
		$value = $percentage >= 10
			? number_format_i18n( round( $percentage ), 0 )
			: number_format_i18n( round( $percentage, 1 ), 1 );
		return sprintf( __( 'Unlocked by %s%% of readers', 'wp-seen-posts' ), $value );
	}

	/** Clear request and persistent rarity caches after an aggregate change. */
	public static function clear_rarity_cache(): void {
		self::$stats_cache = null;
		delete_transient( self::RARITY_CACHE_KEY );
	}

	/** @return array<string,int> */
	private static function stats(): array {
		global $wpdb;

		if ( null !== self::$stats_cache ) {
			return self::$stats_cache;
		}
		$cached = get_transient( self::RARITY_CACHE_KEY );
		if ( is_array( $cached ) ) {
			self::$stats_cache = array_map( 'intval', $cached );
			return self::$stats_cache;
		}

		$rows  = $wpdb->get_results( 'SELECT stat_key, stat_value FROM ' . self::stats_table(), ARRAY_A );
		$stats = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			if ( isset( $row['stat_key'], $row['stat_value'] ) ) {
				$stats[ (string) $row['stat_key'] ] = max( 0, (int) $row['stat_value'] );
			}
		}
		self::$stats_cache = $stats;
		set_transient( self::RARITY_CACHE_KEY, $stats, 5 * MINUTE_IN_SECONDS );
		return $stats;
	}

	/** Increment the requested tiny stat rows with one SQL statement. */
	private static function increment_stats( array $stat_keys ): bool {
		global $wpdb;

		$values = array();
		$args   = array();
		foreach ( array_unique( $stat_keys ) as $stat_key ) {
			$values[] = '(%s,1)';
			$args[]   = $stat_key;
		}
		if ( ! $values ) {
			return true;
		}

		$sql = 'INSERT INTO ' . self::stats_table() . ' (stat_key,stat_value) VALUES ' . implode( ',', $values ) . ' ON DUPLICATE KEY UPDATE stat_value = stat_value + 1';
		return false !== $wpdb->query( $wpdb->prepare( $sql, $args ) );
	}

	/** @return array<string,bool> */
	private static function valid_badge_keys(): array {
		$valid = array();
		foreach ( achievement_badge_definitions() as $badge ) {
			if ( ! empty( $badge['key'] ) ) {
				$valid[ sanitize_key( $badge['key'] ) ] = true;
			}
		}
		return $valid;
	}

	/** @param mixed $raw_keys @return array<int,string>|\WP_Error */
	private static function sanitize_badge_keys( $raw_keys ) {
		if ( null === $raw_keys ) {
			return array();
		}
		if ( ! is_array( $raw_keys ) || count( $raw_keys ) > self::MAX_BADGES_PER_READER ) {
			return new \WP_Error(
				'wp_seen_posts_invalid_badges',
				__( 'The badge list is invalid.', 'wp-seen-posts' ),
				array( 'status' => 400 )
			);
		}

		$valid = self::valid_badge_keys();
		$clean = array();
		foreach ( $raw_keys as $raw_key ) {
			if ( ! is_string( $raw_key ) || $raw_key !== sanitize_key( $raw_key ) || ! isset( $valid[ $raw_key ] ) ) {
				continue;
			}
			$clean[ $raw_key ] = $raw_key;
		}
		return array_values( $clean );
	}

	/** @return array<int,string> */
	private static function decode_badge_keys( string $stored ): array {
		$keys  = array_filter( explode( ',', trim( $stored, ',' ) ) );
		$valid = self::valid_badge_keys();
		return array_values( array_filter( array_unique( $keys ), static function ( string $key ) use ( $valid ): bool {
			return isset( $valid[ $key ] );
		} ) );
	}

	private static function encode_badge_keys( array $badge_keys ): string {
		return $badge_keys ? ',' . implode( ',', array_slice( $badge_keys, 0, self::MAX_BADGES_PER_READER ) ) . ',' : '';
	}

	private static function is_obvious_bot(): bool {
		$user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$is_bot     = '' !== $user_agent && (bool) preg_match( '/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|lighthouse|pagespeed/i', $user_agent );
		return (bool) apply_filters( 'wp_seen_posts_is_obvious_bot', $is_bot, $user_agent );
	}

	private static function database_error(): \WP_Error {
		return new \WP_Error(
			'wp_seen_posts_progress_failed',
			__( 'Reader progress could not be recorded.', 'wp-seen-posts' ),
			array( 'status' => 500 )
		);
	}

	private static function readers_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_seen_readers';
	}

	private static function stats_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_seen_badge_stats';
	}
}
