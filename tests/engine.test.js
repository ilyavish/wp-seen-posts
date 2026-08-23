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
		confirmReset: 'Reset?', loadingUnseen: 'Loading unseen posts…', findingUnseen: 'Finding unseen posts…', noUnseenPage: 'No unseen posts on this page.',
		caughtUp: "You're all caught up.", achievements: 'Your badges',
		badgeHint: 'Tap a badge to see how it unlocks.', badgeLocked: 'Locked. See %1$d posts to unlock %2$s.',
		achievementUnlocked: 'Achievement unlocked!'
	};
}

function badges() {
	return [
		{ key: 'beer', threshold: 5, label: 'Beer badge', description: 'You earned the Beer badge for seeing 5 posts.', alt: 'Cute beer badge', url: 'https://example.com/badges/beer.png' },
		{ key: 'vodka', threshold: 10, label: 'Vodka badge', description: 'You earned the Vodka badge for seeing 10 posts.', alt: 'Vodka bottle badge', url: 'https://example.com/badges/vodka.png' },
		{ key: 'gopnik', threshold: 50, label: 'Gopnik badge', description: 'You earned the Gopnik badge for seeing 50 posts.', alt: 'Gopnik character badge', url: 'https://example.com/badges/gopnik.png' },
		{ key: 'bmw', threshold: 100, label: 'Black BMW badge', description: 'You earned the Black BMW badge for seeing 100 posts.', alt: 'Black BMW badge', url: 'https://example.com/badges/bmw.png' },
		{ key: 'zapoi', type: 'streak', threshold: 4, label: 'Zapoi badge', requirement: '4-Day Vodka Streak', description: 'Four days straight. This is officially a zapoi.', alt: 'Zapoi badge', url: 'https://example.com/badges/zapoi.png' }
	];
}

async function boot(history = {}, options = {}) {
	const postCount = options.postCount ?? 2;
	const postMarkup = Array.from({ length: postCount }, (_, index) => {
		const id = index + 1;
		const like = options.includeWpULike ? `<div class="wpulike"><button class="wp_ulike_btn">Like ${id}</button></div>` : '';
		const publicCounter = options.includePublicCounts !== false
			? `<div class="postcontent">Post ${id}${like}<div class="wp-seen-posts-public-count-wrap"><span class="wp-seen-posts-public-count" data-seen-post-id="${id}" data-seen-count="9"><span class="wp-seen-posts-public-value">9</span></span></div></div>`
			: `<div class="postcontent">Post ${id}<p class="p2-auto-read-more-wrap"><a class="p2-auto-read-more">Read more →</a></p></div>`;
		return `<li id="prologue-${id}" class="post post-${id}">${publicCounter}</li>`;
	}).join('');
	const dom = new JSDOM(`<!doctype html><html><body><main id="main">
		<ul id="postlist">
			${postMarkup}
		</ul>
		<div class="wp-pfis-controls"><a href="${options.nextPageUrl || 'https://example.com/page/2/'}" class="wp-pfis-load-more">Load more</a><div class="wp-pfis-sentinel"></div></div>
	</main></body></html>`, { url: 'https://example.com/', runScripts: 'outside-only' });
	const { window } = dom;
	Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify(history));
	let loadMoreClicks = 0;
	window.document.querySelector('.wp-pfis-load-more').addEventListener('click', (event) => {
		event.preventDefault();
		loadMoreClicks += 1;
	});
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
	window.WPSeenPublicCounts = options.publicCounts || {
		queue() {},
		register() {},
		setPersonalState(root, seen) {
			root.querySelectorAll('.wp-seen-posts-public-count').forEach((node) => {
				node.dataset.personalSeenState = seen ? 'seen' : 'unseen';
				node.classList.toggle('wp-seen-posts-public-count-is-seen', seen);
			});
		}
	};
	if (options.gamification) window.WPSeenGamification = options.gamification;
	window.wpSeenPostsConfig = {
		theme: 'p2', selectors: {}, storageKey: 'wp_seen_posts_v1', threshold: 0.5,
		dwellTime: 5, hasMorePages: options.hasMorePages ?? false,
		reloadPreviewCount: options.reloadPreviewCount ?? 2,
		previewLoadingDelay: options.previewLoadingDelay ?? 500,
		unseenPrefetchPageLimit: options.unseenPrefetchPageLimit ?? 0,
		maxEntries: 3000, retentionDays: 365, badges: badges(), i18n: strings()
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

test('asks the public counter layer to restore markup stripped by Read More', async () => {
	const ensured = [];
	const { window } = await boot({}, {
		postCount: 1,
		includePublicCounts: false,
		publicCounts: {
			ensure(card, id) {
				ensured.push(id);
				const wrap = card.ownerDocument.createElement('div');
				wrap.className = 'wp-seen-posts-public-count-wrap';
				wrap.innerHTML = `<span class="wp-seen-posts-public-count" data-seen-post-id="${id}" data-seen-count="9"><span class="wp-seen-posts-public-value">9</span></span>`;
				card.appendChild(wrap);
			},
			register() {},
			setPersonalState() {}
		}
	});
	assert.deepEqual(ensured, ['1']);
	assert.equal(window.document.querySelector('#prologue-1 > .wp-seen-posts-card-status .wp-seen-posts-public-value').textContent, '9');
});

test('keeps the feed eye at the bottom-right instead of placing it inline with WP ULike', async () => {
	const { window } = await boot({}, { postCount: 1, includeWpULike: true });
	const card = window.document.querySelector('#prologue-1');
	const content = card.querySelector('.postcontent');
	const status = card.querySelector(':scope > .wp-seen-posts-card-status');
	assert.equal(card.querySelector('.wp-seen-posts-card-action-row'), null);
	assert.equal(content.querySelector(':scope > .wpulike') !== null, true);
	assert.equal(status.querySelector('.wp-seen-posts-public-count') !== null, true);
	assert.equal(card.classList.contains('wp-seen-posts-position-context'), true);
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
				assert.equal(currentWindow.document.querySelectorAll('.wp-seen-posts-prebadge').length, 0);
		}
	});
	assert.equal(previewsBeforeEngine, 2);
	assert.equal(hiddenBeforeEngine, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-prepreview, .wp-seen-posts-prehidden').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-prebadge').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview > .wp-seen-posts-card-status .wp-seen-posts-public-count').length, 2);
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
	assert.equal(first.querySelectorAll(':scope > .wp-seen-posts-prebadge').length, 0);
});

