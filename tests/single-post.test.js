'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const tracker = fs.readFileSync(path.join(__dirname, '../assets/js/single-post.js'), 'utf8');

async function bootSingle(history = {}, options = {}) {
	const markup = options.markup || `<!doctype html><html><body><ul id="postlist"><li id="prologue-7" class="post hentry">
			<div id="content-7" class="postcontent">
				<p>Single post</p>
				<div class="wpulike">Like</div>
				<div class="stats_counter sd-content"><span class="view-count">0 views</span></div>
				<div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7" data-seen-count="3"><span class="wp-seen-posts-public-value">3</span></span></div>
				<div class="wp-block-group subscription-block">Discover more newsletter</div>
		</div>
		<div class="respond-wrap">Reply form</div>
	</li></ul></body></html>`;
	const dom = new JSDOM(markup, {
		url: 'https://example.com/example-post/', runScripts: 'outside-only'
	});
	const { window } = dom;
	let visibility = options.visibility || 'visible';
	Object.defineProperty(window.document, 'visibilityState', { get: () => visibility, configurable: true });
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify(history));
	let writes = 0;
	const setItem = window.Storage.prototype.setItem;
	window.Storage.prototype.setItem = function (...args) {
		writes += 1;
		return setItem.apply(this, args);
	};
	window.wpSeenSinglePostConfig = {
		postId: options.postId ?? 7,
		storageKey: 'wp_seen_posts_v1',
		dwellTime: options.dwellTime ?? 5,
		maxEntries: options.maxEntries ?? 3000,
		retentionDays: 365,
		badges: [
			{ key: 'beer', threshold: 5, label: 'Beer badge', description: 'You earned the Beer badge for seeing 5 posts.', alt: 'Cute beer badge', url: 'https://example.com/beer.png' },
			{ key: 'vodka', threshold: 10, label: 'Vodka badge', description: 'You earned the Vodka badge for seeing 10 posts.', alt: 'Vodka bottle badge', url: 'https://example.com/vodka.png' },
			{ key: 'gopnik', threshold: 50, label: 'Gopnik badge', description: 'You earned the Gopnik badge for seeing 50 posts.', alt: 'Gopnik character badge', url: 'https://example.com/gopnik.png' },
			{ key: 'bmw', threshold: 100, label: 'Black BMW badge', description: 'You earned the Black BMW badge for seeing 100 posts.', alt: 'Black BMW badge', url: 'https://example.com/bmw.png' },
			{ key: 'zapoi', type: 'streak', threshold: 4, label: 'Zapoi badge', description: 'Four days straight. This is officially a zapoi.', alt: 'Zapoi badge', url: 'https://example.com/zapoi.png' }
		],
		i18n: {
			seen: 'Seen', achievements: 'Your badges', badgeHint: 'Tap a badge to see why you earned it.',
			achievementUnlocked: 'Achievement unlocked!'
		}
	};
	window.WPSeenPublicCounts = Object.assign({
		queue() {},
		setPersonalState(root, seen) {
			root.querySelectorAll('.wp-seen-posts-public-count').forEach((node) => {
				node.dataset.personalSeenState = seen ? 'seen' : 'unseen';
				node.classList.toggle('wp-seen-posts-public-count-is-seen', seen);
			});
		}
	}, options.publicCounts || {});
	let recordedDetail = null;
	window.document.addEventListener('wpSeenSinglePostRecorded', (event) => { recordedDetail = event.detail; });
	window.eval(tracker);
	return {
		window,
		setVisibility(value) {
			visibility = value;
			window.document.dispatchEvent(new window.Event('visibilitychange'));
		},
		writes: () => writes,
		recordedId: () => recordedDetail && recordedDetail.postId,
		recordedDetail: () => recordedDetail
	};
}

