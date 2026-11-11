const CACHE = 'bc-v2';
const ASSETS = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

/* ── install / activate / fetch ── */
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request, {ignoreSearch:true})));
});

/* ── IndexedDB helpers (SW-side) ── */
function openDB() {
  return new Promise((res,rej) => {
    const r = indexedDB.open('bestcleaner', 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', {keyPath:'id',autoIncrement:true});
    };
    r.onsuccess = e => res(e.target.result); r.onerror = e => rej(e.target.error);
  });
}
function idbGet(store, key) { return openDB().then(db => new Promise((res,rej) => { const r=db.transaction(store,'readonly').objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e.target.error); })); }
function idbGetAll(store) { return openDB().then(db => new Promise((res,rej) => { const r=db.transaction(store,'readonly').objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e.target.error); })); }
function idbDelete(store, key) { return openDB().then(db => new Promise((res,rej) => { const r=db.transaction(store,'readwrite').objectStore(store).delete(key); r.onsuccess=()=>res(); r.onerror=e=>rej(e.target.error); })); }

/* ── Telegram send helper ── */
async function tgSend(token, chatId, text) {
  for (let i=0; i<text.length; i+=4000) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: text.slice(i,i+4000)})
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'HTTP '+r.status);
  }
}

/* ── Background Sync: queue-er sob pending message pathao ── */
async function flushQueue() {
  const token = await idbGet('kv','token') || '';
  const chatId = await idbGet('kv','chatId') || '';
  if (!token || !chatId) return;
  const items = (await idbGetAll('queue')).filter(x=>x.status==='pending');
  for (const item of items) {
    try { await tgSend(token, chatId, item.text); await idbDelete('queue', item.id); }
    catch(e) { /* retry next sync */ }
  }
  /* open tab-ke notify koro */
  const clients = await self.clients.matchAll({type:'window'});
  clients.forEach(c => c.postMessage({type:'queue-updated'}));
}

self.addEventListener('sync', e => { if (e.tag === 'bc-send') e.waitUntil(flushQueue()); });
self.addEventListener('periodicsync', e => { if (e.tag === 'bc-periodic') e.waitUntil(flushQueue()); });
