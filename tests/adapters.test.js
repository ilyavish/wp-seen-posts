'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const adapters = require('../assets/js/adapters.js');

function documentFor(html) {
	return new JSDOM(html, { url: 'https://example.com/' }).window.document;
}

test('detects P2 and extracts its real prologue ID', () => {
	const document = documentFor('<main id="main"><ul id="postlist"><li id="prologue-42" class="post post-42 hentry">Post</li></ul></main>');
	const result = adapters.detect(document, { theme: 'p2-resurrected', selectors: {} });
	assert.equal(result.name, 'p2-resurrected');
	assert.equal(adapters.postId(result.posts[0]), '42');
});

test('detects a Query Loop and reads post classes', () => {
	const document = documentFor('<div class="wp-block-query"><ul class="wp-block-post-template"><li class="wp-block-post post-12">Post</li></ul></div>');
	const result = adapters.detect(document, { theme: 'generic', selectors: {} });
	assert.equal(result.name, 'block');
	assert.equal(adapters.postId(result.posts[0]), '12');
});

test('detects a conservative direct classic feed', () => {
	const document = documentFor('<main class="site-main"><article id="post-7" class="post hentry">Post</article></main>');
	assert.equal(adapters.detect(document, { theme: 'generic', selectors: {} }).name, 'generic');
});

test('fails safely for uncertain elements and ambiguous feeds', () => {
	const document = documentFor('<main><article id="post-7" class="post">One</article></main><div class="posts"><article id="post-8">Other</article></div>');
	assert.equal(adapters.detect(document, { theme: 'generic', selectors: {} }), null);
	assert.equal(adapters.postId(documentFor('<article class="post">No ID</article>').querySelector('.post')), null);
});

test('manual selectors require exactly one feed and real IDs', () => {
	const document = documentFor('<section id="feed"><div class="card" data-post-id="99">Post</div></section>');
	const result = adapters.manual(document, { feed: '#feed', post: ':scope > .card' });
	assert.equal(result.name, 'manual');
	assert.equal(adapters.postId(result.posts[0]), '99');
	assert.equal(adapters.manual(document, { feed: '[', post: '.card' }), null);
});