test('never pre-hides an expired history entry before the full engine starts', async () => {
	const expired = Math.floor(Date.now() / 1000) - 366 * 86400;
	const { window } = await boot({ 1: expired, 2: expired }, {
		beforeEval(currentWindow) {
			currentWindow.wpSeenPostsEarlyConfig = {
				storageKey: 'wp_seen_posts_v1', previewCount: 2, previewSelector: '#postlist > li.post',
				maxEntries: 3000, retentionDays: 365, seenLabel: 'Seen'
			};
			currentWindow.eval(earlyHide);
			assert.equal(currentWindow.document.querySelectorAll('.wp-seen-posts-prebadge').length, 0);
			assert.equal(currentWindow.document.querySelectorAll('.wp-seen-posts-prepreview, .wp-seen-posts-prehidden').length, 0);
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

test('initializes a large Seen history without calculating post-level badge layouts', async () => {
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
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-card-status .wp-seen-posts-public-count').length, 500);
	assert.equal(computedStyleCalls, 0);
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
	await new Promise((resolve) => window.setTimeout(resolve, 30));
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-seen').length, 3);
	assert.equal(historyWrites, 1);
});

test('queues a public increment only for a new local Unseen to Seen transition', async () => {
	const queued = [];
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now }, {
		postCount: 2,
		reloadPreviewCount: 0,
		publicCounts: { queue: (id) => queued.push(id), register: () => {} }
	});
	observer.trigger(window.document.querySelector('#prologue-2'), 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	assert.deepEqual(queued, ['2']);
	assert.equal(window.document.querySelector('#prologue-1').classList.contains('wp-seen-posts-is-seen'), true);
});

test('advances streak progress only when the lifetime ledger accepts a new post', async () => {
	const qualified = [];
	const rejected = await boot({}, {
		postCount: 1,
		publicCounts: { queue: () => false, register() {}, setPersonalState() {} },
		gamification: { mount() {}, recordSeen: (id) => qualified.push(id), isBadgeEarned: () => false }
	});
	rejected.observer.trigger(rejected.window.document.querySelector('#prologue-1'), 0.5);
	await new Promise((resolve) => rejected.window.setTimeout(resolve, 10));
	assert.deepEqual(qualified, []);

	const accepted = await boot({}, {
		postCount: 1,
		publicCounts: { queue: () => true, register() {}, setPersonalState() {} },
		gamification: { mount() {}, recordSeen: (id, total) => qualified.push([id, total]), isBadgeEarned: () => false }
	});
	accepted.observer.trigger(accepted.window.document.querySelector('#prologue-1'), 0.5);
	await new Promise((resolve) => accepted.window.setTimeout(resolve, 10));
	assert.deepEqual(qualified, [['1', 1]]);
});

test('uses only the public eye total at the bottom-right and changes its personal state immediately', async () => {
	const { window, observer } = await boot({}, { postCount: 1, includePublicCounts: true });
	const card = window.document.querySelector('#prologue-1');
	const statusBefore = card.querySelector(':scope > .wp-seen-posts-card-status');
	assert.equal(statusBefore.querySelector(':scope > .wp-seen-posts-public-count-wrap') !== null, true);
	assert.equal(statusBefore.querySelector('.wp-seen-posts-badge'), null);
	assert.equal(statusBefore.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'unseen');
	assert.equal(card.classList.contains('wp-seen-posts-position-context'), true);

	observer.trigger(card, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	const statusAfter = card.querySelector(':scope > .wp-seen-posts-card-status');
	assert.equal(statusAfter.children[0].classList.contains('wp-seen-posts-public-count-wrap'), true);
	assert.equal(statusAfter.children.length, 1);
	assert.equal(statusAfter.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(statusAfter.querySelector('.wp-seen-posts-public-count').classList.contains('wp-seen-posts-public-count-is-seen'), true);
});

test('cancels both local Seen and public counting when a card leaves before the dwell', async () => {
	const queued = [];
	const { window, observer } = await boot({}, {
		postCount: 1,
		publicCounts: { queue: (id) => queued.push(id), register: () => {} }
	});
	const card = window.document.querySelector('#prologue-1');
	observer.trigger(card, 0.5);
	observer.trigger(card, 0, -1);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	assert.equal(card.dataset.seenPostState, 'unseen');
	assert.deepEqual(queued, []);
	assert.equal(window.localStorage.getItem('wp_seen_posts_v1'), '{}');
});

test('merges a post recorded in another tab before writing feed history', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({}, { postCount: 2 });
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify({ 99: now }));
	observer.trigger(window.document.querySelector('#prologue-1'), 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	const stored = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(stored).sort(), ['1', '99']);
});

test('does not resurrect history reset by another tab when the feed writes', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now }, { postCount: 2 });
	window.localStorage.removeItem('wp_seen_posts_v1');
	observer.trigger(window.document.querySelector('#prologue-2'), 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	const stored = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(stored), ['2']);
});

test('reconciles another tab without collapsing a currently visible feed card', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({}, { postCount: 2 });
	const secondCard = window.document.querySelector('#prologue-2');
	window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify({ 2: now }));
	window.dispatchEvent(new window.StorageEvent('storage', {
		key: 'wp_seen_posts_v1',
		newValue: JSON.stringify({ 2: now })
	}));
	assert.equal(secondCard.dataset.seenPostState, 'unseen');
	assert.equal(secondCard.classList.contains('wp-seen-posts-is-hidden'), false);
	observer.trigger(window.document.querySelector('#prologue-1'), 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 15));
	const stored = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(stored).sort(), ['1', '2']);
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
	assert.equal(newCard.querySelector(':scope > .wp-seen-posts-card-status .wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(newCard.querySelector('.wp-seen-posts-badge'), null);
	assert.equal(JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'))['2'] > 0, true);
	assert.equal(window.document.querySelector('.wp-seen-posts-toggle').textContent, 'Show seen (2)');

	observer.trigger(newCard, 0, -1);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
	window.document.querySelector('.wp-seen-posts-toggle').click();
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
});

test('does not hide posts that become Seen after Show seen is closed', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now }, { postCount: 2, hasMorePages: true });
	const secondCard = window.document.querySelector('#prologue-2');
	observer.trigger(secondCard, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));

	const toggle = window.document.querySelector('.wp-seen-posts-toggle');
	toggle.click();
	toggle.click();
	assert.equal(secondCard.classList.contains('wp-seen-posts-is-hidden'), true);

	const thirdCard = window.document.createElement('li');
	thirdCard.id = 'prologue-3';
	thirdCard.className = 'post post-3';
	thirdCard.textContent = 'Post 3';
	window.document.querySelector('#postlist').appendChild(thirdCard);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', {
		detail: { container: window.document.querySelector('#postlist'), posts: [thirdCard] }
	}));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	observer.trigger(thirdCard, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));

	assert.equal(thirdCard.dataset.seenPostState, 'seen');
	assert.equal(thirdCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(thirdCard.getAttribute('aria-hidden'), 'false');
});

