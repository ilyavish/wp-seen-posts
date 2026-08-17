'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const adapters = require('../assets/js/adapters.js');

const earlyHide = fs.readFileSync(path.join(__dirname, '../assets/js/early-hide.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../assets/js/seen-posts.js'), 'utf8');

function strings() {
	return {
		showSeen: 'Show seen', hideSeen: 'Hide seen', seen: 'Seen', reset: 'Reset seen history',
		confirmReset: 'Reset?', loadingUnseen: 'Loading unseen posts…', noUnseenPage: 'No unseen posts on this page.',
		caughtUp: "You're all caught up."
	};
}

async function boot(history = {}, options = {}) {
	const postCount = options.postCount ?? 2;
	const postMarkup = Array.from({ length: postCount }, (_, index) => {
		const id = index + 1;
		return `<li id="prologue-${id}" class="post post-${id}">Post ${id}</li>`;
	}).join('');
	const dom = new JSDOM(`<!doctype html><html><body><main id="main">
		<ul id="postlist">
			${postMarkup}
		</ul>
		<div class="wp-pfis-controls"><button class="wp-pfis-load-more">Load more</button><div class="wp-pfis-sentinel"></div></div>
	</main></body></html>`, { url: 'https://example.com/', runScripts: 'outside-only' });
	const { window } = dom;
	Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify(history));
	let loadMoreClicks = 0;
	window.document.querySelector('.wp-pfis-load-more').addEventListener('click', () => { loadMoreClicks += 1; });
	const observers = [];
	window.IntersectionObserver = class {
		constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
		observe(element) { this.observed.add(element); }
		unobserve(element) { this.observed.delete(element); }
		trigger(element, ratio, bottom = 100, height = 300, visibleHeight = ratio * height) {
			this.callback([{
				target: element,
				isIntersecting: ratio > 0,
				intersectionRatio: ratio,
				boundingClientRect: { bottom, height },
				intersectionRect: { height: visibleHeight }
			}]);
		}
	};
	window.WPSeenPostsAdapters = adapters;
	window.wpSeenPostsConfig = {
		theme: 'p2', selectors: {}, storageKey: 'wp_seen_posts_v1', threshold: 0.5,
		dwellTime: 5, hasMorePages: options.hasMorePages ?? false,
		reloadPreviewCount: options.reloadPreviewCount ?? 2,
		maxEntries: 3000, retentionDays: 365, i18n: strings()
	};
	window.confirm = () => true;
	if (options.beforeEval) options.beforeEval(window);
	window.eval(engine);
	window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	return { dom, window, observer: observers[0], loadMoreClicks: () => loadMoreClicks };
}

test('pre-hides stored cards before the engine takes ownership on reload', async () => {
	const now = Math.floor(Date.now() / 1000);
	let hiddenBeforeEngine = false;
	let historyReads = 0;
	let historyWrites = 0;
	const { window } = await boot({ 1: now }, {
		beforeEval(currentWindow) {
			const getItem = currentWindow.Storage.prototype.getItem;
			const setItem = currentWindow.Storage.prototype.setItem;
			currentWindow.Storage.prototype.getItem = function (...args) {
				historyReads += 1;
				return getItem.apply(this, args);
			};
			currentWindow.Storage.prototype.setItem = function (...args) {
				historyWrites += 1;
				return setItem.apply(this, args);
			};
			currentWindow.wpSeenPostsEarlyConfig = {
				storageKey: 'wp_seen_posts_v1', previewCount: 2, previewSelector: '#postlist > li.post', seenLabel: 'Seen'
			};
			currentWindow.eval(earlyHide);
			hiddenBeforeEngine = currentWindow.document.querySelector('#prologue-1').classList.contains('wp-seen-posts-prehidden');
		}
	});
	const oldCard = window.document.querySelector('#prologue-1');
	assert.equal(hiddenBeforeEngine, true);
	assert.equal(oldCard.classList.contains('wp-seen-posts-prehidden'), false);
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), true);
	assert.equal(historyReads, 1);
	assert.equal(historyWrites, 0);
	assert.equal(window.WPSeenPostsEarlyHide.history, null);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-prebadge').length, 0);
});