test('records a directly opened single post after a visible dwell', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, writes, recordedId } = await bootSingle({ 1: now });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const history = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.equal(history['1'], now);
	assert.equal(history['7'] > 0, true);
	assert.equal(writes(), 1);
	assert.equal(recordedId(), '7');
	const actionRow = window.document.querySelector('.wp-seen-posts-single-action-row');
	const meta = actionRow.querySelector(':scope > .stats_counter.sd-content');
	const status = actionRow.querySelector(':scope > .wp-seen-posts-single-status');
	assert.equal(status.textContent.trim(), '3');
	assert.equal(status.children.length, 1);
	assert.equal(status.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(status.classList.contains('wp-seen-posts-single-status-inline'), true);
	assert.equal(actionRow.firstElementChild.classList.contains('wpulike'), true);
	assert.equal(meta.nextElementSibling, status);
	assert.equal(actionRow.classList.contains('wp-seen-posts-single-meta-host'), true);
	assert.equal(actionRow.nextElementSibling.classList.contains('subscription-block'), true);
	assert.equal(Boolean(status.compareDocumentPosition(window.document.querySelector('.respond-wrap')) & window.Node.DOCUMENT_POSITION_FOLLOWING), true);
});

test('keeps the eye total across from Likes when the live post has no views metadata row', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><ul id="postlist"><li id="prologue-7" class="post hentry"><div id="content-7" class="postcontent"><p>Post body</p><div class="wpulike wpulike-heart"><button type="button">Like</button></div><div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7"><span class="wp-seen-posts-public-value">3</span></span></div><div class="wp-block-group subscription-block">Discover more newsletter</div></div><div class="respond-wrap">Reply form</div></li></ul></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const content = window.document.querySelector('#content-7');
	const actionRow = content.querySelector(':scope > .wp-seen-posts-single-action-row');
	const status = actionRow.querySelector(':scope > .wp-seen-posts-single-status');
	assert.equal(actionRow.children[0].classList.contains('wpulike'), true);
	assert.equal(status.children[0].classList.contains('wp-seen-posts-public-count-wrap'), true);
	assert.equal(status.children.length, 1);
	assert.equal(status.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(actionRow.nextElementSibling.classList.contains('subscription-block'), true);
	assert.equal(content.querySelector(':scope > .wp-seen-posts-public-count-wrap'), null);
	assert.equal(window.document.querySelector('.subscription-block .wp-seen-posts-single-status'), null);
	assert.equal(Boolean(status.compareDocumentPosition(window.document.querySelector('.respond-wrap')) & window.Node.DOCUMENT_POSITION_FOLLOWING), true);
});

test('keeps the weekly-hot fire before the eye when moving a single-post counter', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><ul id="postlist"><li id="prologue-7" class="post hentry"><div id="content-7" class="postcontent"><p>Post body</p><div class="wpulike"><button type="button">Like</button></div><div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7" data-weekly-hot="true"><span class="wp-seen-posts-weekly-hot" aria-hidden="true">🔥</span><svg class="wp-seen-posts-public-eye"></svg><span class="wp-seen-posts-public-value">3</span></span></div></div></li></ul></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const counter = window.document.querySelector('.wp-seen-posts-single-action-row .wp-seen-posts-public-count');
	assert.equal(counter.children[0].classList.contains('wp-seen-posts-weekly-hot'), true);
	assert.equal(counter.children[1].classList.contains('wp-seen-posts-public-eye'), true);
});

test('does not count time spent in a hidden single-post tab', async () => {
	const { window, setVisibility, writes } = await bootSingle({}, { visibility: 'hidden' });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(writes(), 0);
	setVisibility('visible');
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'))['7'] > 0, true);
	assert.equal(writes(), 1);
});

test('does not rewrite history when the single post was already Seen', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, writes, recordedId } = await bootSingle({ 7: now });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(writes(), 0);
	assert.equal(recordedId(), '7');
	assert.equal(window.document.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
});

test('queues a direct-post public increment once but never for existing local history', async () => {
	const queued = [];
	const fresh = await bootSingle({}, { publicCounts: { queue: (id) => queued.push(id) } });
	await new Promise((resolve) => fresh.window.setTimeout(resolve, 10));
	assert.deepEqual(queued, ['7']);
	assert.equal(fresh.recordedDetail().wasNew, true);

	const existingQueued = [];
	const existing = await bootSingle({ 7: Math.floor(Date.now() / 1000) }, { publicCounts: { queue: (id) => existingQueued.push(id) } });
	await new Promise((resolve) => existing.window.setTimeout(resolve, 10));
	assert.deepEqual(existingQueued, []);
	assert.equal(existing.recordedDetail().wasNew, false);
});

