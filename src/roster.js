import { RUNNERS } from './schedule.js';
import { mulberry32, seedFor } from './rng.js';

// Oyuncu listesi (sunucu + istemci ortak). Sunucuda öğeler "pid|ad" dizgesidir; istemciye pid gönderilmez.
export const NAME_MAX = 14;
export const PID_RE = /^[a-z0-9]{8,32}$/;

/** Kullanıcı girdisini güvenli, kısa bir görünen ada çevirir. */
export function cleanName(raw) {
  const s = String(raw ?? '').normalize('NFKC').replace(/[\p{C}|<>&"']/gu, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('').trim() || 'Player';
}

const BOTS = ['Turbo', 'Dash', 'Blaze', 'Zippy', 'Comet', 'Rocket', 'Flash', 'Sprint', 'Bolt', 'Gust', 'Nitro', 'Jet', 'Zoom', 'Swift', 'Dino', 'Pixel'];

/** names: gerçek oyuncu adları (katılım sırasıyla = slot) → RUNNERS koşucu: [{name, bot}]. Bot adları tura ve slota göre sabit (biri katılınca diğer botların adı değişmez). */
export function makeRunners(round, names) {
  const rnd = mulberry32(seedFor(round) ^ 0x5bd1e995);
  const pool = [...BOTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: RUNNERS }, (_, i) => (i < names.length ? { name: names[i], bot: false } : { name: `🤖 ${pool[i]}`, bot: true }));
}
