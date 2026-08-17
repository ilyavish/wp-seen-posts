# WP Seen Posts

A lightweight WordPress plugin that gives archive feeds local Seen/Unseen state. It is built for P2 first, works with conservative standard WordPress markup, and integrates with the separate [WP Progressive Infinite Scroll](https://github.com/ilyavish/wp-progressive-infinite-scroll) plugin through its existing `wpFeedPostsAdded` event.

## Behavior

- A card becomes Seen after at least 50% is visible for 1,000 ms while the tab is visible.
- For a post taller than the viewport, half of the viewport qualifies so long posts remain usable on phones and tablets.
- A post that becomes Seen stays visible for the rest of the current page session, preventing scroll-time layout shifts.
- Seen/hidden totals use constant-time counters, and storage writes are coalesced so large feeds remain responsive.
- A tiny head bootstrap pre-hides stored Seen cards during parsing, preventing a full-feed flash on reload.
- A compact caught-up status appears only after pagination is genuinely exhausted; the toolbar remains the single reveal control.
- If a loaded page contains only previously Seen posts, the companion Load More control is triggered automatically until unseen content or the true end is reached.
- The small Seen badge is anchored to the bottom-right corner of its post card.
- On the next page load, previously Seen cards start hidden and can be revealed.
- Anonymous state is stored as `{ postId: unixTimestamp }` in `wp_seen_posts_v1`.
- History defaults to 365 days and 3,000 IDs. Use `WP_SEEN_POSTS_RETENTION_DAYS`, `WP_SEEN_POSTS_MAX_ENTRIES`, or their matching filters to change the limits.
- The server archive query remains untouched and cacheable.
- Full post markup remains server-rendered; hiding is a visitor-side interaction and does not remove content from the HTML response used by search engines.

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
