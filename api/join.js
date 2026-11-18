import { store } from './_lib/store.js';
import { send, readJson } from './_lib/http.js';
import { currentRound, publicView, pubId, sign } from './_lib/round.js';
import { cleanName, PID_RE } from '../src/roster.js';

// POST /api/join { pid, name } — lobiye katıl ve "buradayım" de (istemci lobideyken HEARTBEAT_MS'de bir tekrarlar; ad değişince de çağrılır).
// Liste kilitlendiyse: oyuncu listedeyse { slot, key } (vuruş belirteci) döner, değilse 409 (sonraki turu bekler).
// Yanıt her zaman güncel görünümdür (önbelleksiz) + me: oyuncunun herkese açık kimliği.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, {});
  if (!store) return send(res, 503, { reason: 'no-store' });
  const b = await readJson(req);
  if (!b || !PID_RE.test(String(b.pid))) return send(res, 400, {});
  const pid = String(b.pid);
  const now = Date.now();
  let r = await currentRound(now);
  if (!r.lock) {
    await store.touch(r.id, pid, cleanName(b.name), now); // kilitten önce ad da güncellenir (ad değiştirme)
    r = await currentRound(now); // bu katılım kilidi atmış olabilir (8. oyuncu)
  }
  const out = { ...publicView(r), me: pubId(pid) };
  if (r.lock) {
    const slot = r.lock.pids.indexOf(pid);
    if (slot < 0) return send(res, 409, { ...out, reason: 'closed' });
    Object.assign(out, { slot, key: sign(r.id, slot, r.lock.at) });
  }
  send(res, 200, out);
}
