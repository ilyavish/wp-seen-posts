'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const gamification = fs.readFileSync(path.join(__dirname, '../assets/js/gamification.js'), 'utf8');

function badgeDefinitions() {
	return [
		{ key: 'beer', type: 'seen_count', threshold: 5 },
		{ key: 'vodka', type: 'seen_count', threshold: 10 },
		{ key: 'zapoi', type: 'streak', threshold: 4 }
	];
}

function boot(options = {}) {
	const dom = new JSDOM('<!doctype html><html><body><span data-wp-seen-streak hidden></span></body></html>', {
		url: 'https://example.com/', runScripts: 'outside-only'
	});
	const { window } = dom;
	const requests = [];
	if (options.state) window.localStorage.setItem('wp_seen_posts_gamification_v1', JSON.stringify(options.state));
	window.wpSeenGamificationConfig = {
		enabled: options.enabled !== false,
		showProgress: options.showProgress !== false,
		zapoiEnabled: options.zapoiEnabled !== false,
		dailyRequirement: options.dailyRequirement || 3,
		storageKey: 'wp_seen_posts_gamification_v1',
		endpoint: options.endpoint || '',
		siteTimeZone: '',
		serverDate: options.date || '2026-08-20',
		badges: badgeDefinitions(),
		i18n: {
			streak: '🔥 %d-day vodka streak',
			progress: '🔥 %1$d / %2$d posts to keep your streak',
			progressStart: '🔥 %1$d / %2$d posts toward a vodka streak'
		}
	};
	window.fetch = (url, request) => {
		requests.push(JSON.parse(request.body));
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ registered: true, rarities: {} }) });
	};
	window.eval(gamification);
	return {
		window,
		requests,
		setDate(date) { window.wpSeenGamificationConfig.serverDate = date; },
		state() { return window.WPSeenGamification.getState(); },
		record(id, total) { return window.WPSeenGamification.recordSeen(id, total); }
	};
}

test('requires unique posts and completes at most one streak day per site-local date', () => {
	const app = boot();
	app.record(1, 1);
	app.record(1, 1);
	assert.equal(app.state().todayCount, 1);
	assert.equal(app.state().currentStreak, 0);
	app.record(2, 2);
	assert.equal(app.window.document.querySelector('[data-wp-seen-streak]').textContent, '🔥 2 / 3 posts toward a vodka streak');
	app.record(3, 3);
	app.record(4, 4);
	assert.equal(app.state().todayCount, 3);
	assert.equal(app.state().currentStreak, 1);
	assert.equal(app.state().todayCompleted, true);
});

test('increments on consecutive completed dates and unlocks Zapoi only once on day four', () => {
	const app = boot();
	let zapoiUnlocks = 0;
	for (let day = 20; day <= 24; day += 1) {
		app.setDate(`2026-08-${day}`);
		for (let post = 1; post <= 3; post += 1) {
			const result = app.record(day * 10 + post, (day - 20) * 3 + post);
			zapoiUnlocks += result.unlocked.filter((key) => key === 'zapoi').length;
		}
	}
	assert.equal(app.state().currentStreak, 5);
	assert.equal(app.state().longestStreak, 5);
	assert.equal(app.state().unlockedBadges.includes('zapoi'), true);
	assert.equal(zapoiUnlocks, 1);
});

test('a missed calendar date resets current streak but preserves longest streak', () => {
	const app = boot();
	[1, 2, 3].forEach((id) => app.record(id, id));
	app.setDate('2026-08-22');
	[4, 5, 6].forEach((id) => app.record(id, id));
	assert.equal(app.state().currentStreak, 1);
	assert.equal(app.state().longestStreak, 1);
	assert.equal(app.state().lastCompletedDate, '2026-08-22');
});

test('keeps state bounded and reports a reader lazily with all earned count badges', async () => {
	const app = boot({ endpoint: 'https://example.com/wp-json/wp-seen-posts/v1/progress' });
	for (let id = 1; id <= 8; id += 1) app.record(id, id);
	await app.window.WPSeenGamification.sync();
	assert.equal(app.state().todayCount, 3);
	assert.equal(app.requests.length, 1);
	assert.equal(app.requests[0].reader_token.length, 32);
	assert.deepEqual(app.requests[0].badge_keys, ['beer']);
	assert.equal(app.state().unlockedBadges.includes('beer'), true);
	const stored = JSON.parse(app.window.localStorage.getItem('wp_seen_posts_gamification_v1'));
	assert.equal(stored.reportedBadges.includes('beer'), true);
});

test('does not render a misleading zero-day indicator', () => {
	const app = boot();
	const node = app.window.document.querySelector('[data-wp-seen-streak]');
	assert.equal(node.hidden, true);
	assert.equal(node.textContent, '');
	const stored = JSON.parse(app.window.localStorage.getItem('wp_seen_posts_gamification_v1'));
	assert.match(stored.readerToken, /^[a-f0-9]{32}$/);
});

test('removes the retired Barsetka key from legacy browser state on load', () => {
	const app = boot({ state: {
		readerToken: 'b'.repeat(32),
		currentDate: '2026-08-20',
		unlockedBadges: ['beer', 'barsetka'],
		reportedBadges: ['barsetka']
	} });
	const stored = JSON.parse(app.window.localStorage.getItem('wp_seen_posts_gamification_v1'));
	assert.deepEqual(stored.unlockedBadges, ['beer']);
	assert.deepEqual(stored.reportedBadges, []);
});

test('fresh tabs converge on one anonymous reader token', () => {
	const firstToken = 'f'.repeat(32);
	const secondToken = 'a'.repeat(32);
	const app = boot({ state: { readerToken: firstToken, currentDate: '2026-08-20' } });
	app.window.dispatchEvent(new app.window.StorageEvent('storage', {
		key: 'wp_seen_posts_gamification_v1',
		newValue: JSON.stringify({ readerToken: secondToken, currentDate: '2026-08-20', registered: false })
	}));
	const stored = JSON.parse(app.window.localStorage.getItem('wp_seen_posts_gamification_v1'));
	assert.equal(stored.readerToken, secondToken);
});