test('keeps the two-card preview visible before the footer engine starts', async () => {
	const now = Math.floor(Date.now() / 1000);
	let previewsBeforeEngine = 0;
	let hiddenBeforeEngine = 0;
	const { window } = await boot({ 1: now, 2: now, 3: now, 4: now }, {
		postCount: 4,
		beforeEval(currentWindow) {
			currentWindow.wpSeenPostsEarlyConfig = {
				storageKey: 'wp_seen_posts_v1', previewCount: 2, previewSelector: '#postlist > li.post', seenLabel: 'Seen'
			};
			currentWindow.eval(earlyHide);
			previewsBeforeEngine = currentWindow.document.querySelectorAll('.wp-seen-posts-prepreview').length;
			hiddenBeforeEngine = currentWindow.document.querySelectorAll('.wp-seen-posts-prehidden').length;
			assert.equal(currentWindow.document.querySelectorAll('.wp-seen-posts-prebadge').length, 2);
		}
	});
	assert.equal(previewsBeforeEngine, 2);
	assert.equal(hiddenBeforeEngine, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-prepreview, .wp-seen-posts-prehidden').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-prebadge').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);
});

test('does not hide a reserved card when the parser reports it again', async () => {
	const dom = new JSDOM('<!doctype html><html><body><ul id="postlist"><li id="prologue-1" class="post post-1"></li><li id="prologue-2" class="post post-2"></li><li id="prologue-3" class="post post-3"></li></ul></body></html>', {
		url: 'https://example.com/', runScripts: 'outside-only'
	});
	const { window } = dom;
	window.document.documentElement.classList.add('wp-seen-posts-active');
	const now = Math.floor(Date.now() / 1000);
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify({ 1: now, 2: now, 3: now }));
	window.wpSeenPostsEarlyConfig = {
		storageKey: 'wp_seen_posts_v1', previewCount: 2, previewSelector: '#postlist > li.post', seenLabel: 'Seen'
	};
	window.eval(earlyHide);
	const first = window.document.querySelector('#prologue-1');
	first.parentElement.appendChild(first);
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	assert.equal(first.classList.contains('wp-seen-posts-prepreview'), true);
	assert.equal(first.classList.contains('wp-seen-posts-prehidden'), false);
	assert.equal(first.querySelectorAll(':scope > .wp-seen-posts-prebadge').length, 1);
});

test('removes an early preview when its stored history has expired', async () => {
	const expired = Math.floor(Date.now() / 1000) - 366 * 86400;
	const { window } = await boot({ 1: expired, 2: expired }, {
		beforeEval(currentWindow) {
			currentWindow.wpSeenPostsEarlyConfig = {
				storageKey: 'wp_seen_posts_v1', previewCount: 2, previewSelector: '#postlist > li.post', seenLabel: 'Seen'
			};
			currentWindow.eval(earlyHide);
			assert.equal(currentWindow.document.querySelectorAll('.wp-seen-posts-prebadge').length, 2);
		}
	});
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-seen, .wp-seen-posts-is-hidden, .wp-seen-posts-reload-preview').length, 0);
});

test('releases early-hidden cards if the full engine never activates', () => {
	const dom = new JSDOM('<!doctype html><html><body><article id="post-1" class="post post-1">Post</article></body></html>', {
		url: 'https://example.com/', runScripts: 'outside-only'
	});
	const { window } = dom;
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify({ 1: Math.floor(Date.now() / 1000) }));
	window.wpSeenPostsEarlyConfig = { storageKey: 'wp_seen_posts_v1' };
	window.eval(earlyHide);
	const card = window.document.querySelector('#post-1');
	assert.equal(card.classList.contains('wp-seen-posts-prehidden'), true);
	window.dispatchEvent(new window.Event('load'));
	assert.equal(card.classList.contains('wp-seen-posts-prehidden'), false);
	assert.equal(window.WPSeenPostsEarlyHide.history, null);
});

test('initializes a large Seen history without calculating hidden badge layouts', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [String(index + 1), now]));
	let computedStyleCalls = 0;
	const { window } = await boot(history, {
		postCount: 500,
		reloadPreviewCount: 0,
		beforeEval(currentWindow) {
			const getComputedStyle = currentWindow.getComputedStyle.bind(currentWindow);
			currentWindow.getComputedStyle = (...args) => {
				computedStyleCalls += 1;
				return getComputedStyle(...args);
			};
		}
	});
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 500);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
	assert.equal(window.document.querySelector('.wp-seen-posts-toggle').textContent, 'Show seen (500)');
	assert.equal(computedStyleCalls, 0);

	window.document.querySelector('.wp-seen-posts-toggle').click();
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 500);
	assert.equal(computedStyleCalls, 500);
});

test('coalesces simultaneous Seen history writes', async () => {
	let historyWrites = 0;
	const { window, observer } = await boot({}, {
		postCount: 3,
		beforeEval(currentWindow) {
			const setItem = currentWindow.Storage.prototype.setItem;
			currentWindow.Storage.prototype.setItem = function (...args) {
				historyWrites += 1;
				return setItem.apply(this, args);
			};
		}
	});
	assert.equal(historyWrites, 0);
	window.document.querySelectorAll('#postlist > li').forEach((card) => observer.trigger(card, 0.5));
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-seen').length, 3);
	assert.equal(historyWrites, 1);
});

