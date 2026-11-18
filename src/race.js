import { mulberry32 } from './rng.js';

// Saf yarış mantığı (three.js'ten bağımsız). Tamamen deterministik: aynı tohum + aynı tuş listesi
// her yerde (tarayıcı, sunucu) aynı sonucu verir; update() sabit STEP ile çağrılmalıdır.
export const STEP = 0.05;
export const STRIDE = 2.1; // rad / birim mesafe

// Hız modeli: herkesin yavaş, sabit bir taban hızı var. Her tuş vuruşu "güç" düzeyini (0..1) yükseltir, güç zamanla söner.
//   hız = BASE × (1 + GAIN × güç)  → üst sınır BASE × (1 + GAIN): güç 1'de kilitlenir, daha fazla basmak ek hız vermez.
export const BASE_SPEED = 5;
export const GAIN = 1;
export const PRESS_GAIN = 0.1; // bir vuruşun güce eklediği miktar (üst sınır 1)
export const POWER_DECAY = 0.8; // güç sönümü (1/sn): tek vuruşun etkisi 1-2 sn sürer; ~8 vuruş/sn güçte tam gücü korur

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Race {
  constructor() {
    this.racers = [];
    this.mode = 'idle'; // idle | racing | finishing | done
    this.elapsed = 0;
    this.duration = 0;
    this.results = [];
    this.finishDist = null; // bitiş kapısının mesafesi (süreye göre tahmin)
    this._finishFrozen = false;
    this._finishTimer = 0;
  }

  /** Koşucuları başlangıç çizgisine dizer; yarış go() ile başlar. bots[i] true ise o koşucuyu sahte tuşlarla bot sürer (tohumdan, deterministik). */
  prepare(count, seconds, seed, bots = []) {
    this.racers = Array.from({ length: count }, (_, i) => {
      const rnd = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0); // koşucuya özel akış: sıra bağımsız
      const bot = !!bots[i];
      return {
        id: i,
        bot,
        rnd,
        dist: 0,
        v: 0,
        base: BASE_SPEED * (bot ? 0.97 + rnd() * 0.06 : 1), // insanlar eşit; botlar çok az farklı
        power: 0, // 0..1: tuşlarla yükselir, zamanla söner
        taps: 0, // bu yarışta sayılan vuruş
        tapGap: 1 / (2.5 + rnd() * 2.5), // botun ortalama vuruş aralığı (2,5–5 vuruş/sn: hızlı basan oyuncu botları geçer)
        nextTap: 0.3 + rnd() * 0.6,
        phase: rnd() * Math.PI * 2,
        rank: i + 1,
      };
    });
    this.elapsed = 0;
    this.duration = seconds;
    this.results = [];
    this.finishDist = null;
    this._finishFrozen = false;
    this.mode = 'idle';
  }

  go() {
    if (this.mode === 'idle' && this.racers.length) this.mode = 'racing';
  }

  /** Bir tuş vuruşu: güç, üst sınıra doğru artar. */
  press(i, n = 1) {
    const r = this.racers[i];
    if (this.mode !== 'racing' || !r) return;
    r.power = Math.min(1, r.power + PRESS_GAIN * n);
    r.taps += n;
  }

  update(dt) {
    if (this.mode === 'idle' || this.mode === 'done') return;
    const rs = this.racers;
    const racing = this.mode === 'racing';

    if (racing) {
      this.elapsed += dt;
      if (this.elapsed >= this.duration) {
        this.elapsed = this.duration;
        const order = this._sorted();
        order.forEach((r, i) => { r.rank = i + 1; }); // final sıralama kesinleşir (kutlama bu sıraya göre)
        this.results = order.map((r) => ({ id: r.id, dist: r.dist }));
        this.mode = 'finishing';
        this._finishTimer = 1.2;
      }
    } else {
      this._finishTimer -= dt;
      if (this._finishTimer <= 0) {
        this.mode = 'done';
        for (const r of rs) { r.v = 0; r.power = 0; }
        return;
      }
    }

    let mean = 0, lead = 0;
    for (const r of rs) { mean += r.dist; if (r.dist > lead) lead = r.dist; }
    mean /= rs.length;

    // Bitiş kapısı: kalan süre 20 sn'nin altına inince, lider süre bittiğinde nerede olacaksa oraya konur
    // (birinci tam süre dolarken kapıdan geçer); son 4 sn'de sabitlenir.
    const remaining = this.duration - this.elapsed;
    if (racing && !this._finishFrozen && remaining <= 20 && this.elapsed > 1) {
      const est = lead + (lead / this.elapsed) * remaining;
      this.finishDist = this.finishDist == null ? est : this.finishDist + (est - this.finishDist) * (1 - Math.exp(-2 * dt));
      if (remaining <= 4) this._finishFrozen = true;
    }

    const decay = Math.exp(-POWER_DECAY * dt);
    const slow = Math.exp(-4 * dt);
    for (const r of rs) {
      let v;
      if (racing) {
        if (r.bot) {
          r.nextTap -= dt;
          while (r.nextTap <= 0) { this.press(r.id); r.nextTap += r.tapGap * (0.65 + r.rnd() * 0.7); }
        }
        r.power *= decay;

        // Lastik bandı yalnızca aşırı uçlarda: çaba sonucu belirler, ama kamera yine de grubu kadrajda tutabilsin
        const gap = r.dist - mean;
        let k = 1;
        if (gap > 60) k = 1 - clamp((gap - 60) * 0.02, 0, 0.4);
        else if (gap < -45) k = 1 + clamp((-45 - gap) * 0.02, 0, 0.3);

        v = r.base * (1 + GAIN * r.power) * k;
      } else {
        r.power *= slow;
        v = r.v * slow;
      }
      r.v = v;
      r.dist += v * dt;
      r.phase += v * STRIDE * dt;
    }

    if (racing) {
      const order = this._sorted();
      for (let i = 0; i < order.length; i++) order[i].rank = i + 1;
    }
  }

  _sorted() {
    return [...this.racers].sort((a, b) => b.dist - a.dist || a.id - b.id);
  }
}
