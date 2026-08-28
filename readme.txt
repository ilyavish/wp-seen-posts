=== WP Seen Posts ===
Contributors: ilyavish
Tags: seen posts, unread, popular posts, analytics, p2
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.3.5
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Tracks posts viewed in archive feeds and hides previously seen posts on later visits.

== Description ==

WP Seen Posts adds Reddit-style read/unread behavior to normal WordPress feeds without changing server queries or page caching.

* Marks a post Seen after 50% remains visible for 1,000 milliseconds.
* Adapts the visibility measurement for posts taller than the viewport.
* Keeps newly Seen posts visible for the rest of the current page session to prevent scroll-time layout shifts.
* Shows one compact caught-up status only when no more archive pages remain.
* Warms up to six fully Seen archive pages in one bounded parallel batch, while the companion infinite-scroll control still inserts them in order.
* Resumes automatic unseen discovery when a temporarily disabled loader settles, without flashing Load More or intermediate status text between pages.
* Keeps two recent Seen cards visible as a stable preview if a reload would otherwise look empty.
* Shows “Finding unseen posts…” only when background loading behind that preview takes longer than 1,500 milliseconds.
* Uses one subtle bottom-right eye/count per card: gray for personally Unseen and fully opaque for Seen.
* Hides previously Seen posts on the next page load.
* Records individual blog posts as Seen after a one-second visible visit, then keeps only the eye total across from Like and pageviews; WordPress pages are not tracked.
* Displays a lightweight public lifetime Seen counter with an inline eye icon on feed and single-post views.
* Updates the visible total immediately, batches newly Seen post IDs into small anonymous REST writes, and reconciles to the confirmed total.
* Keeps a separate fixed-size anonymous browser ledger so repeat visits never increment the same post after personal Seen history is reset or pruned.
* Stores only lifetime and site-local daily aggregates, with no visitor profiles or raw view events.
* Retains 400 days of indexed daily aggregates for ranking and trends, then prunes older daily buckets without changing lifetime totals.
* Adds a Jetpack-style Top Seen Posts widget with Today, Last 7 Days, and Last 30 Days rankings plus text, image-list, and image-grid layouts.
* Keeps the widget's objective weekly ranking while its fire marker skips the two newest posts, requires five weekly Seen visitors, and highlights up to seven older weekly leaders.
* Normalizes WordPress-replaced fire emoji artwork to a square 20×20 px box across themes and devices.
* Shows five locally bundled achievements: Beer, Vodka, Gopnik, and Black BMW at 5, 10, 50, and 100 unique Seen posts, plus the optional 4-Day Zapoi streak badge.
* Keeps future badges visibly grayed out in the top badge shelf as an unlock roadmap; post cards and single posts stay uncluttered.
* Explains badges on hover, keyboard focus, and mobile tap, with descriptive image text and a short reduced-motion-safe unlock celebration.
* Completes one daily reading streak day after three unique lifetime Seen registrations by default, using the WordPress site timezone and a bounded browser-local state.
* Unlocks the optional Zapoi badge once after a four-day streak and keeps its animation consistent with existing achievements.
* Shows an optional compact streak/progress chip and provides `[seen_unseen_streak]` plus a template helper.
* Adds privacy-safe cached badge rarity after a configurable minimum sample, without scanning reader rows during page rendering.
* Adds a Streaks & Rarity section under Settings > Seen Posts.
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
4. Optionally add **Top Seen Posts** under Appearance > Widgets. Add multiple instances for Today, Last 7 Days, and Last 30 Days.

== Integration ==

Infinite-scroll implementations may dispatch this event after appending posts:

`document.dispatchEvent(new CustomEvent('wpFeedPostsAdded', { detail: { container: feedContainer, posts: addedPosts, sourceUrl: loadedUrl } }));`

The supplied `posts` collection is initialized directly; the existing feed is not rescanned.

== Changelog ==

= 1.3.5 =
* Restores one bounded six-page parallel warm-up so 30–60 previously Seen posts do not create multiple serial network waves.
* Retains the loader-state observer and duplicate-click guard added in 1.3.4, so parallel speed cannot reintroduce the stalled Load More state.
* Delays “Finding unseen posts…” to 1.5 seconds, keeping normal warm loads quiet while preserving feedback on genuinely slow connections.

= 1.3.4 =
* Replaces burst archive prefetching with a two-request warm-up pipeline, reducing server contention while preserving exact page order.
* Keeps unseen discovery active while the companion loader is temporarily disabled and resumes immediately when its controls settle.
* Replaces the flashing Load More and intermediate status with one fixed “Finding unseen posts…” indicator, while retaining the loader's manual failure fallback.

