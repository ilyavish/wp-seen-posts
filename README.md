# WP Seen Posts

A lightweight WordPress plugin that gives archive feeds local Seen/Unseen state. It is built for P2 first, works with conservative standard WordPress markup, and integrates with the separate [WP Progressive Infinite Scroll](https://github.com/ilyavish/wp-progressive-infinite-scroll) plugin through its existing `wpFeedPostsAdded` event.

## Behavior

- A card becomes Seen after at least 50% is visible for 750 ms while the tab is visible.
- For a post taller than the viewport, half of the viewport qualifies so long posts remain usable on phones and tablets.
- It stays visible while being read, then collapses after it has fully left above the viewport.
- Multiple collapses are batched after scrolling pauses and preserve the visible card position to avoid mobile viewport jumping.
- The two most recently Seen posts remain expanded as an orientation buffer; older Seen posts collapse after they are passed.
- On a later page load, previously Seen cards start hidden and can be revealed.
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
