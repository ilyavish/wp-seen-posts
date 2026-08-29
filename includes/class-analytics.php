<?php
/**
 * Privacy-conscious first-party page analytics.
 *
 * @package WP_Seen_Posts
 */

namespace HoldMyVodka\SeenPosts;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Counts qualified page views and anonymous visitors across public site routes.
 *
 * Analytics is deliberately independent from browser-local Seen history and the
 * public per-post Seen counter. Resetting, showing, or hiding Seen posts cannot
 * create analytics events or alter these reports.
 */
final class Analytics {
	public const SCHEMA_VERSION        = '1.0.0';
	public const SCHEMA_OPTION         = 'wp_seen_posts_analytics_schema_version';
	public const REST_NAMESPACE        = 'wp-seen-posts/v1';
	public const REST_ROUTE            = '/analytics/view';
	public const CLEANUP_HOOK          = 'wp_seen_posts_prune_analytics';
	public const DAILY_RETENTION_DAYS  = 400;
	public const VISITOR_RETENTION_DAYS = 45;
	public const REALTIME_RETENTION_HOURS = 2;

	/** @var string Admin page hook suffix. */
	private static $admin_hook = '';

	/** Register public tracking, reports, and bounded cleanup. */
	public static function init(): void {
		add_action( 'rest_api_init', array( self::class, 'register_rest_route' ) );
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue_tracker' ), 20 );
		add_action( 'admin_menu', array( self::class, 'register_admin_page' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue_admin_assets' ) );
		add_action( self::CLEANUP_HOOK, array( self::class, 'cleanup' ) );
		self::schedule_cleanup();
	}

	/** Create or upgrade the bounded analytics schema. */
	public static function install_schema(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset_collate = $wpdb->get_charset_collate();
		$daily_table     = self::daily_table();
		$visitor_table   = self::visitor_table();
		$realtime_table  = self::realtime_table();

		$daily_sql = "CREATE TABLE {$daily_table} (
			stat_date date NOT NULL,
			route_hash char(64) NOT NULL,
			route_key varchar(190) NOT NULL,
			route_type varchar(32) NOT NULL,
			object_id bigint(20) unsigned NOT NULL DEFAULT 0,
			route_path varchar(500) NOT NULL DEFAULT '',
			route_title varchar(255) NOT NULL DEFAULT '',
			views bigint(20) unsigned NOT NULL DEFAULT 0,
			visitors bigint(20) unsigned NOT NULL DEFAULT 0,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (stat_date,route_hash),
			KEY route_date (route_hash,stat_date),
			KEY type_date_views (route_type,stat_date,views)
		) ENGINE=InnoDB {$charset_collate};";

		$visitor_sql = "CREATE TABLE {$visitor_table} (
			stat_date date NOT NULL,
			visitor_hash char(64) NOT NULL,
			route_hash char(64) NOT NULL,
			first_seen_at datetime NOT NULL,
			last_seen_at datetime NOT NULL,
			last_counted_at datetime NOT NULL,
			qualified_views bigint(20) unsigned NOT NULL DEFAULT 1,
			PRIMARY KEY  (stat_date,visitor_hash,route_hash),
			KEY route_date (route_hash,stat_date),
			KEY visitor_date (visitor_hash,stat_date),
			KEY last_seen_at (last_seen_at)
		) ENGINE=InnoDB {$charset_collate};";

		$realtime_sql = "CREATE TABLE {$realtime_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			visitor_hash char(64) NOT NULL,
			route_hash char(64) NOT NULL,
			viewed_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY viewed_at (viewed_at),
			KEY visitor_viewed (visitor_hash,viewed_at)
		) ENGINE=InnoDB {$charset_collate};";