test('Show and Hide Seen never queue public analytics increments', async () => {
	const now = Math.floor(Date.now() / 1000);
	const queued = [];
	const { window } = await boot({ 1: now, 2: now }, {
		publicCounts: {
			queue: (id) => queued.push(id),
			register() {},
			setPersonalState() {}
		}
	});
	const toggle = window.document.querySelector('.wp-seen-posts-toggle');
	toggle.click();
	toggle.click();
	assert.deepEqual(queued, []);
});

test('Show Seen is temporary and a reload returns to hidden history with previews', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = { 1: now, 2: now, 3: now, 4: now };
	const first = await boot(history, { postCount: 4 });
	first.window.document.querySelector('.wp-seen-posts-toggle').click();
	assert.equal(first.window.document.querySelector('.wp-seen-posts-toggle').textContent, 'Hide seen');
	assert.equal(first.window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 0);

	const reloaded = await boot(history, { postCount: 4 });
	const toggle = reloaded.window.document.querySelector('.wp-seen-posts-toggle');
	assert.equal(toggle.textContent, 'Show seen (4)');
	assert.equal(toggle.getAttribute('aria-expanded'), 'false');
	assert.equal(reloaded.window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(reloaded.window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);
});

test('unlocks the beer milestone in the top shelf with a brief, explained achievement', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, observer } = await boot({ 1: now, 2: now, 3: now, 4: now }, { postCount: 5 });
	const achievements = window.document.querySelector('.wp-seen-posts-achievements');
	assert.equal(achievements.hidden, false);
	assert.equal(achievements.querySelectorAll('.wp-seen-posts-achievement-locked').length, 5);
	assert.equal(achievements.querySelector('[data-badge-key="beer"] .wp-seen-posts-achievement-tooltip-name').textContent, 'Beer badge');
	assert.equal(achievements.querySelector('[data-badge-key="beer"] .wp-seen-posts-achievement-tooltip-requirement').textContent, 'Locked. See 5 posts to unlock Beer badge.');
	const fifth = window.document.querySelector('#prologue-5');
	observer.trigger(fifth, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(achievements.hidden, false);
	assert.deepEqual([...achievements.querySelectorAll('.wp-seen-posts-achievement')].map((item) => item.dataset.badgeKey), ['beer', 'vodka', 'gopnik', 'bmw', 'zapoi']);
	assert.equal(achievements.querySelector('[data-badge-key="beer"]').dataset.badgeState, 'earned');
	assert.equal(achievements.querySelector('[data-badge-key="vodka"]').dataset.badgeState, 'locked');
	assert.equal(achievements.querySelector('img').src, 'https://example.com/badges/beer.png');
	assert.equal(achievements.querySelector('img').alt, 'Cute beer badge');
	assert.equal(achievements.querySelector('img').decoding, 'sync');
	assert.equal(achievements.querySelector('.wp-seen-posts-achievement-tooltip-requirement').textContent, 'You earned the Beer badge for seeing 5 posts.');
	const achievementButton = achievements.querySelector('.wp-seen-posts-achievement-button');
	assert.equal(achievementButton.getAttribute('title'), null);
	assert.equal(achievementButton.getAttribute('aria-describedby'), 'wp-seen-posts-tooltip-beer');
	achievementButton.click();
	assert.equal(achievementButton.getAttribute('aria-expanded'), 'true');
	window.document.body.click();
	assert.equal(achievementButton.getAttribute('aria-expanded'), 'false');
	assert.equal(fifth.querySelector('.wp-seen-posts-badge'), null);
	assert.equal(fifth.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'seen');
	assert.equal(window.document.querySelector('.wp-seen-posts-unlock-toast').textContent.includes('Achievement unlocked!'), true);
});