= 1.3.3 =
* Keeps Top Seen ranking based on the selected Today, 7-day, or 30-day period while displaying the same lifetime eye total as the destination article.
* Labels the widget's ranking period visibly and reconciles cached widget totals through the existing read-only batch, preventing stale sidebar/article mismatches.

= 1.3.2 =
* Reconciles cached page totals with one delayed read-only batch so newly registered views appear after reload even while a full-page cache still contains an older count.
* Keeps the cached total available for immediate paint and prevents the reconciliation from incrementing analytics or overwriting an in-flight Seen registration.

= 1.3.1 =
* Retires the Barsetka milestone and removes its old browser and aggregate state, keeping the shelf to five badges.
* Replaces Zapoi with the supplied transparent, locally optimized artwork while retaining versioned browser caching and the existing unlock animation.

= 1.3.0 =
* Adds configurable daily reading streaks, longest-streak tracking, optional partial progress, and WordPress-timezone calendar handling.
* Adds the 4-Day Zapoi achievement with locally cached artwork and the existing reduced-motion-safe unlock animation.
* Adds privacy-safe badge rarity using one salted anonymous-reader row, bounded badge keys, tiny aggregate counters, and a five-minute cache.
* Ensures reloads, Show/Hide, returning to a post, and Reset Seen history cannot advance streaks or rarity twice because qualification reuses the fixed-size lifetime ledger.
* Adds `[seen_unseen_streak]`, `[wp_seen_posts_streak]`, `seen_unseen_get_streak_display()`, and extensibility hooks for future achievements.

= 1.2.4 =
* Makes the fire marker a discovery signal by excluding the two newest posts and requiring at least five weekly Seen visitors before awarding it.
* Keeps the Top Seen widget's true weekly ranking unchanged and uses the clearer accessible label “Hot this week.”
* Prevents WordPress emoji replacement from making the fire look compressed by enforcing a square 20×20 px presentation.

= 1.2.3 =
* Restores the feed and archive fire/eye/count group to the subtle bottom-right card position instead of placing it inline with WP ULike.
* Leaves the single-post eye/count in its existing metadata action row.

= 1.2.2 =
* Removes serial archive-network waits for returning visitors by warming up to six same-origin pages in parallel when the loaded feed is entirely Seen.
* Preserves the companion loader's exact page order and parsing path, and falls back to its normal request if any warmed response fails.
* Avoids warm-up traffic whenever an Unseen card is already visible and keeps the stable two-card preview throughout the search.

= 1.2.1 =
* Adds an accessible fire indicator for posts currently ranked in the Top 7 over the last seven site-local days.
* Aligns the fire/eye/count group with WP ULike voting on feeds and archives, matching the existing single-post action row.
* Shares one cached ten-row weekly ranking between hot indicators and Top Seen widgets to avoid duplicate database work.

= 1.2.0 =
* Adds a Top Seen Posts widget powered by the plugin’s anonymous daily aggregates, with Today, Last 7 Days, and Last 30 Days ranges.
* Adds text-list, image-list, and responsive image-grid widget layouts, configurable titles, and 1–10 results.
* Caches ranking queries for five minutes and loads widget CSS only when an instance is active.
* Prevents a fast personal-history reset from bypassing the fixed-size lifetime public-count ledger.
* Verifies that Show/Hide never queues analytics and that Show Seen remains a temporary view after reload.

= 1.1.10 =
* Restores eye/count markup when a P2 auto-Read More renderer strips it after WordPress content filters have completed.
* Uses the already-prefetched page totals for immediate rendering and a read-only batched endpoint for affected infinite-scroll cards; the recovery request never increments analytics.

= 1.1.9 =
* Preloads the five small badge-roadmap images in the document head on feed views so private-window and other cold-cache visits do not discover them after footer JavaScript.
* Decodes the tiny shelf icons immediately while keeping milestone-toast image decoding asynchronous.

= 1.1.8 =
* Keeps the eye/count visible on P2 cards truncated by the automatic Read More renderer.
* Runs the guarded content and excerpt counter append after late truncation filters without duplicating counters on normal cards.

= 1.1.7 =
* Replaces the duplicate Seen word and per-post milestone image with one accessible eye/count state: muted for Unseen and fully opaque for Seen.
* Keeps the badge roadmap and short milestone unlock animation while removing badge panels from feed cards and single posts.
* Moves the single-post eye/count into the Like/pageviews row immediately, before the one-second Seen dwell completes.
* Repaints an incremented count before encoding the lifetime deduplication ledger, coalesces ledger writes, and forces pending persistence on page exit.
* Verifies overflow-free desktop, tablet, and 390-pixel mobile layouts.

