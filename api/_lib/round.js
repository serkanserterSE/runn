import { createHmac, timingSafeEqual } from 'node:crypto';
import { store, SIGN_KEY } from './store.js';
import { makeRunners } from '../../src/roster.js';
import { simulateRound } from '../../src/sim.js';
import { RUNNERS, MIN_PLAYERS, PRESENCE_MS, RACE_END, ROUND_AFTER, SETTLE } from '../../src/schedule.js';

const hmac = (s) => createHmac('sha256', SIGN_KEY).update(s).digest('hex');
/** Oyuncunun herkese açık kısa kimliği (pid gizli kalır; istemci "bu benim" satırını bununla tanır). */
export const pubId = (pid) => hmac(`pub.${pid}`).slice(0, 8);
// Vuruş belirteci: durumsuz HMAC. (tur, slot, kilit anı) imzalıdır; vuruş isteğinde depo okumadan doğrulanır.
export const sign = (id, slot, at) => hmac(`${id}.${slot}.${at}`).slice(0, 32);
export function verify(id, slot, at, key) {
  if (typeof key !== 'string' || key.length !== 32) return false;
  const a = Buffer.from(sign(id, slot, at));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ham lobi verisi → lobide bulunan (son PRESENCE_MS içinde görülen) oyuncular, katılım sırasıyla. İlk RUNNERS kişi oynar, fazlası sırada bekler. */
export function presentPlayers(raw, now) {
  const seen = new Map(raw.s);
  const ready = new Set(raw.v.map(([pid]) => pid));
  const list = [];
  for (const [pid, val] of raw.p) {
    if (now - Number(seen.get(pid) ?? 0) > PRESENCE_MS) continue;
    const i = val.indexOf('|');
    list.push({ pid, join: Number(val.slice(0, i)), name: val.slice(i + 1), ready: ready.has(pid) });
  }
  list.sort((a, b) => a.join - b.join || (a.pid < b.pid ? -1 : 1));
  return { players: list.slice(0, RUNNERS), queued: Math.max(0, list.length - RUNNERS), all: list };
}

/**
 * Şu anki turun durumu. Süresi dolmuş turu kapatıp yenisini açar; kilit koşulu sağlanmışsa listeyi kilitler
 * (SET NX: aynı anda gelen isteklerden yalnızca biri kilidi yazar, ayrı bir zamanlayıcı gerekmez).
 * Kilit koşulu: en az MIN_PLAYERS oyuncu ve (hepsi hazır ya da RUNNERS kadar oyuncu).
 */
export async function currentRound(now = Date.now()) {
  let id = await store.current();
  if (!id) id = await store.open(1, now);
  let raw = await store.lobby(id);
  if (raw.lock && now >= raw.lock.at + ROUND_AFTER * 1000) {
    id = await store.open(id + 1, now);
    raw = await store.lobby(id);
  }
  if (raw.lock) return { id, lock: raw.lock, players: [], queued: 0 };

  const { players, queued } = presentPlayers(raw, now);
  const full = players.length >= RUNNERS;
  if (players.length >= MIN_PLAYERS && (full || players.every((p) => p.ready))) {
    const lock = await store.lock(id, { at: now, names: players.map((p) => p.name), pids: players.map((p) => p.pid), why: full ? 'full' : 'ready' });
    return { id, lock, players: [], queued: 0 };
  }
  return { id, lock: null, players, queued };
}

/** İstemciye giden görünüm (pid yok): kilitliyse oyuncu adları ve kilit anı, değilse lobi listesi. */
export function publicView(r) {
  if (r.lock) return { id: r.id, lock: { at: r.lock.at, names: r.lock.names, pubs: r.lock.pids.map(pubId), why: r.lock.why } };
  return { id: r.id, players: r.players.map((p) => [p.name, p.ready ? 1 : 0, pubId(p.pid)]), queued: r.queued };
}

/** Yarışın sonucunu (yoksa tuş kayıtlarından yeniden hesaplayıp) kaydeder. null: henüz hazır değil / yarış yapılmadı. */
export async function finishedResult(id, now = Date.now()) {
  const saved = await store.result(id);
  if (saved) return saved;
  const lock = await store.getLock(id);
  if (!lock || now < lock.at + (RACE_END + SETTLE) * 1000) return null;
  const runners = makeRunners(id, lock.names);
  const results = simulateRound(id, runners.map((x) => x.bot), await store.presses(id));
  const rows = results.map(([slot, dist]) => ({ pid: lock.pids[slot] ?? null, name: runners[slot].name, bot: runners[slot].bot, dist }));
  await store.recordResult(id, rows);
  return rows;
}
