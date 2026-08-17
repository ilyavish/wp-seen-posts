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

	function postId(element) {
		var values = [element.id || '', element.getAttribute('data-post-id') || '', element.className || ''];
		for (var index = 0; index < values.length; index += 1) {
			var match = String(values[index]).match(index === 1 ? /^(\d+)$/ : /(?:^|\s|\b)(?:post|prologue)-(\d+)(?:\s|$|\b)/);
			if (match && Number(match[1]) > 0) return String(Number(match[1]));
		}
		return null;
	}

	function prehide(element) {
		var id = postId(element);
		if (id && seenIds.has(id)) element.classList.add('wp-seen-posts-prehidden');
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
		}
	};

	window.addEventListener('load', function () {
		if (!document.documentElement.classList.contains('wp-seen-posts-active')) window.WPSeenPostsEarlyHide.release();
	}, { once: true });
}());
