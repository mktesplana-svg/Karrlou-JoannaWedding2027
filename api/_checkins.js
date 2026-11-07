// Shared check-in storage (files starting with "_" inside /api are not turned into URLs).
// All answers live in ONE private Vercel Blob file: { "<normalized name>": { name, attend, email, typed, at, first } }.
// Every write uses the file's ETag, so two guests checking in at the same moment can't overwrite each other.
import { get, put } from '@vercel/blob';

export const DEFAULT_PATH = 'rsvp/checkins.json';
const MAX_GUESTS = 1000;

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export async function readAll(pathname = DEFAULT_PATH) {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { data: {}, etag: null };
  const text = await new Response(r.stream).text();
  let data = {};
  try { data = JSON.parse(text) || {}; } catch (_) { data = {}; }
  return { data, etag: r.blob.etag };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Save one guest's answer. Retries when someone else saved in between.
// A guest who has already answered can't change it (status 409); the couple can clear it in Admin.
export async function saveCheckin(entry, pathname = DEFAULT_PATH) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const { data, etag } = await readAll(pathname);
      const key = norm(entry.name);
      const prev = data[key];
      if (prev) throw Object.assign(new Error('Already answered'), { status: 409, prev });
      if (Object.keys(data).length >= MAX_GUESTS) throw Object.assign(new Error('Guest list is full'), { status: 400 });
      data[key] = Object.assign({}, entry, { first: entry.at });
      const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
      if (etag) { opts.allowOverwrite = true; opts.ifMatch = etag; }
      await put(pathname, JSON.stringify(data), opts);
      return data[key];
    } catch (e) {
      if (e && (e.status === 400 || e.status === 409)) throw e;
      lastErr = e;
      await sleep(80 + Math.random() * 250 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Could not save');
}

// Remove one guest's answer (Admin "Clear check-in"). Returns true if something was removed.
export async function removeKey(key, pathname = DEFAULT_PATH) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const { data, etag } = await readAll(pathname);
      if (!etag || !(key in data)) return false;
      delete data[key];
      await put(pathname, JSON.stringify(data), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, cacheControlMaxAge: 60 });
      return true;
    } catch (e) { lastErr = e; await sleep(80 + Math.random() * 250 * (attempt + 1)); }
  }
  throw lastErr || new Error('Could not remove');
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

export function makeHandler(pathname = DEFAULT_PATH) {
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
          const saved = await saveCheckin({ name, attend, email: attend === 'yes' ? email : '', typed: clip(body.typed, 200), at: new Date().toISOString() }, pathname);
          return json({ ok: true, at: saved.at });
        } catch (e) {
          if (e && e.status === 409) return json({ ok: false, already: true, attend: e.prev.attend, at: e.prev.at }, 409);
          throw e;
        }
      }
      if (request.method === 'DELETE') {
        if (request.headers.get('x-admin-key') !== adminKey) return json({ ok: false, error: 'Unauthorized' }, 401);
        let body;
        try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Bad request' }, 400); }
        const key = norm(body && (body.key || body.name));
        if (!key) return json({ ok: false, error: 'Missing name' }, 400);
        const removed = await removeKey(key, pathname);
        return json({ ok: true, removed });
      }
      if (request.method === 'GET') {
        if (request.headers.get('x-admin-key') !== adminKey) return json({ ok: false, error: 'Unauthorized' }, 401);
        const { data } = await readAll(pathname);
        return json({ ok: true, checkins: data, now: new Date().toISOString() });
      }
      return json({ ok: false, error: 'Method not allowed' }, 405);
    } catch (e) {
      console.error('checkin error', e && e.message);
      return json({ ok: false, error: 'Server error' }, e && e.status === 400 ? 400 : 500);
    }
  };
}
