// Shared Admin data: the same guest-list edits, VVIP marks and "seen" mark on every device.
//
// Stored in the private Vercel Blob store as rsvp/admin.json:
//   { v: 1, rev, updatedAt, edits: { key: guest }, added: [guest], deleted: [key], seenAt, ops: [recent op ids] }
//   guest = { key, name, cat, sent, resp: 'Yes' | 'No' | 'Pending', vvip }
//   key   = 'b:<normalized name>' for guests in the built-in list, 'n:<id>' for guests added in Admin.
//
// Devices send small changes ("ops"), never the whole list, so two devices editing at the same time don't erase each
// other's work. Each op has an id: the server applies it once, checks after writing that it is still there (another
// device may have saved at the same moment) and applies it again if not.
import { get, put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import { norm } from './_checkins.js';

export const ADMIN_PATH = 'rsvp/admin.json';
const MAX_OPS_KEPT = 400;
const RESP = ['Yes', 'No', 'Pending'];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const empty = () => ({ v: 1, rev: 0, updatedAt: null, edits: {}, added: [], deleted: [], seenAt: 0, ops: [] });

const mem = { data: null, at: 0, recent: null, recentAt: 0 };

function clean(d) {
  const out = empty();
  if (!d || typeof d !== 'object') return out;
  out.rev = +d.rev || 0;
  out.updatedAt = d.updatedAt || null;
  out.seenAt = +d.seenAt || 0;
  out.ops = Array.isArray(d.ops) ? d.ops.slice(-MAX_OPS_KEPT) : [];
  if (d.edits && typeof d.edits === 'object') for (const [k, g] of Object.entries(d.edits)) { const c = cleanGuest(g, k); if (c) out.edits[k] = c; }
  if (Array.isArray(d.added)) for (const g of d.added) { const c = cleanGuest(g, g && g.key); if (c && /^n:/.test(c.key)) out.added.push(c); }
  if (Array.isArray(d.deleted)) out.deleted = [...new Set(d.deleted.filter((k) => typeof k === 'string').map((k) => clip(k, 200)))];
  return out;
}
function cleanGuest(g, key) {
  if (!g || typeof g !== 'object') return null;
  const name = clip(g.name, 160);
  key = clip(key || g.key, 200);
  if (!name || !key) return null;
  return { key, name, cat: clip(g.cat, 40) || 'Others', sent: !!g.sent, resp: RESP.includes(g.resp) ? g.resp : 'Pending', vvip: !!g.vvip };
}

async function readRaw(fresh) {
  let r;
  try { r = await get(ADMIN_PATH, { access: 'private', useCache: !fresh }); } catch (e) { if (e && e.name === 'BlobNotFoundError') return empty(); throw e; }
  if (!r || r.statusCode !== 200 || !r.stream) return empty();
  let j = null; try { j = JSON.parse(await new Response(r.stream).text()); } catch (_) {}
  return clean(j);
}

// Read the admin data. Cheap by default (memory for 3 s, then the CDN copy); fresh=true always reads storage.
export async function readAdmin({ fresh = false } = {}) {
  if (!fresh && mem.data && Date.now() - mem.at < 3000) return pick(mem.data);
  let d = await readRaw(fresh);
  // The CDN copy can be up to 60 s old: never go back to an older version than one this instance has already seen.
  if (mem.recent && mem.recent.rev > d.rev && Date.now() - mem.recentAt < 2 * 60 * 1000) d = mem.recent;
  mem.data = d; mem.at = Date.now();
  return pick(d);
}
const pick = (d) => ({ rev: d.rev, updatedAt: d.updatedAt, edits: d.edits, added: d.added, deleted: d.deleted, seenAt: d.seenAt });

async function writeAdmin(d) {
  await put(ADMIN_PATH, JSON.stringify(d), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  mem.data = d; mem.at = Date.now(); mem.recent = d; mem.recentAt = Date.now();
}

// Apply one op to the data (mutates d). Returns false if the op is not valid.
export function applyOp(d, op) {
  if (!op || typeof op !== 'object') return false;
  switch (op.type) {
    case 'edit': {
      const key = clip(op.key, 200), g = cleanGuest(op.guest, key);
      if (!g) return false;
      if (key.startsWith('n:')) {
        const i = d.added.findIndex((a) => a.key === key);
        if (i >= 0) d.added[i] = g; else d.added.push(g);
      } else d.edits[key] = g;
      return true;
    }
    case 'add': {
      const g = cleanGuest(op.guest, op.guest && op.guest.key);
      if (!g || !g.key.startsWith('n:')) return false;
      if (!d.added.some((a) => a.key === g.key)) d.added.push(g);
      return true;
    }
    case 'delete': {
      const key = clip(op.key, 200);
      if (!key) return false;
      if (key.startsWith('n:')) d.added = d.added.filter((a) => a.key !== key);
      else if (!d.deleted.includes(key)) d.deleted.push(key);
      return true;
    }
    case 'reset':
      d.edits = {}; d.added = []; d.deleted = [];
      return true;
    case 'seen':
      d.seenAt = Math.max(+d.seenAt || 0, +op.at || 0);
      return true;
    case 'import': {
      // Edits a device saved before Admin was shared: add them without overwriting anything already shared.
      const src = clean(op.data);
      for (const [k, g] of Object.entries(src.edits)) if (!d.edits[k]) d.edits[k] = g;
      for (const g of src.added) if (!d.added.some((a) => a.key === g.key)) d.added.push(g);
      for (const k of src.deleted) if (!d.deleted.includes(k)) d.deleted.push(k);
      d.seenAt = Math.max(+d.seenAt || 0, +(op.data && op.data.seenAt) || 0);
      return true;
    }
    default:
      return false;
  }
}

// Save ops from a device. Replies after the first write; the check-and-reapply step continues in the background.
export async function saveOps(ops) {
  ops = (Array.isArray(ops) ? ops : []).filter((o) => o && typeof o.id === 'string' && o.id.length <= 64).slice(0, 50);
  if (!ops.length) return readAdmin({ fresh: true });
  const ids = ops.map((o) => o.id);
  const once = async () => {
    const d = await readRaw(true);
    const todo = ops.filter((o) => !d.ops.includes(o.id));
    if (!todo.length) return { d, wrote: false };
    for (const o of todo) { applyOp(d, o); d.ops.push(o.id); }
    d.ops = d.ops.slice(-MAX_OPS_KEPT);
    d.rev = (d.rev || 0) + 1; d.updatedAt = new Date().toISOString();
    await writeAdmin(d);
    return { d, wrote: true };
  };
  const first = await once();
  const verify = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(200 + Math.random() * 400);
        const d = await readRaw(true);
        if (ids.every((id) => d.ops.includes(id))) { if (d.rev >= (mem.data ? mem.data.rev : 0)) { mem.data = d; mem.at = Date.now(); } break; }
        await once();
      }
    } catch (e) { console.error('admin verify failed', e && e.message); }
  })();
  try { waitUntil(verify); } catch (_) { await verify; }
  return pick(first.d);
}

