import { Sim } from './sim.js';
import { laneOrder } from './rng.js';
import { makeRunners, cleanName } from './roster.js';
import {
  RACE_START, RACE_SECONDS, ROUND_AFTER, RUNNERS, MIN_PLAYERS, MIN_PRESS_GAP, COUNTDOWN, HEARTBEAT_MS,
} from './schedule.js';
import { scoreDelta, toRows, emptyTotal, FIELDS } from './scoring.js';

const TWO_PI = Math.PI * 2;
const FLUSH_MS = 600; // vuruş gönderim aralığı: başkalarının gördüğü gecikmeyi belirleyen zincirin ilk halkası
const RACE_POLL_MS = 800; // yarışta durum yoklama aralığı (sunucuda 1 sn CDN önbelleği var)
const DATA_LAG = 1.0; // sn: bir vuruş, basıldıktan sonra bu sürede sunucu kaydına girmiş sayılır (gönderim + yazma)

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* dolu/engelli */ } },
};
function randomId() {
  const a = new Uint8Array(12);
  (crypto?.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }));
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * İstemci tarafı oyun. Sunucu yalnızca (1) saat, (2) tur durumu (lobi listesi / kilit + tuş kayıtları), (3) katılım + "buradayım",
 * (4) hazır oyu, (5) tuş gönderimi ve (6) genel sıralama için çağrılır. Yarış burada, deterministik simülasyonla hesaplanır.
 * Kendi tuşlarımız anında uygulanır; başkalarının tuşları sunucudan gelince geçmişle birlikte yeniden oynatılır.
 * /api yoksa (Redis tanımsız) tek kişilik antrenman moduna düşer: botlarla yarışırsın, sıralama bu tarayıcıda tutulur.
 */
