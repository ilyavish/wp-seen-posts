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
			card.classList.add('wp-seen-posts-prehidden');
		});
		previewCards = [];
	}

	function reservePreview(element) {
		element.classList.add('wp-seen-posts-prepreview');
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
		release: function () {
			observer.disconnect();
			this.history = null;
			document.querySelectorAll('.wp-seen-posts-prehidden').forEach(function (card) {
				card.classList.remove('wp-seen-posts-prehidden');
			});
			document.querySelectorAll('.wp-seen-posts-prepreview').forEach(function (card) {
				card.classList.remove('wp-seen-posts-prepreview');
			});
		}
	};

	window.addEventListener('load', function () {
		if (!document.documentElement.classList.contains('wp-seen-posts-active')) window.WPSeenPostsEarlyHide.release();
	}, { once: true });
}());
