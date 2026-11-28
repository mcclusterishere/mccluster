/* TABLE READ — this device's own takes, kept in this browser (IndexedDB).
   A chunk is saved the moment MediaRecorder hands it over, so a closed tab,
   a dead battery or a dropped call loses at most the last second. Nothing
   here leaves the device: export writes a file the person saves, and a
   transfer to the host happens only after they tap Send. When IndexedDB is
   unavailable (private mode, blocked storage) takes are held in memory and the
   page says recovery is off. */

const DB = 'mcc-table-read';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['key', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (db, stores, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(stores, mode);
  let out;
  t.oncomplete = () => resolve(out);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
  out = fn(t);
});

const all = (store, query) => new Promise((resolve, reject) => {
  const r = query ? store.getAll(query) : store.getAll();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export async function createTakeStore() {
  let db = null;
  try { db = await open(); } catch { db = null; }
  const mem = { takes: new Map(), chunks: new Map() };

  return {
    durable: !!db,
    async begin(meta) {
      const take = { ...meta, key: `${meta.room_id}/${meta.take_id}/${meta.seat_id}`, state: 'recording', chunks: 0, bytes: 0 };
      if (db) await tx(db, ['takes'], 'readwrite', (t) => t.objectStore('takes').put(take));
      else { mem.takes.set(take.key, take); mem.chunks.set(take.key, []); }
      return take;
    },
    async chunk(take, seq, blob, deviceT) {
      take.chunks = Math.max(take.chunks, seq + 1);
      take.bytes += blob.size;
      take.last_chunk_device_t = deviceT;
      if (db) {
        await tx(db, ['takes', 'chunks'], 'readwrite', (t) => {
          t.objectStore('chunks').put({ key: take.key, seq, blob, device_t: deviceT });
          t.objectStore('takes').put(take);
        });
      } else mem.chunks.get(take.key).push({ seq, blob, device_t: deviceT });
    },
    async update(take, patch) {
      Object.assign(take, patch);
      if (db) await tx(db, ['takes'], 'readwrite', (t) => t.objectStore('takes').put(take));
    },
    async list() {
      if (!db) return [...mem.takes.values()];
      return tx(db, ['takes'], 'readonly', (t) => all(t.objectStore('takes'))).then((x) => x)
        .catch(() => []);
    },
    async blob(take) {
      let rows;
      if (db) {
        rows = await new Promise((resolve, reject) => {
          const t = db.transaction(['chunks'], 'readonly');
          const range = IDBKeyRange.bound([take.key, 0], [take.key, Number.MAX_SAFE_INTEGER]);
          const r = t.objectStore('chunks').getAll(range);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      } else rows = mem.chunks.get(take.key) || [];
      rows.sort((a, b) => a.seq - b.seq);
      const gaps = rows.filter((r, i) => r.seq !== i).length;
      return { blob: new Blob(rows.map((r) => r.blob), { type: take.mime || 'video/webm' }), chunks: rows.length, gaps };
    },
    async remove(take) {
      if (!db) { mem.takes.delete(take.key); mem.chunks.delete(take.key); return; }
      const { chunks } = take;
      await tx(db, ['takes', 'chunks'], 'readwrite', (t) => {
        t.objectStore('takes').delete(take.key);
        for (let i = 0; i < chunks; i++) t.objectStore('chunks').delete([take.key, i]);
      });
    },
  };
}

/* The take's manifest: everything Prime's alignment needs besides the media. */
export function manifest(take, extra = {}) {
  return {
    schema: 'mccluster-table-read-take/1',
    room_id: take.room_id,
    take_id: take.take_id,
    seat_id: take.seat_id,
    role: take.role,
    name: take.name,
    scene: take.scene,
    mime: take.mime,
    video: take.video || null,
    started_device_t: take.started_device_t,
    stopped_device_t: take.stopped_device_t ?? null,
    clock: take.clock || null,
    sync: take.sync || [],
    markers: take.markers || [],
    lines: take.lines || [],
    chunks: take.chunks,
    bytes: take.bytes,
    consent: take.consent || null,
    scratch: false,
    ...extra,
  };
}