test('accumulates earned milestones only in the top roadmap', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index + 1), now]));
	const { window } = await boot(history);
	const achievements = window.document.querySelector('.wp-seen-posts-achievements');
	assert.deepEqual([...achievements.querySelectorAll('.wp-seen-posts-achievement')].map((item) => item.dataset.badgeKey), ['beer', 'vodka', 'gopnik', 'bmw', 'zapoi']);
	assert.equal(achievements.querySelectorAll('img').length, 5);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
	window.document.querySelector('.wp-seen-posts-reset').click();
	assert.equal(achievements.hidden, false);
	assert.equal(achievements.querySelector('.wp-seen-posts-achievements-list').children.length, 5);
	assert.equal(achievements.querySelectorAll('.wp-seen-posts-achievement-locked').length, 5);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-badge').length, 0);
});

test('unlocks the 100-post Black BMW milestone with animation and toast', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 99 }, (_, index) => [String(index + 1), now]));
	const { window, observer } = await boot(history, { postCount: 100 });
	const hundredth = window.document.querySelector('#prologue-100');
	observer.trigger(hundredth, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const bmw = window.document.querySelector('.wp-seen-posts-achievement[data-badge-key="bmw"]');
	assert.equal(bmw.classList.contains('wp-seen-posts-achievement-unlocked'), true);
	assert.equal(bmw.querySelector('img').src, 'https://example.com/badges/bmw.png');
	assert.equal(window.document.querySelector('.wp-seen-posts-unlock-toast').textContent.includes('Black BMW badge'), true);
	assert.equal(hundredth.querySelector('.wp-seen-posts-badge'), null);
});

