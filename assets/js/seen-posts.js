(function () {
	'use strict';

	var config = window.wpSeenPostsConfig || {};
	var adapters = window.WPSeenPostsAdapters;
	if (!adapters || !('IntersectionObserver' in window)) return;

	function safeNumber(value, fallback) {
		value = Number(value);
		return Number.isFinite(value) && value > 0 ? value : fallback;
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

		var empty = document.createElement('div');
		empty.className = 'wp-seen-posts-empty';
		empty.hidden = true;
		var emptyTitle = document.createElement('strong');
		emptyTitle.textContent = config.i18n.caughtUp;
		var emptyDetail = document.createElement('span');
		emptyDetail.textContent = config.i18n.caughtUpDetail;
		var emptyShow = document.createElement('button');
		emptyShow.type = 'button';
		emptyShow.textContent = config.i18n.showSeenPosts;
		empty.appendChild(emptyTitle);
		empty.appendChild(emptyDetail);
		empty.appendChild(emptyShow);
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
			toggle.disabled = count === 0;
			reset.hidden = Object.keys(history).length === 0;
			var visible = 0;
			cards.forEach(function (card) { if (!card.classList.contains('wp-seen-posts-is-hidden')) visible += 1; });
			empty.hidden = !(cards.size > 0 && visible === 0 && count === cards.size);
		}

		function setSeen(card, id, fromHistory) {
			card.classList.add('wp-seen-posts-is-seen');
			card.dataset.seenPostState = 'seen';
			if (!card.querySelector(':scope > .wp-seen-posts-badge')) {
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
				if (entry.isIntersecting && entry.intersectionRatio >= safeNumber(config.threshold, 0.5) && document.visibilityState === 'visible') {
					if (!timers.has(card)) {
						timers.set(card, window.setTimeout(function () {
							timers.delete(card);
							if (document.visibilityState === 'visible' && card.dataset.seenPostState === 'unseen') setSeen(card, id, false);
						}, safeNumber(config.dwellTime, 750)));
					}
				} else if (timers.has(card)) {
					window.clearTimeout(timers.get(card));
					timers.delete(card);
				}
			});
		}, { threshold: [safeNumber(config.threshold, 0.5)] });

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
		}

		toggle.addEventListener('click', function () { setShowSeen(!showSeen); });
		emptyShow.addEventListener('click', function () { setShowSeen(true); });
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
			/* Use the companion plugin's own control to cross an all-hidden page. */
			var added = Array.prototype.filter.call(event.detail.posts, function (post) { return post && post.dataset.seenPostInitialized === 'true'; });
			if (added.length && added.every(function (post) { return post.classList.contains('wp-seen-posts-is-hidden'); })) {
				var loadMore = document.querySelector('.wp-pfis-load-more:not([aria-disabled="true"])');
				if (loadMore) window.setTimeout(function () { loadMore.click(); }, 0);
			}
		});

		initializePosts(adapter.posts);
		document.documentElement.classList.add('wp-seen-posts-active');
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
}());
