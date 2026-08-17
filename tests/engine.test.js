'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const adapters = require('../assets/js/adapters.js');

const engine = fs.readFileSync(path.join(__dirname, '../assets/js/seen-posts.js'), 'utf8');

function strings() {
	return {
		showSeen: 'Show seen', hideSeen: 'Hide seen', seen: 'Seen', reset: 'Reset seen history',
		confirmReset: 'Reset?', caughtUp: "You're all caught up."
	};
}

async function boot(history = {}, options = {}) {
	const dom = new JSDOM(`<!doctype html><html><body><main id="main">
		<ul id="postlist">
			<li id="prologue-1" class="post post-1">Old</li>
			<li id="prologue-2" class="post post-2">New</li>
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
		dwellTime: 5, collapseDelay: 1, recentBuffer: 2, hasMorePages: options.hasMorePages ?? false,
		maxEntries: 3000, retentionDays: 365, i18n: strings()
	};
	window.confirm = () => true;
	window.eval(engine);
	window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	return { dom, window, observer: observers[0], loadMoreClicks: () => loadMoreClicks };
}

test('keeps a newly Seen card visible until it is scrolled past, then reveals it on request', async () => {
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
	assert.equal(JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'))['2'] > 0, true);
	assert.equal(window.document.querySelector('.wp-seen-posts-toggle').textContent, 'Show seen (2)');

	const focusedControl = window.document.createElement('button');
	newCard.appendChild(focusedControl);
	focusedControl.focus();
	observer.trigger(newCard, 0, -1);
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);
	focusedControl.blur();
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), false);

	const feed = window.document.querySelector('#postlist');
	for (const id of [3, 4]) {
		const card = window.document.createElement('li');
		card.id = `prologue-${id}`;
		card.className = `post post-${id}`;
		feed.appendChild(card);
		window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { container: feed, posts: [card] } }));
		observer.trigger(card, 0.5);
		await new Promise((resolve) => window.setTimeout(resolve, 10));
	}
	await new Promise((resolve) => window.setTimeout(resolve, 5));
	assert.equal(newCard.classList.contains('wp-seen-posts-is-hidden'), true);
	window.document.querySelector('.wp-seen-posts-toggle').click();
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

test('shows a compact caught-up status only after the feed is truly exhausted', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await boot({ 1: now, 2: now, 3: now }, { hasMorePages: true });
	const empty = window.document.querySelector('.wp-seen-posts-empty');
	assert.equal(empty.hidden, true);
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
});

test('automatically advances an initially all-Seen page when more pages exist', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window, loadMoreClicks } = await boot({ 1: now, 2: now }, { hasMorePages: true });
	assert.equal(window.document.querySelectorAll('.wp-seen-posts-is-hidden').length, 2);
	assert.equal(window.document.querySelector('.wp-seen-posts-empty').hidden, true);
	assert.equal(loadMoreClicks(), 1);
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
	assert.equal(observer.observed.has(oldCard), true);
});