test('keeps a newly Seen card visible after it is scrolled past and reveals prior history on request', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now });
	const oldCard = window.document.querySelector('#prologue-1');
	const newCard = window.document.querySelector('#prologue-2');
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), true);
	assert.equal(observer.observed.has(newCard), true);

	observer.trigger(newCard, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(newCard.classList.contains('wp-seen-posts-is-seen'), true);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(observer.observed.has(newCard), false);
	assert.equal(newCard.classList.contains('wp-seen-posts-position-context'), true);
	assert.equal(newCard.querySelector(':scope > .wp-seen-posts-badge').textContent, 'Seen');
	assert.equal(JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'))['2'] > 0, true);
	assert.equal(window.document.querySelector('.wp-seen-posts-toggle').textContent, 'Show seen (2)');

	observer.trigger(newCard, 0, -1);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
	window.document.querySelector('.wp-seen-posts-toggle').click();
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
});

test('initializes only supplied infinite-scroll posts without advancing while visible content remains', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await boot({ 1: now, 3: now });
	let clicks = 0;
	window.document.querySelector('.wp-pfis-load-more').addEventListener('click', () => { clicks += 1; });
	const feed = window.document.querySelector('#postlist');
	const added = window.document.createElement('li');
	added.id = 'prologue-3';
	added.className = 'post post-3';
	feed.appendChild(added);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', {
		detail: { container: feed, posts: [added], sourceUrl: 'https://example.com/page/2/' }
	}));
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(added.dataset.seenPostInitialized, 'true');
	assert.equal(added.classList.contains('wp-seen-posts-is-hidden'), true);
	assert.equal(clicks, 0);
});

test('allows half a viewport to qualify an exceptionally tall post', async () => {
	const { window, observer } = await boot();
	const tallCard = window.document.querySelector('#prologue-2');
	observer.trigger(tallCard, 0.3, 100, 2000, window.innerHeight * 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(tallCard.dataset.seenPostState, 'seen');
});

test('replaces the immediate loading status with caught up only after the feed is exhausted', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await boot({ 1: now, 2: now, 3: now }, { hasMorePages: true });
	const empty = window.document.querySelector('.wp-seen-posts-empty');
	assert.equal(empty.hidden, true);
	assert.equal(empty.textContent, 'Loading unseen posts…');
	assert.equal(empty.classList.contains('wp-seen-posts-empty-loading'), false);
	assert.equal(empty.querySelector('button'), null);

	const feed = window.document.querySelector('#postlist');
	const card = window.document.createElement('li');
	card.id = 'prologue-3';
	card.className = 'post post-3';
	feed.appendChild(card);
	window.document.querySelector('.wp-pfis-load-more').remove();
	window.document.querySelector('.wp-pfis-sentinel').remove();
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { container: feed, posts: [card] } }));
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(empty.hidden, false);
	assert.equal(empty.textContent, "You're all caught up.");
	assert.equal(empty.classList.contains('wp-seen-posts-empty-loading'), false);
});

test('keeps two stable Seen previews while automatically loading an unseen page', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, loadMoreClicks } = await boot({ 1: now, 2: now, 3: now, 4: now }, { postCount: 4, hasMorePages: true });
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview > .wp-seen-posts-badge').length, 2);
	const empty = window.document.querySelector('.wp-seen-posts-empty');
	assert.equal(empty.hidden, true);
	assert.equal(empty.textContent, 'Loading unseen posts…');
	assert.equal(loadMoreClicks(), 1);

	const feed = window.document.querySelector('#postlist');
	const unseen = window.document.createElement('li');
	unseen.id = 'prologue-5';
	unseen.className = 'post post-5';
	feed.appendChild(unseen);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { container: feed, posts: [unseen] } }));
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(empty.hidden, true);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);

	const toggle = window.document.querySelector('.wp-seen-posts-toggle');
	toggle.click();
	toggle.click();
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 4);
	assert.equal(unseen.classList.contains('wp-seen-posts-is-hidden'), false);
});

test('reset clears only Seen history and re-observes loaded cards', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now });
	window.localStorage.setItem('unrelated', 'keep');
	window.document.querySelector('.wp-seen-posts-reset').click();
	const oldCard = window.document.querySelector('#prologue-1');
	assert.equal(window.localStorage.getItem('wp_seen_posts_v1'), null);
	assert.equal(window.localStorage.getItem('unrelated'), 'keep');
	assert.equal(oldCard.dataset.seenPostState, 'unseen');
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(oldCard.classList.contains('wp-seen-posts-position-context'), false);
	assert.equal(observer.observed.has(oldCard), true);
});
