const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const script = fs.readFileSync(require('node:path').join(__dirname,'../assets/js/top-widget.js'),'utf8');
async function boot(fetch, count=1) {
 const dom=new JSDOM('<body>'+('<div class="wp-seen-posts-top-live" data-period="week" data-limit="5" data-display="text"><a href="/old">Old ranking</a></div>').repeat(count),{url:'https://example.com/',runScripts:'outside-only'});
 const w=dom.window;Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});
 w.wpSeenTopConfig={endpoint:'/wp-json/wp-seen-posts/v1/top'};w.fetch=fetch;
 let refresh;w.setInterval=()=>0;w.setTimeout=(fn,ms)=>{if(ms===500)refresh=fn;return 0;};
 w.eval(script);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return {w,refresh:async()=>{refresh();await new Promise(r=>setImmediate(r));}};
}
test('replaces stale ranking membership and batches identical widget requests',async()=>{
 let requests=0;const {w,refresh}=await boot(async(url,opts)=>{requests++;assert.equal(new URL(url).searchParams.get('period'),'week');assert.equal(opts.cache,'no-store');return {ok:true,json:async()=>({html:'<ul><li>New leader</li></ul>'})};},2);
 await refresh();assert.equal(requests,1);
 assert.equal(w.document.querySelectorAll('li').length,2);assert.equal(w.document.body.textContent.includes('Old ranking'),false);
 await refresh();assert.equal(requests,1);w.close();
});
test('refresh failures retain server-rendered fallback',async()=>{
 const {w,refresh}=await boot(async()=>{throw new Error('offline');});await refresh();assert.equal(w.document.querySelector('a').textContent,'Old ranking');w.close();
});
test('hidden tabs do not request rankings',async()=>{
 let requests=0;const {w,refresh}=await boot(async()=>{requests++;});Object.defineProperty(w.document,'visibilityState',{value:'hidden'});await refresh();assert.equal(requests,0);w.close();
});
test('empty rankings clear expired entries',async()=>{
 const {w,refresh}=await boot(async()=>({ok:true,json:async()=>({html:''})}));await refresh();assert.equal(w.document.querySelector('.wp-seen-posts-top-live').children.length,0);w.close();
});
