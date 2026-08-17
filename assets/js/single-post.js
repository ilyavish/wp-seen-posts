(function () {
	'use strict';

	var config = window.wpSeenSinglePostConfig || {};
	var i18n = config.i18n || {};
	var postId = String(Math.floor(Number(config.postId) || 0));
	if (!/^[1-9]\d*$/.test(postId)) return;

	var timer = null;
	var recorded = false;
	var status = null;
	var toast = null;
	var toastTimer = null;

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

	var milestones = readMilestones();

	function createImage(milestone, className, size) {
		var image = document.createElement('img');
		image.className = className;
		image.src = milestone.url;
		image.alt = milestone.alt || milestone.label;
		image.width = size;
		image.height = size;
		image.decoding = 'async';
		return image;
	}

	function findPostRoot() {
		var selectors = ['#post-' + postId, '#prologue-' + postId, 'article.post', 'main article', '.hentry', '#content'];
		for (var index = 0; index < selectors.length; index += 1) {
			var root = document.querySelector(selectors[index]);
			if (root) return root;
		}
		return document.body;
	}

	function findStatusHost() {
		var root = findPostRoot();
		var content = root.querySelector('#content-' + postId + ', .postcontent, .entry-content, .post-content, [itemprop="articleBody"]') || root;
		var meta = content.querySelector('.jp-post-views-single-meta, .stats_counter.sd-content');
		if (meta) {
			meta.classList.add('wp-seen-posts-single-meta-host');
			return { element: meta, inline: true };
		}
		return { element: content, inline: false };
	}

	function closeExplanations(except) {
		if (!status) return;
		status.querySelectorAll('.wp-seen-posts-achievement.is-explaining').forEach(function (item) {
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
		tooltip.id = 'wp-seen-posts-single-tooltip-' + milestone.key;
		tooltip.setAttribute('role', 'tooltip');
		tooltip.textContent = milestone.description;
		button.setAttribute('aria-describedby', tooltip.id);
		button.appendChild(createImage(milestone, 'wp-seen-posts-achievement-image', 36));
		button.addEventListener('click', function (event) {
			event.stopPropagation();
			var open = !item.classList.contains('is-explaining');
			closeExplanations(open ? item : null);
			item.classList.toggle('is-explaining', open);
			button.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
		item.appendChild(button);
		item.appendChild(tooltip);
		return item;
	}

	function showUnlockToast(milestone) {
		if (!document.body || !milestone) return;
		if (toastTimer) window.clearTimeout(toastTimer);
		if (toast) toast.remove();
		toast = document.createElement('div');
		toast.className = 'wp-seen-posts-unlock-toast';
		toast.setAttribute('role', 'status');
		toast.setAttribute('aria-live', 'polite');
		toast.appendChild(createImage(milestone, 'wp-seen-posts-unlock-image', 48));
		var copy = document.createElement('span');
		var heading = document.createElement('strong');
		heading.textContent = i18n.achievementUnlocked || 'Achievement unlocked!';
		copy.appendChild(heading);
		copy.appendChild(document.createTextNode(' ' + milestone.description));
		toast.appendChild(copy);
		document.body.appendChild(toast);
		window.setTimeout(function () { if (toast) toast.classList.add('is-visible'); }, 0);
		toastTimer = window.setTimeout(function () {
			if (!toast) return;
			toast.classList.remove('is-visible');
			var oldToast = toast;
			toastTimer = window.setTimeout(function () { oldToast.remove(); }, 180);
			toast = null;
		}, 2400);
	}

	function renderStatus(history, unlocked) {
		var host = findStatusHost();
		if (!host.element) return;
		if (status) status.remove();
		status = document.createElement('div');
		status.className = 'wp-seen-posts-single-status' + (host.inline ? ' wp-seen-posts-single-status-inline' : '');
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		var seen = document.createElement('strong');
		seen.className = 'wp-seen-posts-single-seen';
		seen.textContent = i18n.seen || 'Seen';
		status.appendChild(seen);

		var count = Object.keys(history).length;
		var earned = milestones.filter(function (milestone) { return count >= milestone.threshold; });
		if (earned.length) {
			var achievements = document.createElement('span');
			achievements.className = 'wp-seen-posts-single-achievements';
			achievements.setAttribute('aria-label', i18n.achievements || 'Your badges');
			var title = document.createElement('span');
			title.className = 'wp-seen-posts-single-achievements-title';
			title.textContent = i18n.achievements || 'Your badges';
			var list = document.createElement('span');
			list.className = 'wp-seen-posts-achievements-list';
			list.setAttribute('role', 'list');
			earned.forEach(function (milestone) {
				list.appendChild(createAchievementItem(milestone, Boolean(unlocked && unlocked.key === milestone.key)));
			});
			var hint = document.createElement('span');
			hint.className = 'wp-seen-posts-achievements-hint';
			hint.textContent = i18n.badgeHint || 'Tap a badge to see why you earned it.';
			achievements.appendChild(title);
			achievements.appendChild(list);
			achievements.appendChild(hint);
			status.appendChild(achievements);
		}
		host.element.appendChild(status);
		if (unlocked) showUnlockToast(unlocked);
	}

	function recordPost() {
		timer = null;
		if (recorded || document.visibilityState !== 'visible') return;
		var history = {};
		var unlocked = null;
		var wasNew = false;
		try {
			var storageKey = config.storageKey || 'wp_seen_posts_v1';
			history = normalizeHistory(JSON.parse(window.localStorage.getItem(storageKey) || '{}'));
			if (!Object.prototype.hasOwnProperty.call(history, postId)) {
				history[postId] = Math.floor(Date.now() / 1000);
				history = normalizeHistory(history);
				window.localStorage.setItem(storageKey, JSON.stringify(history));
				wasNew = true;
			}
			if (wasNew) {
				var count = Object.keys(history).length;
				milestones.forEach(function (milestone) {
					if (count === milestone.threshold) unlocked = milestone;
				});
			}
		} catch (error) {}
		recorded = true;
		renderStatus(history, unlocked);
		document.dispatchEvent(new window.CustomEvent('wpSeenSinglePostRecorded', {
			detail: { postId: postId, total: Object.keys(history).length, unlocked: unlocked ? unlocked.key : '' }
		}));
	}

	function schedule() {
		if (recorded || timer || document.visibilityState !== 'visible') return;
		timer = window.setTimeout(recordPost, safeNumber(config.dwellTime, 1000));
	}

	document.addEventListener('click', function () { closeExplanations(null); });
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
