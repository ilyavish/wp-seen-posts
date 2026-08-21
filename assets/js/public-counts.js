(function () {
	'use strict';

	var config = window.wpSeenPublicCountsConfig || {};
	var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
	var maxBatchSize = Math.max(1, Math.min(50, Math.floor(Number(config.maxBatchSize) || 25)));
	var batchDelay = Math.max(100, Math.floor(Number(config.batchDelay) || 1200));
	var pending = new Set();
	var nodesById = new Map();
	var flushTimer = null;
	var inFlight = false;

	function validId(value) {
		value = String(value || '');
		return /^[1-9]\d*$/.test(value) ? value : '';
	}

	function trimDecimal(value) {
		return value.toFixed(1).replace(/\.0$/, '');
	}

	function formatCompact(count) {
		count = Math.max(0, Math.floor(Number(count) || 0));
		if (count < 1000) return String(count);
		if (count < 1000000) {
			var thousands = count / 1000;
			thousands = thousands < 10 ? Math.floor(thousands * 10) / 10 : Math.round(thousands * 10) / 10;
			if (thousands >= 1000) return '1M';
			return trimDecimal(thousands) + 'K';
		}
		var millions = count / 1000000;
		millions = millions < 10 ? Math.floor(millions * 10) / 10 : Math.round(millions * 10) / 10;
		return trimDecimal(millions) + 'M';
	}

	function exactNumber(count) {
		try { return Number(count).toLocaleString(document.documentElement.lang || undefined); }
		catch (error) { return String(count); }
	}

	function accessibleLabel(count) {
		var template = count === 1
			? (config.labelSingular || 'Seen by %s visitor')
			: (config.labelPlural || 'Seen by %s visitors');
		return template.replace('%s', exactNumber(count));
	}

	function rememberNode(node) {
		if (!node || node.nodeType !== 1) return;
		var id = validId(node.dataset.seenPostId);
		if (!id) return;
		if (!nodesById.has(id)) nodesById.set(id, new Set());
		nodesById.get(id).add(node);
	}

	function register(root) {
		if (!root) return;
		if (root.nodeType === 1 && root.matches('.wp-seen-posts-public-count[data-seen-post-id]')) rememberNode(root);
		if (typeof root.querySelectorAll === 'function') {
			root.querySelectorAll('.wp-seen-posts-public-count[data-seen-post-id]').forEach(rememberNode);
		}
	}

	function update(id, count) {
		id = validId(id);
		count = Number(count);
		if (!id || !Number.isSafeInteger(count) || count < 0 || !nodesById.has(id)) return;
		var label = accessibleLabel(count);
		nodesById.get(id).forEach(function (node) {
			if (!node.isConnected) {
				nodesById.get(id).delete(node);
				return;
			}
			var value = node.querySelector('.wp-seen-posts-public-value');
			if (value) value.textContent = formatCompact(count);
			node.dataset.seenCount = String(count);
			node.setAttribute('aria-label', label);
			node.title = label;
		});
	}

	function takeBatch() {
		var ids = Array.from(pending).slice(0, maxBatchSize);
		ids.forEach(function (id) { pending.delete(id); });
		return ids;
	}

	function scheduleFlush() {
		if (flushTimer || inFlight || !pending.size || !endpoint) return;
		flushTimer = window.setTimeout(function () {
			flushTimer = null;
			flush();
		}, batchDelay);
	}

	function validateResponse(data, requestedIds) {
		if (!data || typeof data !== 'object' || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) return;
		requestedIds.forEach(function (id) {
			if (!Object.prototype.hasOwnProperty.call(data.counts, id)) return;
			var count = Number(data.counts[id]);
			if (Number.isSafeInteger(count) && count >= 0) update(id, count);
		});
	}

	function flush() {
		if (inFlight || !pending.size || !endpoint || typeof window.fetch !== 'function') return Promise.resolve();
		var ids = takeBatch();
		inFlight = true;
		return window.fetch(endpoint, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ post_ids: ids }),
			keepalive: true
		}).then(function (response) {
			if (!response || !response.ok) return null;
			return response.json();
		}).then(function (data) {
			if (data) validateResponse(data, ids);
		}).catch(function () {
			/* The personal Seen state is independent and must keep working on failure.
			 * Do not retry an ambiguous write: the server may already have committed it. */
		}).finally(function () {
			inFlight = false;
			if (pending.size) scheduleFlush();
		});
	}

	function queue(postId) {
		var id = validId(postId);
		if (!id || !endpoint) return;
		pending.add(id);
		if (pending.size >= maxBatchSize && !inFlight) {
			if (flushTimer) window.clearTimeout(flushTimer);
			flushTimer = null;
			flush();
		} else scheduleFlush();
	}

	function flushOnExit() {
		if (flushTimer) window.clearTimeout(flushTimer);
		flushTimer = null;
		while (pending.size) {
			var ids = takeBatch();
			var body = JSON.stringify({ post_ids: ids });
			if (navigator.sendBeacon) {
				try {
					if (navigator.sendBeacon(endpoint, new window.Blob([body], { type: 'application/json' }))) continue;
				} catch (error) {}
			}
			if (typeof window.fetch === 'function') {
				window.fetch(endpoint, {
					method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true
				}).catch(function () {});
			}
		}
	}

	document.addEventListener('wpFeedPostsAdded', function (event) {
		if (!event.detail || !event.detail.posts) return;
		Array.prototype.forEach.call(event.detail.posts, register);
	});
	window.addEventListener('pagehide', flushOnExit);
	register(document);

	window.WPSeenPublicCounts = {
		queue: queue,
		register: register,
		flush: flush,
		formatCompact: formatCompact
	};
}());
