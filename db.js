const DB_NAME = 'forge-db-v2';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weights')) db.createObjectStore('weights', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('nutrition')) db.createObjectStore('nutrition', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

export async function getAll(storeName) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function get(storeName, key) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function exportDB() {
  const [settings, sessions, weights, nutrition, notes] = await Promise.all([
    getAll('settings'),
    getAll('sessions'),
    getAll('weights'),
    getAll('nutrition'),
    getAll('notes')
  ]);
  return { settings, sessions, weights, nutrition, notes, exportedAt: new Date().toISOString() };
}

export async function importDB(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  for (const row of data.settings || []) await put('settings', row);
  for (const row of data.sessions || []) await put('sessions', row);
  for (const row of data.weights || []) await put('weights', row);
  for (const row of data.nutrition || []) await put('nutrition', row);
  for (const row of data.notes || []) await put('notes', row);
}

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}