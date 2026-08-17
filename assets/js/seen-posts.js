(function () {
	'use strict';

	var config = window.wpSeenPostsConfig || {};
	var adapters = window.WPSeenPostsAdapters;
	if (!adapters || !('IntersectionObserver' in window)) return;

	function safeNumber(value, fallback) {
		value = Number(value);
		return Number.isFinite(value) && value > 0 ? value : fallback;
	}

	function visibilityThreshold() {
		return Math.min(1, Math.max(0.05, safeNumber(config.threshold, 0.5)));
	}

	function observerThresholds(maximum) {
		var thresholds = [0];
		var step = 0.05;
		for (var value = step; value < maximum; value += step) thresholds.push(Number(value.toFixed(2)));
		thresholds.push(maximum);
		return thresholds;
	}

	function hasEnoughVisibility(entry, threshold) {
		var cardHeight = Math.max(0, entry.boundingClientRect.height || 0);
		var visibleHeight = Math.max(0, entry.intersectionRect.height || 0);
		var availableHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
		var requiredHeight = Math.min(cardHeight, availableHeight) * threshold;
		return entry.isIntersecting && visibleHeight >= requiredHeight;
	}

	function readHistory() {
		try {
			var parsed = JSON.parse(window.localStorage.getItem(config.storageKey || 'wp_seen_posts_v1') || '{}');
			if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
			var clean = {};
			Object.keys(parsed).forEach(function (id) {
				if (/^[1-9]\d*$/.test(id) && Number.isFinite(Number(parsed[id])) && Number(parsed[id]) > 0) clean[id] = Math.floor(Number(parsed[id]));
			});
			return clean;
		} catch (error) { return {}; }
	}

	function prune(history) {
		var cutoff = Math.floor(Date.now() / 1000) - safeNumber(config.retentionDays, 365) * 86400;
		var max = Math.floor(safeNumber(config.maxEntries, 3000));
		var entries = Object.keys(history).filter(function (id) { return history[id] >= cutoff; }).map(function (id) { return [id, history[id]]; });
		entries.sort(function (a, b) { return b[1] - a[1]; });
		var clean = {};
		entries.slice(0, max).forEach(function (entry) { clean[entry[0]] = entry[1]; });
		return clean;
	}

	function init() {
		var adapter = adapters.detect(document, config);
		if (!adapter) return;

		var feed = adapter.feedContainer;
		var history = prune(readHistory());
		var historyAtLoad = new Set(Object.keys(history));
		var sessionSeen = new Set();
		var cards = new Map();
		var timers = new Map();
		var showSeen = false;
		var hideSessionSeen = false;
		var feedExhausted = config.hasMorePages === false;
		var writesSincePrune = 0;

		function writeHistory(forcePrune) {
			try {
				writesSincePrune += 1;
				if (forcePrune || writesSincePrune >= 25) {
					history = prune(history);
					writesSincePrune = 0;
				}
				window.localStorage.setItem(config.storageKey || 'wp_seen_posts_v1', JSON.stringify(history));
			} catch (error) {}
		}
		writeHistory(true);

		var controls = document.createElement('div');
		controls.className = 'wp-seen-posts-controls';
		var toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'wp-seen-posts-toggle';
		var reset = document.createElement('button');
		reset.type = 'button';
		reset.className = 'wp-seen-posts-reset';
		reset.textContent = config.i18n.reset;
		controls.appendChild(toggle);
		controls.appendChild(reset);
		feed.insertAdjacentElement('beforebegin', controls);

		var empty = document.createElement('p');
		empty.className = 'wp-seen-posts-empty';
		empty.hidden = true;
		empty.setAttribute('role', 'status');
		empty.setAttribute('aria-live', 'polite');
		empty.textContent = config.i18n.caughtUp;
		feed.insertAdjacentElement('beforebegin', empty);

		function seenCount() {
			var count = 0;
			cards.forEach(function (card) { if (card.classList.contains('wp-seen-posts-is-seen')) count += 1; });
			return count;
		}

		function shouldHide(id) {
			if (showSeen) return false;
			return historyAtLoad.has(id) || (hideSessionSeen && sessionSeen.has(id));
		}

		function applyCardVisibility(card, id) {
			var hidden = card.classList.contains('wp-seen-posts-is-seen') && shouldHide(id);
			card.classList.toggle('wp-seen-posts-is-hidden', hidden);
			card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
		}

		function updateUi() {
			var count = seenCount();
			toggle.textContent = showSeen ? config.i18n.hideSeen : config.i18n.showSeen + ' (' + count + ')';
			toggle.setAttribute('aria-expanded', showSeen ? 'true' : 'false');
			toggle.disabled = count === 0;
			reset.hidden = Object.keys(history).length === 0;
			var visible = 0;
			cards.forEach(function (card) { if (!card.classList.contains('wp-seen-posts-is-hidden')) visible += 1; });
			empty.hidden = !(feedExhausted && cards.size > 0 && visible === 0 && count === cards.size);
		}

		function refreshFeedExhaustion() {
			var infiniteControls = document.querySelector('.wp-pfis-controls');
			if (infiniteControls) {
				feedExhausted = !infiniteControls.querySelector('.wp-pfis-load-more') && !infiniteControls.querySelector('.wp-pfis-sentinel');
			}
			updateUi();
		}

		function requestMoreIfAllHidden() {
			if (feedExhausted || showSeen || !cards.size) return;
			var hasVisibleCard = false;
			cards.forEach(function (card) {
				if (!card.classList.contains('wp-seen-posts-is-hidden')) hasVisibleCard = true;
			});
			if (hasVisibleCard) return;

			var loadMore = document.querySelector('.wp-pfis-load-more:not([aria-disabled="true"]):not(:disabled)');
			if (loadMore) loadMore.click();
		}

		function continueFeedIfNeeded() {
			refreshFeedExhaustion();
			requestMoreIfAllHidden();
		}

		function setSeen(card, id, fromHistory) {
			card.classList.add('wp-seen-posts-is-seen');
			card.dataset.seenPostState = 'seen';
			if (!card.querySelector(':scope > .wp-seen-posts-badge')) {
				var cardPosition = window.getComputedStyle(card).position;
				if (!cardPosition || cardPosition === 'static') card.classList.add('wp-seen-posts-position-context');
				var badge = document.createElement('span');
				badge.className = 'wp-seen-posts-badge';
				badge.textContent = config.i18n.seen;
				card.insertAdjacentElement('afterbegin', badge);
			}
			if (!fromHistory) {
				history[id] = Math.floor(Date.now() / 1000);
				sessionSeen.add(id);
				writeHistory(false);
			}
			observer.unobserve(card);
			applyCardVisibility(card, id);
			updateUi();
		}

		var observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				var card = entry.target;
				var id = card.dataset.seenPostId;
				if (hasEnoughVisibility(entry, visibilityThreshold()) && document.visibilityState === 'visible') {
					if (!timers.has(card)) {
						timers.set(card, window.setTimeout(function () {
							timers.delete(card);
							if (document.visibilityState === 'visible' && card.dataset.seenPostState === 'unseen') setSeen(card, id, false);
						}, safeNumber(config.dwellTime, 1000)));
					}
				} else if (timers.has(card)) {
					window.clearTimeout(timers.get(card));
					timers.delete(card);
				}
			});
		}, { threshold: observerThresholds(visibilityThreshold()) });

		document.addEventListener('visibilitychange', function () {
			if (document.visibilityState !== 'visible') {
				timers.forEach(function (timer) { window.clearTimeout(timer); });
				timers.clear();
				return;
			}
			/* Re-observe eligible cards so a dwell period can restart after returning to the tab. */
			cards.forEach(function (card) {
				if (card.dataset.seenPostState === 'unseen') {
					observer.unobserve(card);
					observer.observe(card);
				}
			});
		});

		function initializePosts(posts) {
			Array.prototype.forEach.call(posts || [], function (card) {
				if (!card || card.nodeType !== 1 || card.dataset.seenPostInitialized === 'true') return;
				var id = adapters.postId(card);
				if (!id) return;
				card.dataset.seenPostInitialized = 'true';
				card.dataset.seenPostId = id;
				cards.set(id, card);
				if (historyAtLoad.has(id)) setSeen(card, id, true);
				else {
					card.dataset.seenPostState = 'unseen';
					observer.observe(card);
				}
			});
			updateUi();
		}

		function setShowSeen(value) {
			showSeen = value;
			if (!value) hideSessionSeen = true;
			cards.forEach(function (card, id) { applyCardVisibility(card, id); });
			updateUi();
			if (!value) window.setTimeout(requestMoreIfAllHidden, 0);
		}

		toggle.addEventListener('click', function () { setShowSeen(!showSeen); });
		reset.addEventListener('click', function () {
			if (!window.confirm(config.i18n.confirmReset)) return;
			try { window.localStorage.removeItem(config.storageKey || 'wp_seen_posts_v1'); } catch (error) {}
			history = {};
			historyAtLoad.clear();
			sessionSeen.clear();
			showSeen = false;
			hideSessionSeen = false;
			cards.forEach(function (card) {
				card.classList.remove('wp-seen-posts-is-seen', 'wp-seen-posts-is-hidden');
				card.classList.remove('wp-seen-posts-position-context');
				card.removeAttribute('aria-hidden');
				card.dataset.seenPostState = 'unseen';
				var badge = card.querySelector(':scope > .wp-seen-posts-badge');
				if (badge) badge.remove();
				observer.observe(card);
			});
			updateUi();
		});

		document.addEventListener('wpFeedPostsAdded', function (event) {
			if (!event.detail || event.detail.container !== feed || !event.detail.posts) return;
			initializePosts(event.detail.posts);
			/* Wait until the companion loader finishes updating its controls, then skip an all-Seen page. */
			window.setTimeout(continueFeedIfNeeded, 0);
		});

		document.addEventListener('wpFeedInfiniteScrollReady', function (event) {
			if (event.detail && event.detail.container && event.detail.container !== feed) return;
			window.setTimeout(continueFeedIfNeeded, 0);
		});

		document.addEventListener('wpFeedInfiniteScrollFinished', function (event) {
			if (event.detail && event.detail.container && event.detail.container !== feed) return;
			feedExhausted = true;
			updateUi();
		});

		initializePosts(adapter.posts);
		document.documentElement.classList.add('wp-seen-posts-active');
		window.setTimeout(continueFeedIfNeeded, 0);
	}

	if (document.readyState === 'loading' && !document.body) document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
}());