test('has no Barsetka definition or 20-post unlock behavior', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 19 }, (_, index) => [String(index + 1), now]));
	const { window, observer } = await boot(history, { postCount: 20 });
	const twentieth = window.document.querySelector('#prologue-20');
	observer.trigger(twentieth, 0.5);
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	assert.equal(window.document.querySelector('[data-badge-key="barsetka"]'), null);
	assert.equal(window.document.querySelector('.wp-seen-posts-unlock-toast'), null);
	assert.equal(twentieth.querySelector('.wp-seen-posts-badge'), null);
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

test('warms consecutive Seen archive pages in parallel for a returning visitor', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [String(index + 1), now]));
	const requests = [];
	const resolvers = new Map();
	function responseFor(url) {
		return {
			ok: true,
			clone: () => responseFor(url),
			text: () => Promise.resolve(`<html data-source="${url}"></html>`)
		};
	}
	const { window } = await boot(history, {
		postCount: 10,
		hasMorePages: true,
		unseenPrefetchPageLimit: 6,
		beforeEval(currentWindow) {
			currentWindow.fetch = (input) => {
				const url = String(input);
				requests.push(url);
				return new Promise((resolve) => { resolvers.set(url, resolve); });
			};
		}
	});

	assert.deepEqual(requests, [
		'https://example.com/page/2/',
		'https://example.com/page/3/',
		'https://example.com/page/4/',
		'https://example.com/page/5/',
		'https://example.com/page/6/'
	]);
	const warmed = window.fetch('https://example.com/page/2/', { method: 'GET' });
	assert.equal(requests.length, 5);
	resolvers.get('https://example.com/page/2/')(responseFor('https://example.com/page/2/'));
	const response = await warmed;
	assert.equal(await response.text(), '<html data-source="https://example.com/page/2/"></html>');
	assert.equal(requests.length, 5);
});

test('falls back to the normal archive request when a warmed response fails', async () => {
	const now = Math.floor(Date.now() / 1000);
	const history = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [String(index + 1), now]));
	const requests = [];
	let rejectWarmRequest;
	function responseFor(url) {
		return { ok: true, clone: () => responseFor(url), text: () => Promise.resolve(url) };
	}
	const { window } = await boot(history, {
		postCount: 10,
		hasMorePages: true,
		unseenPrefetchPageLimit: 6,
		beforeEval(currentWindow) {
			currentWindow.fetch = (input) => {
				const url = String(input);
				requests.push(url);
				if ('https://example.com/page/2/' === url && 1 === requests.filter((item) => item === url).length) {
					return new Promise((resolve, reject) => { rejectWarmRequest = reject; });
				}
				return Promise.resolve(responseFor(url));
			};
		}
	});

	const recovered = window.fetch('https://example.com/page/2/', { method: 'GET' });
	rejectWarmRequest(new Error('network failure'));
	assert.equal(await (await recovered).text(), 'https://example.com/page/2/');
	assert.equal(requests.filter((url) => url === 'https://example.com/page/2/').length, 2);
});