export function createGame() {
  const sim = new Sim(RUNNERS);
  let pid = store.get('bm.pid');
  if (!/^[a-z0-9]{8,32}$/.test(pid ?? '')) { pid = randomId(); store.set('bm.pid', pid); }
  let name = store.get('bm.name') ? cleanName(store.get('bm.name')) : '';

  let offset = 0; // sunucu saati - yerel saat (ms)
  let synced = false;
  let apiOff = false;
  let failures = 0;
  const nowServer = () => Date.now() + offset;

  async function syncTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/time', { cache: 'no-store' });
      const t1 = Date.now();
      if (res.ok) offset = (await res.json()).t + (t1 - t0) / 2 - t1;
      else if (res.status === 404) apiOff = true;
    } catch { /* yerel saat kullanılır */ }
    synced = true;
  }
  syncTime();
  setInterval(syncTime, 5 * 60 * 1000);

  // ---- Tur durumu: sunucudan (veya antrenman modunda yerel saatten)
  let rd = null; // { id, lock: {at, names, pubs, why} | null, players: [[ad, hazır, pub]], queued }
  const me = { id: 0, joined: false, closed: false, pub: '', slot: -1, key: '', ready: false };
  let pending = null; // sim henüz kurulmadan gelen tuş kayıtları
  let started = -1; // sim'in kurulduğu tur
  let freshAt = 0; // en son (önbelleksiz) POST yanıtının uygulandığı an: bundan önce başlayan GET yanıtları lobi listesini ezemez

  function applyState(j, reqStart = Infinity) {
    if (rd && j.id < rd.id) return; // önbellekten gelen eski yanıt
    if (j.me) me.pub = j.me;
    if (!rd || j.id !== rd.id) {
      rd = { id: j.id, lock: null, players: [], queued: 0 };
      Object.assign(me, { id: j.id, joined: false, closed: false, slot: -1, key: '', ready: false });
    }
    if (j.lock) rd.lock = rd.lock ?? j.lock; // kilit bir kez atılır, değişmez
    else if (!rd.lock && reqStart >= freshAt) { rd.players = j.players ?? []; rd.queued = j.queued ?? 0; }
    if (rd.lock && me.pub && me.slot < 0) me.slot = Math.max(-1, rd.lock.pubs.indexOf(me.pub));
    if (!rd.lock && me.pub) { const mine = rd.players.find((p) => p[2] === me.pub); if (mine && reqStart >= freshAt) me.ready = !!mine[1]; }
    if (j.slot != null) { me.slot = j.slot; me.key = j.key; if (started === rd.id) sim.setOwn(j.slot); }
    if (j.presses && rd.lock) {
      const upTo = (j.t - rd.lock.at) / 1000 - RACE_START - DATA_LAG; // verinin tamamlandığı yarış sn'si (sunucu saatiyle)
      if (started === rd.id) sim.setPresses(j.presses, upTo); else pending = [j.presses, upTo];
    }
  }

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'default' });
    if (res.status === 404 || res.status === 503) { apiOff = true; throw new Error('off'); }
    return res;
  }

  /** POST ve yanıtı (önbelleksiz, güncel) uygula. */
  async function post(path, body) {
    const res = await api(path, body);
    const j = await res.json();
    if (j.id != null) { applyState(j); freshAt = performance.now(); }
    return { res, j };
  }

  // Katıl / "buradayım": lobideyken HEARTBEAT_MS'de bir; kilit atıldıysa (listedeysek) vuruş belirtecini almak için bir kez
  let joining = false;
  async function join() {
    if (!name || !rd || joining || apiOff || document.hidden) return;
    const locked = !!rd.lock;
    if (locked && (!me.joined || me.key || me.closed)) return;
    const round = rd.id;
    const sending = name;
    joining = true;
    try {
      const { res, j } = await post('/api/join', { pid, name: sending });
      if (rd?.id !== round) return;
      if (res.ok) me.joined = true;
      else if (j.reason === 'closed') me.closed = true; // kilit atıldı, listede değiliz: sonraki turu bekle
    } catch { /* bir sonraki turda yeniden denenir */ }
    finally { joining = false; }
    if (sending !== name) join(); // gönderilirken ad değişti: yenisini hemen ilet
  }
  setInterval(join, HEARTBEAT_MS);

  let busy = false;
  let timer = 0;
  async function poll() {
    if (busy || document.hidden || apiOff || !synced) return;
    busy = true;
    const t0 = performance.now();
    try {
      const res = await api('/api/state');
      if (!res.ok) throw new Error(String(res.status));
      applyState(await res.json(), t0);
      failures = 0;
      join();
    } catch { failures++; }
    busy = false;
  }
  function delay() {
    if (failures >= 3) return 8000;
    if (!rd) return 1000;
    if (!rd.lock) return 2000;
    const rt = (nowServer() - rd.lock.at) / 1000;
    if (rt >= ROUND_AFTER - 4) return 1000; // tur bitiyor: yenisini hızlı yakala
    if (rt >= RACE_START - 1 && rt < RACE_START + RACE_SECONDS + 5) return RACE_POLL_MS; // yarış: başkalarının tuşları
    return 3000;
  }
  function schedule(ms = delay()) {
    clearTimeout(timer);
    timer = setTimeout(async () => { await poll(); schedule(); }, ms);
  }
  schedule(0);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { schedule(0); join(); flush(); } });

  // ---- "Oyunu başlat" oyu
  async function vote(on) {
    if (apiOff || !rd || rd.lock || !me.joined) return;
    me.ready = on; // iyimser: yanıt gelince sunucudaki değerle değişir
    try { await post('/api/vote', { pid, ready: on }); } catch { /* sonraki yoklama düzeltir */ }
  }

  // ---- Tuşlar
  const dirty = new Set();
  let lastPress = -1;
  async function flush() {
    if (!dirty.size || !me.key || apiOff || !rd?.lock || me.id !== rd.id) return;
    const round = rd.id, buckets = [...dirty].sort((a, b) => a - b).slice(-20);
    dirty.clear();
    try {
      const res = await api('/api/press', { id: round, s: me.slot, t: rd.lock.at, k: me.key, p: buckets.map((b) => [b, sim.ownCount(b)]) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      if (rd?.id === round) for (const b of buckets) dirty.add(b); // sonraki gönderimde yeniden dene (HSET: tekrar güvenli)
    }
  }
  setInterval(() => { if (!document.hidden) flush(); }, FLUSH_MS);

  // ---- Antrenman modu (API yok): kilit hemen atılır, tek gerçek oyuncu = sen; turlar art arda zincirlenir
  function localState(now) {
    if (!name) { rd ??= { id: 1, lock: null, players: [], queued: 0 }; return; }
    const mk = (id, at) => {
      rd = { id, lock: { at, names: [name], pubs: ['me'], why: 'practice' }, players: [], queued: 0 };
      Object.assign(me, { id, joined: true, closed: false, pub: 'me', slot: 0, key: '' });
      started = -1;
    };
    if (!rd?.lock) mk((rd?.id ?? 0) + 1, now);
    else if (now >= rd.lock.at + ROUND_AFTER * 1000) mk(rd.id + 1, rd.lock.at + ROUND_AFTER * 1000);
  }

  // ---- Anlık görüntü (aynı nesne yeniden kullanılır; GC'siz)
  const snap = {
    seq: 0, lanes: Array.from({ length: RUNNERS }, (_, i) => i), phase: 'lobby', n: RUNNERS, e: 0, d: RACE_SECONDS, w: 0, nx: null, f: null, age: 0,
    r: Array.from({ length: RUNNERS }, () => [0, 0, 0, 0, 0, 0]), res: null,
    runners: makeRunners(0, []), runnersKey: '', slot: -1,
    // Lobi paneli: stage = waiting (oyuncu bekleniyor) | voting (oylama) | starting (kilit atıldı, geri sayım) | queued | wait (sonraki tur açılıyor)
    lobby: { stage: 'waiting', me: '', players: [], count: 0, min: MIN_PLAYERS, ready: 0, myReady: false, joined: false, practice: false, why: '' },
  };
  let resCache = null;

  function setRunners(names) {
    const key = names.join('|');
    if (key === snap.runnersKey) return;
    snap.runnersKey = key;
    snap.runners = makeRunners(rd.id, names); // yeni dizi: arayüz referans değişimini fark eder
  }

  function startSim() {
    sim.reset(rd.id, snap.runners.map((x) => x.bot));
    sim.setOwn(me.id === rd.id ? me.slot : -1);
    if (pending) { sim.setPresses(...pending); pending = null; }
    started = rd.id;
    resCache = null;
    lastPress = -1; // tur başına sıfırla: önceki turun yarış saniyesi yeni turda vuruşları engellemesin
    dirty.clear();
    laneOrder(rd.id, RUNNERS, snap.lanes);
  }

  const zeroRows = () => { for (let i = 0; i < RUNNERS; i++) { const row = snap.r[i]; row[0] = row[1] = row[2] = row[3] = row[4] = 0; row[5] = i + 1; } };

  return {
    get name() { return name; },
    get pid() { return pid; },
    /** Ad ilk kez girilirken ya da lobide değiştirilirken; kilitten önce sunucudaki ad da güncellenir. */
    setName(n) {
      const next = cleanName(n);
      if (next === name) return;
      name = next; store.set('bm.name', name);
      if (apiOff) { rd = null; started = -1; } // antrenman modu: tur yeni adla yeniden kurulur
      else { schedule(0); join(); }
    },
    vote,

    /** Boşluk tuşu / dokunma. true: vuruş sayıldı. */
    press() {
      if (!rd?.lock || snap.phase !== 'racing' || me.slot < 0 || started !== rd.id) return false;
      const rt = (nowServer() - rd.lock.at) / 1000 - RACE_START;
      if (rt - lastPress < MIN_PRESS_GAP) return false;
      lastPress = rt;
      const b = sim.ownPress(rt);
      if (b < 0) return false;
      dirty.add(b);
      return true;
    },

    /** Her karede çağrılır; veri yoksa null. */
    snapshot() {
      if (!synced) return null;
      const now = nowServer();
      if (apiOff) localState(now);
      if (!rd) return null;

      const L = snap.lobby;
      const mine = me.id === rd.id;
      snap.seq = rd.id;
      snap.slot = mine ? me.slot : -1;
      snap.res = null;
      L.practice = apiOff; L.joined = mine && me.joined; L.myReady = mine && me.ready;
      L.why = rd.lock?.why ?? '';
      L.me = mine ? me.pub : '';

      if (!rd.lock) {
        // Bekleme / oylama: koşucular başlangıçta, adlar katıldıkça belirir
        const pl = rd.players;
        setRunners(pl.map((p) => p[0]));
        L.players = pl; L.count = pl.length; L.ready = pl.reduce((n, p) => n + (p[1] ? 1 : 0), 0);
        const inList = mine && me.pub && pl.some((p) => p[2] === me.pub);
        L.stage = L.joined && me.pub && !inList && pl.length >= RUNNERS ? 'queued' : pl.length < MIN_PLAYERS ? 'waiting' : 'voting';
        snap.phase = 'lobby'; snap.nx = null; snap.e = 0; snap.w = 0; snap.f = null; snap.age = 0;
        zeroRows();
        return snap;
      }

      const rt = (now - rd.lock.at) / 1000;
      if (started !== rd.id) { setRunners(rd.lock.names); startSim(); }
      L.players = rd.lock.names.map((n, i) => [n, 1, rd.lock.pubs[i]]); L.count = L.players.length; L.ready = L.count;
      if (rt >= ROUND_AFTER) { // tur bitti, sonraki turun bilgisi bekleniyor
        L.stage = 'wait'; snap.phase = 'lobby'; snap.nx = null; zeroRows();
        return snap;
      }
      const rtr = rt - RACE_START;
      sim.advanceTo(rtr);
      const race = sim.race;
      const done = sim.done;

      L.stage = 'starting';
      snap.phase = rtr < -COUNTDOWN ? 'lobby' : rtr < 0 ? 'countdown' : done ? 'waiting' : race.mode === 'racing' ? 'racing' : 'finishing';
      snap.e = Math.min(RACE_SECONDS, Math.max(0, rtr));
      snap.w = Math.max(0, -rtr);
      snap.nx = rtr < 0 ? -rtr : done ? Math.max(0, ROUND_AFTER - rt) : null;
      snap.f = race.finishDist;
      snap.age = done || rtr < 0 ? 0 : Math.min(0.3, Math.max(0, rtr - sim.time));
      if (done) snap.res = resCache ??= sim.results();

      for (let i = 0; i < RUNNERS; i++) {
        const x = race.racers[i], row = snap.r[i];
        row[0] = x.dist; row[1] = x.v; row[2] = x.phase % TWO_PI; row[3] = x.power; row[4] = x.taps; row[5] = x.rank;
      }
      return snap;
    },

    /** Genel sıralama (+ round verilmişse o turun sunucu sonucu). Sunucu yoksa yerelde tutulur. */
    async standings(round) {
      if (!apiOff) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const res = await api(`/api/standings${round != null ? `?c=${round}` : ''}`);
            if (res.ok) {
              const j = await res.json();
              if (round == null || j.race || attempt === 4) return j;
            }
          } catch { if (apiOff) break; }
          await new Promise((r) => setTimeout(r, 2000)); // sonuç sunucuda henüz hesaplanmadı: son tuşlar bekleniyor
        }
      }
      return localStandings(round, sim, snap, name);
    },
  };
}

// ---- Yerel yedek (antrenman modu): yalnızca bu tarayıcıda oynanan yarışlar
function localStandings(round, sim, snap, name) {
  let st = { races: 0, last: 0, t: emptyTotal(name || 'You') };
  try { st = JSON.parse(localStorage.getItem('bm.standings')) ?? st; } catch { /* boş başla */ }
  const res = round != null && sim.round === round ? sim.results() : null;
  if (res && round > st.last && snap.slot >= 0) {
    const rows = res.map(([slot, dist]) => ({ pid: slot === snap.slot ? 'me' : null, name: name || 'You', dist }));
    for (const d of scoreDelta(rows)) for (const f of FIELDS) st.t[f] += d[f];
    st.t.name = name || st.t.name;
    st.races++;
    st.last = round;
    try { localStorage.setItem('bm.standings', JSON.stringify(st)); } catch { /* dolu */ }
  }
  const race = res ? res.map(([slot, dist]) => [snap.runners[slot].name, Math.round(dist), snap.runners[slot].bot ? 1 : 0]) : undefined;
  return { races: st.races, rows: st.races ? toRows({ me: st.t }) : [], race };
}
