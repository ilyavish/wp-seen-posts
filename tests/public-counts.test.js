'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicCounts = fs.readFileSync(path.join(__dirname, '../assets/js/public-counts.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../assets/css/seen-posts.css'), 'utf8');

function counter(id, count) {
	return `<span class="wp-seen-posts-public-count" data-seen-post-id="${id}" data-seen-count="${count}" data-personal-seen-state="unseen" aria-label="old"><span class="wp-seen-posts-public-value">${count}</span></span>`;
}

function boot(options = {}) {
	const dom = new JSDOM(`<!doctype html><html lang="en"><body>${options.markup || counter(7, 9)}</body></html>`, {
		url: 'https://example.com/', runScripts: 'outside-only'
	});
	const { window } = dom;
	const requests = [];
	if (options.history) window.localStorage.setItem('wp_seen_posts_v1', JSON.stringify(options.history));
	if (options.ledger) window.localStorage.setItem('wp_seen_posts_counted_v1', options.ledger);
	window.wpSeenPublicCountsConfig = {
		endpoint: 'https://example.com/wp-json/wp-seen-posts/v1/counts',
		readEndpoint: 'https://example.com/wp-json/wp-seen-posts/v1/counts/read',
		maxBatchSize: options.maxBatchSize || 25,
		batchDelay: 100,
		initialCounts: options.initialCounts || {},
		weeklyHotPostIds: options.weeklyHotPostIds || [],
		ledgerStorageKey: 'wp_seen_posts_counted_v1',
		historyStorageKey: 'wp_seen_posts_v1',
		labelSingular: 'Seen by %s visitor',
		labelPlural: 'Seen by %s visitors',
		personalSeen: 'Seen',
		personalUnseen: 'Unseen',
		weeklyHotLabel: 'Hot this week'
	};
	window.fetch = (url, request) => {
		const ids = JSON.parse(request.body).post_ids;
		const isRead = url.endsWith('/read');
		requests.push({ url, request, ids, isRead });
		if (options.fetchHandler) return options.fetchHandler({ url, request, ids, isRead });
		if (options.fetchRejects) return Promise.reject(new Error('offline'));
		const configured = isRead ? options.readResponseCounts : options.responseCounts;
		const counts = configured || Object.fromEntries(ids.map((id) => [id, 10]));
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts }) });
	};
	window.eval(publicCounts);
	return { window, requests };
}

test('restores a theme-stripped counter immediately from the prefetched page totals', async () => {
	const { window, requests } = boot({
		markup: '<article id="post-22"></article>',
		initialCounts: { 22: 43 }
	});
	const card = window.document.querySelector('#post-22');
	const wrap = window.WPSeenPublicCounts.ensure(card, 22);
	assert.equal(wrap.parentElement, card);
	assert.equal(wrap.querySelector('.wp-seen-posts-public-value').textContent, '43');
	assert.equal(wrap.querySelector('.wp-seen-posts-public-count').dataset.seenCount, '43');
	assert.equal(wrap.querySelector('.wp-seen-posts-public-count').dataset.seenCountPending, undefined);
	await window.WPSeenPublicCounts.flushReads();
	assert.equal(requests.length, 0);
});

test('quietly reconciles a stale cached total without incrementing it', async () => {
	const { window, requests } = boot({
		markup: counter(1424, 0),
		readResponseCounts: { 1424: 3 }
	});
	const value = window.document.querySelector('.wp-seen-posts-public-value');
	assert.equal(value.textContent, '0');
	await new Promise((resolve) => window.setTimeout(resolve, 230));
	assert.equal(requests.length, 1);
	assert.equal(requests[0].isRead, true);
	assert.deepEqual(requests[0].ids, ['1424']);
	assert.equal(value.textContent, '3');
});

