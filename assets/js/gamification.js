(function () {
	'use strict';

	var config = window.wpSeenGamificationConfig || {};
	var storageKey = typeof config.storageKey === 'string' && config.storageKey
		? config.storageKey
		: 'wp_seen_posts_gamification_v1';
	var dailyRequirement = Math.max(1, Math.min(25, Math.floor(Number(config.dailyRequirement) || 3)));
	var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
	var badges = Array.isArray(config.badges) ? config.badges.filter(function (badge) {
		return badge && typeof badge.key === 'string' && /^[a-z0-9_-]+$/.test(badge.key);
	}) : [];
	var validBadgeKeys = new Set(badges.map(function (badge) { return badge.key; }));
	var syncTimer = null;
	var syncInFlight = false;
	var syncAgain = false;
	var mountedNodes = new Set();

	function positiveInteger(value, fallback) {
		value = Math.floor(Number(value));
		return Number.isFinite(value) && value >= 0 ? value : fallback;
	}

	function validDate(value) {
		return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
	}

	function randomToken() {
		var bytes = new Uint8Array(16);
		if ( window.crypto && typeof window.crypto.getRandomValues === 'function' ) {
			window.crypto.getRandomValues(bytes);
		} else {
			for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
		}
		return Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
	}

	function siteDate() {
		var timeZone = typeof config.siteTimeZone === 'string' ? config.siteTimeZone : '';
		if (timeZone && !/^[+-]\d{2}:\d{2}$/.test(timeZone) && window.Intl && window.Intl.DateTimeFormat) {
			try {
				var parts = new window.Intl.DateTimeFormat('en-US', {
					timeZone: timeZone,
					year: 'numeric', month: '2-digit', day: '2-digit'
				}).formatToParts(new Date());
				var values = {};
				parts.forEach(function (part) { values[part.type] = part.value; });
				if (values.year && values.month && values.day) return values.year + '-' + values.month + '-' + values.day;
			} catch (error) {}
		}

		var offset = Number(config.siteUtcOffset);
		if (Number.isFinite(offset)) {
			var shifted = new Date(Date.now() + offset * 1000);
			return shifted.getUTCFullYear() + '-' + String(shifted.getUTCMonth() + 1).padStart(2, '0') + '-' + String(shifted.getUTCDate()).padStart(2, '0');
		}
		return validDate(config.serverDate) || new Date().toISOString().slice(0, 10);
	}

	function dayDifference(later, earlier) {
		if (!validDate(later) || !validDate(earlier)) return null;
		var laterParts = later.split('-').map(Number);
		var earlierParts = earlier.split('-').map(Number);
		return Math.round((
			Date.UTC(laterParts[0], laterParts[1] - 1, laterParts[2]) -
			Date.UTC(earlierParts[0], earlierParts[1] - 1, earlierParts[2])
		) / 86400000);
	}

	function cleanBadgeKeys(value) {
		if (!Array.isArray(value)) return [];
		var clean = [];
		value.forEach(function (key) {
			if (key === 'barsetka') return;
			if (typeof key === 'string' && /^[a-z0-9_-]+$/.test(key) && clean.indexOf(key) === -1) clean.push(key);
		});
		return clean.slice(0, 24);
	}

	function defaultState() {
		return {
			version: 1,
			readerToken: randomToken(),
			currentStreak: 0,
			longestStreak: 0,
			lastCompletedDate: '',
			currentDate: siteDate(),
			todayPostIds: [],
			todayCompleted: false,
			unlockedBadges: [],
			reportedBadges: [],
			registered: false
		};
	}

	function normalizeState(value) {
		var today = siteDate();
		var clean = defaultState();
		if (value && !Array.isArray(value) && typeof value === 'object') {
			clean.readerToken = typeof value.readerToken === 'string' && /^[a-f0-9]{32,128}$/.test(value.readerToken)
				? value.readerToken
				: clean.readerToken;
			clean.currentStreak = positiveInteger(value.currentStreak, 0);
			clean.longestStreak = Math.max(clean.currentStreak, positiveInteger(value.longestStreak, 0));
			clean.lastCompletedDate = validDate(value.lastCompletedDate);
			clean.currentDate = validDate(value.currentDate) || today;
			clean.todayPostIds = Array.isArray(value.todayPostIds) ? value.todayPostIds.map(function (id) {
				id = String(id || '');
				return /^[1-9]\d*$/.test(id) ? id : '';
			}).filter(Boolean).filter(function (id, index, all) { return all.indexOf(id) === index; }).slice(0, dailyRequirement) : [];
			clean.todayCompleted = Boolean(value.todayCompleted);
			clean.unlockedBadges = cleanBadgeKeys(value.unlockedBadges);
			clean.reportedBadges = cleanBadgeKeys(value.reportedBadges);
			clean.registered = Boolean(value.registered);
		}

		if (clean.currentDate !== today) {
			clean.currentDate = today;
			clean.todayPostIds = [];
			clean.todayCompleted = clean.lastCompletedDate === today;
		}
		var gap = clean.lastCompletedDate ? dayDifference(today, clean.lastCompletedDate) : null;
		if (gap === 0) clean.todayCompleted = true;
		if (gap !== null && (gap > 1 || gap < 0)) {
			clean.currentStreak = 0;
			clean.todayCompleted = false;
		}
		clean.longestStreak = Math.max(clean.longestStreak, clean.currentStreak);
		return clean;
	}

	function readState() {
		try {
			var raw = window.localStorage.getItem(storageKey);
			var initial = normalizeState(JSON.parse(raw || '{}'));
			var normalized = JSON.stringify(initial);
			/* Persist the opaque token immediately so two freshly opened tabs reuse
			 * one anonymous reader identity before either tab records a post. Also
			 * rewrite legacy state once when retired badge keys are removed. */
			if (raw !== normalized) window.localStorage.setItem(storageKey, normalized);
			return initial;
		}
		catch (error) { return normalizeState({}); }
	}

	var state = readState();

	function writeState() {
		try { window.localStorage.setItem(storageKey, JSON.stringify(state)); } catch (error) {}
	}

	function publicState() {
		return {
			currentStreak: state.currentStreak,
			longestStreak: state.longestStreak,
			lastCompletedDate: state.lastCompletedDate,
			todayCount: state.todayPostIds.length,
			todayCompleted: state.todayCompleted,
			dailyRequirement: dailyRequirement,
			unlockedBadges: state.unlockedBadges.slice()
		};
	}

	function format(template, values) {
		var output = String(template || '');
		values.forEach(function (value, index) {
			output = output.replace('%' + (index + 1) + '$d', String(value));
		});
		if (values.length === 1) output = output.replace('%d', String(values[0]));
		return output;
	}

	function displayText() {
		if (!config.enabled) return '';
		if (state.todayCompleted && state.currentStreak > 0) {
			return format((config.i18n && config.i18n.streak) || '🔥 %d-day vodka streak', [state.currentStreak]);
		}
		if (config.showProgress && state.todayPostIds.length > 0) {
			return state.currentStreak > 0
				? format((config.i18n && config.i18n.progress) || '🔥 %1$d / %2$d posts to keep your streak', [state.todayPostIds.length, dailyRequirement])
				: format((config.i18n && config.i18n.progressStart) || '🔥 %1$d / %2$d posts toward a vodka streak', [state.todayPostIds.length, dailyRequirement]);
		}
		if (state.currentStreak > 0) return format((config.i18n && config.i18n.streak) || '🔥 %d-day vodka streak', [state.currentStreak]);
		return '';
	}

	function render() {
		var text = displayText();
		document.querySelectorAll('[data-wp-seen-streak]').forEach(function (node) { mountedNodes.add(node); });
		mountedNodes.forEach(function (node) {
			if (!node || !node.isConnected) {
				mountedNodes.delete(node);
				return;
			}
			node.textContent = text;
			node.hidden = !text;
		});
	}

	function notify(detail) {
		render();
		document.dispatchEvent(new window.CustomEvent('wpSeenPostsStreakUpdated', { detail: detail || publicState() }));
	}

	function unlockCountBadges(total, newlyUnlocked) {
		badges.forEach(function (badge) {
			if ((badge.type || 'seen_count') !== 'seen_count') return;
			var threshold = positiveInteger(badge.threshold, 0);
			if (threshold > 0 && total >= threshold && state.unlockedBadges.indexOf(badge.key) === -1) {
				state.unlockedBadges.push(badge.key);
				newlyUnlocked.push(badge.key);
			}
		});
	}

	function completeToday(newlyUnlocked) {
		if (!config.enabled || state.todayCompleted || state.todayPostIds.length < dailyRequirement) return false;
		var gap = state.lastCompletedDate ? dayDifference(state.currentDate, state.lastCompletedDate) : null;
		state.currentStreak = gap === 1 ? state.currentStreak + 1 : (gap === 0 ? state.currentStreak : 1);
		state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
		state.lastCompletedDate = state.currentDate;
		state.todayCompleted = true;
		if (config.zapoiEnabled && state.currentStreak >= 4 && validBadgeKeys.has('zapoi') && state.unlockedBadges.indexOf('zapoi') === -1) {
			state.unlockedBadges.push('zapoi');
			newlyUnlocked.push('zapoi');
		}
		return true;
	}

	function needsSync() {
		if (!endpoint || typeof window.fetch !== 'function') return false;
		if (!state.registered) return true;
		return state.unlockedBadges.some(function (key) {
			return validBadgeKeys.has(key) && state.reportedBadges.indexOf(key) === -1;
		});
	}

	function scheduleSync() {
		if (!needsSync()) return;
		if (syncInFlight) {
			syncAgain = true;
			return;
		}
		if (syncTimer) return;
		syncTimer = window.setTimeout(function () {
			syncTimer = null;
			syncProgress();
		}, 250);
	}

	function syncProgress() {
		if (!needsSync() || syncInFlight) return Promise.resolve();
		var sentBadges = state.unlockedBadges.filter(function (key) { return validBadgeKeys.has(key); });
		syncInFlight = true;
		return window.fetch(endpoint, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ reader_token: state.readerToken, badge_keys: sentBadges }),
			keepalive: true
		}).then(function (response) {
			if (!response || !response.ok) throw new Error('Seen progress request failed');
			return response.json();
		}).then(function (data) {
			state.registered = true;
			state.reportedBadges = cleanBadgeKeys(state.reportedBadges.concat(sentBadges));
			writeState();
			if (data && data.rarities && typeof data.rarities === 'object') {
				document.dispatchEvent(new window.CustomEvent('wpSeenPostsRaritiesUpdated', { detail: { rarities: data.rarities } }));
			}
		}).catch(function () {
			/* Rarity reporting is optional and never blocks personal Seen or streak state. */
		}).finally(function () {
			syncInFlight = false;
			var shouldRunAgain = syncAgain;
			syncAgain = false;
			if (shouldRunAgain) scheduleSync();
		});
	}

	function recordSeen(postId, totalSeen) {
		postId = String(postId || '');
		if (!/^[1-9]\d*$/.test(postId)) return { qualified: false, unlocked: [] };
		state = normalizeState(state);
		var newlyUnlocked = [];
		unlockCountBadges(positiveInteger(totalSeen, 0), newlyUnlocked);

		if (config.enabled && !state.todayCompleted && state.todayPostIds.indexOf(postId) === -1) {
			state.todayPostIds.push(postId);
			if (state.todayPostIds.length > dailyRequirement) state.todayPostIds.length = dailyRequirement;
		}
		var completedToday = completeToday(newlyUnlocked);
		state.unlockedBadges = cleanBadgeKeys(state.unlockedBadges);
		writeState();
		notify(Object.assign(publicState(), { completedToday: completedToday, unlocked: newlyUnlocked.slice() }));
		scheduleSync();
		return { qualified: true, unlocked: newlyUnlocked, completedToday: completedToday, state: publicState() };
	}

	function isBadgeEarned(key) {
		return state.unlockedBadges.indexOf(String(key || '')) !== -1;
	}

	function mount(target) {
		if (!target || target.nodeType !== 1 || !config.enabled) return null;
		var node = target.querySelector(':scope > [data-wp-seen-streak]');
		if (!node) {
			node = document.createElement('span');
			node.className = 'wp-seen-posts-streak';
			node.dataset.wpSeenStreak = '';
			node.setAttribute('role', 'status');
			node.setAttribute('aria-live', 'polite');
			node.hidden = true;
			target.appendChild(node);
		}
		mountedNodes.add(node);
		render();
		return node;
	}

	function mergeIncoming(raw) {
		var incoming;
		try { incoming = normalizeState(JSON.parse(raw || '{}')); } catch (error) { return; }
		if (incoming.registered && !state.registered) {
			state.readerToken = incoming.readerToken;
		} else if (!incoming.registered && !state.registered && incoming.readerToken < state.readerToken) {
			/* Simultaneous first loads converge on one deterministic token. */
			state.readerToken = incoming.readerToken;
		}
		if (incoming.currentDate > state.currentDate) {
			state.currentDate = incoming.currentDate;
			state.todayPostIds = incoming.todayPostIds.slice();
			state.todayCompleted = incoming.todayCompleted;
		} else if (incoming.currentDate === state.currentDate) {
			state.todayPostIds = Array.from(new Set(state.todayPostIds.concat(incoming.todayPostIds))).slice(0, dailyRequirement);
			state.todayCompleted = state.todayCompleted || incoming.todayCompleted;
		}
		if (incoming.lastCompletedDate >= state.lastCompletedDate) {
			state.lastCompletedDate = incoming.lastCompletedDate;
			state.currentStreak = incoming.currentStreak;
		}
		state.longestStreak = Math.max(state.longestStreak, incoming.longestStreak);
		state.unlockedBadges = cleanBadgeKeys(state.unlockedBadges.concat(incoming.unlockedBadges));
		state.reportedBadges = cleanBadgeKeys(state.reportedBadges.concat(incoming.reportedBadges));
		state.registered = state.registered || incoming.registered;
		state = normalizeState(state);
		writeState();
		notify();
	}

	window.addEventListener('storage', function (event) {
		if (event.key === storageKey && event.newValue) mergeIncoming(event.newValue);
	});
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
	else render();

	window.WPSeenGamification = {
		getState: publicState,
		isBadgeEarned: isBadgeEarned,
		mount: mount,
		recordSeen: recordSeen,
		render: render,
		sync: syncProgress
	};
}());