test('does not warm archive pages while an Unseen card is already visible', async () => {
	const now = Math.floor(Date.now() / 1000);
	const requests = [];
	await boot(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index + 1), now])), {
		postCount: 10,
		hasMorePages: true,
		unseenPrefetchPageLimit: 6,
		beforeEval(currentWindow) {
			currentWindow.fetch = (input) => {
				requests.push(String(input));
				return Promise.resolve({ ok: true, clone() { return this; } });
			};
		}
	});
	assert.deepEqual(requests, []);
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

test('keeps two stable Seen previews and delays the finding-unseen status', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, loadMoreClicks } = await boot({ 1: now, 2: now, 3: now, 4: now }, { postCount: 4, hasMorePages: true, previewLoadingDelay: 10 });
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview > .wp-seen-posts-card-status .wp-seen-posts-public-count-is-seen').length, 2);
	const empty = window.document.querySelector('.wp-seen-posts-empty');
	assert.equal(empty.hidden, true);
	assert.equal(empty.textContent, 'Loading unseen posts…');
	assert.equal(loadMoreClicks(), 1);
	await new Promise((resolve) => window.setTimeout(resolve, 12));
	assert.equal(empty.hidden, false);
	assert.equal(empty.textContent, 'Finding unseen posts…');
	assert.equal(empty.classList.contains('wp-seen-posts-empty-loading'), true);
	assert.equal(empty.classList.contains('wp-seen-posts-empty-preview-loading'), true);

	const feed = window.document.querySelector('#postlist');
	const unseen = window.document.createElement('li');
	unseen.id = 'prologue-5';
	unseen.className = 'post post-5';
	feed.appendChild(unseen);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { container: feed, posts: [unseen] } }));
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(empty.hidden, true);
	assert.equal(empty.classList.contains('wp-seen-posts-empty-preview-loading'), false);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 2);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);

	const toggle = window.document.querySelector('.wp-seen-posts-toggle');
	toggle.click();
	toggle.click();
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-reload-preview').length, 0);
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 4);
	assert.equal(unseen.classList.contains('wp-seen-posts-is-hidden'), false);
});

test('never flashes the finding-unseen status when unseen content arrives quickly', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await boot({ 1: now, 2: now }, { hasMorePages: true, previewLoadingDelay: 15 });
	const feed = window.document.querySelector('#postlist');
	const unseen = window.document.createElement('li');
	unseen.id = 'prologue-3';
	unseen.className = 'post post-3';
	feed.appendChild(unseen);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { container: feed, posts: [unseen] } }));
	await new Promise((resolve) => window.setTimeout(resolve, 20));
	const empty = window.document.querySelector('.wp-seen-posts-empty');
	assert.equal(empty.hidden, true);
	assert.equal(empty.classList.contains('wp-seen-posts-empty-preview-loading'), false);
});

test('reset clears only Seen history and re-observes loaded cards', async () => {
	const now = Math.floor(Date.now() / 1000);
	let preserved = 0;
	const { window, observer } = await boot({ 1: now }, {
		publicCounts: {
			preserveHistoryBeforeReset() { preserved += 1; },
			register() {},
			setPersonalState(root, seen) {
				root.querySelectorAll('.wp-seen-posts-public-count').forEach((node) => {
					node.dataset.personalSeenState = seen ? 'seen' : 'unseen';
				});
			}
		}
	});
	window.localStorage.setItem('unrelated', 'keep');
	window.document.querySelector('.wp-seen-posts-reset').click();
	const oldCard = window.document.querySelector('#prologue-1');
	assert.equal(window.localStorage.getItem('wp_seen_posts_v1'), null);
	assert.equal(window.localStorage.getItem('unrelated'), 'keep');
	assert.equal(oldCard.dataset.seenPostState, 'unseen');
	assert.equal(oldCard.classList.contains('wp-seen-posts-is-hidden'), false);
	assert.equal(oldCard.classList.contains('wp-seen-posts-position-context'), true);
	assert.equal(oldCard.querySelector('.wp-seen-posts-public-count').dataset.personalSeenState, 'unseen');
	assert.equal(observer.observed.has(oldCard), true);
	assert.equal(preserved, 1);
});
