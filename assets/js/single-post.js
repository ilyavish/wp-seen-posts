(function () {
	'use strict';

	var config = window.wpSeenSinglePostConfig || {};
	var postId = String(Math.floor(Number(config.postId) || 0));
	if (!/^[1-9]\d*$/.test(postId)) return;

	var timer = null;
	var recorded = false;

	function safeNumber(value, fallback) {
		value = Number(value);
		return Number.isFinite(value) && value > 0 ? value : fallback;
	}

	function normalizeHistory(parsed) {
		if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
		var cutoff = Math.floor(Date.now() / 1000) - safeNumber(config.retentionDays, 365) * 86400;
		var max = Math.floor(safeNumber(config.maxEntries, 3000));
		var entries = [];
		Object.keys(parsed).forEach(function (id) {
			var timestamp = Number(parsed[id]);
			if (/^[1-9]\d*$/.test(id) && Number.isFinite(timestamp) && timestamp >= cutoff) entries.push([id, Math.floor(timestamp)]);
		});
		if (entries.length > max) {
			entries.sort(function (a, b) { return b[1] - a[1]; });
			entries.length = max;
		}
		var clean = {};
		entries.forEach(function (entry) { clean[entry[0]] = entry[1]; });
		return clean;
	}

	function recordPost() {
		timer = null;
		if (recorded || document.visibilityState !== 'visible') return;
		try {
			var storageKey = config.storageKey || 'wp_seen_posts_v1';
			var history = normalizeHistory(JSON.parse(window.localStorage.getItem(storageKey) || '{}'));
			if (!Object.prototype.hasOwnProperty.call(history, postId)) {
				history[postId] = Math.floor(Date.now() / 1000);
				history = normalizeHistory(history);
				window.localStorage.setItem(storageKey, JSON.stringify(history));
			}
			recorded = true;
			document.dispatchEvent(new window.CustomEvent('wpSeenSinglePostRecorded', { detail: { postId: postId } }));
		} catch (error) {
			recorded = true;
		}
	}

	function schedule() {
		if (recorded || timer || document.visibilityState !== 'visible') return;
		timer = window.setTimeout(recordPost, safeNumber(config.dwellTime, 1000));
	}

	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'visible') schedule();
		else if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}
	});
	window.addEventListener('pagehide', function () {
		if (timer) window.clearTimeout(timer);
		timer = null;
	});

	schedule();
}());
