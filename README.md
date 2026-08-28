# WP Seen Posts

A lightweight WordPress plugin that gives archive feeds local Seen/Unseen state. It is built for P2 first, works with conservative standard WordPress markup, and integrates with the separate [WP Progressive Infinite Scroll](https://github.com/ilyavish/wp-progressive-infinite-scroll) plugin through its existing `wpFeedPostsAdded` event.

## Behavior

- A card becomes Seen after at least 50% is visible for 1,000 ms while the tab is visible.
- For a post taller than the viewport, half of the viewport qualifies so long posts remain usable on phones and tablets.
- A post that becomes Seen stays visible for the rest of the current page session, preventing scroll-time layout shifts.
- Closing Show seen hides only posts that are already Seen at that moment; newly loaded posts remain stable until another Hide tap or page reload.
- Seen/hidden totals use constant-time counters, and storage writes are coalesced and merged with newer tab history so large feeds remain responsive without losing direct-post visits.
- Reloads reuse the early bootstrap's parsed history and perform no synchronous no-change localStorage write.
- A tiny head bootstrap validates retention and size limits before pre-hiding stored Seen cards during parsing, preventing both a full-feed flash and transient hiding from expired history.
- On an all-Seen P2 or Query Loop page, that same bootstrap keeps the two-card preview visible before footer scripts run.
- A compact caught-up status appears only after pagination is genuinely exhausted; the toolbar remains the single reveal control.
- If a loaded page contains only previously Seen posts, up to six same-origin archive pages are warmed in one bounded parallel batch; the companion loader still parses and inserts them in exact order until unseen content or the true end is reached.
- Failed or unsupported warm-up requests fall back to the companion loader's normal fetch, and no warm-up runs while an Unseen card is already available.
- Automatic unseen discovery observes temporarily disabled infinite-scroll controls and resumes as soon as the loader settles, rather than stopping between pages.
- During automatic discovery, one fixed “Finding unseen posts…” status replaces the companion loader's flashing Load More and intermediate status text; a prominent loader failure still restores its manual Continue fallback.
- If a reload would otherwise contain no visible cards, two recent Seen cards remain as a stable preview while unseen pages load, avoiding both blank waits and live removal.
- If background search behind the stable preview takes longer than 1,500 ms, the same compact fixed status appears without changing the feed height; normal warm loads never flash it.
- Each card uses only one bottom-right eye/count: a quiet gray eye means personally Unseen, and the same eye becomes fully opaque when Seen. No duplicate Seen word or post-level badge artwork is rendered.
- The top badge shelf shows five achievements: the 5, 10, 50, and 100-post Beer, Vodka, Gopnik, and Black BMW roadmap plus the optional 4-Day Zapoi streak badge; locked badges are muted in grayscale and earned badges switch to full color.
- Three genuinely new lifetime Seen posts complete one calendar day by default. Consecutive completed site-timezone dates grow a vodka streak, a missed date resets only the current streak, and the longest streak remains local.
- The compact streak chip never displays a misleading zero; it shows either the current streak or optional same-day progress. Use `[seen_unseen_streak]` (alias `[wp_seen_posts_streak]`) or `seen_unseen_get_streak_display()` in a template.
- Completing a four-day streak unlocks Zapoi once with the existing lightweight badge animation and the supplied local artwork.
- Badge tooltips can show a cached “Unlocked by … of readers” rarity line after the configured minimum sample (20 by default).
- Badge images have descriptive alternative text. Desktop hover/focus and mobile taps show a custom explanation below the badge so P2 and Safari cannot clip it above the feed.
- A newly unlocked milestone gets one short badge-pop animation and a compact explanatory toast, with motion disabled when the visitor requests reduced motion.
- Pixel-art badge artwork is bundled locally at a maximum 96 px; the small roadmap images load once at the top and use versioned URLs for reliable long-lived browser caching.
- Feed and single-post pages preload the badge images from the document head, eliminating late discovery on private-window and other cold-cache visits.
- On the next page load, previously Seen cards start hidden and can be revealed; the two-card preview is used only when hiding everything would leave the feed empty.
- Individual blog posts opened directly are recorded after one visible second and show only the eye/count inside the detected metadata row, right-aligned across from Like and pageviews and before newsletters or comments; WordPress pages are never tracked by default.
- Every rendered post includes a small, accessible eye counter for its public lifetime Seen total and personal Seen/Unseen state. It updates immediately at the local Seen transition, then reconciles to the confirmed server total.
- Cached pages show their embedded total immediately, then reconcile all visible counters through one delayed read-only batch so a successful view never appears stuck at an older value after reload.
- If a theme replaces filtered content and strips that markup (including P2 auto Read More cards), the feed restores it from prefetched totals; later infinite-scroll exceptions share one read-only batch that cannot increment analytics.
- A new local Unseen-to-Seen transition queues its post ID for one anonymous batched REST increment; existing local history is never retroactively submitted.
- A separate fixed-size anonymous browser ledger remembers public increments after personal Seen history is reset or pruned. Its encoded storage remains about 22 KB regardless of how many pages are revisited.
- Public count storage uses one lifetime row per post and one daily row per active post/site-local date. Rarity adds one compact salted anonymous-browser hash row and tiny aggregate stat rows; it stores no IP addresses, user agents, referrers, raw identity tokens, or individual view events.
- Daily aggregate buckets are retained for 400 site-local days, supporting Today/Week/Month and year-over-year trend work; one indexed daily cleanup prunes older buckets while permanent lifetime totals remain unchanged.
- The bundled **Top Seen Posts** widget ranks published posts for Today, Last 7 Days, or Last 30 Days with text, image-list, or responsive image-grid layouts. Its visible eye uses the same reconciled lifetime total as the destination article, while a subtle label explains the selected ranking period. Multiple instances can show all three periods at once.
- The widget retains the objective weekly ranking. Its discovery-focused 🔥 marker skips the two newest posts, requires at least five Seen visitors during the week, and marks up to seven older weekly leaders on feeds, archives, and single-post action rows.
- WordPress-replaced fire emoji artwork is normalized to a square 20×20 px box so it stays aligned with the eye across themes and devices.
- Widget rankings use the WordPress site timezone, one indexed aggregate query cached for five minutes, server-rendered links/titles, and no visitor-level data.
- Resetting personal Seen history first commits the fixed-size lifetime ledger, including if reset is tapped before its normal idle migration, so it cannot make a prior visit count twice.
- Anonymous state is stored as `{ postId: unixTimestamp }` in `wp_seen_posts_v1`.
- Public-count deduplication is stored separately as a bounded probabilistic bitmap in `wp_seen_posts_counted_v1`; clearing site data or changing browser/device intentionally starts a new anonymous browser identity.
- History defaults to 365 days and 3,000 IDs. Use `WP_SEEN_POSTS_RETENTION_DAYS`, `WP_SEEN_POSTS_MAX_ENTRIES`, or their matching filters to change the limits.
- The server archive query remains untouched and cacheable. Cached HTML may show a slightly stale count until a visitor's own confirmed increment updates it.
- Full post markup remains server-rendered; hiding is a visitor-side interaction and does not remove content from the HTML response used by search engines.
- Achievement artwork is bundled locally and renders only in the top roadmap and short milestone-unlock toast.
- The visual counter updates before the fixed-size lifetime ledger is encoded and persisted; ledger writes are coalesced and forced on page exit.
- Feed controls retain 44 px touch targets even under P2 Resurrected's more specific button rules.

## Supported markup

- P2 / P2 Resurrected: `#postlist > li.post`, with `prologue-{ID}` or `post-{ID}`.
- Query Loop: one `.wp-block-post-template` containing direct `.wp-block-post` children.
- Classic themes: one unambiguous `.site-main`, `main`, `.posts`, or `.post-list` with direct post cards.
- Manual fallback: Settings > Seen Posts.

## Development

```bash
npm install
npm test
```

## Streak and rarity hooks

- `wp_seen_posts_streak_daily_requirement`
- `wp_seen_posts_rarity_minimum_readers`
- `wp_seen_posts_badge_rarity`
- `wp_seen_posts_achievement_badges`
- `wp_seen_posts_badge_unlocked`
- `wp_seen_posts_reader_registered`
- `wp_seen_posts_streak_display`

The browser also dispatches `wpSeenPostsStreakUpdated` and `wpSeenPostsRaritiesUpdated` events.
