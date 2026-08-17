(function (root, factory) {
	'use strict';
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.WPSeenPostsAdapters = factory();
}(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	function unique(document, selector) {
		if (!selector) return null;
		try {
			var matches = document.querySelectorAll(selector);
			return matches.length === 1 ? matches[0] : null;
		} catch (error) { return null; }
	}

	function directPosts(container, selector) {
		if (!container || !selector) return [];
		try {
			return Array.prototype.filter.call(container.querySelectorAll(selector), function (post) {
				return post.parentElement === container;
			});
		} catch (error) { return []; }
	}

	function postId(post) {
		if (!post || post.nodeType !== 1) return null;
		var values = [post.id || '', post.getAttribute('data-post-id') || '', post.className || ''];
		for (var i = 0; i < values.length; i += 1) {
			var match = String(values[i]).match(i === 1 ? /^(\d+)$/ : /(?:^|\s|\b)(?:post|prologue)-(\d+)(?:\s|$|\b)/);
			if (match && Number(match[1]) > 0) return String(Number(match[1]));
		}
		return null;
	}

	function result(name, container, selector) {
		var posts = directPosts(container, selector).filter(function (post) { return postId(post) !== null; });
		return posts.length ? { name: name, feedContainer: container, postSelector: selector, posts: posts } : null;
	}

	function manual(document, selectors) {
		if (!selectors || !selectors.feed || !selectors.post) return null;
		return result('manual', unique(document, selectors.feed), selectors.post);
	}

	function p2(document, name) {
		return result(name || 'p2', unique(document, '#postlist'), ':scope > li.post');
	}

	function block(document) {
		var containers = document.querySelectorAll('.wp-block-post-template');
		if (containers.length !== 1) return null;
		return result('block', containers[0], ':scope > .wp-block-post');
	}

	function generic(document) {
		var selector = ':scope > article.post, :scope > article.hentry, :scope > [id^="post-"]';
		var candidates = [];
		['.site-main', 'main', '.posts', '.post-list'].forEach(function (containerSelector) {
			try {
				document.querySelectorAll(containerSelector).forEach(function (container) {
					if (directPosts(container, selector).some(function (post) { return postId(post) !== null; }) && candidates.indexOf(container) === -1) candidates.push(container);
				});
			} catch (error) {}
		});
		return candidates.length === 1 ? result('generic', candidates[0], selector) : null;
	}

	function detect(document, config) {
		var detected = manual(document, (config && config.selectors) || {});
		if (detected) return detected;
		if (config && (config.theme === 'p2' || config.theme === 'p2-resurrected')) return p2(document, config.theme);
		return block(document) || generic(document);
	}

	return { detect: detect, manual: manual, p2: p2, block: block, generic: generic, directPosts: directPosts, postId: postId };
}));

