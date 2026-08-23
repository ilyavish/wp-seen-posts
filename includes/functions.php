<?php
/**
 * Public streak display helpers.
 *
 * @package WP_Seen_Posts
 */

namespace HoldMyVodka\SeenPosts {
	if ( ! defined( 'ABSPATH' ) ) {
		exit;
	}

	/** Return a client-hydrated streak placeholder without exposing local state. */
	function get_streak_display(): string {
		if ( ! Settings::streaks_enabled() ) {
			return '';
		}
		enqueue_gamification_assets();
		$html = '<span class="wp-seen-posts-streak" data-wp-seen-streak role="status" aria-live="polite" hidden></span>';
		/** Filters the compact streak placeholder markup. */
		return (string) apply_filters( 'wp_seen_posts_streak_display', $html );
	}

	/** Render [seen_unseen_streak] and its wp_seen_posts_streak alias. */
	function streak_shortcode(): string {
		return get_streak_display();
	}
}

namespace {
	/** Theme-template helper retained under the feature name requested by the site. */
	function seen_unseen_get_streak_display(): string {
		return \HoldMyVodka\SeenPosts\get_streak_display();
	}
}
