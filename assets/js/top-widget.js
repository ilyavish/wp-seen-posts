(function () {
 'use strict';
 var config = window.wpSeenTopConfig || {};
 if (!config.endpoint || typeof window.fetch !== 'function') return;
 function init() {
  var widgets = Array.prototype.slice.call(document.querySelectorAll('.wp-seen-posts-top-live'));
  if (!widgets.length) return;
  var busy = false;
  var lastAttempt = 0;
  function refresh() {
   if (busy || document.visibilityState === 'hidden' || Date.now() - lastAttempt < 300000) return;
   busy = true;
   lastAttempt = Date.now();
   var requests = new Map();
   Promise.all(widgets.map(function (widget) {
    var url = new URL(config.endpoint, window.location.href);
    if (url.origin !== window.location.origin) return Promise.resolve();
    ['period', 'limit', 'display'].forEach(function (key) { url.searchParams.set(key, widget.dataset[key]); });
    var key = url.href;
    if (!requests.has(key)) {
     var controller = new AbortController();
     var timer = window.setTimeout(function () { controller.abort(); }, 10000);
     requests.set(key, window.fetch(key, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(function (response) { if (!response.ok) throw new Error('Widget refresh failed'); return response.json(); })
      .finally(function () { window.clearTimeout(timer); }));
    }
    return requests.get(key).then(function (data) {
     if (!data || typeof data.html !== 'string' || widget.contains(document.activeElement)) return;
     var parsed = new DOMParser().parseFromString(data.html, 'text/html');
     // Keep focus and server-rendered fallback intact; never import executable elements.
     parsed.querySelectorAll('script, iframe, object, embed').forEach(function (node) { node.remove(); });
     widget.replaceChildren.apply(widget, Array.prototype.slice.call(parsed.body.childNodes).map(function (node) { return document.importNode(node, true); }));
     if (window.WPSeenPublicCounts && typeof window.WPSeenPublicCounts.register === 'function') window.WPSeenPublicCounts.register(widget);
    }).catch(function () {});
   })).finally(function () { busy = false; });
  }
  window.setTimeout(refresh, 500);
  window.setInterval(refresh, 300000);
  document.addEventListener('visibilitychange', refresh);
 }
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
 else init();
}());