= 1.1.6 =
* Adds a fixed-size anonymous browser ledger that prevents lifetime repeat increments even after personal Seen history is reset, expires, or reaches its size limit.
* Migrates existing local Seen history into the ledger without retroactively submitting old posts.
* Bounds historical database growth with a daily indexed cleanup of aggregate buckets older than 400 site-local days; lifetime totals remain permanent.

= 1.1.5 =
* Keeps all milestones visible in the top badge shelf, with locked badges muted in grayscale and earned badges in full color.
* Explains each locked badge's post requirement on hover, keyboard focus, or mobile tap without adding locked badges to posts.

= 1.1.4 =
* Uses the WordPress Dashicons visibility eye associated with Post Views Counter while keeping it inline and request-free.
* Restyles Seen counters and badge surfaces with quiet neutral backgrounds, lighter borders, and minimal shadows.

= 1.1.3 =
* Anchors the single-post Seen panel directly across from the Like control, even when no separate views metadata row exists.
* Keeps the Like/Seen action row before Jetpack's end-of-post subscription block.

= 1.1.2 =
* Groups the public eye total beside the personal Seen badge in one bottom-right status pill.
* Updates the visible total immediately at the local Seen transition, then reconciles it with the confirmed server total.
* Shortens the micro-batch window to 100 milliseconds while retaining duplicate-ID batching.

= 1.1.1 =
* Forces a clean schema check and fresh asset URLs when replacing an unrelated or cached 1.1.0 installation.

= 1.1.0 =
* Adds an accessible public lifetime Seen counter using a lightweight inline eye icon.
* Adds atomic batched lifetime and site-timezone daily aggregate storage for future ranking features.
* Integrates public increments only with new local Unseen-to-Seen transitions on feeds, infinite-scroll posts, and direct post views.
* Keeps cached pages compatible by server-rendering counts in one batched read and updating only confirmed new counts in the browser.

= 1.0.22 =
* Prevents newly loaded posts from disappearing after a visitor closes Show seen; only posts already Seen at that tap are hidden.

= 1.0.21 =
* Merges each feed write with the newest stored history so direct posts recorded in another tab are not lost.
* Validates retention and size limits in the head bootstrap before any post is hidden.
* Keeps Seen controls at a true 44-pixel touch target under P2 Resurrected's button styles.

= 1.0.20 =
* Adds a delayed “Finding unseen posts…” status while the stable two-card preview remains visible.
* Uses a fixed, non-interactive status pill so appearing and disappearing cannot shift the feed.

= 1.0.19 =
* Replaces every milestone image with the new lightweight pixel-art badge set.
* Replaces the 20-post Tracksuit milestone with the Barsetka waist bag, including its explanation and unlock animation.

= 1.0.18 =
* Replaces all milestone artwork with redesigned, locally optimized and versioned badge assets for fast cached loading.
* Adds an animated Black BMW milestone at 100 unique Seen posts.

= 1.0.17 =
* Recognizes Hold My Vodka's live `.stats_counter.sd-content` views row so single-post Seen feedback sits across from the view count instead of after the newsletter block.

= 1.0.16 =
* Keeps badge explanations visible inside overflow-clipped P2 layouts and removes Safari's duplicate native title tooltip.

= 1.0.15 =
* Places single-post Seen feedback inside the post-content metadata row, aligned right across from likes and pageviews and before comments.

= 1.0.14 =
* Replaces the dark badge capsule with a light, playful shelf aligned to the right of the left-aligned feed buttons.
* Keeps Seen visible beside milestone artwork on feed cards.
* Shows Seen and accumulated earned badges on directly opened single posts, while continuing to exclude pages.
* Adds hover, focus, and tap explanations plus descriptive badge image text.
* Adds a short, lightweight milestone unlock animation and explanatory toast with reduced-motion support.
* Updates the beer, tracksuit, and gopnik artwork.

= 1.0.13 =
* Records directly opened single posts as Seen after one visible second, without tracking pages.
* Adds cumulative beer, vodka, tracksuit, and gopnik milestones at 5, 10, 20, and 50 Seen posts.
* Uses the highest earned milestone image instead of the Seen word on post cards.
* Bundles optimized badge artwork locally and improves the Reset history button affordance.

= 1.0.12 =
* Reserves the two-card all-Seen preview during HTML parsing instead of waiting for the footer engine.
* Cancels the early preview automatically when the initial feed contains an unseen card.

= 1.0.11 =
* Reuses the history already parsed by the early reload bootstrap instead of parsing localStorage twice.
* Removes duplicate pruning, unnecessary sorting, and the synchronous no-change storage rewrite from reloads.

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