test('keeps a cached widget count aligned with the article lifetime total', async () => {
	const { window, requests } = boot({
		markup: '<span class="wp-seen-posts-top-count" data-seen-post-id="1400" data-seen-count="20" aria-label="old"><svg></svg><span class="wp-seen-posts-public-value">20</span></span>',
		readResponseCounts: { 1400: 23 }
	});
	const node = window.document.querySelector('.wp-seen-posts-top-count');
	await new Promise((resolve) => window.setTimeout(resolve, 230));
	assert.equal(requests.length, 1);
	assert.equal(requests[0].isRead, true);
	assert.deepEqual(requests[0].ids, ['1400']);
	assert.equal(node.querySelector('.wp-seen-posts-public-value').textContent, '23');
	assert.equal(node.dataset.seenCount, '23');
	assert.equal(node.dataset.personalSeenState, undefined);
	assert.equal(node.getAttribute('aria-label'), 'Seen by 23 visitors');
});

test('restores a cached weekly-hot fire before the eye with an accessible explanation', () => {
	const { window } = boot({
		markup: '<article id="post-22"></article>',
		initialCounts: { 22: 43 },
		weeklyHotPostIds: [22]
	});
	const wrap = window.WPSeenPublicCounts.ensure(window.document.querySelector('#post-22'), 22);
	const node = wrap.querySelector('.wp-seen-posts-public-count');
	assert.equal(node.children[0].classList.contains('wp-seen-posts-weekly-hot'), true);
	assert.equal(node.children[0].textContent, '🔥');
	assert.equal(node.children[1].classList.contains('wp-seen-posts-public-eye'), true);
	assert.equal(node.dataset.weeklyHot, 'true');
	assert.equal(node.getAttribute('aria-label'), 'Hot this week. Unseen. Seen by 43 visitors');
});

test('keeps the WordPress-replaced fire emoji square and aligned with the eye', () => {
	const dom = new JSDOM(`<!doctype html><html><head>
		<style>img.emoji { display: inline !important; height: 1em !important; margin: 0 .07em !important; vertical-align: -.1em !important; width: 1em !important; }</style>
		<style>${styles}</style>
	</head><body><span class="wp-seen-posts-weekly-hot"><img class="emoji" alt="Fire"></span></body></html>`);
	const { window } = dom;
	const marker = window.document.querySelector('.wp-seen-posts-weekly-hot');
	const image = marker.querySelector('img.emoji');
	const markerStyle = window.getComputedStyle(marker);
	const imageStyle = window.getComputedStyle(image);
	assert.equal(markerStyle.width, '20px');
	assert.equal(markerStyle.height, '20px');
	assert.equal(imageStyle.width, '20px');
	assert.equal(imageStyle.height, '20px');
	assert.equal(imageStyle.margin, '0px');
});

test('reads, but never increments, a missing infinite-scroll counter', async () => {
	const { window, requests } = boot({
		markup: '<article id="post-22"></article>',
		readResponseCounts: { 22: 43 }
	});
	const card = window.document.querySelector('#post-22');
	const wrap = window.WPSeenPublicCounts.ensure(card, 22);
	const node = wrap.querySelector('.wp-seen-posts-public-count');
	assert.equal(node.dataset.seenCountPending, 'true');
	assert.equal(wrap.querySelector('.wp-seen-posts-public-value').textContent, '…');
	await window.WPSeenPublicCounts.flushReads();
	assert.equal(requests.length, 1);
	assert.equal(requests[0].isRead, true);
	assert.deepEqual(requests[0].ids, ['22']);
	assert.equal(node.dataset.seenCount, '43');
	assert.equal(node.dataset.seenCountPending, undefined);
	assert.equal(wrap.querySelector('.wp-seen-posts-public-value').textContent, '43');
});

