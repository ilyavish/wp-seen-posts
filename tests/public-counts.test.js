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
	window.wpSeenPublicCountsConfig = {
		endpoint: 'https://example.com/wp-json/wp-seen-posts/v1/counts',
		maxBatchSize: options.maxBatchSize || 25,
		batchDelay: 100,
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
