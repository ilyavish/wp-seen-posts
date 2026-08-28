(function () {
	'use strict';

	var config = window.wpSeenPostsAnalytics || {};
	if (!config.endpoint || !config.route || !config.signature || typeof window.fetch !== 'function') return;
	if (config.respectDnt && ((navigator.globalPrivacyControl === true) || navigator.doNotTrack === '1' || window.doNotTrack === '1')) return;
	if (window.wpSeenPostsAnalyticsStarted) return;
	window.wpSeenPostsAnalyticsStarted = true;

	var storageKey = 'wp_seen_analytics_visitor_v1';
	var sent = false;
	var timer = 0;
	var delay = Math.max(250, Math.min(10000, Number(config.delay) || 1000));

	function randomToken() {
		var bytes = new Uint8Array(16);
		if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
			window.crypto.getRandomValues(bytes);
			return Array.prototype.map.call(bytes, function (byte) {
				return byte.toString(16).padStart(2, '0');
			}).join('');
		}
		var fallback = '';
		for (var index = 0; index < 4; index += 1) {
			fallback += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
		}
		return fallback;
	}

	function visitorToken() {
		var token = '';
		try { token = window.localStorage.getItem(storageKey) || ''; } catch (error) {}
		if (!/^[a-f0-9]{32,64}$/.test(token)) {
			try { token = window.sessionStorage.getItem(storageKey) || ''; } catch (error) {}
		}
		if (/^[a-f0-9]{32,64}$/.test(token)) return token;
		token = randomToken();
		try { window.localStorage.setItem(storageKey, token); } catch (error) {}
		try { window.sessionStorage.setItem(storageKey, token); } catch (error) {}
		return token;
	}

	function record() {
		if (sent || document.visibilityState === 'hidden') return;
		sent = true;
		window.fetch(config.endpoint, {
			method: 'POST',
			credentials: 'same-origin',
			keepalive: true,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				route: config.route,
				signature: config.signature,
				visitor: visitorToken()
			})
		}).catch(function () {
			/* Analytics must never interrupt page interaction. A failed beacon is
			 * intentionally not retried during this page view. */
		});
	}

	function schedule() {
		if (sent || timer || document.visibilityState === 'hidden') return;
		timer = window.setTimeout(function () {
			timer = 0;
			record();
		}, delay);
	}

	function visibilityChanged() {
		if (document.visibilityState === 'hidden') {
			if (timer) window.clearTimeout(timer);
			timer = 0;
			return;
		}
		schedule();
	}

	document.addEventListener('visibilitychange', visibilityChanged);
	schedule();
})();