test('does not let a late read overwrite a newly confirmed increment', async () => {
	let resolveRead;
	const { window } = boot({
		markup: '<article id="post-22"></article>',
		fetchHandler({ isRead }) {
			if (!isRead) return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: { 22: 44 } }) });
			return new Promise((resolve) => {
				resolveRead = () => resolve({ ok: true, json: () => Promise.resolve({ counts: { 22: 43 } }) });
			});
		}
	});
	const card = window.document.querySelector('#post-22');
	window.WPSeenPublicCounts.ensure(card, 22);
	const read = window.WPSeenPublicCounts.flushReads();
	window.WPSeenPublicCounts.queue(22);
	await window.WPSeenPublicCounts.flush();
	resolveRead();
	await read;
	assert.equal(card.querySelector('.wp-seen-posts-public-value').textContent, '44');
});

test('deduplicates new post IDs into one batch and applies only confirmed totals', async () => {
	const { window, requests } = boot({
		markup: counter(7, 9) + counter(7, 9) + counter(8, 19),
		responseCounts: { 7: 10, 8: 20 }
	});
	window.WPSeenPublicCounts.queue(7);
	window.WPSeenPublicCounts.queue('7');
	window.WPSeenPublicCounts.queue(8);
	assert.deepEqual(Array.from(window.document.querySelectorAll('[data-seen-post-id="7"] .wp-seen-posts-public-value'), (node) => node.textContent), ['10', '10']);
	assert.equal(window.document.querySelector('[data-seen-post-id="8"] .wp-seen-posts-public-value').textContent, '20');
	await window.WPSeenPublicCounts.flush();
	assert.deepEqual(requests[0].ids, ['7', '8']);
	assert.equal(requests.length, 1);
	assert.deepEqual(Array.from(window.document.querySelectorAll('[data-seen-post-id="7"] .wp-seen-posts-public-value'), (node) => node.textContent), ['10', '10']);
	assert.equal(window.document.querySelector('[data-seen-post-id="8"] .wp-seen-posts-public-value').textContent, '20');
	assert.equal(window.document.querySelector('[data-seen-post-id="7"]').getAttribute('aria-label'), 'Unseen. Seen by 10 visitors');
});

test('switches the subtle eye state and accessible label without adding extra post UI', () => {
	const { window } = boot();
	const node = window.document.querySelector('.wp-seen-posts-public-count');
	assert.equal(node.dataset.personalSeenState, 'unseen');
	assert.equal(node.classList.contains('wp-seen-posts-public-count-is-seen'), false);
	assert.equal(node.getAttribute('aria-label'), 'Unseen. Seen by 9 visitors');
	window.WPSeenPublicCounts.setPersonalState(window.document, true);
	assert.equal(node.dataset.personalSeenState, 'seen');
	assert.equal(node.classList.contains('wp-seen-posts-public-count-is-seen'), true);
	assert.equal(node.getAttribute('aria-label'), 'Seen. Seen by 9 visitors');
});

test('restores an immediate visual increment after an ambiguous failed request and does not retry', async () => {
	const { window, requests } = boot({ fetchRejects: true });
	window.WPSeenPublicCounts.queue(7);
	assert.equal(window.document.querySelector('.wp-seen-posts-public-value').textContent, '10');
	await window.WPSeenPublicCounts.flush();
	await new Promise((resolve) => window.setTimeout(resolve, 130));
	assert.equal(requests.length, 1);
	assert.equal(window.document.querySelector('.wp-seen-posts-public-value').textContent, '9');
	const returning = boot({ ledger: window.localStorage.getItem('wp_seen_posts_counted_v1') });
	returning.window.WPSeenPublicCounts.queue(7);
	await returning.window.WPSeenPublicCounts.flush();
	assert.equal(returning.requests.length, 0);
});

test('does not increment a post again after a later page load in the same browser', async () => {
	const first = boot();
	assert.equal(first.window.WPSeenPublicCounts.queue(7), true);
	await new Promise((resolve) => first.window.setTimeout(resolve, 0));
	await first.window.WPSeenPublicCounts.flush();
	assert.equal(first.requests.length, 1);
	const ledger = first.window.localStorage.getItem('wp_seen_posts_counted_v1');

	const returning = boot({ ledger });
	assert.equal(returning.window.WPSeenPublicCounts.queue(7), false);
	await returning.window.WPSeenPublicCounts.flush();
	assert.equal(returning.requests.length, 0);
	assert.equal(returning.window.document.querySelector('.wp-seen-posts-public-value').textContent, '9');
});

