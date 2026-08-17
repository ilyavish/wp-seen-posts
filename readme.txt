=== WP Seen Posts ===
Contributors: ilyavish
Tags: seen posts, unread, feed, p2, infinite scroll
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.10
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Tracks posts viewed in archive feeds and hides previously seen posts on later visits.

== Description ==

WP Seen Posts adds Reddit-style read/unread behavior to normal WordPress feeds without changing server queries or page caching.

* Marks a post Seen after 50% remains visible for 1,000 milliseconds.
* Adapts the visibility measurement for posts taller than the viewport.
* Keeps newly Seen posts visible for the rest of the current page session to prevent scroll-time layout shifts.
* Shows one compact caught-up status only when no more archive pages remain.
* Automatically skips fully Seen pages through the companion infinite-scroll control.
* Keeps two recent Seen cards visible as a stable preview if a reload would otherwise look empty.
* Places the Seen label in the bottom-right corner of each post card.
* Hides previously Seen posts on the next page load.
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

= 1.0.10 =
* Keeps two recent Seen cards visible when a reload would otherwise show an empty feed.
* Continues loading unseen pages behind that stable preview without removing the preview mid-session.

= 1.0.9 =
* Shows an immediate loading state while all-Seen archive pages are skipped, removing unexplained blank-feed waits.
* Replaces the loading state as soon as unseen content arrives or pagination is exhausted.

= 1.0.8 =
* Pre-hides stored Seen posts during HTML parsing so reloads do not briefly paint the old feed.
* Hands the early state to the full engine synchronously and safely releases it if feed detection fails.

= 1.0.7 =
* Speeds up large feeds with constant-time Seen/hidden counters and batched initial UI updates.
* Coalesces history persistence and defers badges for already-hidden posts to reduce synchronous work.

= 1.0.6 =
* Reduces the continuous Seen dwell time from 1,500 to 1,000 milliseconds.

= 1.0.5 =
* Removes live post collapsing to eliminate desktop glitches and mobile stumbles while scrolling.
* Restores a 1,500 millisecond Seen dwell time; newly Seen posts remain visible until the next page load.

= 1.0.4 =
* Moves the Seen badge to the bottom-right corner of the post card.

= 1.0.3 =
* Prevents blank feeds by automatically advancing past pages whose posts are all already Seen.

= 1.0.2 =
* Removes the duplicate empty-state action and only shows a compact caught-up status after pagination is exhausted.

= 1.0.1 =
* Made Seen detection more responsive: 50% visibility for 750 milliseconds.
* Automatically collapses a newly Seen post after the visitor scrolls past it.
* Improves long-post handling and mobile touch targets.
* Stabilizes the mobile viewport while Seen posts collapse.
* Adds a two-post recent Seen buffer so the interaction feels deliberate rather than immediate.

= 1.0.0 =
* Initial release.