// What guests' own devices need (no answers, emails or invitation status): added / removed / renamed guests and VVIP marks.
export function publicView(a) {
  const renamed = {}, vvip = {};
  for (const [k, g] of Object.entries(a.edits || {})) { renamed[k] = g.name; vvip[k] = !!g.vvip; }
  return {
    rev: a.rev,
    added: (a.added || []).map((g) => ({ key: g.key, name: g.name, vvip: !!g.vvip })),
    deleted: a.deleted || [],
    renamed, vvip,
  };
}

// Is this guest marked VVIP in the shared Admin data? (Used to put the plus-one note on the guest's own pass.)
export async function isVvip(name) {
  try {
    const a = await readAdmin();
    const k = norm(name);
    for (const [key, g] of Object.entries(a.edits || {})) if ((key === 'b:' + k || norm(g.name) === k)) return !!g.vvip;
    const add = (a.added || []).find((g) => norm(g.name) === k);
    return !!(add && add.vvip);
  } catch (_) { return false; }
}

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});
const detail = (e) => String((e && (e.name + ': ' + e.message)) || e).slice(0, 300);

export function makeAdminHandler() {
  return async function handle(request) {
    const adminKey = process.env.ADMIN_KEY || 'KarrlouandJoanna';
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.searchParams.get('public') === '1') {
        const a = await readAdmin();
        // Guests' devices: let Vercel's CDN answer most of these (refreshed every 20 s).
        return json({ ok: true, guests: publicView(a) }, 200, 'public, max-age=0, s-maxage=20, stale-while-revalidate=60');
      }
      if (request.headers.get('x-admin-key') !== adminKey) return json({ ok: false, error: 'Unauthorized' }, 401);
      if (request.method === 'GET') {
        const admin = await readAdmin({ fresh: url.searchParams.get('fresh') === '1' });
        return json({ ok: true, admin });
      }
      if (request.method === 'POST') {
        let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Bad request' }, 400); }
        const admin = await saveOps(body && body.ops);
        return json({ ok: true, admin });
      }
      return json({ ok: false, error: 'Method not allowed' }, 405);
    } catch (e) {
      console.error('admin error', detail(e));
      return json({ ok: false, error: 'Server error', detail: detail(e) }, 500);
    }
  };
}
