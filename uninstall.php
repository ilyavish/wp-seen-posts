<?php
/**
 * Remove only configuration options. Browser-local history and aggregate Seen data remain intact.
 * Historical tables are deliberately retained so uninstall/reinstall cannot erase social counts.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'wp_seen_posts_selectors' );
delete_option( 'wp_seen_posts_schema_version' );
delete_option( 'wp_seen_posts_gamification_schema_version' );
delete_transient( 'wp_seen_posts_badge_stats_v1' );
wp_clear_scheduled_hook( 'wp_seen_posts_prune_daily' );
