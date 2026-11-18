import { store } from './_lib/store.js';
import { send, readJson } from './_lib/http.js';
import { verify } from './_lib/round.js';
import { RACE_START, RACE_SECONDS, FINISH_TAIL, SETTLE, BUCKET, MAX_PER_BUCKET, RUNNERS } from '../src/schedule.js';

const MAX_ENTRIES = 24;
const BACKFILL = 8; // sn: bu kadar eski kovalar kabul edilir (ağ gecikmesi / yeniden deneme payı)

// POST /api/press { id, s, t (kilit anı), k, p: [[kova, adet], ...] } — oyuncunun son kovalarındaki vuruş sayıları.
// Belirteç (durumsuz HMAC) doğrulanır; kovalar yarış zaman penceresinde ve makul sayıda olmalı (gelecek/çok eski/aşırı hızlı reddedilir).
// HSET ile yazıldığı için aynı istek tekrarlansa da sonuç değişmez.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, {});
  if (!store) return send(res, 503, { reason: 'no-store' });
  const b = await readJson(req);
  if (!b || !Array.isArray(b.p) || !Number.isInteger(b.id) || !Number.isInteger(b.s) || !Number.isFinite(b.t) || b.s < 0 || b.s >= RUNNERS) return send(res, 400, {});
  if (!verify(b.id, b.s, b.t, b.k)) return send(res, 403, {});

  const rr = (Date.now() - b.t) / 1000 - RACE_START; // yarış saniyesi (sunucu saati)
  if (rr < -1 || rr > RACE_SECONDS + FINISH_TAIL + SETTLE) return send(res, 200, { ok: true, n: 0 });
  const entries = [];
  for (const e of b.p.slice(0, MAX_ENTRIES)) {
    const [k, c] = Array.isArray(e) ? e : [];
    if (!Number.isInteger(k) || !Number.isInteger(c) || c < 1 || k < 0 || k * BUCKET >= RACE_SECONDS) continue;
    if (k * BUCKET > rr + 1 || k * BUCKET < rr - BACKFILL) continue;
    entries.push([b.s, k, Math.min(c, MAX_PER_BUCKET)]);
  }
  if (entries.length) await store.addPresses(b.id, entries);
  send(res, 200, { ok: true, n: entries.length });
}