		dbDelta( $daily_sql );
		dbDelta( $visitor_sql );
		dbDelta( $realtime_sql );
		update_option( self::SCHEMA_OPTION, self::SCHEMA_VERSION, true );
		self::schedule_cleanup();
	}

	/** Run schema work only after a plugin update changes the schema version. */
	public static function maybe_upgrade_schema(): void {
		if ( self::SCHEMA_VERSION !== get_option( self::SCHEMA_OPTION, '' ) ) {
			self::install_schema();
		}
	}

	/** Schedule one indexed cleanup per hour to keep realtime storage genuinely short. */
	public static function schedule_cleanup(): void {
		if ( ! wp_next_scheduled( self::CLEANUP_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::CLEANUP_HOOK );
		}
	}

	/** Stop the cleanup event while the plugin is inactive. */
	public static function unschedule_cleanup(): void {
		wp_clear_scheduled_hook( self::CLEANUP_HOOK );
	}

	/**
	 * Keep long-term aggregates while bounding visitor-level and realtime rows.
	 */
	public static function cleanup(): void {
		global $wpdb;

		$daily_days   = max( 31, (int) apply_filters( 'wp_seen_posts_analytics_daily_retention_days', self::DAILY_RETENTION_DAYS ) );
		$visitor_days = max( 31, (int) apply_filters( 'wp_seen_posts_analytics_visitor_retention_days', self::VISITOR_RETENTION_DAYS ) );
		$daily_cutoff = current_datetime()->modify( '-' . $daily_days . ' days' )->format( 'Y-m-d' );
		$visit_cutoff = current_datetime()->modify( '-' . $visitor_days . ' days' )->format( 'Y-m-d' );
		$live_cutoff  = current_datetime()->modify( '-' . max( 2, self::REALTIME_RETENTION_HOURS ) . ' hours' )->format( 'Y-m-d H:i:s' );

		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::daily_table() . ' WHERE stat_date < %s', $daily_cutoff ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::visitor_table() . ' WHERE stat_date < %s', $visit_cutoff ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::realtime_table() . ' WHERE viewed_at < %s', $live_cutoff ) );
	}

	/** Register the cache-safe public view endpoint. */
	public static function register_rest_route(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			self::REST_ROUTE,
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'handle_view_request' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Build the analytics identity for the current public WordPress route.
	 * Pagination is intentionally omitted from route keys so an archive remains
	 * one report row across /page/2/, /page/3/, and infinite-scroll entry points.
	 *
	 * @return array<string,mixed>|null
	 */
	public static function current_route(): ?array {
		if ( is_front_page() || is_home() ) {
			return self::route( 'home', 'home', 0, home_url( '/' ), __( 'Homepage', 'wp-seen-posts' ) );
		}

		if ( is_singular() ) {
			$post_id   = (int) get_queried_object_id();
			$post_type = (string) get_post_type( $post_id );
			$type      = 'post' === $post_type ? 'post' : ( 'page' === $post_type ? 'page' : 'singular' );
			$key       = 'singular' === $type ? 'singular:' . sanitize_key( $post_type ) . ':' . $post_id : $type . ':' . $post_id;
			return self::route( $key, $type, $post_id, get_permalink( $post_id ), get_the_title( $post_id ) );
		}

		if ( is_tag() || is_category() || is_tax() ) {
			$term = get_queried_object();
			if ( ! $term instanceof \WP_Term ) {
				return null;
			}
			$type = is_tag() ? 'tag' : ( is_category() ? 'category' : 'taxonomy' );
			$key  = $type . ':' . sanitize_key( (string) $term->taxonomy ) . ':' . (int) $term->term_id;
			$link = get_term_link( $term );
			return self::route(
				$key,
				$type,
				(int) $term->term_id,
				is_wp_error( $link ) ? home_url( '/' ) : $link,
				sprintf( '%1$s: %2$s', self::type_label( $type ), $term->name )
			);
		}

		if ( is_author() ) {
			$author = get_queried_object();
			$id     = $author instanceof \WP_User ? (int) $author->ID : (int) get_query_var( 'author' );
			$name   = $author instanceof \WP_User ? $author->display_name : (string) $id;
			return self::route( 'author:' . $id, 'author', $id, get_author_posts_url( $id ), sprintf( __( 'Author: %s', 'wp-seen-posts' ), $name ) );
		}

		if ( is_date() ) {
			$year  = max( 0, (int) get_query_var( 'year' ) );
			$month = max( 0, (int) get_query_var( 'monthnum' ) );
			$day   = max( 0, (int) get_query_var( 'day' ) );
			$key   = sprintf( 'date:%04d-%02d-%02d', $year, $month, $day );
			$path  = $day ? get_day_link( $year, $month, $day ) : ( $month ? get_month_link( $year, $month ) : get_year_link( $year ) );
			return self::route( $key, 'date', 0, $path, get_the_archive_title() );
		}

		if ( is_post_type_archive() ) {
			$post_type = sanitize_key( (string) get_query_var( 'post_type' ) );
			$link      = get_post_type_archive_link( $post_type );
			return self::route( 'post-type:' . $post_type, 'post_type_archive', 0, $link ?: home_url( '/' ), get_the_archive_title() );
		}

		if ( is_search() ) {
			/* Search terms can be sensitive. Aggregate every search-results page
			 * without storing or transmitting the query. */
			return self::route( 'search', 'search', 0, '', __( 'Search results', 'wp-seen-posts' ) );
		}

		if ( is_404() ) {
			return self::route( 'not-found', 'not_found', 0, '', __( '404 / Not found', 'wp-seen-posts' ) );
		}

		if ( is_archive() ) {
			return self::route( 'archive:other', 'archive', 0, home_url( '/' ), get_the_archive_title() );
		}

		return null;
	}

	/** Create one normalized route payload. */
	private static function route( string $key, string $type, int $object_id, string $path, string $title ): array {
		return self::sanitize_route(
			array(
				'key'       => $key,
				'type'      => $type,
				'object_id' => $object_id,
				'path'      => $path,
				'title'     => $title,
			)
		);
	}

	/**
	 * Normalize and validate a signed route payload.
	 *
	 * @param mixed $raw Route payload.
	 * @return array<string,mixed>|null
	 */
	public static function sanitize_route( $raw ): ?array {
		if ( ! is_array( $raw ) ) {
			return null;
		}
		$allowed = array( 'site', 'home', 'post', 'page', 'singular', 'tag', 'category', 'taxonomy', 'author', 'date', 'post_type_archive', 'search', 'not_found', 'archive' );
		$type    = sanitize_key( (string) ( $raw['type'] ?? '' ) );
		$key     = sanitize_text_field( (string) ( $raw['key'] ?? '' ) );
		$title   = self::limit_text( sanitize_text_field( (string) ( $raw['title'] ?? '' ) ), 255 );
		$path    = esc_url_raw( (string) ( $raw['path'] ?? '' ) );
		$id      = absint( $raw['object_id'] ?? 0 );

		if ( ! in_array( $type, $allowed, true ) || '' === $key || strlen( $key ) > 190 ) {
			return null;
		}
		$path = self::limit_text( $path, 500 );
		if ( $path ) {
			$route_host = strtolower( (string) wp_parse_url( $path, PHP_URL_HOST ) );
			$site_host  = strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) );
			if ( $route_host && $site_host && $route_host !== $site_host ) {
				return null;
			}
		}

		return array(
			'key'       => $key,
			'type'      => $type,
			'object_id' => $id,
			'path'      => $path,
			'title'     => '' !== $title ? $title : self::type_label( $type ),
		);
	}

	/** Bound stored labels without breaking multibyte titles when mbstring exists. */
	private static function limit_text( string $value, int $length ): string {
		if ( function_exists( 'mb_substr' ) ) {
			return mb_substr( $value, 0, $length, 'UTF-8' );
		}
		return substr( $value, 0, $length );
	}

	/** Return a stable signature that lets full-page caches safely replay config. */
	public static function route_signature( array $route ): string {
		return hash_hmac( 'sha256', self::route_signature_payload( $route ), wp_salt( 'nonce' ) );
	}

	/** Return the canonical signed representation of a route. */
	private static function route_signature_payload( array $route ): string {
		return wp_json_encode(
			array(
				(string) $route['key'],
				(string) $route['type'],
				(int) $route['object_id'],
				(string) $route['path'],
				(string) $route['title'],
			)
		);
	}

	/** Enqueue one dependency-free, visibility-qualified page beacon. */
	public static function enqueue_tracker(): void {
		if (
			is_admin()
			|| ! Settings::analytics_enabled()
			|| ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() )
			|| is_feed()
			|| is_robots()
			|| current_user_can( 'manage_options' )
		) {
			return;
		}

		$route = self::current_route();
		if ( ! $route ) {
			return;
		}

		wp_enqueue_script(
			'wp-seen-posts-analytics',
			plugins_url( 'assets/js/analytics.js', dirname( __DIR__ ) . '/wp-seen-posts.php' ),
			array(),
			VERSION,
			true
		);
		wp_add_inline_script(
			'wp-seen-posts-analytics',
			'window.wpSeenPostsAnalytics=' . wp_json_encode(
				array(
					'endpoint'   => esc_url_raw( rest_url( self::REST_NAMESPACE . self::REST_ROUTE ) ),
					'route'      => $route,
					'signature'  => self::route_signature( $route ),
					'delay'      => Settings::analytics_delay_ms(),
					'respectDnt' => Settings::analytics_respects_dnt(),
				)
			) . ';',
			'before'
		);
	}

	/** Validate and record one anonymous qualified page view. */
	public static function handle_view_request( \WP_REST_Request $request ) {
		if ( ! Settings::analytics_enabled() ) {
			return rest_ensure_response( array( 'counted' => false, 'disabled' => true ) );
		}
		if ( ! self::request_is_same_site() || self::is_obvious_bot() ) {
			return new \WP_Error( 'wp_seen_posts_analytics_forbidden', __( 'This page view cannot be counted.', 'wp-seen-posts' ), array( 'status' => 403 ) );
		}

		$route     = self::sanitize_route( $request->get_param( 'route' ) );
		$signature = sanitize_text_field( (string) $request->get_param( 'signature' ) );
		$visitor   = self::sanitize_visitor_token( $request->get_param( 'visitor' ) );
		if ( ! $route || ! $visitor || ! hash_equals( self::route_signature( $route ), $signature ) ) {
			return new \WP_Error( 'wp_seen_posts_analytics_invalid', __( 'The analytics request is invalid.', 'wp-seen-posts' ), array( 'status' => 400 ) );
		}

		$result = self::record_view( $route, $visitor );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$response = rest_ensure_response( $result );
		if ( is_object( $response ) && method_exists( $response, 'header' ) ) {
			$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		}
		return $response;
	}

	/** Accept only a locally generated anonymous 128-bit-or-larger token. */
	public static function sanitize_visitor_token( $raw ): string {
		$token = strtolower( trim( (string) $raw ) );
		return preg_match( '/^[a-f0-9]{32,64}$/D', $token ) ? $token : '';
	}

	/**
	 * Atomically record a route view and site-wide view.
	 *
	 * Page reloads inside the configured window do not increment views. A visitor
	 * increments a route's visitor count once per day and the site's selected-range
	 * visitor metric once, even when several archives or posts are opened.
	 *
	 * @param array<string,mixed> $route Trusted normalized route.
	 * @return array<string,mixed>|\WP_Error
	 */
	public static function record_view( array $route, string $visitor_token ) {
		global $wpdb;

		$route = self::sanitize_route( $route );
		$visitor_token = self::sanitize_visitor_token( $visitor_token );
		if ( ! $route || ! $visitor_token ) {
			return new \WP_Error( 'wp_seen_posts_analytics_invalid', __( 'The analytics request is invalid.', 'wp-seen-posts' ), array( 'status' => 400 ) );
		}

		$now          = current_time( 'mysql' );
		$today        = current_time( 'Y-m-d' );
		$window       = Settings::analytics_dedupe_minutes();
		$cutoff       = current_datetime()->modify( '-' . $window . ' minutes' )->format( 'Y-m-d H:i:s' );
		$visitor_hash = hash_hmac( 'sha256', $visitor_token, wp_salt( 'auth' ) );
		$route_hash   = hash( 'sha256', (string) $route['key'] );
		$site_route   = self::site_route();
		$site_hash    = hash( 'sha256', (string) $site_route['key'] );
		$visitor_table = self::visitor_table();

		if ( false === $wpdb->query( 'START TRANSACTION' ) ) {
			return self::storage_error();
		}

		$route_inserted = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$visitor_table} (stat_date,visitor_hash,route_hash,first_seen_at,last_seen_at,last_counted_at,qualified_views) VALUES (%s,%s,%s,%s,%s,%s,1)",
				$today,
				$visitor_hash,
				$route_hash,
				$now,
				$now,
				$now
			)
		);
		if ( false === $route_inserted ) {
			$wpdb->query( 'ROLLBACK' );
			return self::storage_error();
		}

		$route_unique = 1 === (int) $route_inserted;
		$counted      = $route_unique;
		if ( ! $route_unique ) {
			$route_updated = $wpdb->query(
				$wpdb->prepare(
					"UPDATE {$visitor_table} SET last_seen_at=%s,last_counted_at=%s,qualified_views=qualified_views+1 WHERE stat_date=%s AND visitor_hash=%s AND route_hash=%s AND last_counted_at < %s",
					$now,
					$now,
					$today,
					$visitor_hash,
					$route_hash,
					$cutoff
				)
			);
			if ( false === $route_updated ) {
				$wpdb->query( 'ROLLBACK' );
				return self::storage_error();
			}
			$counted = 1 === (int) $route_updated;
		}

		$site_unique = false;
		if ( $counted ) {
			$site_inserted = $wpdb->query(
				$wpdb->prepare(
					"INSERT IGNORE INTO {$visitor_table} (stat_date,visitor_hash,route_hash,first_seen_at,last_seen_at,last_counted_at,qualified_views) VALUES (%s,%s,%s,%s,%s,%s,1)",
					$today,
					$visitor_hash,
					$site_hash,
					$now,
					$now,
					$now
				)
			);
			if ( false === $site_inserted ) {
				$wpdb->query( 'ROLLBACK' );
				return self::storage_error();
			}
			$site_unique = 1 === (int) $site_inserted;
			if ( ! $site_unique ) {
				$site_updated = $wpdb->query(
					$wpdb->prepare(
						"UPDATE {$visitor_table} SET last_seen_at=%s,last_counted_at=%s,qualified_views=qualified_views+1 WHERE stat_date=%s AND visitor_hash=%s AND route_hash=%s",
						$now,
						$now,
						$today,
						$visitor_hash,
						$site_hash
					)
				);
				if ( false === $site_updated ) {
					$wpdb->query( 'ROLLBACK' );
					return self::storage_error();
				}
			}

			if ( ! self::increment_daily_route( $route, $route_hash, $today, $now, $route_unique ? 1 : 0 )
				|| ! self::increment_daily_route( $site_route, $site_hash, $today, $now, $site_unique ? 1 : 0 ) ) {
				$wpdb->query( 'ROLLBACK' );
				return self::storage_error();
			}

			$realtime = $wpdb->query(
				$wpdb->prepare(
					'INSERT INTO ' . self::realtime_table() . ' (visitor_hash,route_hash,viewed_at) VALUES (%s,%s,%s)',
					$visitor_hash,
					$route_hash,
					$now
				)
			);
			if ( false === $realtime ) {
				$wpdb->query( 'ROLLBACK' );
				return self::storage_error();
			}
		}

		if ( false === $wpdb->query( 'COMMIT' ) ) {
			return self::storage_error();
		}

		return array(
			'counted'       => $counted,
			'routeVisitor'  => $route_unique,
			'dailyVisitor'  => $site_unique,
		);
	}

	/** Upsert one route and its daily unique-visitor delta. */
	private static function increment_daily_route( array $route, string $route_hash, string $today, string $now, int $visitor_delta ): bool {
		global $wpdb;
		$sql = 'INSERT INTO ' . self::daily_table() . ' (stat_date,route_hash,route_key,route_type,object_id,route_path,route_title,views,visitors,updated_at) '
			. 'VALUES (%s,%s,%s,%s,%d,%s,%s,1,%d,%s) '
			. 'ON DUPLICATE KEY UPDATE route_key=VALUES(route_key),route_type=VALUES(route_type),object_id=VALUES(object_id),route_path=VALUES(route_path),route_title=VALUES(route_title),views=views+1,visitors=visitors+VALUES(visitors),updated_at=VALUES(updated_at)';
		$result = $wpdb->query(
			$wpdb->prepare(
				$sql,
				$today,
				$route_hash,
				$route['key'],
				$route['type'],
				(int) $route['object_id'],
				$route['path'],
				$route['title'],
				$visitor_delta,
				$now
			)
		);
		return false !== $result;
	}

	/** Return a generic storage error without leaking database details. */
	private static function storage_error(): \WP_Error {
		return new \WP_Error( 'wp_seen_posts_analytics_storage', __( 'Analytics could not be stored right now.', 'wp-seen-posts' ), array( 'status' => 500 ) );
	}

	/** Reject explicit cross-origin beacons while tolerating stripped headers. */
	private static function request_is_same_site(): bool {
		$source = '';
		if ( ! empty( $_SERVER['HTTP_ORIGIN'] ) ) {
			$source = esc_url_raw( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) );
		} elseif ( ! empty( $_SERVER['HTTP_REFERER'] ) ) {
			$source = esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) );
		}
		if ( ! $source ) {
			return true;
		}
		return strtolower( (string) wp_parse_url( $source, PHP_URL_HOST ) ) === strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) );
	}

	/** Exclude ordinary crawlers without changing crawlable HTML. */
	private static function is_obvious_bot(): bool {
		$user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$is_bot     = '' !== $user_agent && (bool) preg_match( '/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|lighthouse|pagespeed/i', $user_agent );
		return (bool) apply_filters( 'wp_seen_posts_analytics_is_bot', $is_bot, $user_agent );
	}

	/** Add a dedicated first-party analytics admin destination. */
	public static function register_admin_page(): void {
		self::$admin_hook = add_menu_page(
			__( 'Seen Analytics', 'wp-seen-posts' ),
			__( 'Seen Analytics', 'wp-seen-posts' ),
			'manage_options',
			'wp-seen-posts-analytics',
			array( self::class, 'render_admin_page' ),
			'dashicons-chart-area',
			58
		);
	}

	/** Load small responsive dashboard styles only on this plugin page. */
	public static function enqueue_admin_assets( string $hook ): void {
		if ( ! self::$admin_hook || self::$admin_hook !== $hook ) {
			return;
		}
		wp_enqueue_style(
			'wp-seen-posts-analytics-admin',
			plugins_url( 'assets/css/analytics-admin.css', dirname( __DIR__ ) . '/wp-seen-posts.php' ),
			array(),
			VERSION
		);
	}

	/** Render the standalone views/visitors report. */
	public static function render_admin_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$days = isset( $_GET['range'] ) ? absint( wp_unslash( $_GET['range'] ) ) : 7;
		$days = in_array( $days, array( 1, 7, 30 ), true ) ? $days : 7;
		$data = self::dashboard_data( $days );
		$max_daily = 1;
		foreach ( $data['daily'] as $row ) {
			$max_daily = max( $max_daily, (int) $row['views'] );
		}
		?>
		<div class="wrap wp-seen-analytics">
			<div class="wp-seen-analytics__header">
				<div>
					<h1><?php esc_html_e( 'Seen Analytics', 'wp-seen-posts' ); ?></h1>
					<p><?php esc_html_e( 'First-party views and anonymous visitors across posts, the homepage, archives, categories, and tags.', 'wp-seen-posts' ); ?></p>
				</div>
				<nav class="wp-seen-analytics__ranges" aria-label="<?php esc_attr_e( 'Report range', 'wp-seen-posts' ); ?>">
					<?php foreach ( array( 1 => __( 'Today', 'wp-seen-posts' ), 7 => __( '7 days', 'wp-seen-posts' ), 30 => __( '30 days', 'wp-seen-posts' ) ) as $range => $label ) : ?>
						<a class="<?php echo $days === $range ? 'is-current' : ''; ?>" href="<?php echo esc_url( add_query_arg( array( 'page' => 'wp-seen-posts-analytics', 'range' => $range ), admin_url( 'admin.php' ) ) ); ?>"<?php echo $days === $range ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $label ); ?></a>
					<?php endforeach; ?>
				</nav>
			</div>

			<div class="wp-seen-analytics__metrics">
				<?php self::metric_card( __( 'Views', 'wp-seen-posts' ), $data['views'], __( 'Qualified page loads', 'wp-seen-posts' ) ); ?>
				<?php self::metric_card( __( 'Visitors', 'wp-seen-posts' ), $data['visitors'], __( 'Unique anonymous browsers', 'wp-seen-posts' ) ); ?>
				<?php self::metric_card( __( 'Views per visitor', 'wp-seen-posts' ), $data['visitors'] ? number_format_i18n( $data['views'] / $data['visitors'], 1 ) : '0', __( 'Across the selected range', 'wp-seen-posts' ), false ); ?>
				<?php self::metric_card( __( 'Live — last hour', 'wp-seen-posts' ), $data['live_views'], sprintf( _n( '%s active visitor', '%s active visitors', $data['live_visitors'], 'wp-seen-posts' ), number_format_i18n( $data['live_visitors'] ) ) ); ?>
			</div>

			<section class="wp-seen-analytics__panel">
				<h2><?php esc_html_e( 'Views and visitors by day', 'wp-seen-posts' ); ?></h2>
				<div class="wp-seen-analytics__chart" role="img" aria-label="<?php esc_attr_e( 'Daily views chart', 'wp-seen-posts' ); ?>">
					<?php foreach ( $data['daily'] as $row ) : ?>
						<div class="wp-seen-analytics__bar-row" title="<?php echo esc_attr( sprintf( __( '%1$s: %2$s views, %3$s visitors', 'wp-seen-posts' ), $row['date_label'], number_format_i18n( $row['views'] ), number_format_i18n( $row['visitors'] ) ) ); ?>">
							<time datetime="<?php echo esc_attr( $row['stat_date'] ); ?>"><?php echo esc_html( $row['date_label'] ); ?></time>
							<div class="wp-seen-analytics__bar-track"><span style="width:<?php echo esc_attr( max( 2, round( ( $row['views'] / $max_daily ) * 100, 1 ) ) ); ?>%"></span></div>
							<strong><?php echo esc_html( number_format_i18n( $row['views'] ) ); ?></strong>
							<small><?php echo esc_html( sprintf( _n( '%s visitor', '%s visitors', $row['visitors'], 'wp-seen-posts' ), number_format_i18n( $row['visitors'] ) ) ); ?></small>
						</div>
					<?php endforeach; ?>
				</div>
			</section>

			<div class="wp-seen-analytics__columns">
				<section class="wp-seen-analytics__panel">
					<h2><?php esc_html_e( 'Top destinations', 'wp-seen-posts' ); ?></h2>
					<div class="wp-seen-analytics__table-wrap">
						<table class="widefat striped">
							<thead><tr><th><?php esc_html_e( 'Destination', 'wp-seen-posts' ); ?></th><th><?php esc_html_e( 'Type', 'wp-seen-posts' ); ?></th><th><?php esc_html_e( 'Views', 'wp-seen-posts' ); ?></th><th><?php esc_html_e( 'Visitors', 'wp-seen-posts' ); ?></th></tr></thead>
							<tbody>
							<?php if ( ! $data['top_routes'] ) : ?>
								<tr><td colspan="4"><?php esc_html_e( 'Analytics is ready and waiting for qualified visits.', 'wp-seen-posts' ); ?></td></tr>
							<?php else : foreach ( $data['top_routes'] as $row ) : ?>
								<tr>
									<td><?php if ( $row['route_path'] ) : ?><a href="<?php echo esc_url( $row['route_path'] ); ?>"><?php echo esc_html( $row['route_title'] ); ?></a><?php else : echo esc_html( $row['route_title'] ); endif; ?></td>
									<td><?php echo esc_html( self::type_label( $row['route_type'] ) ); ?></td>
									<td><?php echo esc_html( number_format_i18n( $row['views'] ) ); ?></td>
									<td><?php echo esc_html( number_format_i18n( $row['visitors'] ) ); ?></td>
								</tr>
							<?php endforeach; endif; ?>
							</tbody>
						</table>
					</div>
				</section>

				<section class="wp-seen-analytics__panel">
					<h2><?php esc_html_e( 'Traffic by page type', 'wp-seen-posts' ); ?></h2>
					<ul class="wp-seen-analytics__types">
						<?php if ( ! $data['types'] ) : ?><li><?php esc_html_e( 'No page-type data yet.', 'wp-seen-posts' ); ?></li><?php endif; ?>
						<?php foreach ( $data['types'] as $row ) : ?>
							<li><span><?php echo esc_html( self::type_label( $row['route_type'] ) ); ?></span><strong><?php echo esc_html( number_format_i18n( $row['views'] ) ); ?></strong><small><?php echo esc_html( sprintf( _n( '%s visitor', '%s visitors', $row['visitors'], 'wp-seen-posts' ), number_format_i18n( $row['visitors'] ) ) ); ?></small></li>
						<?php endforeach; ?>
					</ul>
				</section>
			</div>

			<p class="wp-seen-analytics__privacy"><strong><?php esc_html_e( 'Privacy and counting:', 'wp-seen-posts' ); ?></strong> <?php esc_html_e( 'No IP addresses, search terms, or Seen history are stored. Reloads inside the deduplication window do not create another view. Visitor-level rows are automatically pruned while daily aggregates remain bounded. Reports begin collecting with this version; historical Seen totals are not imported because they are a different measurement.', 'wp-seen-posts' ); ?></p>
		</div>
		<?php
	}

	/** Render a report metric card. */
	private static function metric_card( string $label, $value, string $help, bool $format = true ): void {
		$display = $format && is_numeric( $value ) ? number_format_i18n( (float) $value ) : (string) $value;
		?>
		<div class="wp-seen-analytics__metric"><span><?php echo esc_html( $label ); ?></span><strong><?php echo esc_html( $display ); ?></strong><small><?php echo esc_html( $help ); ?></small></div>
		<?php
	}

	/**
	 * Return range metrics, daily rows, top routes, and page-type totals.
	 *
	 * @return array<string,mixed>
	 */
	public static function dashboard_data( int $days ): array {
		global $wpdb;
		$days      = in_array( $days, array( 1, 7, 30 ), true ) ? $days : 7;
		$end       = current_datetime()->format( 'Y-m-d' );
		$start     = current_datetime()->modify( '-' . ( $days - 1 ) . ' days' )->format( 'Y-m-d' );
		$site_hash = hash( 'sha256', 'site' );
		$daily     = array();

		$site_rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT stat_date,views,visitors FROM ' . self::daily_table() . ' WHERE route_hash=%s AND stat_date >= %s AND stat_date <= %s ORDER BY stat_date ASC',
				$site_hash,
				$start,
				$end
			),
			ARRAY_A
		);
		$site_by_date = array();
		foreach ( (array) $site_rows as $row ) {
			$site_by_date[ (string) $row['stat_date'] ] = $row;
		}
		$cursor = current_datetime()->modify( '-' . ( $days - 1 ) . ' days' );
		for ( $offset = 0; $offset < $days; $offset++ ) {
			$date = $cursor->modify( '+' . $offset . ' days' )->format( 'Y-m-d' );
			$row  = $site_by_date[ $date ] ?? array();
			$daily[] = array(
				'stat_date'  => $date,
				'date_label' => 1 === $days ? __( 'Today', 'wp-seen-posts' ) : wp_date( $days <= 7 ? 'D' : 'M j', strtotime( $date ) ),
				'views'      => isset( $row['views'] ) ? (int) $row['views'] : 0,
				'visitors'   => isset( $row['visitors'] ) ? (int) $row['visitors'] : 0,
			);
		}

		$views = array_sum( array_column( $daily, 'views' ) );
		$visitors = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(DISTINCT visitor_hash) FROM ' . self::visitor_table() . ' WHERE route_hash=%s AND stat_date >= %s AND stat_date <= %s',
				$site_hash,
				$start,
				$end
			)
		);

		$top_routes = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT route_hash,MAX(route_type) AS route_type,MAX(route_path) AS route_path,MAX(route_title) AS route_title,SUM(views) AS views,SUM(visitors) AS daily_visitors FROM ' . self::daily_table() . ' WHERE route_hash<>%s AND stat_date >= %s AND stat_date <= %s GROUP BY route_hash ORDER BY views DESC LIMIT 25',
				$site_hash,
				$start,
				$end
			),
			ARRAY_A
		);
		$route_visitors = array();
		if ( $top_routes ) {
			$hashes       = array_column( $top_routes, 'route_hash' );
			$placeholders = implode( ',', array_fill( 0, count( $hashes ), '%s' ) );
			$args         = array_merge( array( $start, $end ), $hashes );
			$sql          = $wpdb->prepare(
				'SELECT route_hash,COUNT(DISTINCT visitor_hash) AS visitors FROM ' . self::visitor_table() . " WHERE stat_date >= %s AND stat_date <= %s AND route_hash IN ({$placeholders}) GROUP BY route_hash",
				$args
			);
			foreach ( (array) $wpdb->get_results( $sql, ARRAY_A ) as $row ) {
				$route_visitors[ (string) $row['route_hash'] ] = (int) $row['visitors'];
			}
		}
		foreach ( $top_routes as &$row ) {
			$row['views']    = (int) $row['views'];
			$row['visitors'] = $route_visitors[ (string) $row['route_hash'] ] ?? 0;
		}
		unset( $row );

		$types = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT route_type,SUM(views) AS views FROM ' . self::daily_table() . ' WHERE route_hash<>%s AND stat_date >= %s AND stat_date <= %s GROUP BY route_type ORDER BY views DESC',
				$site_hash,
				$start,
				$end
			),
			ARRAY_A
		);
		$type_visitors   = array();
		$type_visitor_sql = 'SELECT routes.route_type,COUNT(DISTINCT visits.visitor_hash) AS visitors FROM ' . self::visitor_table() . ' visits '
			. 'INNER JOIN (SELECT route_hash,MAX(route_type) AS route_type FROM ' . self::daily_table() . ' WHERE route_hash<>%s AND stat_date >= %s AND stat_date <= %s GROUP BY route_hash) routes ON routes.route_hash=visits.route_hash '
			. 'WHERE visits.stat_date >= %s AND visits.stat_date <= %s GROUP BY routes.route_type';
		foreach (
			(array) $wpdb->get_results(
				$wpdb->prepare( $type_visitor_sql, $site_hash, $start, $end, $start, $end ),
				ARRAY_A
			) as $row
		) {
			$type_visitors[ (string) $row['route_type'] ] = (int) $row['visitors'];
		}
		foreach ( $types as &$row ) {
			$row['views']    = (int) $row['views'];
			$row['visitors'] = $type_visitors[ (string) $row['route_type'] ] ?? 0;
		}
		unset( $row );

		$live_cutoff = current_datetime()->modify( '-1 hour' )->format( 'Y-m-d H:i:s' );
		$live_row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT COUNT(*) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM ' . self::realtime_table() . ' WHERE viewed_at >= %s',
				$live_cutoff
			),
			ARRAY_A
		);

		return array(
			'views'         => (int) $views,
			'visitors'      => $visitors,
			'live_views'    => isset( $live_row['views'] ) ? (int) $live_row['views'] : 0,
			'live_visitors' => isset( $live_row['visitors'] ) ? (int) $live_row['visitors'] : 0,
			'daily'         => $daily,
			'top_routes'    => $top_routes,
			'types'         => $types,
		);
	}

	/** Human-readable route type for the reports. */
	public static function type_label( string $type ): string {
		$labels = array(
			'site'              => __( 'Entire site', 'wp-seen-posts' ),
			'home'              => __( 'Homepage', 'wp-seen-posts' ),
			'post'              => __( 'Post', 'wp-seen-posts' ),
			'page'              => __( 'Page', 'wp-seen-posts' ),
			'singular'          => __( 'Content', 'wp-seen-posts' ),
			'tag'               => __( 'Tag', 'wp-seen-posts' ),
			'category'          => __( 'Category', 'wp-seen-posts' ),
			'taxonomy'          => __( 'Taxonomy', 'wp-seen-posts' ),
			'author'            => __( 'Author archive', 'wp-seen-posts' ),
			'date'              => __( 'Date archive', 'wp-seen-posts' ),
			'post_type_archive' => __( 'Post type archive', 'wp-seen-posts' ),
			'search'            => __( 'Search', 'wp-seen-posts' ),
			'not_found'         => __( 'Not found', 'wp-seen-posts' ),
			'archive'           => __( 'Archive', 'wp-seen-posts' ),
		);
		return $labels[ $type ] ?? __( 'Other', 'wp-seen-posts' );
	}

	/** Aggregate route used for exact site-level daily totals and visitors. */
	private static function site_route(): array {
		return array(
			'key'       => 'site',
			'type'      => 'site',
			'object_id' => 0,
			'path'      => home_url( '/' ),
			'title'     => __( 'Entire site', 'wp-seen-posts' ),
		);
	}

	private static function daily_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_analytics_daily';
	}

	private static function visitor_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_analytics_visitors';
	}

	private static function realtime_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'hmv_analytics_realtime';
	}
}
