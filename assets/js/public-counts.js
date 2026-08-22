(function () {
	'use strict';

	var config = window.wpSeenPublicCountsConfig || {};
	var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
	var readEndpoint = typeof config.readEndpoint === 'string' ? config.readEndpoint : '';
	var initialCounts = config.initialCounts && !Array.isArray(config.initialCounts) && typeof config.initialCounts === 'object'
		? config.initialCounts
		: {};
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
	var writingThisPage = new Set();
	var optimisticOriginals = new Map();
	var nodesById = new Map();
	var readPending = new Set();
	var readAttempted = new Set();
	var flushTimer = null;
	var readTimer = null;
	var ledgerSaveTimer = null;
	var ledgerDirty = false;
	var inFlight = false;
	var readInFlight = false;
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
		try {
			window.localStorage.setItem(ledgerStorageKey, encoded);
			ledgerDirty = false;
		} catch (error) {}
	}

	function flushLedgerSave() {
		if (ledgerSaveTimer) window.clearTimeout(ledgerSaveTimer);
		ledgerSaveTimer = null;
		if (ledgerDirty) saveLedger();
	}

	function scheduleLedgerSave() {
		ledgerDirty = true;
		if (ledgerSaveTimer) return;
		/* Encoding and writing the fixed-size ledger costs more than the visual
		 * transition. Let the eye/count repaint first and coalesce nearby writes. */
		ledgerSaveTimer = window.setTimeout(flushLedgerSave, 0);
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
		if (changed || ledger) scheduleLedgerSave();
	}

	function rememberLifetimeCount(id) {
		ensureLedger(id);
		if (!ledger || ledgerHas(id)) return false;
		ledgerAdd(id);
		scheduleLedgerSave();
		return true;
	}

	function preserveHistoryBeforeReset() {
		/* Resetting personal Seen history must not reset lifetime public-count
		 * deduplication. Complete any pending migration while the history still
		 * exists, then persist the fixed-size ledger synchronously. */
		ensureLedger('');
		flushLedgerSave();
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

	function accessibleLabel(count, node) {
		var template = count === 1
			? (config.labelSingular || 'Seen by %s visitor')
			: (config.labelPlural || 'Seen by %s visitors');
		var state = node && node.dataset.personalSeenState === 'seen'
			? (config.personalSeen || 'Seen')
			: (config.personalUnseen || 'Unseen');
		return state + '. ' + template.replace('%s', exactNumber(count));
	}

	function pendingLabel(node) {
		var state = node && node.dataset.personalSeenState === 'seen'
			? (config.personalSeen || 'Seen')
			: (config.personalUnseen || 'Unseen');
		return state + '. ' + (config.loadingLabel || 'Loading Seen count');
	}

	function parsedCount(value) {
		value = String(value == null ? '' : value);
		if (!/^\d+$/.test(value)) return null;
		var count = Number(value);
		return Number.isSafeInteger(count) && count >= 0 ? count : null;
	}

	function createCounter(id, count) {
		var wrap = document.createElement('div');
		wrap.className = 'wp-seen-posts-public-count-wrap';
		var node = document.createElement('span');
		node.className = 'wp-seen-posts-public-count';
		node.setAttribute('role', 'img');
		node.dataset.seenPostId = id;
		node.dataset.personalSeenState = 'unseen';

		var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('class', 'wp-seen-posts-public-eye');
		svg.setAttribute('viewBox', '0 0 20 20');
		svg.setAttribute('width', '20');
		svg.setAttribute('height', '20');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M18.3 9.5C15 4.9 8.5 3.8 3.9 7.2c-1.2.9-2.2 2.1-3 3.4.2.4.5.8.8 1.2 3.3 4.6 9.6 5.6 14.2 2.4.9-.7 1.7-1.4 2.4-2.4.3-.4.5-.8.8-1.2-.3-.4-.5-.8-.8-1.1zM10.1 7.2c.5-.5 1.3-.5 1.8 0s.5 1.3 0 1.8-1.3.5-1.8 0-.5-1.3 0-1.8zM10 14.9c-3.1 0-6-1.6-7.7-4.2C3.5 9 5.1 7.8 7 7.2c-.7.8-1 1.7-1 2.7 0 2.2 1.7 4.1 4 4.1 2.2 0 4.1-1.7 4.1-4v-.1c0-1-.4-2-1.1-2.7 1.9.6 3.5 1.8 4.7 3.5-1.7 2.6-4.6 4.2-7.7 4.2z');
		svg.appendChild(path);
		node.appendChild(svg);

		var value = document.createElement('span');
		value.className = 'wp-seen-posts-public-value';
		value.setAttribute('aria-hidden', 'true');
		if (count === null) {
			node.dataset.seenCountPending = 'true';
			value.textContent = '…';
			var loading = pendingLabel(node);
			node.setAttribute('aria-label', loading);
			node.title = loading;
		} else {
			node.dataset.seenCount = String(count);
			value.textContent = formatCompact(count);
			var label = accessibleLabel(count, node);
			node.setAttribute('aria-label', label);
			node.title = label;
		}
		node.appendChild(value);
		wrap.appendChild(node);
		return wrap;
	}

	function rememberNode(node) {
		if (!node || node.nodeType !== 1) return;
		var id = validId(node.dataset.seenPostId);
		if (!id) return;
		if (node.dataset.personalSeenState !== 'seen') node.dataset.personalSeenState = 'unseen';
		node.classList.toggle('wp-seen-posts-public-count-is-seen', node.dataset.personalSeenState === 'seen');
		if (!nodesById.has(id)) nodesById.set(id, new Set());
		nodesById.get(id).add(node);
		var current = parsedCount(node.dataset.seenCount);
		if (current !== null) {
			var label = accessibleLabel(current, node);
			node.setAttribute('aria-label', label);
			node.title = label;
		}
	}

	function register(root) {
		if (!root) return;
		if (root.nodeType === 1 && root.matches('.wp-seen-posts-public-count[data-seen-post-id]')) rememberNode(root);
		if (typeof root.querySelectorAll === 'function') {
			root.querySelectorAll('.wp-seen-posts-public-count[data-seen-post-id]').forEach(rememberNode);
		}
	}

	function ensure(root, postId) {
		var id = validId(postId);
		if (!root || root.nodeType !== 1 || !id) return null;
		var existing = root.matches('.wp-seen-posts-public-count-wrap')
			? root
			: root.querySelector('.wp-seen-posts-public-count-wrap');
		if (existing) {
			register(existing);
			return existing;
		}

		var count = Object.prototype.hasOwnProperty.call(initialCounts, id) ? parsedCount(initialCounts[id]) : null;
		var wrap = createCounter(id, count);
		root.appendChild(wrap);
		register(wrap);
		if (count === null) requestRead(id);
		return wrap;
	}

	function update(id, count) {
		id = validId(id);
		count = Number(count);
		if (!id || !Number.isSafeInteger(count) || count < 0 || !nodesById.has(id)) return;
		nodesById.get(id).forEach(function (node) {
			if (!node.isConnected) {
				nodesById.get(id).delete(node);
				return;
			}
			var value = node.querySelector('.wp-seen-posts-public-value');
			if (value) value.textContent = formatCompact(count);
			node.dataset.seenCount = String(count);
			delete node.dataset.seenCountPending;
			var label = accessibleLabel(count, node);
			node.setAttribute('aria-label', label);
			node.title = label;
		});
	}

	function setPersonalState(root, seen) {
		if (!root) return;
		var nodes = [];
		if (root.nodeType === 1 && root.matches('.wp-seen-posts-public-count[data-seen-post-id]')) nodes.push(root);
		if (typeof root.querySelectorAll === 'function') {
			root.querySelectorAll('.wp-seen-posts-public-count[data-seen-post-id]').forEach(function (node) { nodes.push(node); });
		}
		nodes.forEach(function (node) {
			rememberNode(node);
			node.dataset.personalSeenState = seen ? 'seen' : 'unseen';
			node.classList.toggle('wp-seen-posts-public-count-is-seen', Boolean(seen));
			var count = parsedCount(node.dataset.seenCount);
			var label = count === null ? pendingLabel(node) : accessibleLabel(count, node);
			node.setAttribute('aria-label', label);
			node.title = label;
		});
	}

	function displayedCount(id) {
		if (!nodesById.has(id)) return null;
		var value = null;
		nodesById.get(id).forEach(function (node) {
			if (value !== null || !node.isConnected) return;
			var parsed = parsedCount(node.dataset.seenCount);
			if (parsed !== null) value = parsed;
		});
		return value;
	}

	function hasPendingNode(id) {
		if (!nodesById.has(id)) return false;
		var pendingNode = false;
		nodesById.get(id).forEach(function (node) {
			if (node.isConnected && node.dataset.seenCountPending === 'true') pendingNode = true;
		});
		return pendingNode;
	}

	function requestRead(postId, retry) {
		var id = validId(postId);
		if (!id || !readEndpoint || typeof window.fetch !== 'function' || writingThisPage.has(id)) return;
		if (retry) readAttempted.delete(id);
		if (readAttempted.has(id) || readPending.has(id)) return;
		readPending.add(id);
		if (readTimer || readInFlight) return;
		readTimer = window.setTimeout(function () {
			readTimer = null;
			flushReads();
		}, 0);
	}

	function takeReadBatch() {
		var ids = Array.from(readPending).slice(0, maxBatchSize);
		ids.forEach(function (id) {
			readPending.delete(id);
			readAttempted.add(id);
		});
		return ids;
	}

	function flushReads() {
		if (readInFlight || !readPending.size || !readEndpoint || typeof window.fetch !== 'function') return Promise.resolve();
		var ids = takeReadBatch();
		readInFlight = true;
		return window.fetch(readEndpoint, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ post_ids: ids })
		}).then(function (response) {
			if (!response || !response.ok) throw new Error('Seen count read failed');
			return response.json();
		}).then(function (data) {
			if (!data || typeof data.counts !== 'object' || Array.isArray(data.counts)) return;
			ids.forEach(function (id) {
				if (writingThisPage.has(id) || !Object.prototype.hasOwnProperty.call(data.counts, id)) return;
				var count = parsedCount(data.counts[id]);
				if (count !== null) update(id, count);
			});
		}).catch(function () {
			/* A missing cosmetic total must never interfere with Seen tracking. */
		}).finally(function () {
			readInFlight = false;
			if (readPending.size) {
				readTimer = window.setTimeout(function () {
					readTimer = null;
					flushReads();
				}, 0);
			}
		});
	}

	function rollback(ids) {
		ids.forEach(function (id) {
			if (!optimisticOriginals.has(id)) return;
			update(id, optimisticOriginals.get(id));
			optimisticOriginals.delete(id);
		});
	}

	function failWrites(ids) {
		rollback(ids);
		ids.forEach(function (id) {
			writingThisPage.delete(id);
			if (hasPendingNode(id)) requestRead(id, true);
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
			failWrites(requestedIds);
			return;
		}
		requestedIds.forEach(function (id) {
			if (!Object.prototype.hasOwnProperty.call(data.counts, id)) {
				failWrites([id]);
				return;
			}
			var count = Number(data.counts[id]);
			if (Number.isSafeInteger(count) && count >= 0) {
				update(id, count);
				optimisticOriginals.delete(id);
			} else failWrites([id]);
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
			failWrites(ids);
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
		writingThisPage.add(id);
		readPending.delete(id);
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
		flushLedgerSave();
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
		ensure: ensure,
		preserveHistoryBeforeReset: preserveHistoryBeforeReset,
		queue: queue,
		register: register,
		setPersonalState: setPersonalState,
		flush: flush,
		flushReads: flushReads,
		formatCompact: formatCompact
	};
}());
