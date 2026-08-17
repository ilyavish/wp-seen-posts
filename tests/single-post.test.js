'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const tracker = fs.readFileSync(path.join(__dirname, '../assets/js/single-post.js'), 'utf8');

async function bootSingle(history = {}, options = {}) {
	const dom = new JSDOM('<!doctype html><html><body><article>Single post</article></body></html>', {
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
		retentionDays: 365
	};
	let recordedId = null;
	window.document.addEventListener('wpSeenSinglePostRecorded', (event) => { recordedId = event.detail.postId; });
	window.eval(tracker);
	return {
		window,
		setVisibility(value) {
			visibility = value;
			window.document.dispatchEvent(new window.Event('visibilitychange'));
		},
		writes: () => writes,
		recordedId: () => recordedId
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
});

test('enforces the history size limit when a single post is added', async () => {
	const now = Math.floor(Date.now() / 1000);
	const { window } = await bootSingle({ 1: now - 2, 2: now - 1 }, { postId: 3, maxEntries: 2 });
	await new Promise((resolve) => window.setTimeout(resolve, 10));
	const history = JSON.parse(window.localStorage.getItem('wp_seen_posts_v1'));
	assert.deepEqual(Object.keys(history).sort(), ['2', '3']);
});
