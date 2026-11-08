// Shared check-in storage (files starting with "_" inside /api are not turned into URLs).
//
// How answers are stored (private Vercel Blob store):
//   rsvp/guests/<normalized name>.json  ONE file per guest. Written once with allowOverwrite:false, so a save is a
//                                       single upload: no read-modify-write, no ETag, and two guests checking in at the
//                                       same moment can't block each other. This is the source of truth.
//   rsvp/checkins.json                  The combined list the Admin manifest reads: { v: 2, migrated, checkins: { key: entry } }.
//                                       Updated after each check-in and rebuilt from the per-guest files by sync().
//
// Why it is built this way:
//   - The old version kept everything in rsvp/checkins.json and re-wrote it with an ETag check. The ETag returned by
//     reads stopped matching, so every save failed with "Precondition failed: ETag mismatch" after 8 retries (~17 s).
//   - Vercel Blob on Hobby includes 10,000 uncached reads and 2,000 uploads/lists a month, and blocks the store for
//     30 days when they run out. The Admin manifest polls every few seconds, so its reads come from this function's
//     memory or the CDN cache (free), never an uncached read per poll.
import { get, put, list, del } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import { readAdmin, isVvip } from './_admin.js';

export const INDEX_PATH = 'rsvp/checkins.json';
export const GUEST_DIR = 'rsvp/guests/';
const MAX_GUESTS = 1000;

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
const fileKey = (key) => key.replace(/ /g, '-');
const guestPath = (key) => GUEST_DIR + fileKey(key) + '.json';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const isExists = (e) => /already exist/i.test(String(e && e.message));

// ---- In-memory state for this function instance (Vercel reuses warm instances between requests) ----
const mem = {
  index: null,        // last known combined list { key: entry }
  migrated: false,
  at: 0,              // when mem.index was last loaded from storage
  recent: new Map(),  // key -> { e: entry, t: time } saved by this instance in the last 2 minutes
  removed: new Map(), // key -> time, cleared by this instance
  lastSync: 0,
};

function parseIndex(text) {
  let j = {};
  try { j = JSON.parse(text) || {}; } catch (_) { j = {}; }
  if (j && j.v === 2 && j.checkins && typeof j.checkins === 'object') return { checkins: j.checkins, migrated: !!j.migrated };
  // Legacy format: the file itself is the { key: entry } map.
  const out = {};
  for (const [k, v] of Object.entries(j || {})) if (v && typeof v === 'object' && v.name) out[k] = v;
  return { checkins: out, migrated: false };
}

async function readJson(pathname, fresh) {
  const r = await get(pathname, { access: 'private', useCache: !fresh });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return new Response(r.stream).text();
}

// Read the combined list. fresh=true skips the CDN cache (counts as one storage read).
export async function readIndex(fresh = false) {
  let text = null;
  try { text = await readJson(INDEX_PATH, fresh); } catch (e) { if (!(e && e.name === 'BlobNotFoundError')) throw e; }
  const parsed = text == null ? { checkins: {}, migrated: false } : parseIndex(text);
  mem.index = parsed.checkins; mem.migrated = mem.migrated || parsed.migrated; mem.at = Date.now();
  return parsed;
}

async function writeIndex(checkins, migrated) {
  await put(INDEX_PATH, JSON.stringify({ v: 2, migrated: !!migrated, checkins }), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  mem.index = checkins; mem.migrated = mem.migrated || !!migrated; mem.at = Date.now();
}

// What the admin sees: storage list + anything this instance saved/cleared that the (cached) list may not show yet.
function overlay(checkins) {
  const out = Object.assign({}, checkins);
  const now = Date.now();
  for (const [k, r] of mem.recent) {
    if (now - r.t > 2 * 60 * 1000) { mem.recent.delete(k); continue; } // the CDN copy is at most 60 s old by now
    out[k] = out[k] || r.e;
  }
  for (const [k, t] of mem.removed) {
    if (now - t > 5 * 60 * 1000) mem.removed.delete(k); else delete out[k];
  }
  return out;
}

// Save one guest's answer. Answers are final: a second check-in for the same guest gets status 409 with the first answer.
export async function saveCheckin(entry) {
  const key = norm(entry.name);
  // 1) Already answered? Once the old answers have been moved into per-guest files (migrated), step 2 detects this by
  //    itself. Before that, check the combined list (fresh read).
  if (!mem.migrated) {
    const { checkins } = await readIndex(true);
    if (checkins[key]) throw Object.assign(new Error('Already answered'), { status: 409, prev: checkins[key] });
    if (Object.keys(checkins).length >= MAX_GUESTS) throw Object.assign(new Error('Guest list is full'), { status: 400 });
  }
  const rec = Object.assign({}, entry, { first: entry.at });

  // 2) Save the guest's own file. This is the step that must succeed.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await put(guestPath(key), JSON.stringify(rec), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
      lastErr = null;
      break;
    } catch (e) {
      if (isExists(e)) {
        let prev = null;
        try { prev = JSON.parse(await readJson(guestPath(key), true)); } catch (_) {}
        throw Object.assign(new Error('Already answered'), { status: 409, prev: prev || rec });
      }
      lastErr = e;
      await sleep(250 * (attempt + 1));
    }
  }
  if (lastErr) throw lastErr;
  mem.recent.set(key, { e: rec, t: Date.now() }); mem.removed.delete(key);

  // 3) The guest's answer is safe now, so reply right away and update the combined list in the background:
  //    add it, check it is still there (another guest saving at the same moment may have written over it) and add it
  //    again if not. Best effort: if this still fails, sync() repairs the list.
  const update = (async () => {
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const cur = await readIndex(true);
        if (attempt > 0 && cur.checkins[key] && cur.checkins[key].at === rec.at) break;
        cur.checkins[key] = rec;
        await writeIndex(cur.checkins, cur.migrated);
        await sleep(150 + Math.random() * 350);
      }
    } catch (e) { console.error('index update failed', e && e.message); }
  })();
  try { waitUntil(update); } catch (_) { await update; }
  return rec;
}

