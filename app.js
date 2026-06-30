// ========== DEBUG HELPER ==========
const debugLog = [];
function debug(msg) {
  debugLog.push(msg);
  const el = document.getElementById('debugOutput');
  if (el) el.textContent = debugLog.join('\n');
  console.log(msg);
}

// ========== DB functions (inline) ==========
const DB_NAME = 'forge-db-v2';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  debug('⏳ Opening IndexedDB...');
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      debug('📦 Creating object stores...');
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weights')) db.createObjectStore('weights', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('nutrition')) db.createObjectStore('nutrition', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      debug('✅ Object stores created');
    };
    req.onsuccess = () => {
      debug('✅ IndexedDB opened');
      resolve(req.result);
    };
    req.onerror = () => {
      debug('❌ IndexedDB error: ' + req.error);
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

async function getAll(storeName) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function get(storeName, key) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ========== SIMPLEST POSSIBLE TEST ==========
debug('✅ Script loaded');

// Test if buttons are clickable by attaching ONE simple handler
window.addEventListener('DOMContentLoaded', () => {
  debug('✅ DOM ready');
  
  // Test: does clicking a tab work?
  const tabs = document.querySelectorAll('.tab');
  debug('📋 Found ' + tabs.length + ' tabs');
  
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      debug('🖱️ Tab clicked: ' + tab.textContent);
      // Remove active from all tabs and pages
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      // Activate clicked tab
      tab.classList.add('active');
      const pageId = 'page-' + tab.dataset.page;
      const page = document.getElementById(pageId);
      if (page) {
        page.classList.add('active');
        debug('✅ Showing page: ' + pageId);
      } else {
        debug('❌ Page not found: ' + pageId);
      }
    });
  });
  
  debug('✅ Tab handlers attached');
  
  // Also attach a few critical buttons for testing
  const buttons = ['startWorkoutBtn', 'quickCompleteBtn', 'prevDayBtn', 'nextDayBtn', 'todayBtn'];
  buttons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        debug('🖱️ Button clicked: ' + id);
      });
    } else {
      debug('❌ Button not found: ' + id);
    }
  });
  
  debug('✅ Critical button handlers attached');
});

// Catch any global error
window.addEventListener('error', (e) => {
  debug('💥 ERROR: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
});