test('enforces the history size limit when a single post is added', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await bootSingle({ 1: now - 2, 2: now - 1 }, { postId: 3, maxEntries: 2 });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const history = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(history).sort(), ['2', '3']);
});

test('keeps generic-theme eye feedback inside post content and before comments', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><article id="post-7" class="post"><div class="entry-content">Post body<div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7" data-seen-count="3"><span class="wp-seen-posts-public-value">3</span></span></div></div><section class="comments-area">Comments</section></article></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const content = window.document.querySelector('.entry-content');
	assert.equal(content.querySelector(':scope > .wp-seen-posts-single-status') !== null, true);
	assert.equal(window.document.querySelector('.comments-area .wp-seen-posts-single-status'), null);
});

test('supports the alternate JP post-views metadata wrapper', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><article id="post-7" class="post"><div class="entry-content"><div class="jp-post-views-single-meta"><span class="jp-post-views-single-count">0 views</span></div><div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7" data-seen-count="3"><span class="wp-seen-posts-public-value">3</span></span></div></div><section class="comments-area">Comments</section></article></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(window.document.querySelector('.jp-post-views-single-meta > .wp-seen-posts-single-status') !== null, true);
});

test('moves only the public eye total into the single-post metadata row', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><article id="post-7" class="post"><div class="entry-content"><p>Post body</p><div class="stats_counter sd-content"><span>73 views</span></div><div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="7" data-seen-count="428"><span class="wp-seen-posts-public-value">428</span></span></div></div><section class="comments-area">Comments</section></article></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const status = window.document.querySelector('.stats_counter.sd-content > .wp-seen-posts-single-status');
	assert.equal(status.children[0].classList.contains('wp-seen-posts-public-count-wrap'), true);
	assert.equal(status.children.length, 1);
	assert.equal(status.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(window.document.querySelector('.entry-content > .wp-seen-posts-public-count-wrap'), null);
});

test('keeps single posts clean while explaining a newly unlocked milestone in the toast', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, recordedDetail } = await bootSingle({ 1: now, 2: now, 3: now, 4: now });
	await new Promise((resolve) => window.setTimeout(resolve, 12));
	const status = window.document.querySelector('.wp-seen-posts-single-status');
	assert.equal(status.children.length, 1);
	assert.equal(status.querySelector('.wp-seen-posts-achievement'), null);
	const toast = window.document.querySelector('.wp-seen-posts-unlock-toast');
	assert.equal(toast.textContent.includes('Achievement unlocked!'), true);
	assert.equal(toast.querySelector('.wp-seen-posts-unlock-image').alt, 'Cute beer badge');
	assert.equal(recordedDetail().unlocked, 'beer');
});

test('unlocks and animates the Black BMW badge on a 100th direct post', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 99 }, (_, index) => [String(index + 100), now]));
	const { window, recordedDetail } = await bootSingle(history);
	await new Promise((resolve) => window.setTimeout(resolve, 12));
	assert.equal(recordedDetail().unlocked, 'bmw');
	const toast = window.document.querySelector('.wp-seen-posts-unlock-toast');
	assert.equal(toast.classList.contains('is-visible'), true);
	assert.equal(toast.querySelector('img').src, 'https://example.com/bmw.png');
	assert.equal(toast.textContent.includes('Black BMW badge'), true);
});

test('does not unlock any retired badge on a 20th direct post', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 19 }, (_, index) => [String(index + 100), now]));
	const { window, recordedDetail } = await bootSingle(history);
	await new Promise((resolve) => window.setTimeout(resolve, 12));
	assert.equal(recordedDetail().unlocked, '');
	assert.equal(window.document.querySelector('.wp-seen-posts-unlock-toast'), null);
});
