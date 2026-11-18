import { Race, STEP } from './race.js';
import { seedFor } from './rng.js';
import { RACE_SECONDS, RUNNERS, BUCKET } from './schedule.js';

/**
 * Bir turun yarışını sabit adımlarla ilerleten deterministik simülasyon.
 * Girdi: oyuncuların tuş vuruşları [slot, kova, adet] (kova = yarış saniyesi / BUCKET); botlar tohumdan kendi başına "basar".
 * Bir vuruş kovası, at = kova × BUCKET <= adım zamanı olan ilk adımda uygulanır.
 * Geç gelen veri (zamanı geçmiş bir kova) olursa simülasyon baştan, tam veriyle yeniden oynatılır: ucuz (≤ ~1000 adım) ve
 * böylece sunucunun sonradan hesapladığı sonuçla aynı yola yakınsar.
 */
export class Sim {
  constructor(count = RUNNERS) {
    this.count = count;
    this.race = new Race();
    this.round = -1;
    this.bots = [];
    this.steps = 0;
    this.entries = new Map(); // "slot:kova" → { s, b, c, at }
    this.list = []; // at'e göre sıralı; cursor'dan öncekiler uygulandı
    this.cursor = 0;
    this.dirty = false; // geçmişi etkileyen yeni veri: yeniden oynat
    this.unsorted = false;
    this.own = -1; // bu istemcinin slotu (-1: izleyici)
  }

  reset(round, bots) {
    this.round = round;
    this.bots = bots;
    this.entries.clear();
    this.list.length = 0;
    this.own = -1;
    this.dirty = false;
    this.unsorted = false;
    this._restart();
  }

  _restart() {
    this.race.prepare(this.count, RACE_SECONDS, seedFor(this.round), this.bots);
    this.race.go();
    this.steps = 0;
    this.cursor = 0;
    this.list = [...this.entries.values()]; // yerel (anında uygulanmış) vuruşlar dahil tüm kayıtlar baştan oynatılır
    for (const e of this.list) e.listed = true;
    this.list.sort((a, b) => a.at - b.at || a.s - b.s);
    this.unsorted = false;
    this.dirty = false;
  }

  /** Kaydı ekler/günceller (daha büyük değer kazanır); geçmişi değiştirdiyse true. */
  _put(s, b, c) {
    const key = `${s}:${b}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { s, b, c, at: b * BUCKET, listed: true };
      this.entries.set(key, e);
      this.list.push(e);
    } else if (c > e.c) e.c = c;
    else return false;
    if (e.at < this.time) return true;
    this.unsorted = true;
    return false;
  }

  /** Sunucudaki vuruş listesinin tamamı (veya yeni kısmı): [[slot, kova, adet], ...] */
  setPresses(list) {
    for (const [s, b, c] of list) {
      if (this._put(s, b, c)) this.dirty = true;
    }
    if (this.unsorted) { this.list.sort((a, b) => a.at - b.at || a.s - b.s); this.unsorted = false; }
  }

  /** Bu istemcinin oyuncusu: slot (-1 = izleyici). */
  setOwn(slot) { this.own = slot; }

  /** Yerel vuruş: anında uygulanır (gecikmesiz his). Kayıt listeye girmez (zaten uygulandı); baştan oynatmada dahil edilir. Kovayı döndürür. */
  ownPress(rt) {
    if (this.own < 0 || this.race.mode !== 'racing') return -1;
    const b = Math.floor(Math.max(0, rt) / BUCKET);
    const key = `${this.own}:${b}`;
    let e = this.entries.get(key);
    if (!e) { e = { s: this.own, b, c: 0, at: b * BUCKET, listed: false }; this.entries.set(key, e); }
    e.c++;
    this.race.press(this.own);
    return b;
  }

  /** Bu istemcinin bir kovadaki yerel vuruş sayısı. */
  ownCount(b) { return this.entries.get(`${this.own}:${b}`)?.c ?? 0; }

  get time() { return this.steps * STEP; }
  get done() { return this.race.mode === 'done'; }

  /** Yarış saniyesi rt'ye kadar ilerlet (rt < 0: başlamadı). */
  advanceTo(rt) {
    if (rt < 0) return;
    if (this.dirty) this._restart();
    const target = Math.floor(rt / STEP + 1e-9);
    while (this.steps < target && this.race.mode !== 'done') this._step();
  }

  _step() {
    const t = this.steps * STEP + 1e-9;
    const l = this.list;
    while (this.cursor < l.length && l[this.cursor].at <= t) { const e = l[this.cursor++]; this.race.press(e.s, e.c); }
    this.race.update(STEP);
    this.steps++;
  }

  /** Sonuç satırları [[slot, mesafe]] (birinciden sonuncuya); bitmediyse null. */
  results() {
    return this.done ? this.race.results.map((r) => [r.id, Math.round(r.dist * 10) / 10]) : null;
  }
}

/** Bir turu baştan sona (sunucu tarafı) hesaplar. */
export function simulateRound(round, bots, presses, count = RUNNERS) {
  const sim = new Sim(count);
  sim.reset(round, bots);
  sim.setPresses(presses);
  while (!sim.done) sim._step();
  return sim.results();
}
