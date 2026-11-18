import { store } from './_lib/store.js';
import { send } from './_lib/http.js';
import { currentRound, publicView } from './_lib/round.js';
import { RACE_START } from '../src/schedule.js';

// GET /api/state — şu anki tur: lobi listesi (hazır bayraklarıyla) ya da kilit (oyuncu adları + zaman çapası) ve yarış başladıysa tuş kayıtları.
// Herkese aynı yanıt: 1 sn CDN önbelleği, kaç izleyici olursa olsun saniyede en fazla ~1 fonksiyon çağrısı.
export default async function handler(req, res) {
  if (!store) return send(res, 503, { reason: 'no-store' });
  const now = Date.now();
  const r = await currentRound(now);
  const body = publicView(r);
  if (r.lock && now >= r.lock.at + RACE_START * 1000) body.presses = await store.presses(r.id);
  send(res, 200, body, 'public, s-maxage=1');
}
