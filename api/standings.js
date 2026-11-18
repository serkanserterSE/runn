import { store } from './_lib/store.js';
import { send, query } from './_lib/http.js';
import { finishedResult } from './_lib/round.js';

// GET /api/standings[?c=<tur>] — genel sıralama; c verilirse o turun yarış sonucu da (varsa; ilk istekte sunucu hesaplayıp kaydeder).
// İstemci sonuç bildirmez: sonuç tuş kayıtlarından sunucuda üretilir, sahte sonuç yazılamaz.
export default async function handler(req, res) {
  if (!store) return send(res, 503, { races: 0, rows: [], reason: 'no-store' });
  const raw = query(req).get('c');
  const out = {};
  let cache = 'public, s-maxage=10, stale-while-revalidate=20';
  if (raw != null) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) return send(res, 400, {});
    const rows = await finishedResult(id);
    if (rows) out.race = rows.map((r) => [r.name, Math.round(r.dist), r.bot ? 1 : 0]);
    else cache = 'no-store'; // henüz hazır değil (son tuşlar bekleniyor) ya da yarış yapılmadı
  }
  send(res, 200, { ...(await store.standings()), ...out }, cache);
}
