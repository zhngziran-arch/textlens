// 浏览器端 IndexedDB 存储（历史文章 + 推荐流量数据，纯本地不上传）
const DB_NAME = 'textlens_db';
const DB_VER = 1;
const STORE = 'articles';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

export async function listHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)));
    req.onerror = () => reject(req.error);
  });
}

export async function upsertArticles(articles) {
  const existing = await listHistory();
  const db = await openDB();
  let added = 0, updated = 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const a of articles) {
      const content = String(a.content || '').trim();
      if (content.length < 50) continue;
      const title = String(a.title || '').trim();
      const date = a.date || new Date().toISOString().slice(0, 10);
      const hit = a.id && existing.find(x => x.id === a.id) || existing.find(x => x.title && x.title === title && x.date === date);
      const rec = {
        id: hit ? hit.id : newId(),
        title,
        date,
        platform: a.platform || (hit ? hit.platform : 'wechat'),
        content,
        recommendedReads: a.recommendedReads !== undefined ? numOrNull(a.recommendedReads) : (hit ? hit.recommendedReads : null),
        totalReads: a.totalReads !== undefined ? numOrNull(a.totalReads) : (hit ? hit.totalReads : null),
        lowCreativityFlag: Boolean(a.lowCreativityFlag ?? hit?.lowCreativityFlag ?? false),
        updatedAt: Date.now()
      };
      store.put(rec);
      if (hit) updated++; else added++;
    }
    tx.oncomplete = () => resolve({ added, updated });
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateMeta(id, patch) {
  const all = await listHistory();
  const item = all.find(x => x.id === id);
  if (!item) throw new Error('记录不存在');
  if ('title' in patch) item.title = String(patch.title || '').trim();
  if ('date' in patch) item.date = patch.date || '';
  if ('platform' in patch) item.platform = patch.platform;
  if ('recommendedReads' in patch) item.recommendedReads = numOrNull(patch.recommendedReads);
  if ('totalReads' in patch) item.totalReads = numOrNull(patch.totalReads);
  if ('lowCreativityFlag' in patch) item.lowCreativityFlag = Boolean(patch.lowCreativityFlag);
  item.updatedAt = Date.now();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteArticle(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
