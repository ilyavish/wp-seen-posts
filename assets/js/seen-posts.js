(function () {
	'use strict';

	var config = window.wpSeenPostsConfig || {};
	var adapters = window.WPSeenPostsAdapters;
	var publicCounts = window.WPSeenPublicCounts;
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

	function mergeHistories(base, additions) {
		var merged = {};
		[base, additions].forEach(function (source) {
			if (!source || Array.isArray(source) || typeof source !== 'object') return;
			Object.keys(source).forEach(function (id) {
				var timestamp = Number(source[id]);
				if (!/^[1-9]\d*$/.test(id) || !Number.isFinite(timestamp)) return;
				timestamp = Math.floor(timestamp);
				if (!Object.prototype.hasOwnProperty.call(merged, id) || timestamp > merged[id]) merged[id] = timestamp;
			});
		});
		return merged;
	}

	function readMilestones() {
		if (!Array.isArray(config.badges)) return [];
		return config.badges.map(function (badge) {
			return {
				key: badge && typeof badge.key === 'string' ? badge.key : '',
				threshold: Math.floor(Number(badge && badge.threshold) || 0),
				label: badge && typeof badge.label === 'string' ? badge.label : '',
				description: badge && typeof badge.description === 'string' ? badge.description : '',
				alt: badge && typeof badge.alt === 'string' ? badge.alt : '',
				url: badge && typeof badge.url === 'string' ? badge.url : ''
			};
		}).filter(function (badge) {
			return badge.key && badge.threshold > 0 && badge.label && badge.description && badge.url;
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
		var storageKey = config.storageKey || 'wp_seen_posts_v1';
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
		var hiddenSessionSeen = new Set();
		var feedExhausted = config.hasMorePages === false;
		var infiniteReady = document.documentElement.classList.contains('wp-pfis-active');
		var writesSincePrune = 0;
		var historyWriteTimer = null;
		var historyDirty = false;
		var pendingHistory = {};
		var achievementSignature = '';
		var achievementsInitialized = false;
		var activeMilestoneKey = '';
		var milestoneToast = null;
		var milestoneToastTimer = null;
		var previewLoadingDelay = safeNumber(config.previewLoadingDelay, 500);
		var previewLoadingTimer = null;
		var previewLoadingVisible = false;

		function flushHistory(forcePrune) {
			if (historyWriteTimer) window.clearTimeout(historyWriteTimer);
			historyWriteTimer = null;
			if (!forcePrune && !historyDirty) return;
			var previousCount = historyEntryCount;
			var wroteHistory = false;
			try {
				/* Merge only this tab's pending additions into the latest stored value. This
				 * preserves posts recorded by other tabs without resurrecting a reset. */
				history = mergeHistories(readHistory(), pendingHistory);
				if (forcePrune || writesSincePrune >= 25) {
					history = normalizeHistory(history);
					writesSincePrune = 0;
				}
				historyEntryCount = Object.keys(history).length;
				window.localStorage.setItem(storageKey, JSON.stringify(history));
				pendingHistory = {};
				wroteHistory = true;
			} catch (error) {}
			historyDirty = !wroteHistory && Object.keys(pendingHistory).length > 0;
			if (previousCount !== historyEntryCount) updateUi();
		}

		function syncHistoryFromStorage(storedValue) {
			var previousCount = historyEntryCount;
			var storedHistory;
			if (typeof storedValue === 'string' || storedValue === null) {
				try { storedHistory = normalizeHistory(JSON.parse(storedValue || '{}')); }
				catch (error) { storedHistory = {}; }
			} else storedHistory = readHistory();
			history = mergeHistories(storedHistory, pendingHistory);
			historyEntryCount = Object.keys(history).length;
			if (previousCount !== historyEntryCount) updateUi();
		}

		function scheduleHistoryWrite() {
			historyDirty = true;
			writesSincePrune += 1;
			if (!historyWriteTimer) historyWriteTimer = window.setTimeout(function () { flushHistory(false); }, 0);
		}

		var controls = document.createElement('div');
		controls.className = 'wp-seen-posts-controls';
		var actions = document.createElement('div');
		actions.className = 'wp-seen-posts-actions';
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
		achievements.setAttribute('role', 'region');
		achievements.setAttribute('aria-label', config.i18n.achievements || 'Seen achievements');
		var achievementsTitle = document.createElement('span');
		achievementsTitle.className = 'wp-seen-posts-achievements-title';
		achievementsTitle.textContent = config.i18n.achievements || 'Your badges';
		var achievementsList = document.createElement('span');
		achievementsList.className = 'wp-seen-posts-achievements-list';
		achievementsList.setAttribute('role', 'list');
		var achievementsHint = document.createElement('span');
		achievementsHint.className = 'wp-seen-posts-achievements-hint';
		achievementsHint.textContent = config.i18n.badgeHint || 'Tap a badge to see why you earned it.';
		actions.appendChild(toggle);
		actions.appendChild(reset);
		controls.appendChild(actions);
		achievements.appendChild(achievementsTitle);
		achievements.appendChild(achievementsList);
		achievements.appendChild(achievementsHint);
		controls.appendChild(achievements);
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
			return historyAtLoad.has(id) || hiddenSessionSeen.has(id);
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
			image.alt = milestone.alt || milestone.label;
			image.width = size;
			image.height = size;
			image.decoding = 'async';
			return image;
		}

		function renderCardBadge(badge) {
			var milestone = currentMilestone();
			while (badge.firstChild) badge.removeChild(badge.firstChild);
			badge.classList.toggle('wp-seen-posts-badge-earned', Boolean(milestone));
			var seenText = document.createElement('span');
			seenText.className = 'wp-seen-posts-badge-text';
			seenText.textContent = config.i18n.seen;
			badge.appendChild(seenText);
			if (!milestone) {
				badge.removeAttribute('aria-label');
				badge.removeAttribute('title');
				return;
			}
			badge.setAttribute('aria-label', config.i18n.seen + '. ' + milestone.description);
			badge.title = milestone.description;
			badge.appendChild(createMilestoneImage(milestone, 'wp-seen-posts-badge-image', 24));
		}

		function closeAchievementExplanations(except) {
			achievementsList.querySelectorAll('.wp-seen-posts-achievement.is-explaining').forEach(function (item) {
				if (item === except) return;
				item.classList.remove('is-explaining');
				var button = item.querySelector('.wp-seen-posts-achievement-button');
				if (button) {
					button.setAttribute('aria-expanded', 'false');
					if (document.activeElement === button) button.blur();
				}
			});
		}

		function createAchievementItem(milestone, animate) {
			var item = document.createElement('span');
			item.className = 'wp-seen-posts-achievement' + (animate ? ' wp-seen-posts-achievement-unlocked' : '');
			item.dataset.badgeKey = milestone.key;
			item.setAttribute('role', 'listitem');
			var button = document.createElement('button');
			button.type = 'button';
			button.className = 'wp-seen-posts-achievement-button';
			button.setAttribute('aria-label', milestone.description);
			button.setAttribute('aria-expanded', 'false');
			var tooltip = document.createElement('span');
			tooltip.className = 'wp-seen-posts-achievement-tooltip';
			tooltip.id = 'wp-seen-posts-tooltip-' + milestone.key;
			tooltip.setAttribute('role', 'tooltip');
			tooltip.textContent = milestone.description;
			button.setAttribute('aria-describedby', tooltip.id);
			button.appendChild(createMilestoneImage(milestone, 'wp-seen-posts-achievement-image', 36));
			button.addEventListener('click', function (event) {
				event.stopPropagation();
				var open = !item.classList.contains('is-explaining');
				closeAchievementExplanations(open ? item : null);
				item.classList.toggle('is-explaining', open);
				button.setAttribute('aria-expanded', open ? 'true' : 'false');
			});
			item.appendChild(button);
			item.appendChild(tooltip);
			return item;
		}

		function showMilestoneToast(milestone) {
			if (!document.body) return;
			if (milestoneToastTimer) window.clearTimeout(milestoneToastTimer);
			if (milestoneToast) milestoneToast.remove();
			milestoneToast = document.createElement('div');
			milestoneToast.className = 'wp-seen-posts-unlock-toast';
			milestoneToast.setAttribute('role', 'status');
			milestoneToast.setAttribute('aria-live', 'polite');
			milestoneToast.appendChild(createMilestoneImage(milestone, 'wp-seen-posts-unlock-image', 48));
			var copy = document.createElement('span');
			var heading = document.createElement('strong');
			heading.textContent = config.i18n.achievementUnlocked || 'Achievement unlocked!';
			copy.appendChild(heading);
			copy.appendChild(document.createTextNode(' ' + milestone.description));
			milestoneToast.appendChild(copy);
			document.body.appendChild(milestoneToast);
			window.setTimeout(function () {
				if (milestoneToast) milestoneToast.classList.add('is-visible');
			}, 0);
			milestoneToastTimer = window.setTimeout(function () {
				if (!milestoneToast) return;
				milestoneToast.classList.remove('is-visible');
				var oldToast = milestoneToast;
				milestoneToastTimer = window.setTimeout(function () { oldToast.remove(); }, 180);
				milestoneToast = null;
			}, 2400);
		}

		function updateAchievements() {
			var earned = milestones.filter(function (milestone) { return historyEntryCount >= milestone.threshold; });
			var signature = earned.map(function (milestone) { return milestone.key; }).join(',');
			var previousKeys = achievementSignature ? achievementSignature.split(',') : [];
			var newlyEarned = achievementsInitialized ? earned.filter(function (milestone) {
				return previousKeys.indexOf(milestone.key) === -1;
			}) : [];
			if (signature !== achievementSignature) {
				achievementSignature = signature;
				while (achievementsList.firstChild) achievementsList.removeChild(achievementsList.firstChild);
				earned.forEach(function (milestone) {
					achievementsList.appendChild(createAchievementItem(milestone, newlyEarned.indexOf(milestone) !== -1));
				});
				achievements.hidden = earned.length === 0;
			}
			achievementsInitialized = true;
			if (newlyEarned.length) showMilestoneToast(newlyEarned[newlyEarned.length - 1]);

			var active = currentMilestone();
			var nextActiveKey = active ? active.key : '';
			if (nextActiveKey !== activeMilestoneKey) {
				activeMilestoneKey = nextActiveKey;
				cards.forEach(function (card) {
					var badge = findCardBadge(card);
					if (badge) renderCardBadge(badge);
				});
			}
		}
		document.addEventListener('click', function () { closeAchievementExplanations(null); });

		function updatePreviewLoading(waiting) {
			if (!waiting) {
				if (previewLoadingTimer) window.clearTimeout(previewLoadingTimer);
				previewLoadingTimer = null;
				previewLoadingVisible = false;
				return;
			}
			if (previewLoadingVisible || previewLoadingTimer) return;
			previewLoadingTimer = window.setTimeout(function () {
				previewLoadingTimer = null;
				previewLoadingVisible = true;
				updateUi();
			}, previewLoadingDelay);
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
			var waitingWithPreview = previewOnly && canStillAdvance;
			updatePreviewLoading(waitingWithPreview);
			var findingWithPreview = waitingWithPreview && previewLoadingVisible;
			empty.textContent = findingWithPreview
				? (config.i18n.findingUnseen || 'Finding unseen posts…')
				: (canStillAdvance ? config.i18n.loadingUnseen : (feedExhausted ? config.i18n.caughtUp : config.i18n.noUnseenPage));
			empty.classList.toggle('wp-seen-posts-empty-loading', (allHidden && canStillAdvance) || findingWithPreview);
			empty.classList.toggle('wp-seen-posts-empty-preview-loading', findingWithPreview);
			empty.hidden = !(allHidden || findingWithPreview || (previewOnly && !canStillAdvance));
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

		function ensureCardStatus(card) {
			var statusGroup = card.querySelector(':scope > .wp-seen-posts-card-status');
			if (!statusGroup) {
				statusGroup = document.createElement('div');
				statusGroup.className = 'wp-seen-posts-card-status';
				card.insertAdjacentElement('afterbegin', statusGroup);
			}
			var looseBadge = card.querySelector(':scope > .wp-seen-posts-badge');
			if (looseBadge) statusGroup.appendChild(looseBadge);
			card.classList.add('wp-seen-posts-position-context');
			return statusGroup;
		}

		function placePublicCounter(card) {
			var counter = card.querySelector('.wp-seen-posts-public-count-wrap');
			if (!counter) return;
			var statusGroup = ensureCardStatus(card);
			if (counter.parentElement !== statusGroup) statusGroup.insertBefore(counter, statusGroup.firstChild);
		}

		function findCardBadge(card) {
			return card.querySelector(':scope > .wp-seen-posts-card-status > .wp-seen-posts-badge, :scope > .wp-seen-posts-badge');
		}

		function ensureBadge(card) {
			placePublicCounter(card);
			var statusGroup = ensureCardStatus(card);
			var badge = findCardBadge(card);
			if (!badge) {
				badge = document.createElement('span');
				badge.className = 'wp-seen-posts-badge';
				statusGroup.appendChild(badge);
			}
			renderCardBadge(badge);
		}

		function setSeen(card, id, fromHistory, deferUi) {
			var wasNew = false;
			if (card.dataset.seenPostState !== 'seen') seenCardCount += 1;
			card.classList.add('wp-seen-posts-is-seen');
			card.dataset.seenPostState = 'seen';
			if (!fromHistory) {
				if (!Object.prototype.hasOwnProperty.call(history, id)) {
					historyEntryCount += 1;
					wasNew = true;
				}
				var seenAt = Math.floor(Date.now() / 1000);
				history[id] = seenAt;
				pendingHistory[id] = seenAt;
				sessionSeen.add(id);
				scheduleHistoryWrite();
			}
			/* Existing browser history is never backfilled. Only the same new local
			 * transition that marks this card Seen may enter the public batch. */
			if (wasNew && publicCounts && typeof publicCounts.queue === 'function') publicCounts.queue(id);
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
			syncHistoryFromStorage();
			/* Re-observe eligible cards so a dwell period can restart after returning to the tab. */
			cards.forEach(function (card) {
				if (card.dataset.seenPostState === 'unseen') {
					observer.unobserve(card);
					observer.observe(card);
				}
			});
		});
		window.addEventListener('storage', function (event) {
			if (event.key !== storageKey && event.key !== null) return;
			syncHistoryFromStorage(event.newValue);
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
				if (publicCounts && typeof publicCounts.register === 'function') publicCounts.register(card);
				if (historyAtLoad.has(id)) setSeen(card, id, true, true);
				else {
					placePublicCounter(card);
					card.dataset.seenPostState = 'unseen';
					observer.observe(card);
				}
			});
			updateUi();
		}

		function setShowSeen(value) {
			showSeen = value;
			if (!value) {
				/* Hide only the session posts that are already Seen at this tap. New
				 * posts loaded afterward must remain stable until another Hide tap. */
				sessionSeen.forEach(function (id) { hiddenSessionSeen.add(id); });
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
			try { window.localStorage.removeItem(storageKey); } catch (error) {}
			history = {};
			pendingHistory = {};
			historyEntryCount = 0;
			historyAtLoad.clear();
			sessionSeen.clear();
			hiddenSessionSeen.clear();
			reloadPreviewIds.clear();
			seenCardCount = 0;
			hiddenCardCount = 0;
			showSeen = false;
			cards.forEach(function (card) {
				card.classList.remove('wp-seen-posts-is-seen', 'wp-seen-posts-is-hidden', 'wp-seen-posts-reload-preview');
				card.removeAttribute('aria-hidden');
				card.dataset.seenPostState = 'unseen';
				var badge = findCardBadge(card);
				if (badge) badge.remove();
				var statusGroup = card.querySelector(':scope > .wp-seen-posts-card-status');
				if (statusGroup && !statusGroup.querySelector('.wp-seen-posts-public-count-wrap')) statusGroup.remove();
				if (card.querySelector(':scope > .wp-seen-posts-card-status')) card.classList.add('wp-seen-posts-position-context');
				else card.classList.remove('wp-seen-posts-position-context');
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
