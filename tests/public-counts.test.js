'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicCounts = fs.readFileSync(path.join(__dirname, '../assets/js/public-counts.js'), 'utf8');

function counter(id, count) {
	return `<span class="wp-seen-posts-public-count" data-seen-post-id="${id}" data-seen-count="${count}" aria-label="old"><span class="wp-seen-posts-public-value">${count}</span></span>`;
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
		maxBatchSize: options.maxBatchSize || 25,
		batchDelay: 100,
		ledgerStorageKey: 'wp_seen_posts_counted_v1',
		historyStorageKey: 'wp_seen_posts_v1',
		labelSingular: 'Seen by %s visitor',
		labelPlural: 'Seen by %s visitors'
	};
	window.fetch = (url, request) => {
		requests.push({ url, request, ids: JSON.parse(request.body).post_ids });
		if (options.fetchRejects) return Promise.reject(new Error('offline'));
		const counts = options.responseCounts || Object.fromEntries(JSON.parse(request.body).post_ids.map((id) => [id, 10]));
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts }) });
	};
	window.eval(publicCounts);
	return { window, requests };
}

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
	assert.equal(window.document.querySelector('[data-seen-post-id="7"]').getAttribute('aria-label'), 'Seen by 10 visitors');
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
	first.window.WPSeenPublicCounts.queue(7);
	await first.window.WPSeenPublicCounts.flush();
	assert.equal(first.requests.length, 1);
	const ledger = first.window.localStorage.getItem('wp_seen_posts_counted_v1');

	const returning = boot({ ledger });
	returning.window.WPSeenPublicCounts.queue(7);
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

test('keeps the lifetime deduplication ledger at a fixed storage size', () => {
	const first = boot();
	first.window.WPSeenPublicCounts.queue(7);
	const firstLength = first.window.localStorage.getItem('wp_seen_posts_counted_v1').length;
	for (let id = 8; id <= 20; id += 1) first.window.WPSeenPublicCounts.queue(id);
	const laterLength = first.window.localStorage.getItem('wp_seen_posts_counted_v1').length;
	assert.equal(firstLength, laterLength);
	assert.equal(laterLength < 23000, true);
});

test('merges lifetime deduplication updates received from another tab', async () => {
	const first = boot();
	const second = boot();
	await new Promise((resolve) => second.window.setTimeout(resolve, 0));
	first.window.WPSeenPublicCounts.queue(7);
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