test('migrates existing Seen history into lifetime deduplication without backfilling it', async () => {
	const existing = boot({ history: { 7: Math.floor(Date.now() / 1000) } });
	await new Promise((resolve) => existing.window.setTimeout(resolve, 60));
	existing.window.WPSeenPublicCounts.queue(7);
	await existing.window.WPSeenPublicCounts.flush();
	assert.equal(existing.requests.length, 0);
	assert.equal(existing.window.localStorage.getItem('wp_seen_posts_counted_v1').startsWith('b1:'), true);
});

test('a fast history reset cannot make a previously counted post increment again', async () => {
	const existing = boot({ history: { 7: Math.floor(Date.now() / 1000) } });
	existing.window.WPSeenPublicCounts.preserveHistoryBeforeReset();
	existing.window.localStorage.removeItem('wp_seen_posts_v1');
	existing.window.WPSeenPublicCounts.queue(7);
	await existing.window.WPSeenPublicCounts.flush();
	assert.equal(existing.requests.length, 0);
	assert.equal(existing.window.localStorage.getItem('wp_seen_posts_counted_v1').startsWith('b1:'), true);
});

test('repaints before persistence and keeps the lifetime ledger at a fixed storage size', async () => {
	const first = boot();
	first.window.WPSeenPublicCounts.queue(7);
	assert.equal(first.window.document.querySelector('.wp-seen-posts-public-value').textContent, '10');
	assert.equal(first.window.localStorage.getItem('wp_seen_posts_counted_v1'), null);
	await new Promise((resolve) => first.window.setTimeout(resolve, 0));
	const firstLength = first.window.localStorage.getItem('wp_seen_posts_counted_v1').length;
	for (let id = 8; id <= 20; id += 1) first.window.WPSeenPublicCounts.queue(id);
	await new Promise((resolve) => first.window.setTimeout(resolve, 0));
	const laterLength = first.window.localStorage.getItem('wp_seen_posts_counted_v1').length;
	assert.equal(firstLength, laterLength);
	assert.equal(laterLength < 23000, true);
});

test('merges lifetime deduplication updates received from another tab', async () => {
	const first = boot();
	const second = boot();
	await new Promise((resolve) => second.window.setTimeout(resolve, 0));
	first.window.WPSeenPublicCounts.queue(7);
	await new Promise((resolve) => first.window.setTimeout(resolve, 0));
	const ledger = first.window.localStorage.getItem('wp_seen_posts_counted_v1');
	second.window.dispatchEvent(new second.window.StorageEvent('storage', {
		key: 'wp_seen_posts_counted_v1', newValue: ledger
	}));
	second.window.WPSeenPublicCounts.queue(7);
	await second.window.WPSeenPublicCounts.flush();
	assert.equal(second.requests.length, 0);
});

test('registers only the posts supplied by the infinite-scroll event', async () => {
	const { window } = boot();
	const card = window.document.createElement('article');
	card.innerHTML = counter(22, 1200);
	window.document.body.appendChild(card);
	window.document.dispatchEvent(new window.CustomEvent('wpFeedPostsAdded', { detail: { posts: [card] } }));
	window.WPSeenPublicCounts.queue(22);
	await window.WPSeenPublicCounts.flush();
	assert.equal(card.querySelector('.wp-seen-posts-public-value').textContent, '10');
});

test('matches the required compact lifetime-count examples', () => {
	const { window } = boot();
	const format = window.WPSeenPublicCounts.formatCompact;
	assert.equal(format(0), '0');
	assert.equal(format(18), '18');
	assert.equal(format(999), '999');
	assert.equal(format(1000), '1K');
	assert.equal(format(1284), '1.2K');
	assert.equal(format(15860), '15.9K');
	assert.equal(format(1240000), '1.2M');
});