// Rebuild the combined list from the per-guest files (repairs anything a failed or simultaneous update missed).
// Also moves answers saved by the old version (only in the combined list) into per-guest files, once.
export async function sync() {
  const files = new Map();
  let cursor;
  do {
    const r = await list({ prefix: GUEST_DIR, cursor, limit: 1000 });
    for (const b of r.blobs) files.set(b.pathname, b);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);

  const { checkins, migrated } = await readIndex(true);
  const next = {};
  let changed = !migrated;
  // Answers in the list
  for (const [k, e] of Object.entries(checkins)) {
    if (files.has(guestPath(k))) { next[k] = e; continue; }
    if (!migrated) {
      // One-time move of an old answer into its own file
      try { await put(guestPath(k), JSON.stringify(e), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false }); } catch (err) { if (!isExists(err)) throw err; }
      next[k] = e;
    } else {
      changed = true; // its file was cleared: drop it from the list
    }
  }
  // Per-guest files missing from the list
  for (const p of files.keys()) {
    const k = p.slice(GUEST_DIR.length, -5).replace(/-/g, ' ');
    if (next[k]) continue;
    try { const e = JSON.parse(await readJson(p, true)); if (e && e.name) { next[k] = e; changed = true; } } catch (_) {}
  }
  if (changed) await writeIndex(next, true);
  mem.lastSync = Date.now();
  return next;
}

// Remove one guest's answer (Admin "Clear check-in"). Returns true if something was removed.
export async function removeKey(key) {
  let removed = false;
  try { await del(guestPath(key)); removed = true; } catch (e) { if (!(e && e.name === 'BlobNotFoundError')) throw e; }
  const cur = await readIndex(true);
  if (key in cur.checkins) { delete cur.checkins[key]; removed = true; await writeIndex(cur.checkins, cur.migrated); }
  mem.recent.delete(key); mem.removed.set(key, Date.now());
  return removed;
}

// Admin read. Cheap by default (memory for 3 s, then the CDN-cached list); sync=true rebuilds from the per-guest files.
export async function readForAdmin({ sync: doSync = false } = {}) {
  if (doSync && Date.now() - mem.lastSync > 20 * 1000) {
    try { await sync(); } catch (e) { console.error('sync failed', e && e.message); }
  } else if (!mem.index || Date.now() - mem.at > 3000) {
    await readIndex(false);
  }
  return overlay(mem.index || {});
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const detail = (e) => String((e && (e.name + ': ' + e.message)) || e).slice(0, 300);

export function makeHandler() {
  return async function handle(request) {
    const adminKey = process.env.ADMIN_KEY || 'KarrlouandJoanna';
    try {
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Bad request' }, 400); }
        const name = clip(body && body.name, 160);
        const attend = body && body.attend;
        const email = clip(body && body.email, 200);
        if (!name || !norm(name)) return json({ ok: false, error: 'Missing name' }, 400);
        if (attend !== 'yes' && attend !== 'no') return json({ ok: false, error: 'Missing attendance' }, 400);
        if (attend === 'yes' && !email) return json({ ok: false, error: 'Email required' }, 400);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Invalid email' }, 400);
        try {
          const saved = await saveCheckin({ name, attend, email: attend === 'yes' ? email : '', typed: clip(body.typed, 200), at: new Date().toISOString() });
          return json({ ok: true, at: saved.at, vvip: await isVvip(name) });
        } catch (e) {
          if (e && e.status === 409) return json({ ok: false, already: true, attend: e.prev.attend, at: e.prev.at, vvip: await isVvip(name) }, 409);
          throw e;
        }
      }
      if (request.method === 'DELETE') {
        if (request.headers.get('x-admin-key') !== adminKey) return json({ ok: false, error: 'Unauthorized' }, 401);
        let body;
        try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Bad request' }, 400); }
        const key = norm(body && (body.key || body.name));
        if (!key) return json({ ok: false, error: 'Missing name' }, 400);
        const removed = await removeKey(key);
        return json({ ok: true, removed });
      }
      if (request.method === 'GET') {
        if (request.headers.get('x-admin-key') !== adminKey) return json({ ok: false, error: 'Unauthorized' }, 401);
        const doSync = new URL(request.url).searchParams.get('sync') === '1';
        const [checkins, admin] = await Promise.all([readForAdmin({ sync: doSync }), readAdmin({ fresh: doSync })]);
        return json({ ok: true, checkins, admin, now: new Date().toISOString(), synced: doSync });
      }
      return json({ ok: false, error: 'Method not allowed' }, 405);
    } catch (e) {
      console.error('checkin error', detail(e));
      return json({ ok: false, error: 'Server error', detail: detail(e) }, e && e.status === 400 ? 400 : 500);
    }
  };
}
