import { store } from './_lib/store.js';
import { send, readJson } from './_lib/http.js';
import { currentRound, publicView, pubId } from './_lib/round.js';
import { PID_RE } from '../src/roster.js';

// POST /api/vote { pid, ready } — "oyunu başlat" oyu. Herkes hazırsa (en az MIN_PLAYERS oyuncuyla) liste kilitlenir ve geri sayım başlar.
// Yanıt güncel görünümdür (önbelleksiz).
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, {});
  if (!store) return send(res, 503, { reason: 'no-store' });
  const b = await readJson(req);
  if (!b || !PID_RE.test(String(b.pid)) || typeof b.ready !== 'boolean') return send(res, 400, {});
  const now = Date.now();
  let r = await currentRound(now);
  if (r.lock) return send(res, 409, { ...publicView(r), me: pubId(String(b.pid)), reason: 'locked' });
  if (!r.players.some((p) => p.pid === b.pid)) return send(res, 409, { ...publicView(r), me: pubId(String(b.pid)), reason: 'not-joined' });
  await store.vote(r.id, b.pid, b.ready, now);
  r = await currentRound(now);
  send(res, 200, { ...publicView(r), me: pubId(String(b.pid)) });
}
