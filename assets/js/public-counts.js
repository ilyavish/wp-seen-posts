(function () {
	'use strict';

	var config = window.wpSeenPublicCountsConfig || {};
	var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
	var maxBatchSize = Math.max(1, Math.min(50, Math.floor(Number(config.maxBatchSize) || 25)));
	var batchDelay = Math.max(100, Math.floor(Number(config.batchDelay) || 1200));
	var ledgerStorageKey = typeof config.ledgerStorageKey === 'string' && config.ledgerStorageKey
		? config.ledgerStorageKey
		: 'wp_seen_posts_counted_v1';
	var historyStorageKey = typeof config.historyStorageKey === 'string' && config.historyStorageKey
		? config.historyStorageKey
		: 'wp_seen_posts_v1';
	var ledgerPrefix = 'b1:';
	var ledgerByteLength = 16384;
	var ledgerBitMask = ledgerByteLength * 8 - 1;
	var ledgerHashCount = 7;
	var pending = new Set();
	var queuedThisPage = new Set();
	var optimisticOriginals = new Map();
	var nodesById = new Map();
	var flushTimer = null;
	var inFlight = false;
	var ledger = null;
	var ledgerInitialized = false;
	var ledgerNeedsMigration = false;
	var capturedHistory = window.WPSeenPostsEarlyHide && window.WPSeenPostsEarlyHide.history
		? window.WPSeenPostsEarlyHide.history
		: null;

	function validId(value) {
		value = String(value || '');
		return /^[1-9]\d*$/.test(value) ? value : '';
	}

	function decodeLedger(raw) {
		if (typeof raw !== 'string' || raw.indexOf(ledgerPrefix) !== 0 || typeof window.atob !== 'function') return null;
		try {
			var binary = window.atob(raw.slice(ledgerPrefix.length));
			if (binary.length !== ledgerByteLength) return null;
			var bytes = new Uint8Array(ledgerByteLength);
			for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return bytes;
		} catch (error) { return null; }
	}

	function encodeLedger(bytes) {
		if (!bytes || typeof window.btoa !== 'function') return '';
		var binary = '';
		for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
		return ledgerPrefix + window.btoa(binary);
	}

	function hashString(value, seed) {
		var hash = seed >>> 0;
		for (var index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= hash >>> 16;
		hash = Math.imul(hash, 2246822507);
		hash ^= hash >>> 13;
		return hash >>> 0;
	}

	function ledgerPositions(id) {
		var first = hashString(id, 2166136261);
		var second = hashString(id, 2654435769) | 1;
		var positions = [];
		for (var index = 0; index < ledgerHashCount; index += 1) {
			positions.push((first + Math.imul(index, second)) & ledgerBitMask);
		}
		return positions;
	}

	function ledgerHas(id) {
		if (!ledger) return false;
		return ledgerPositions(id).every(function (position) {
			return Boolean(ledger[position >>> 3] & (1 << (position & 7)));
		});
	}

	function ledgerAdd(id) {
		if (!ledger) return false;
		var changed = false;
		ledgerPositions(id).forEach(function (position) {
			var byteIndex = position >>> 3;
			var bit = 1 << (position & 7);
			if (!(ledger[byteIndex] & bit)) changed = true;
			ledger[byteIndex] |= bit;
		});
		return changed;
	}

	function readHistoryForMigration() {
		if (capturedHistory && !Array.isArray(capturedHistory) && typeof capturedHistory === 'object') return capturedHistory;
		try {
			var parsed = JSON.parse(window.localStorage.getItem(historyStorageKey) || '{}');
			return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
		} catch (error) { return {}; }
	}

	function saveLedger() {
		var encoded = encodeLedger(ledger);
		if (!encoded) return;
		try { window.localStorage.setItem(ledgerStorageKey, encoded); } catch (error) {}
	}

	function mergeLedger(raw) {
		var incoming = decodeLedger(raw);
		if (!incoming) return;
		if (!ledgerInitialized) {
			ledger = incoming;
			ledgerInitialized = true;
			ledgerNeedsMigration = false;
			capturedHistory = null;
			return;
		}
		for (var index = 0; index < ledger.length; index += 1) ledger[index] |= incoming[index];
	}

	function ensureLedger(excludeId) {
		if (!ledgerInitialized) {
			var stored = null;
			try { stored = decodeLedger(window.localStorage.getItem(ledgerStorageKey)); } catch (error) {}
			ledger = stored || new Uint8Array(ledgerByteLength);
			ledgerNeedsMigration = !stored;
			ledgerInitialized = true;
		}
		if (!ledgerNeedsMigration) return;
		var changed = false;
		var history = readHistoryForMigration();
		Object.keys(history).forEach(function (id) {
			id = validId(id);
			if (id && id !== excludeId && ledgerAdd(id)) changed = true;
		});
		ledgerNeedsMigration = false;
		capturedHistory = null;
		if (changed || ledger) saveLedger();
	}

	function rememberLifetimeCount(id) {
		ensureLedger(id);
		if (!ledger || ledgerHas(id)) return false;
		ledgerAdd(id);
		saveLedger();
		return true;
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

	function displayedCount(id) {
		if (!nodesById.has(id)) return null;
		var value = null;
		nodesById.get(id).forEach(function (node) {
			if (value !== null || !node.isConnected) return;
			var parsed = Number(node.dataset.seenCount);
			if (Number.isSafeInteger(parsed) && parsed >= 0) value = parsed;
		});
		return value;
	}

	function rollback(ids) {
		ids.forEach(function (id) {
			if (!optimisticOriginals.has(id)) return;
			update(id, optimisticOriginals.get(id));
			optimisticOriginals.delete(id);
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
		if (!data || typeof data !== 'object' || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) {
			rollback(requestedIds);
			return;
		}
		requestedIds.forEach(function (id) {
			if (!Object.prototype.hasOwnProperty.call(data.counts, id)) {
				rollback([id]);
				return;
			}
			var count = Number(data.counts[id]);
			if (Number.isSafeInteger(count) && count >= 0) {
				update(id, count);
				optimisticOriginals.delete(id);
			} else rollback([id]);
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
			if (!response || !response.ok) throw new Error('Seen count request failed');
			return response.json();
		}).then(function (data) {
			validateResponse(data, ids);
		}).catch(function () {
			/* The personal Seen state is independent and must keep working on failure.
			 * Do not retry an ambiguous write: the server may already have committed it. */
			rollback(ids);
		}).finally(function () {
			inFlight = false;
			if (pending.size) scheduleFlush();
		});
	}

	function queue(postId) {
		var id = validId(postId);
		if (!id || !endpoint || queuedThisPage.has(id)) return;
		queuedThisPage.add(id);
		if (!rememberLifetimeCount(id)) return;
		var original = displayedCount(id);
		if (original !== null) {
			optimisticOriginals.set(id, original);
			update(id, original + 1);
		}
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
	window.addEventListener('storage', function (event) {
		if (event.key === ledgerStorageKey && event.newValue) mergeLedger(event.newValue);
	});
	window.addEventListener('pagehide', flushOnExit);
	register(document);
	if (typeof window.requestIdleCallback === 'function') {
		window.requestIdleCallback(function () { ensureLedger(''); }, { timeout: 750 });
	} else window.setTimeout(function () { ensureLedger(''); }, 50);

	window.WPSeenPublicCounts = {
		queue: queue,
		register: register,
		flush: flush,
		formatCompact: formatCompact
	};
}());
