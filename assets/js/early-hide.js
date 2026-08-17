(function () {
	'use strict';

	var config = window.wpSeenPostsEarlyConfig || {};
	var history;
	try {
		history = JSON.parse(window.localStorage.getItem(config.storageKey || 'wp_seen_posts_v1') || '{}');
	} catch (error) {
		return;
	}
	if (!history || Array.isArray(history) || typeof history !== 'object') return;

	function safeNumber(value, fallback) {
		value = Number(value);
		return Number.isFinite(value) && value > 0 ? value : fallback;
	}

	var cutoff = Math.floor(Date.now() / 1000) - safeNumber(config.retentionDays, 365) * 86400;
	var maxEntries = Math.floor(safeNumber(config.maxEntries, 3000));
	var validEntries = [];
	Object.keys(history).forEach(function (id) {
		var timestamp = Number(history[id]);
		if (/^[1-9]\d*$/.test(id) && Number.isFinite(timestamp) && timestamp >= cutoff) validEntries.push([id, Math.floor(timestamp)]);
	});
	if (validEntries.length > maxEntries) {
		validEntries.sort(function (a, b) { return b[1] - a[1]; });
		validEntries.length = maxEntries;
	}
	var seenIds = new Set(validEntries.map(function (entry) { return entry[0]; }));
	if (!seenIds.size) return;
	var previewCount = Math.max(0, Math.floor(Number(config.previewCount) || 0));
	var previewSelector = typeof config.previewSelector === 'string' ? config.previewSelector : '';
	var seenLabel = typeof config.seenLabel === 'string' && config.seenLabel ? config.seenLabel : 'Seen';
	var milestones = Array.isArray(config.badges) ? config.badges.map(function (badge) {
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
	}).sort(function (a, b) { return a.threshold - b.threshold; }) : [];
	var previewCards = [];
	var foundUnseenPreviewCard = false;

	function postId(element) {
		var values = [element.id || '', element.getAttribute('data-post-id') || '', element.className || ''];
		for (var index = 0; index < values.length; index += 1) {
			var match = String(values[index]).match(index === 1 ? /^(\d+)$/ : /(?:^|\s|\b)(?:post|prologue)-(\d+)(?:\s|$|\b)/);
			if (match && Number(match[1]) > 0) return String(Number(match[1]));
		}
		return null;
	}

	function isPreviewCard(element) {
		if (!previewCount || !previewSelector) return false;
		try { return element.matches(previewSelector); } catch (error) { return false; }
	}

	function cancelPreview() {
		previewCards.forEach(function (card) {
			card.classList.remove('wp-seen-posts-prepreview');
			card.classList.remove('wp-seen-posts-position-context');
			var badge = card.querySelector(':scope > .wp-seen-posts-prebadge');
			if (badge) badge.remove();
			card.classList.add('wp-seen-posts-prehidden');
		});
		previewCards = [];
	}

	function reservePreview(element) {
		element.classList.add('wp-seen-posts-prepreview', 'wp-seen-posts-position-context');
		var badge = document.createElement('span');
		badge.className = 'wp-seen-posts-badge wp-seen-posts-prebadge';
		var seenText = document.createElement('span');
		seenText.className = 'wp-seen-posts-badge-text';
		seenText.textContent = seenLabel;
		badge.appendChild(seenText);
		var milestone = null;
		milestones.forEach(function (candidate) {
			if (seenIds.size >= candidate.threshold) milestone = candidate;
		});
		if (milestone) {
			badge.classList.add('wp-seen-posts-badge-earned');
			badge.setAttribute('aria-label', seenLabel + '. ' + milestone.description);
			badge.title = milestone.description;
			var image = document.createElement('img');
			image.className = 'wp-seen-posts-badge-image';
			image.src = milestone.url;
			image.alt = milestone.alt || milestone.label;
			image.width = 24;
			image.height = 24;
			image.decoding = 'async';
			badge.appendChild(image);
		}
		element.insertAdjacentElement('afterbegin', badge);
		previewCards.push(element);
	}

	function prehide(element) {
		if (element.classList.contains('wp-seen-posts-prepreview') || element.classList.contains('wp-seen-posts-prehidden')) return;
		var id = postId(element);
		if (!id) return;
		if (isPreviewCard(element)) {
			if (!seenIds.has(id)) {
				foundUnseenPreviewCard = true;
				cancelPreview();
				return;
			}
			if (!foundUnseenPreviewCard && previewCards.length < previewCount) {
				if (!element.classList.contains('wp-seen-posts-prepreview')) {
					reservePreview(element);
				}
				return;
			}
		}
		if (seenIds.has(id)) element.classList.add('wp-seen-posts-prehidden');
	}

	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		prehide(node);
		node.querySelectorAll('[id], [data-post-id], [class*="post-"], [class*="prologue-"]').forEach(prehide);
	}

	var observer = new MutationObserver(function (records) {
		records.forEach(function (record) { record.addedNodes.forEach(scan); });
	});
	observer.observe(document.documentElement, { childList: true, subtree: true });
	scan(document.documentElement);

	window.WPSeenPostsEarlyHide = {
		history: history,
		stop: function () { observer.disconnect(); },
		release: function (keepPreviewBadges) {
			observer.disconnect();
			this.history = null;
			document.querySelectorAll('.wp-seen-posts-prehidden').forEach(function (card) {
				card.classList.remove('wp-seen-posts-prehidden');
			});
			document.querySelectorAll('.wp-seen-posts-prepreview').forEach(function (card) {
				card.classList.remove('wp-seen-posts-prepreview');
				var badge = card.querySelector(':scope > .wp-seen-posts-prebadge');
				if (keepPreviewBadges && card.classList.contains('wp-seen-posts-reload-preview') && badge) badge.classList.remove('wp-seen-posts-prebadge');
				else {
					if (badge) badge.remove();
					card.classList.remove('wp-seen-posts-position-context');
				}
			});
		}
	};

	window.addEventListener('load', function () {
		if (!document.documentElement.classList.contains('wp-seen-posts-active')) window.WPSeenPostsEarlyHide.release();
	}, { once: true });
}());
