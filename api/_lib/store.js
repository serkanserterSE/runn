// Kalıcı veri: Upstash/Vercel KV (Redis REST). Yerelde, Redis yoksa bellek içi yedek (yalnızca geliştirme için).
//
// Anahtarlar (hepsi küçük; tur verileri TTL ile kendiliğinden silinir):
//   cur            → şu anki tur numarası
//   round:<id>     → turun açılış zamanı (ms)
//   p:<id>         → hash: pid → katılım zamanı (ms, değişmez)   n:<id> → hash: pid → ad (kilitten önce değiştirilebilir)
//   s:<id>         → hash: pid → son görülme (ms)                v:<id> → hash: pid → 1 (hazır)
//   lock:<id>      → kilit kaydı (JSON): { at, names, pids, why } — yarışın oyuncu listesi ve zaman çapası
//   presses:<id>   → hash: "slot:kova" → vuruş sayısı
//   res:<id>       → kaydedilmiş yarış sonucu (JSON)
//   totals/names/races → genel sıralama
import { scoreDelta, toRows, emptyTotal, FIELDS } from '../../src/scoring.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24; // tur verileri 1 gün sonra silinir

async function redis(commands) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).map((x) => x.result);
}

const pairs = (flat) => {
  const out = [];
  for (let i = 0; i < (flat?.length ?? 0); i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
const parsePresses = (flat) => pairs(flat).map(([k, c]) => { const [s, b] = k.split(':'); return [Number(s), Number(b), Number(c)]; });
const buildTotals = (totalsFlat, namesFlat) => {
  const names = Object.fromEntries(pairs(namesFlat));
  const totals = {};
  for (const [k, v] of pairs(totalsFlat)) {
    const [pid, f] = k.split(':');
    (totals[pid] ??= emptyTotal(names[pid] ?? 'Player'))[f] = Number(v);
  }
  return totals;
};

const redisStore = {
  kind: 'redis',
  /** Şu anki tur numarası | null */
  async current() {
    const [id] = await redis([['GET', 'cur']]);
    return id ? Number(id) : null;
  },
  /** Yeni tur aç (aynı anda birden çok istek gelirse ilki kazanır; sonuç aynı numaradır). */
  async open(id, now) {
    await redis([['SET', `round:${id}`, now, 'NX', 'EX', TTL], ['SET', 'cur', id]]);
    return id;
  },
  /** Lobi ham verisi: { lock | null, p: [[pid, katılımMs]], n: [[pid, ad]], s: [[pid, ms]], v: [[pid, 1]] } (tek çağrı, 5 komut) */
  async lobby(id) {
    const [lock, p, n, s, v] = await redis([['GET', `lock:${id}`], ['HGETALL', `p:${id}`], ['HGETALL', `n:${id}`], ['HGETALL', `s:${id}`], ['HGETALL', `v:${id}`]]);
    return { lock: lock ? JSON.parse(lock) : null, p: pairs(p), n: pairs(n), s: pairs(s), v: pairs(v) };
  },
  async getLock(id) {
    const [lock] = await redis([['GET', `lock:${id}`]]);
    return lock ? JSON.parse(lock) : null;
  },
  /** Katıl / "buradayım": katılım zamanı değişmez (HSETNX, sıra korunur); ad ve son görülme güncellenir (ad değişikliği buradan geçer). */
  async touch(id, pid, name, now) {
    await redis([['HSETNX', `p:${id}`, pid, now], ['HSET', `n:${id}`, pid, name], ['HSET', `s:${id}`, pid, now],
      ['EXPIRE', `p:${id}`, TTL], ['EXPIRE', `n:${id}`, TTL], ['EXPIRE', `s:${id}`, TTL]]);
  },
  async vote(id, pid, ready, now) {
    await redis([['HSET', `s:${id}`, pid, now], ready ? ['HSET', `v:${id}`, pid, 1] : ['HDEL', `v:${id}`, pid], ['EXPIRE', `v:${id}`, TTL]]);
  },
  /** Listeyi kilitle (ilk yazan kazanır); geçerli kilit kaydını döndürür. */
  async lock(id, rec) {
    const res = await redis([['SET', `lock:${id}`, JSON.stringify(rec), 'NX', 'EX', TTL], ['GET', `lock:${id}`]]);
    return JSON.parse(res[1]);
  },
  async presses(id) {
    const [flat] = await redis([['HGETALL', `presses:${id}`]]);
    return parsePresses(flat);
  },
  /** entries: [[slot, kova, adet]] — HSET (üzerine yazar): tekrar gönderim güvenlidir. */
  async addPresses(id, entries) {
    const key = `presses:${id}`;
    await redis([['HSET', key, ...entries.flatMap(([s, b, c]) => [`${s}:${b}`, c])], ['EXPIRE', key, TTL]]);
  },
  async result(id) {
    const [raw] = await redis([['GET', `res:${id}`]]);
    return raw ? JSON.parse(raw) : null;
  },
  /** rows: [{pid, name, dist, bot}] birinciden sonuncuya. İlk kayıtta true (toplamlar güncellenir), tekrarında false. */
  async recordResult(id, rows) {
    const [added] = await redis([['SET', `res:${id}`, JSON.stringify(rows), 'NX', 'EX', TTL]]);
    if (added !== 'OK') return false;
    const cmds = [['INCR', 'races']];
    for (const d of scoreDelta(rows)) {
      cmds.push(['HSET', 'names', d.pid, d.name]);
      for (const f of FIELDS) cmds.push(['HINCRBY', 'totals', `${d.pid}:${f}`, d[f]]);
    }
    await redis(cmds);
    return true;
  },
  async standings() {
    const [totals, names, races] = await redis([['HGETALL', 'totals'], ['HGETALL', 'names'], ['GET', 'races']]);
    return { races: Number(races) || 0, rows: toRows(buildTotals(totals, names)) };
  },
};

const mem = { cur: 0, rounds: new Map(), presses: new Map(), results: new Map(), totals: {}, races: 0 };
const memRound = (id) => mem.rounds.get(id);
const memoryStore = {
  kind: 'memory',
  async current() { return mem.cur || null; },
  async open(id, now) {
    if (!mem.rounds.has(id)) mem.rounds.set(id, { at: now, p: new Map(), n: new Map(), s: new Map(), v: new Map(), lock: null });
    mem.cur = id;
    for (const m of [mem.rounds, mem.presses, mem.results]) m.delete(id - 20); // eski turlar bellekte birikmesin
    return id;
  },
  async lobby(id) {
    const r = memRound(id);
    return { lock: r?.lock ?? null, p: [...(r?.p ?? [])], n: [...(r?.n ?? [])], s: [...(r?.s ?? [])], v: [...(r?.v ?? [])] };
  },
  async getLock(id) { return memRound(id)?.lock ?? null; },
  async touch(id, pid, name, now) {
    const r = memRound(id);
    if (!r) return;
    if (!r.p.has(pid)) r.p.set(pid, now);
    r.n.set(pid, name);
    r.s.set(pid, now);
  },
  async vote(id, pid, ready, now) {
    const r = memRound(id);
    if (!r) return;
    r.s.set(pid, now);
    if (ready) r.v.set(pid, 1); else r.v.delete(pid);
  },
  async lock(id, rec) {
    const r = memRound(id);
    r.lock ??= rec;
    return r.lock;
  },
  async presses(id) { return [...(mem.presses.get(id) ?? [])].map(([k, c]) => { const [s, b] = k.split(':'); return [Number(s), Number(b), c]; }); },
  async addPresses(id, entries) {
    const m = mem.presses.get(id) ?? mem.presses.set(id, new Map()).get(id);
    for (const [s, b, c] of entries) m.set(`${s}:${b}`, c);
  },
  async result(id) { return mem.results.get(id) ?? null; },
  async recordResult(id, rows) {
    if (mem.results.has(id)) return false;
    mem.results.set(id, rows);
    mem.races++;
    for (const d of scoreDelta(rows)) {
      const t = (mem.totals[d.pid] ??= emptyTotal(d.name));
      t.name = d.name;
      for (const f of FIELDS) t[f] += d[f];
    }
    return true;
  },
  async standings() { return { races: mem.races, rows: toRows(mem.totals) }; },
};

// Vercel'de bellek yedeği güvenilmezdir (her çağrı farklı örnekte çalışabilir): Redis yoksa depo yok sayılır
// ve istemci tek kişilik antrenman moduna düşer.
export const store = URL_ && TOKEN ? redisStore : process.env.VERCEL ? null : memoryStore;
export const SIGN_KEY = process.env.SIGNING_SECRET || TOKEN || 'dev-only-signing-key';
