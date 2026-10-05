// Локальная база на устройстве (IndexedDB).
// Структура повторяет разделы ТЗ 45–60: проект → скважина → интервал описания →
// проба → анализ → фото. У каждой записи внутренний UUID (п.59), created_at /
// updated_at, удаление «мягкое» (deleted_at).
// Все записи при запуске читаются в память — запросы и расчёты идут по памяти,
// запись сразу уходит в IndexedDB. Файлы фото хранятся отдельно и в память не грузятся.

import { uuid, nowIso } from './util.js';

const DB_NAME = 'kern-logging';
const DB_VERSION = 1;

export const TABLES = [
  'projects', 'holes', 'survey', 'intervals', 'samples', 'assays', 'imports', 'photos',
  'ref_lithology', 'ref_alteration', 'ref_intensity', 'ref_mineral', 'ref_vein_type',
  'ref_structure', 'ref_texture', 'ref_element', 'ref_unit', 'settings'
];
const BLOBS = 'photo_blobs';

let idb = null;
const mem = Object.fromEntries(TABLES.map(t => [t, new Map()]));
let version = 0;                      // растёт при каждом изменении — для кэшей расчётов
const listeners = new Set();

export const dataVersion = () => version;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(table) { version++; listeners.forEach(fn => fn(table)); }

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
  });
}

export async function openDb() {
  idb = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('База открыта в другой вкладке — закройте её'));
  });
  const tx = idb.transaction(TABLES, 'readonly');
  await Promise.all(TABLES.map(async t => {
    const rows = await req(tx.objectStore(t).getAll());
    const m = mem[t];
    m.clear();
    for (const row of rows) m.set(row.id, row);
  }));
  version++;
}

// ---------- Чтение ----------

export function all(table, { withDeleted = false } = {}) {
  const out = [];
  for (const row of mem[table].values()) if (withDeleted || !row.deleted_at) out.push(row);
  return out;
}

export function get(table, id) {
  const row = mem[table].get(id);
  return row && !row.deleted_at ? row : null;
}

export function getAny(table, id) { return mem[table].get(id) || null; }

export function count(table) { return mem[table].size; }

// ---------- Запись ----------

function stamp(table, row) {
  const now = nowIso();
  const prev = row.id ? mem[table].get(row.id) : null;
  return { ...row, id: row.id || uuid(), created_at: row.created_at || prev?.created_at || now, updated_at: now };
}

export async function put(table, row) {
  const rec = stamp(table, row);
  const tx = idb.transaction(table, 'readwrite');
  tx.objectStore(table).put(rec);
  await txDone(tx);
  mem[table].set(rec.id, rec);
  changed(table);
  return rec;
}

// Несколько таблиц одной транзакцией: [{table, row}] или [{table, id, delete: true}]
export async function batch(ops) {
  const tables = [...new Set(ops.map(o => o.table))];
  if (!tables.length) return [];
  const tx = idb.transaction(tables, 'readwrite');
  const out = [];
  const staged = [];
  for (const op of ops) {
    if (op.delete) {
      tx.objectStore(op.table).delete(op.id);
      staged.push(() => mem[op.table].delete(op.id));
    } else {
      const rec = stamp(op.table, op.row);
      tx.objectStore(op.table).put(rec);
      staged.push(() => mem[op.table].set(rec.id, rec));
      out.push(rec);
    }
  }
  await txDone(tx);
  staged.forEach(fn => fn());
  tables.forEach(changed);
  return out;
}

export async function putMany(table, rows) {
  return batch(rows.map(row => ({ table, row })));
}

export async function softDelete(table, id) {
  const row = mem[table].get(id);
  if (!row) return;
  return put(table, { ...row, deleted_at: nowIso() });
}

export async function hardDelete(table, id) {
  return batch([{ table, id, delete: true }]);
}

// ---------- Файлы фото ----------

export async function putBlob(id, blob) {
  const tx = idb.transaction(BLOBS, 'readwrite');
  tx.objectStore(BLOBS).put(blob, id);
  await txDone(tx);
}

export async function getBlob(id) {
  const tx = idb.transaction(BLOBS, 'readonly');
  return req(tx.objectStore(BLOBS).get(id));
}

export async function deleteBlob(id) {
  const tx = idb.transaction(BLOBS, 'readwrite');
  tx.objectStore(BLOBS).delete(id);
  await txDone(tx);
}

export async function blobKeys() {
  const tx = idb.transaction(BLOBS, 'readonly');
  return req(tx.objectStore(BLOBS).getAllKeys());
}

// ---------- Резервная копия / восстановление ----------

export function dumpTables() {
  return Object.fromEntries(TABLES.map(t => [t, [...mem[t].values()]]));
}

// Полная замена данных (восстановление из резервной копии)
export async function replaceAll(tables, blobs) {
  const tx = idb.transaction([...TABLES, BLOBS], 'readwrite');
  for (const t of TABLES) {
    const store = tx.objectStore(t);
    store.clear();
    for (const row of tables[t] || []) store.put(row);
  }
  const bs = tx.objectStore(BLOBS);
  bs.clear();
  for (const [id, blob] of blobs) bs.put(blob, id);
  await txDone(tx);
  for (const t of TABLES) {
    mem[t].clear();
    for (const row of tables[t] || []) mem[t].set(row.id, row);
  }
  version++;
  listeners.forEach(fn => fn('*'));
}

// ---------- Настройки ----------

export function setting(key, fallback = null) {
  return mem.settings.get(key)?.value ?? fallback;
}

export async function setSetting(key, value) {
  return put('settings', { id: key, value });
}

// Просьба к браузеру не удалять данные при нехватке места
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageInfo() {
  try {
    const [est, persisted] = await Promise.all([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.()
    ]);
    return { usage: est?.usage, quota: est?.quota, persisted: !!persisted };
  } catch {
    return { persisted: false };
  }
}
