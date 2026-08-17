# WP Seen Posts

A lightweight WordPress plugin that gives archive feeds local Seen/Unseen state. It is built for P2 first, works with conservative standard WordPress markup, and integrates with the separate [WP Progressive Infinite Scroll](https://github.com/ilyavish/wp-progressive-infinite-scroll) plugin through its existing `wpFeedPostsAdded` event.

## Behavior

- A card becomes Seen after at least 50% is visible for 1,000 ms while the tab is visible.
- For a post taller than the viewport, half of the viewport qualifies so long posts remain usable on phones and tablets.
- A post that becomes Seen stays visible for the rest of the current page session, preventing scroll-time layout shifts.
- Seen/hidden totals use constant-time counters, and storage writes are coalesced so large feeds remain responsive.
- Reloads reuse the early bootstrap's parsed history and perform no synchronous no-change localStorage write.
- A tiny head bootstrap pre-hides stored Seen cards during parsing, preventing a full-feed flash on reload.
- On an all-Seen P2 or Query Loop page, that same bootstrap keeps the two-card preview visible before footer scripts run.
- A compact caught-up status appears only after pagination is genuinely exhausted; the toolbar remains the single reveal control.
- If a loaded page contains only previously Seen posts, the companion Load More control is triggered automatically until unseen content or the true end is reached.
- During an automatic advance with no preview available, a compact “Loading unseen posts…” status appears instead of an unexplained empty feed.
- If a reload would otherwise contain no visible cards, two recent Seen cards remain as a stable preview while unseen pages load, avoiding both blank waits and live removal.
- The small Seen badge is anchored to the bottom-right corner of its post card and keeps the Seen word visible beside the visitor's highest earned badge.
- At 5, 10, 20, 50, and 100 unique Seen posts, visitors accumulate beer, vodka, tracksuit, gopnik, and Black BMW achievement icons in a light badge shelf aligned opposite the feed buttons.
- Badge images have descriptive alternative text. Desktop hover/focus and mobile taps show a custom explanation below the badge so P2 and Safari cannot clip it above the feed.
- A newly unlocked milestone gets one short badge-pop animation and a compact explanatory toast, with motion disabled when the visitor requests reduced motion.
- Redesigned badge artwork is bundled locally at a maximum 96 px, loaded only when earned, and uses versioned URLs so browsers cache it while plugin upgrades reliably refresh it.
- On the next page load, previously Seen cards start hidden and can be revealed; the two-card preview is used only when hiding everything would leave the feed empty.
- Individual blog posts opened directly are recorded after one visible second and visibly show Seen plus earned badges inside the detected views row, right-aligned across from the view count and before newsletters or comments; WordPress pages are never tracked by default.
- Anonymous state is stored as `{ postId: unixTimestamp }` in `wp_seen_posts_v1`.
- History defaults to 365 days and 3,000 IDs. Use `WP_SEEN_POSTS_RETENTION_DAYS`, `WP_SEEN_POSTS_MAX_ENTRIES`, or their matching filters to change the limits.
- The server archive query remains untouched and cacheable.
- Full post markup remains server-rendered; hiding is a visitor-side interaction and does not remove content from the HTML response used by search engines.
- Achievement artwork is bundled as four optimized 96×96 transparent PNGs and only earned images are loaded.

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
