const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/analytics.js'), 'utf8');

function analyticsWindow(options = {}) {
	const dom = new JSDOM('<!doctype html><title>Analytics</title>', {
		url: 'https://holdmyvodka.com/tag/vodka/',
		runScripts: 'outside-only',
		pretendToBeVisual: true
	});
	const { window } = dom;
	Object.defineProperty(window.document, 'visibilityState', { value: options.hidden ? 'hidden' : 'visible', configurable: true });
	if (options.dnt) Object.defineProperty(window.navigator, 'doNotTrack', { value: '1', configurable: true });
	window.wpSeenPostsAnalytics = {
		endpoint: 'https://holdmyvodka.com/wp-json/wp-seen-posts/v1/analytics/view',
		route: { key: 'tag:post_tag:55', type: 'tag', object_id: 55, path: 'https://holdmyvodka.com/tag/vodka/', title: 'Tag: Vodka' },
		signature: 'signed-route',
		delay: 250,
		respectDnt: options.respectDnt !== false
	};
	window.localStorage.setItem('wp_seen_analytics_visitor_v1', 'ab'.repeat(16));
	const requests = [];
	window.fetch = (url, request) => {
		requests.push({ url, request });
		return Promise.resolve({ ok: true });
	};
	window.setTimeout = (callback) => { callback(); return 1; };
	window.eval(source);
	return { window, requests };
}

test('sends one signed route beacon with the stable anonymous visitor', () => {
	const { window, requests } = analyticsWindow();
	assert.equal(requests.length, 1);
	const payload = JSON.parse(requests[0].request.body);
	assert.equal(requests[0].request.keepalive, true);
	assert.equal(payload.route.key, 'tag:post_tag:55');
	assert.equal(payload.signature, 'signed-route');
	assert.equal(payload.visitor, 'ab'.repeat(16));
	window.document.dispatchEvent(new window.Event('visibilitychange'));
	assert.equal(requests.length, 1);
});

test('waits for a hidden page to become visible before counting', () => {
	const { window, requests } = analyticsWindow({ hidden: true });
	assert.equal(requests.length, 0);
	Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
	window.document.dispatchEvent(new window.Event('visibilitychange'));
	assert.equal(requests.length, 1);
});

test('does not start analytics when Do Not Track is enabled', () => {
	const { requests } = analyticsWindow({ dnt: true });
	assert.equal(requests.length, 0);
});

test('does not start analytics when Global Privacy Control is enabled', () => {
	const dom = new JSDOM('<!doctype html>', { url: 'https://holdmyvodka.com/', runScripts: 'outside-only', pretendToBeVisual: true });
	const { window } = dom;
	Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: true, configurable: true });
	window.wpSeenPostsAnalytics = {
		endpoint: 'https://holdmyvodka.com/wp-json/wp-seen-posts/v1/analytics/view',
		route: { key: 'home', type: 'home', object_id: 0, path: 'https://holdmyvodka.com/', title: 'Homepage' },
		signature: 'signed-route',
		delay: 250,
		respectDnt: true
	};
	let requests = 0;
	window.fetch = () => { requests += 1; return Promise.resolve({ ok: true }); };
	window.eval(source);
	assert.equal(requests, 0);
});
