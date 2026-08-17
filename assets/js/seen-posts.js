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

	function readHistory(preloaded) {
		try {
			var parsed = typeof preloaded === 'undefined' ? JSON.parse(window.localStorage.getItem(config.storageKey || 'wp_seen_posts_v1') || '{}') : preloaded;
			return normalizeHistory(parsed);
		} catch (error) { return {}; }
	}

	function readMilestones() {
		if (!Array.isArray(config.badges)) return [];
		return config.badges.map(function (badge) {
			return {
				key: badge && typeof badge.key === 'string' ? badge.key : '',
				threshold: Math.floor(Number(badge && badge.threshold) || 0),
				label: badge && typeof badge.label === 'string' ? badge.label : '',
				url: badge && typeof badge.url === 'string' ? badge.url : ''
			};
		}).filter(function (badge) {
			return badge.key && badge.threshold > 0 && badge.label && badge.url;
		}).sort(function (a, b) { return a.threshold - b.threshold; });
	}

	function init() {
		var earlyHide = window.WPSeenPostsEarlyHide;
		if (earlyHide) earlyHide.stop();
		var adapter = adapters.detect(document, config);
		if (!adapter) {
			if (earlyHide) earlyHide.release();
			return;
		}

		var feed = adapter.feedContainer;
		var requiredVisibility = visibilityThreshold();
		/* The head bootstrap already parsed storage; reuse it instead of blocking reload with a second parse. */
		var history = readHistory(earlyHide && earlyHide.history);
		if (earlyHide) earlyHide.history = null;
		var historyAtLoad = new Set(Object.keys(history));
		var historyEntryCount = historyAtLoad.size;
		var milestones = readMilestones();
		var reloadPreviewIds = new Set();
		var reloadPreviewCount = Number(config.reloadPreviewCount);
		if (!Number.isFinite(reloadPreviewCount) || reloadPreviewCount < 0) reloadPreviewCount = 2;
		reloadPreviewCount = Math.floor(reloadPreviewCount);
		var initialPostIds = Array.prototype.map.call(adapter.posts || [], function (card) { return adapters.postId(card); }).filter(Boolean);
		if (initialPostIds.length && initialPostIds.every(function (id) { return historyAtLoad.has(id); })) {
			initialPostIds.slice(0, reloadPreviewCount).forEach(function (id) { reloadPreviewIds.add(id); });
		}
		var sessionSeen = new Set();
		var cards = new Map();
		var timers = new Map();
		var seenCardCount = 0;
		var hiddenCardCount = 0;
		var showSeen = false;
		var hideSessionSeen = false;
		var feedExhausted = config.hasMorePages === false;
		var infiniteReady = document.documentElement.classList.contains('wp-pfis-active');
		var writesSincePrune = 0;
		var historyWriteTimer = null;
		var historyDirty = false;
		var achievementSignature = '';
		var activeMilestoneKey = '';

		function flushHistory(forcePrune) {
			if (historyWriteTimer) window.clearTimeout(historyWriteTimer);
			historyWriteTimer = null;
			if (!forcePrune && !historyDirty) return;
			try {
				if (forcePrune || writesSincePrune >= 25) {
					history = normalizeHistory(history);
					historyEntryCount = Object.keys(history).length;
					writesSincePrune = 0;
				}
				window.localStorage.setItem(config.storageKey || 'wp_seen_posts_v1', JSON.stringify(history));
			} catch (error) {}
			historyDirty = false;
		}

		function scheduleHistoryWrite() {
			historyDirty = true;
			writesSincePrune += 1;
			if (!historyWriteTimer) historyWriteTimer = window.setTimeout(function () { flushHistory(false); }, 0);
		}

		var controls = document.createElement('div');
		controls.className = 'wp-seen-posts-controls';
		var toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'wp-seen-posts-toggle';
		var reset = document.createElement('button');
		reset.type = 'button';
		reset.className = 'wp-seen-posts-reset';
		reset.textContent = config.i18n.reset;
		var achievements = document.createElement('div');
		achievements.className = 'wp-seen-posts-achievements';
		achievements.hidden = true;
		achievements.setAttribute('role', 'list');
		achievements.setAttribute('aria-label', config.i18n.achievements || 'Seen achievements');
		controls.appendChild(toggle);
		controls.appendChild(achievements);
		controls.appendChild(reset);
		feed.insertAdjacentElement('beforebegin', controls);

		var empty = document.createElement('p');
		empty.className = 'wp-seen-posts-empty';
		empty.hidden = true;
		empty.setAttribute('role', 'status');
		empty.setAttribute('aria-live', 'polite');
		empty.textContent = config.i18n.caughtUp;
		feed.insertAdjacentElement('beforebegin', empty);

		function shouldHide(id) {
			if (showSeen) return false;
			if (reloadPreviewIds.has(id)) return false;
			return historyAtLoad.has(id) || (hideSessionSeen && sessionSeen.has(id));
		}

		function applyCardVisibility(card, id) {
			var hidden = card.classList.contains('wp-seen-posts-is-seen') && shouldHide(id);
			var wasHidden = card.classList.contains('wp-seen-posts-is-hidden');
			if (hidden !== wasHidden) hiddenCardCount += hidden ? 1 : -1;
			card.classList.toggle('wp-seen-posts-is-hidden', hidden);
			card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
		}

		function currentMilestone() {
			var current = null;
			milestones.forEach(function (milestone) {
				if (historyEntryCount >= milestone.threshold) current = milestone;
			});
			return current;
		}

		function createMilestoneImage(milestone, className, size) {
			var image = document.createElement('img');
			image.className = className;
			image.src = milestone.url;
			image.alt = '';
			image.width = size;
			image.height = size;
			image.decoding = 'async';
			image.setAttribute('aria-hidden', 'true');
			return image;
		}

		function renderCardBadge(badge) {
			var milestone = currentMilestone();
			while (badge.firstChild) badge.removeChild(badge.firstChild);
			badge.classList.toggle('wp-seen-posts-badge-earned', Boolean(milestone));
			if (!milestone) {
				badge.textContent = config.i18n.seen;
				badge.removeAttribute('aria-label');
				badge.removeAttribute('title');
				return;
			}
			badge.setAttribute('aria-label', milestone.label);
			badge.title = milestone.label;
			badge.appendChild(createMilestoneImage(milestone, 'wp-seen-posts-badge-image', 24));
		}

		function updateAchievements() {
			var earned = milestones.filter(function (milestone) { return historyEntryCount >= milestone.threshold; });
			var signature = earned.map(function (milestone) { return milestone.key; }).join(',');
			if (signature !== achievementSignature) {
				achievementSignature = signature;
				while (achievements.firstChild) achievements.removeChild(achievements.firstChild);
				earned.forEach(function (milestone) {
					var item = document.createElement('span');
					item.className = 'wp-seen-posts-achievement';
					item.dataset.badgeKey = milestone.key;
					item.setAttribute('role', 'listitem');
					item.setAttribute('aria-label', milestone.label);
					item.title = milestone.label;
					item.appendChild(createMilestoneImage(milestone, 'wp-seen-posts-achievement-image', 32));
					achievements.appendChild(item);
				});
				achievements.hidden = earned.length === 0;
			}

			var active = currentMilestone();
			var nextActiveKey = active ? active.key : '';
			if (nextActiveKey !== activeMilestoneKey) {
				activeMilestoneKey = nextActiveKey;
				cards.forEach(function (card) {
					var badge = card.querySelector(':scope > .wp-seen-posts-badge');
					if (badge) renderCardBadge(badge);
				});
			}
		}

		function updateUi() {
			updateAchievements();
			var count = seenCardCount;
			toggle.textContent = showSeen ? config.i18n.hideSeen : config.i18n.showSeen + ' (' + count + ')';
			toggle.setAttribute('aria-expanded', showSeen ? 'true' : 'false');
			toggle.disabled = count === 0;
			reset.hidden = historyEntryCount === 0;
			var visible = cards.size - hiddenCardCount;
			var allHidden = !showSeen && cards.size > 0 && visible === 0 && count === cards.size;
			var canStillAdvance = !feedExhausted && (infiniteReady || document.readyState !== 'complete');
			var previewOnly = !showSeen && reloadPreviewIds.size > 0 && count === cards.size;
			empty.textContent = canStillAdvance ? config.i18n.loadingUnseen : (feedExhausted ? config.i18n.caughtUp : config.i18n.noUnseenPage);
			empty.classList.toggle('wp-seen-posts-empty-loading', allHidden && canStillAdvance);
			empty.hidden = !(allHidden || (previewOnly && !canStillAdvance));
		}

		function refreshFeedExhaustion() {
			var infiniteControls = document.querySelector('.wp-pfis-controls');
			if (infiniteControls) {
				infiniteReady = true;
				feedExhausted = !infiniteControls.querySelector('.wp-pfis-load-more') && !infiniteControls.querySelector('.wp-pfis-sentinel');
			}
			updateUi();
		}

		function requestMoreIfAllHidden() {
			if (feedExhausted || showSeen || !cards.size) return;
			var hasVisibleCard = false;
			cards.forEach(function (card, id) {
				if (!reloadPreviewIds.has(id) && !card.classList.contains('wp-seen-posts-is-hidden')) hasVisibleCard = true;
			});
			if (hasVisibleCard) return;

			var loadMore = document.querySelector('.wp-pfis-load-more:not([aria-disabled="true"]):not(:disabled)');
			if (loadMore) loadMore.click();
		}

		function continueFeedIfNeeded() {
			refreshFeedExhaustion();
			requestMoreIfAllHidden();
		}

		function ensureBadge(card) {
			var badge = card.querySelector(':scope > .wp-seen-posts-badge');
			if (!badge) {
				var cardPosition = window.getComputedStyle(card).position;
				if (!cardPosition || cardPosition === 'static') card.classList.add('wp-seen-posts-position-context');
				badge = document.createElement('span');
				badge.className = 'wp-seen-posts-badge';
				card.insertAdjacentElement('afterbegin', badge);
			}
			renderCardBadge(badge);
		}

		function setSeen(card, id, fromHistory, deferUi) {
			if (card.dataset.seenPostState !== 'seen') seenCardCount += 1;
			card.classList.add('wp-seen-posts-is-seen');
			card.dataset.seenPostState = 'seen';
			if (!fromHistory) {
				if (!Object.prototype.hasOwnProperty.call(history, id)) historyEntryCount += 1;
				history[id] = Math.floor(Date.now() / 1000);
				sessionSeen.add(id);
				scheduleHistoryWrite();
			}
			if (!fromHistory || reloadPreviewIds.has(id)) ensureBadge(card);
			card.classList.toggle('wp-seen-posts-reload-preview', reloadPreviewIds.has(id));
			observer.unobserve(card);
			applyCardVisibility(card, id);
			if (!deferUi) updateUi();
		}

		var observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				var card = entry.target;
				var id = card.dataset.seenPostId;
				if (hasEnoughVisibility(entry, requiredVisibility) && document.visibilityState === 'visible') {
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
		}, { threshold: observerThresholds(requiredVisibility) });

		document.addEventListener('visibilitychange', function () {
			if (document.visibilityState !== 'visible') {
				flushHistory(false);
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
		window.addEventListener('pagehide', function () { flushHistory(false); });

		function initializePosts(posts) {
			Array.prototype.forEach.call(posts || [], function (card) {
				if (!card || card.nodeType !== 1 || card.dataset.seenPostInitialized === 'true') return;
				var id = adapters.postId(card);
				if (!id) return;
				card.dataset.seenPostInitialized = 'true';
				card.dataset.seenPostId = id;
				cards.set(id, card);
				if (historyAtLoad.has(id)) setSeen(card, id, true, true);
				else {
					card.dataset.seenPostState = 'unseen';
					observer.observe(card);
				}
			});
			updateUi();
		}

		function setShowSeen(value) {
			showSeen = value;
			if (!value) {
				hideSessionSeen = true;
				reloadPreviewIds.clear();
			}
			cards.forEach(function (card, id) {
				if (value && card.dataset.seenPostState === 'seen') ensureBadge(card);
				card.classList.toggle('wp-seen-posts-reload-preview', reloadPreviewIds.has(id));
				applyCardVisibility(card, id);
			});
			updateUi();
			if (!value) window.setTimeout(requestMoreIfAllHidden, 0);
		}

		toggle.addEventListener('click', function () { setShowSeen(!showSeen); });
		reset.addEventListener('click', function () {
			if (!window.confirm(config.i18n.confirmReset)) return;
			if (historyWriteTimer) window.clearTimeout(historyWriteTimer);
			historyWriteTimer = null;
			historyDirty = false;
			try { window.localStorage.removeItem(config.storageKey || 'wp_seen_posts_v1'); } catch (error) {}
			history = {};
			historyEntryCount = 0;
			historyAtLoad.clear();
			sessionSeen.clear();
			reloadPreviewIds.clear();
			seenCardCount = 0;
			hiddenCardCount = 0;
			showSeen = false;
			hideSessionSeen = false;
			cards.forEach(function (card) {
				card.classList.remove('wp-seen-posts-is-seen', 'wp-seen-posts-is-hidden', 'wp-seen-posts-reload-preview');
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
			infiniteReady = true;
			continueFeedIfNeeded();
		});

		document.addEventListener('wpFeedInfiniteScrollFinished', function (event) {
			if (event.detail && event.detail.container && event.detail.container !== feed) return;
			feedExhausted = true;
			updateUi();
		});
		window.addEventListener('load', function () { if (!infiniteReady) updateUi(); }, { once: true });

		initializePosts(adapter.posts);
		if (earlyHide) earlyHide.release(true);
		document.documentElement.classList.add('wp-seen-posts-active');
		window.setTimeout(continueFeedIfNeeded, 0);
	}

	if (document.readyState === 'loading' && !document.body) document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
}());
