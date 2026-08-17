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
			<div class="jp-post-views-single-meta"><span class="jp-post-views-single-count">0 views</span></div>
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
			{ key: 'vodka', threshold: 10, label: 'Vodka badge', description: 'You earned the Vodka badge for seeing 10 posts.', alt: 'Vodka bottle badge', url: 'https://example.com/vodka.png' }
		],
		i18n: {
			seen: 'Seen', achievements: 'Your badges', badgeHint: 'Tap a badge to see why you earned it.',
			achievementUnlocked: 'Achievement unlocked!'
		}
	};
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
	const meta = window.document.querySelector('.jp-post-views-single-meta');
	const status = meta.querySelector(':scope > .wp-seen-posts-single-status');
	assert.equal(status.textContent, 'Seen');
	assert.equal(status.classList.contains('wp-seen-posts-single-status-inline'), true);
	assert.equal(meta.classList.contains('wp-seen-posts-single-meta-host'), true);
	assert.equal(Boolean(status.compareDocumentPosition(window.document.querySelector('.respond-wrap')) & window.Node.DOCUMENT_POSITION_FOLLOWING), true);
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
	assert.equal(window.document.querySelector('.wp-seen-posts-single-seen').textContent, 'Seen');
});

test('enforces the history size limit when a single post is added', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await bootSingle({ 1: now - 2, 2: now - 1 }, { postId: 3, maxEntries: 2 });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const history = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(history).sort(), ['2', '3']);
});

test('keeps generic-theme Seen feedback inside post content and before comments', async () => {
	const { window } = await bootSingle({}, {
		markup: '<!doctype html><html><body><article id="post-7" class="post"><div class="entry-content">Post body</div><section class="comments-area">Comments</section></article></body></html>'
	});
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const content = window.document.querySelector('.entry-content');
	assert.equal(content.querySelector(':scope > .wp-seen-posts-single-status') !== null, true);
	assert.equal(window.document.querySelector('.comments-area .wp-seen-posts-single-status'), null);
});

test('shows earned badges on a single post and explains a newly unlocked milestone', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, recordedDetail } = await bootSingle({ 1: now, 2: now, 3: now, 4: now });
	await new Promise((resolve) => window.setTimeout(resolve, 12));
	const status = window.document.querySelector('.wp-seen-posts-single-status');
	assert.equal(status.querySelector('.wp-seen-posts-single-seen').textContent, 'Seen');
	assert.equal(status.querySelector('.wp-seen-posts-single-achievements-title').textContent, 'Your badges');
	assert.equal(status.querySelector('.wp-seen-posts-achievement-image').alt, 'Cute beer badge');
	const button = status.querySelector('.wp-seen-posts-achievement-button');
	assert.equal(button.getAttribute('title'), null);
	assert.equal(button.getAttribute('aria-describedby'), 'wp-seen-posts-single-tooltip-beer');
	button.click();
	assert.equal(button.getAttribute('aria-expanded'), 'true');
	window.document.body.click();
	assert.equal(button.getAttribute('aria-expanded'), 'false');
	assert.equal(status.querySelector('.wp-seen-posts-achievement-tooltip').textContent, 'You earned the Beer badge for seeing 5 posts.');
	assert.equal(window.document.querySelector('.wp-seen-posts-unlock-toast').textContent.includes('Achievement unlocked!'), true);
	assert.equal(recordedDetail().unlocked, 'beer');
});
