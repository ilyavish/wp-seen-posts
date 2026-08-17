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

	var historyIds = Object.keys(history);
	if (!historyIds.length) return;
	var seenIds = new Set(historyIds.filter(function (id) { return /^[1-9]\d*$/.test(id); }));
	if (!seenIds.size) return;
	var previewCount = Math.max(0, Math.floor(Number(config.previewCount) || 0));
	var previewSelector = typeof config.previewSelector === 'string' ? config.previewSelector : '';
	var seenLabel = typeof config.seenLabel === 'string' && config.seenLabel ? config.seenLabel : 'Seen';
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
		badge.textContent = seenLabel;
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
