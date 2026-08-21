<?php
/**
 * Aggregate public Seen counters and daily ranking data.
 *
 * @package WP_Seen_Posts
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Stores anonymous aggregate counts without retaining visitor-level data.
 */
final class Public_Counts {
	public const SCHEMA_VERSION        = '1.1.2';
	public const SCHEMA_VERSION_OPTION = 'wp_seen_posts_schema_version';
	public const REST_NAMESPACE        = 'wp-seen-posts/v1';
	public const REST_ROUTE            = '/counts';
	public const MAX_BATCH_SIZE        = 25;
	public const DAILY_RETENTION_DAYS  = 400;
	public const CLEANUP_HOOK          = 'wp_seen_posts_prune_daily';
	public const RENDER_PRIORITY       = PHP_INT_MAX;

	/** @var array<int,int> Request-local lifetime-count cache. */
	private static $count_cache = array();

	/** Register front-end rendering and the anonymous batch endpoint. */
	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_rest_route' ) );
		add_action( self::CLEANUP_HOOK, array( __CLASS__, 'cleanup_daily_counts' ) );
		add_filter( 'the_posts', array( __CLASS__, 'prime_query_counts' ), 10, 2 );
		/* P2 auto-Read More rewrites the_content late and discards markup appended
		 * before truncation. Render last so full content, excerpts, and truncated
		 * cards all receive exactly one counter. */
		add_filter( 'the_content', array( __CLASS__, 'append_counter' ), self::RENDER_PRIORITY );
		add_filter( 'the_excerpt', array( __CLASS__, 'append_counter' ), self::RENDER_PRIORITY );
	}

	/** Create or upgrade the aggregate tables. This runs only when the schema version changes. */
	public static function install_schema(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset_collate = $wpdb->get_charset_collate();
		$lifetime_table  = self::lifetime_table();
		$daily_table     = self::daily_table();

		$lifetime_sql = "CREATE TABLE {$lifetime_table} (
			post_id bigint(20) unsigned NOT NULL,
			seen_count bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (post_id)
		) ENGINE=InnoDB {$charset_collate};";

		$daily_sql = "CREATE TABLE {$daily_table} (
			post_id bigint(20) unsigned NOT NULL,
			view_date date NOT NULL,
			seen_count bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (post_id,view_date),
			KEY view_date_count (view_date,seen_count,post_id)
		) ENGINE=InnoDB {$charset_collate};";

		dbDelta( $lifetime_sql );
		dbDelta( $daily_sql );
		self::schedule_cleanup();

		if ( false === get_option( self::SCHEMA_VERSION_OPTION, false ) ) {
			add_option( self::SCHEMA_VERSION_OPTION, self::SCHEMA_VERSION, '', true );
		} else {
			update_option( self::SCHEMA_VERSION_OPTION, self::SCHEMA_VERSION, true );
		}
	}

	/** Upgrade an existing installation without running dbDelta on ordinary requests. */
	public static function maybe_upgrade_schema(): void {
		if ( self::SCHEMA_VERSION !== get_option( self::SCHEMA_VERSION_OPTION, '' ) ) {
			self::install_schema();
		}
	}

	/** Schedule one indexed retention cleanup per day, never one cleanup per request. */
	public static function schedule_cleanup(): void {
		if ( ! wp_next_scheduled( self::CLEANUP_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK );
		}
	}

	/** Remove obsolete daily buckets while preserving exact lifetime totals forever. */
	public static function cleanup_daily_counts(): void {
		global $wpdb;

		$retention_days = max( 31, (int) apply_filters( 'wp_seen_posts_daily_retention_days', self::DAILY_RETENTION_DAYS ) );
		$cutoff_date     = current_datetime()->modify( '-' . $retention_days . ' days' )->format( 'Y-m-d' );
		$sql             = $wpdb->prepare(
			'DELETE FROM ' . self::daily_table() . ' WHERE view_date < %s',
			$cutoff_date
		);
		$wpdb->query( $sql );
	}

	/** Stop the maintenance event when the plugin is deactivated. */
	public static function unschedule_cleanup(): void {
		wp_clear_scheduled_hook( self::CLEANUP_HOOK );
	}

	/** Register the anonymous, IDs-only batch endpoint. */
	public static function register_rest_route(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			self::REST_ROUTE,
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_increment_request' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Validate one anonymous batch, atomically increment both aggregates, and return exact totals.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function handle_increment_request( \WP_REST_Request $request ) {
		if ( self::is_obvious_bot() ) {
			return new \WP_Error(
				'wp_seen_posts_bot_request',
				__( 'Automated requests are not counted.', 'wp-seen-posts' ),
				array( 'status' => 403 )
			);
		}

		$post_ids = self::sanitize_batch( $request->get_param( 'post_ids' ) );
		if ( is_wp_error( $post_ids ) ) {
			return $post_ids;
		}

		$post_ids = self::published_post_ids( $post_ids );
		if ( ! $post_ids ) {
			return rest_ensure_response( array( 'counts' => new \stdClass() ) );
		}

		$result = self::increment_counts( $post_ids );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$response_counts = new \stdClass();
		foreach ( $result as $post_id => $count ) {
			$response_counts->{(string) $post_id} = (int) $count;
		}

		return rest_ensure_response( array( 'counts' => $response_counts ) );
	}

	/**
	 * Normalize a small IDs-only request. Invalid members are rejected, not coerced.
	 *
	 * @param mixed $raw_ids Raw REST parameter.
	 * @return array<int,int>|\WP_Error
	 */
	public static function sanitize_batch( $raw_ids ) {
		if ( ! is_array( $raw_ids ) ) {
			return new \WP_Error(
				'wp_seen_posts_invalid_batch',
				__( 'post_ids must be an array.', 'wp-seen-posts' ),
				array( 'status' => 400 )
			);
		}

		if ( count( $raw_ids ) > self::MAX_BATCH_SIZE ) {
			return new \WP_Error(
				'wp_seen_posts_batch_too_large',
				__( 'Too many post IDs were submitted.', 'wp-seen-posts' ),
				array( 'status' => 413 )
			);
		}

		$post_ids = array();
		foreach ( $raw_ids as $raw_id ) {
			if ( is_int( $raw_id ) ) {
				$post_id = $raw_id;
			} elseif ( is_string( $raw_id ) && preg_match( '/^[1-9]\d*$/D', $raw_id ) ) {
				$post_id = (int) $raw_id;
			} else {
				return new \WP_Error(
					'wp_seen_posts_invalid_post_id',
					__( 'Every post ID must be a positive integer.', 'wp-seen-posts' ),
					array( 'status' => 400 )
				);
			}

			if ( $post_id <= 0 || ( is_string( $raw_id ) && (string) $post_id !== $raw_id ) ) {
				return new \WP_Error(
					'wp_seen_posts_invalid_post_id',
					__( 'Every post ID must be a positive integer.', 'wp-seen-posts' ),
					array( 'status' => 400 )
				);
			}
			$post_ids[ $post_id ] = $post_id;
		}

		if ( ! $post_ids ) {
			return new \WP_Error(
				'wp_seen_posts_empty_batch',
				__( 'No valid post IDs were submitted.', 'wp-seen-posts' ),
				array( 'status' => 400 )
			);
		}

		return array_values( $post_ids );
	}

	/**
	 * Atomically increment lifetime and site-local daily aggregates in two multi-row writes.
	 *
	 * @param array<int,int> $post_ids Valid published post IDs.
	 * @return array<int,int>|\WP_Error Exact lifetime totals after the increment.
	 */
	public static function increment_counts( array $post_ids ) {
		global $wpdb;

		$post_ids = self::sanitize_batch( $post_ids );
		if ( is_wp_error( $post_ids ) ) {
			return $post_ids;
		}

		$lifetime_values = array();
		$lifetime_args   = array();
		$daily_values    = array();
		$daily_args      = array();
		$view_date       = current_time( 'Y-m-d' );

		foreach ( $post_ids as $post_id ) {
			$lifetime_values[] = '(%d,1)';
			$lifetime_args[]   = $post_id;
			$daily_values[]    = '(%d,%s,1)';
			$daily_args[]      = $post_id;
			$daily_args[]      = $view_date;
		}

		$lifetime_sql = 'INSERT INTO ' . self::lifetime_table() . ' (post_id,seen_count) VALUES ' . implode( ',', $lifetime_values ) . ' ON DUPLICATE KEY UPDATE seen_count = seen_count + 1';
		$daily_sql    = 'INSERT INTO ' . self::daily_table() . ' (post_id,view_date,seen_count) VALUES ' . implode( ',', $daily_values ) . ' ON DUPLICATE KEY UPDATE seen_count = seen_count + 1';

		$transaction_started = $wpdb->query( 'START TRANSACTION' );
		if ( false === $transaction_started ) {
			return new \WP_Error(
				'wp_seen_posts_increment_failed',
				__( 'The Seen count could not be recorded.', 'wp-seen-posts' ),
				array( 'status' => 500 )
			);
		}
		$lifetime_result = $wpdb->query( $wpdb->prepare( $lifetime_sql, $lifetime_args ) );
		$daily_result    = false;
		if ( false !== $lifetime_result ) {
			$daily_result = $wpdb->query( $wpdb->prepare( $daily_sql, $daily_args ) );
		}

		if ( false === $lifetime_result || false === $daily_result ) {
			$wpdb->query( 'ROLLBACK' );
			return new \WP_Error(
				'wp_seen_posts_increment_failed',
				__( 'The Seen count could not be recorded.', 'wp-seen-posts' ),
				array( 'status' => 500 )
			);
		}

		$wpdb->query( 'COMMIT' );
		return self::fetch_counts( $post_ids, true );
	}

	/** Prime all posts in a query with one indexed lifetime-table read. */
	public static function prime_query_counts( array $posts, $query ): array {
		if ( is_admin() || ! $posts ) {
			return $posts;
		}

		$post_ids = array();
		foreach ( $posts as $post ) {
			if ( $post instanceof \WP_Post && 'post' === $post->post_type && 'publish' === $post->post_status ) {
				$post_ids[] = (int) $post->ID;
			}
		}
		self::fetch_counts( $post_ids );

		return $posts;
	}

	/** Append a server-rendered lifetime counter to supported post content or excerpts. */
	public static function append_counter( string $content ): string {
		if (
			is_admin()
			|| is_feed()
			|| ! in_the_loop()
			|| false !== strpos( $content, 'wp-seen-posts-public-count' )
			|| ( ! is_supported_view() && ! is_trackable_single_post() )
		) {
			return $content;
		}

		$post_id = get_the_ID();
		if ( ! $post_id || 'post' !== get_post_type( $post_id ) || 'publish' !== get_post_status( $post_id ) ) {
			return $content;
		}

		return $content . self::counter_markup( (int) $post_id );
	}

	/** Return accessible, non-interactive Post Views Counter-style inline eye markup. */
	public static function counter_markup( int $post_id ): string {
		$count     = self::get_count( $post_id );
		$formatted = self::format_compact( $count );
		$exact     = number_format_i18n( $count );
		$public_label = sprintf(
			/* translators: %s: exact lifetime Seen count. */
			_n( 'Seen by %s visitor', 'Seen by %s visitors', $count, 'wp-seen-posts' ),
			$exact
		);
		$label = __( 'Unseen', 'wp-seen-posts' ) . '. ' . $public_label;

		return sprintf(
			'<div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" role="img" data-seen-post-id="%1$d" data-seen-count="%2$d" data-personal-seen-state="unseen" aria-label="%3$s" title="%3$s"><svg class="wp-seen-posts-public-eye" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M18.3 9.5C15 4.9 8.5 3.8 3.9 7.2c-1.2.9-2.2 2.1-3 3.4.2.4.5.8.8 1.2 3.3 4.6 9.6 5.6 14.2 2.4.9-.7 1.7-1.4 2.4-2.4.3-.4.5-.8.8-1.2-.3-.4-.5-.8-.8-1.1zM10.1 7.2c.5-.5 1.3-.5 1.8 0s.5 1.3 0 1.8-1.3.5-1.8 0-.5-1.3 0-1.8zM10 14.9c-3.1 0-6-1.6-7.7-4.2C3.5 9 5.1 7.8 7 7.2c-.7.8-1 1.7-1 2.7 0 2.2 1.7 4.1 4 4.1 2.2 0 4.1-1.7 4.1-4v-.1c0-1-.4-2-1.1-2.7 1.9.6 3.5 1.8 4.7 3.5-1.7 2.6-4.6 4.2-7.7 4.2z"></path></svg><span class="wp-seen-posts-public-value" aria-hidden="true">%4$s</span></span></div>',
			$post_id,
			$count,
			esc_attr( $label ),
			esc_html( $formatted )
		);
	}

	/** Compact lifetime totals while preserving the exact value in accessible markup. */
	public static function format_compact( int $count ): string {
		$count = max( 0, $count );
		if ( $count < 1000 ) {
			return (string) $count;
		}

		if ( $count < 1000000 ) {
			$value = $count / 1000;
			$value = $value < 10 ? floor( $value * 10 ) / 10 : round( $value, 1 );
			if ( $value >= 1000 ) {
				return '1M';
			}
			return self::trim_decimal( $value ) . 'K';
		}

		$value = $count / 1000000;
		$value = $value < 10 ? floor( $value * 10 ) / 10 : round( $value, 1 );
		return self::trim_decimal( $value ) . 'M';
	}

	/** Fetch any missing lifetime counts in one indexed query. */
	private static function fetch_counts( array $post_ids, bool $refresh = false ): array {
		global $wpdb;

		$post_ids = array_values( array_unique( array_filter( array_map( 'absint', $post_ids ) ) ) );
		if ( ! $post_ids ) {
			return array();
		}

		$requested = $post_ids;
		if ( ! $refresh ) {
			$post_ids = array_values(
				array_filter(
					$post_ids,
					static function ( int $post_id ): bool {
						return ! array_key_exists( $post_id, self::$count_cache );
					}
				)
			);
		}

		if ( $post_ids ) {
			foreach ( $post_ids as $post_id ) {
				self::$count_cache[ $post_id ] = 0;
			}
			$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
			$sql          = 'SELECT post_id, seen_count FROM ' . self::lifetime_table() . " WHERE post_id IN ({$placeholders})";
			$rows         = (array) $wpdb->get_results( $wpdb->prepare( $sql, $post_ids ), ARRAY_A );
			foreach ( $rows as $row ) {
				self::$count_cache[ (int) $row['post_id'] ] = max( 0, (int) $row['seen_count'] );
			}
		}

		$counts = array();
		foreach ( $requested as $post_id ) {
			$counts[ $post_id ] = isset( self::$count_cache[ $post_id ] ) ? self::$count_cache[ $post_id ] : 0;
		}
		return $counts;
	}

	/** Return a single cached count, falling back to one query outside a primed loop. */
	private static function get_count( int $post_id ): int {
		$counts = self::fetch_counts( array( $post_id ) );
		return isset( $counts[ $post_id ] ) ? (int) $counts[ $post_id ] : 0;
	}

	/** Validate all IDs in one posts-table query and retain only published allowed post types. */
	private static function published_post_ids( array $post_ids ): array {
		global $wpdb;

		$post_types = (array) apply_filters( 'wp_seen_posts_public_count_post_types', array( 'post' ) );
		$post_types = array_values( array_unique( array_filter( array_map( 'sanitize_key', $post_types ) ) ) );
		if ( ! $post_types ) {
			return array();
		}

		$id_placeholders   = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
		$type_placeholders = implode( ',', array_fill( 0, count( $post_types ), '%s' ) );
		$sql               = "SELECT ID FROM {$wpdb->posts} WHERE ID IN ({$id_placeholders}) AND post_status = %s AND post_type IN ({$type_placeholders})";
		$args              = array_merge( $post_ids, array( 'publish' ), $post_types );
		$valid_ids         = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( $sql, $args ) ) );

		return array_values( array_intersect( $post_ids, $valid_ids ) );
	}

	/** Exclude common crawler user agents without changing crawlable page output. */
	private static function is_obvious_bot(): bool {
		$user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$is_bot     = '' !== $user_agent && (bool) preg_match( '/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|lighthouse|pagespeed/i', $user_agent );

		/** Filters whether an anonymous Seen-count request appears automated. */
		return (bool) apply_filters( 'wp_seen_posts_is_obvious_bot', $is_bot, $user_agent );
	}

	/** Lifetime aggregate table name using the current site's configured prefix. */
	private static function lifetime_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_seen_counts';
	}

	/** Daily aggregate table name using the current site's configured prefix. */
	private static function daily_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_seen_daily';
	}

	/** Render one optional decimal without locale-dependent grouping. */
	private static function trim_decimal( float $value ): string {
		return rtrim( rtrim( number_format( $value, 1, '.', '' ), '0' ), '.' );
	}
}
