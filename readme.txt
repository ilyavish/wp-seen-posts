=== WP Seen Posts ===
Contributors: ilyavish
Tags: seen posts, unread, feed, p2, infinite scroll
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Tracks posts viewed in archive feeds and hides previously seen posts on later visits.

== Description ==

WP Seen Posts adds Reddit-style read/unread behavior to normal WordPress feeds without changing server queries or page caching.

* Marks a post Seen after 60% remains visible for 1.5 seconds.
* Keeps posts visible when they become Seen during the current visit.
* Hides previously Seen posts on later page loads.
* Stores anonymous history only in localStorage, with age and size pruning.
* Supports P2 and P2 Resurrected automatically.
* Supports Query Loop blocks and conservative classic-theme markup.
* Consumes the `wpFeedPostsAdded` event emitted by WP Progressive Infinite Scroll.
* Includes optional feed and post selector overrides under Settings > Seen Posts.

It does not implement infinite scrolling, personalize WordPress queries, use cookies, or make per-post AJAX requests.

== Installation ==

1. Upload the `wp-seen-posts` directory to `/wp-content/plugins/`.
2. Activate WP Seen Posts.
3. P2 requires no configuration. For an unsupported theme, set selectors under Settings > Seen Posts.

== Integration ==

Infinite-scroll implementations may dispatch this event after appending posts:

`document.dispatchEvent(new CustomEvent('wpFeedPostsAdded', { detail: { container: feedContainer, posts: addedPosts, sourceUrl: loadedUrl } }));`

The supplied `posts` collection is initialized directly; the existing feed is not rescanned.

== Changelog ==

= 1.0.0 =
* Initial release.

