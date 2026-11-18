import './style.css';
import * as THREE from 'three';
import { createWorld, GANTRY_H } from './world.js';
import { createRunner, setRunnerTime } from './runner.js';
import { createCelebration } from './celebration.js';
import { STRIDE } from './race.js';
import { path, lane, Rc } from './track.js';
import { createUI } from './ui.js';
import { createGame } from './game.js';
import { MAX_RUNNERS, RUNNER_DEFS, LANE_W } from './config.js';

const FOV = 45;
const LOOK_AHEAD = 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 320);
const world = createWorld(scene, renderer);
const celebration = createCelebration({ scene, finish: world.finish, gx: world.gantryHalfWidth, gantryH: GANTRY_H });

const views = RUNNER_DEFS.slice(0, MAX_RUNNERS).map((d, i) => {
  const v = createRunner(d, i + 1);
  v.root.visible = false;
  scene.add(v.root);
  return v;
});

// Sunucudan gelen durumdan türetilen, her karede güncellenen koşucu durumu (GC'siz).
const live = Array.from({ length: MAX_RUNNERS }, (_, id) => ({
  id, dist: 0, v: 0, phase: 0, boostLevel: 0, taps: 0, rank: id + 1,
}));

const cam = { dist: 0, back: 14, base: 14 };
let snap = null;
let count = 0;
let lastSeq = -1;
let snapCamera = true;

const game = createGame();

/** Yeni yarış / koşucu sayısı değişimi gibi durum geçişleri (her karede ucuz karşılaştırma). */
function onSnapshot(s) {
  if (s.seq !== lastSeq) { lastSeq = s.seq; snapCamera = true; } // yeni yarış: kamerayı başa al
  if (s.n !== count) {
    count = s.n;
    views.forEach((v, i) => { v.root.visible = i < count; });
  }
}

const ui = createUI({ getStandings: (round) => game.standings(round), getName: () => game.name, onName: (n) => game.setName(n), onVote: (on) => game.vote(on) });
if (!game.name) ui.askName();

// Ad etiketleri: adlar ya da "bu benim koşucum" değişince güncellenir
let lastRunners = null;
let lastSlot = -2;
function syncNames(s) {
  if (s.runners === lastRunners && s.slot === lastSlot) return;
  lastRunners = s.runners; lastSlot = s.slot;
  for (let i = 0; i < count; i++) views[i].setName(s.runners[i].name, i === s.slot);
}

// Giriş: boşluk tuşu (basılı tutma sayılmaz) ve ekrana dokunma
const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || typing()) return;
  e.preventDefault();
  if (!e.repeat) game.press();
});
canvas.addEventListener('pointerdown', () => game.press());
document.getElementById('tap').addEventListener('pointerdown', (e) => { e.preventDefault(); game.press(); });

// Kutlama / seyirci coşkusu durumu
const CELEB_DELAY = 0.5; // sn: koşucular yavaşlasın, sonra sevinç/üzüntü başlasın
const CELEB_BLEND = 0.7; // sn: duyguya geçiş süresi
const CELEB_HYPE = 14; // sn: tam coşku süresi, sonra sakinleşir
let celebSeq = -1; // kutlaması başlamış yarışın seq'i
let emoting = false;
let excite = 0.2;
let hype = 0;
let swing = 0; // 0 = arkadan takip, 1 = koşucuların önünde
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function updateCelebration(dt, time) {
  const p = snap.phase;
  const over = p === 'finishing' || p === 'waiting';
  const celebrating = over && snap.seq === celebSeq;
  if (over && snap.n && snap.seq !== celebSeq && live[0].dist > 0) { celebSeq = snap.seq; celebration.start(time); }
  else if (!over) { celebration.stop(); celebSeq = -1; }

  const el = celebration.elapsed(time);
  const k = el < 0 ? 0 : smooth((el - CELEB_DELAY) / CELEB_BLEND);
  const swingTarget = el < 0 ? 0 : smooth((el - 0.8) / 3);
  swing = swingTarget; // zaman tabanlı olduğundan ek yumuşatma gerekmez
  const winners = Math.min(3, count - 1); // en az bir üzgün kalsın

  if (k > 0 || emoting) {
    for (let i = 0; i < count; i++) {
      const rank = live[i].rank;
      views[i].emote(time, k <= 0 ? 0 : rank <= winners ? 1 : 2, rank, k);
    }
    emoting = k > 0;
  }

  // Seyirci coşkusu: yarışta hafif, kapıya yaklaşınca artar, bitişte tam coşku
  let targetExcite = p === 'racing' ? 0.3 : 0.2;
  let targetHype = 0;
  if (p === 'racing' && snap.f != null) {
    let lead = 0;
    for (let i = 0; i < count; i++) if (live[i].dist > lead) lead = live[i].dist;
    const near = clamp(1 - (snap.f - lead) / 45, 0, 1); // kapıya 45 m kala başlar
    targetExcite += near * 0.3;
    targetHype = near * 0.6;
  }
  if (celebrating || el >= 0) {
    const calm = smooth((el - CELEB_HYPE) / 6);
    targetExcite = 1 - calm * 0.45;
    targetHype = 1 - calm * 0.5;
  }
  const a = 1 - Math.exp(-2.5 * dt);
  excite += (targetExcite - excite) * a;
  hype += (targetHype - hype) * a;
  world.setExcite(excite);
  world.setFinishHype(hype);
}

const laneX = (i, n) => (i - (n - 1) / 2) * LANE_W;

const camPt = { x: 0, z: 0, psi: 0 };
const lookPt = { x: 0, z: 0, psi: 0 };
const lanePt = { x: 0, z: 0, psi: 0 };

/** Kamera pist eğrisini izler: grubun `back` metre gerisinde, `LOOK_AHEAD` metre ilerisine bakar. */
function placeCamera(sc, back, swing = 0) {
  path(sc - back, 0, camPt);
  path(sc, 0, lookPt);
  // Bakış, kameradan grubun ortasına doğru; viraj olsa da grup yatayda ortada kalır
  const dx = lookPt.x - camPt.x, dz = lookPt.z - camPt.z;
  const k = (back + LOOK_AHEAD) / (Math.hypot(dx, dz) || 1);
  let px = camPt.x, pz = camPt.z, py = Math.min(8, 2.2 + back * 0.22);
  let tx = camPt.x + dx * k, ty = 0.8, tz = camPt.z + dz * k;

  if (swing > 0) {
    // Kutlama: kamera grubun etrafında iç sahadan dönerek koşucuların önüne geçer, geriye bakar
    const th = swing * Math.PI;
    const fx = -Math.sin(lookPt.psi), fz = -Math.cos(lookPt.psi); // yürüyüş yönü
    const rx = Math.cos(lookPt.psi), rz = -Math.sin(lookPt.psi); // sağ (dış)
    const along = -Math.cos(th) * back, side = -Math.sin(th) * 4.5;
    px = lookPt.x + fx * along + rx * side;
    pz = lookPt.z + fz * along + rz * side;
    py = py + (3.2 - py) * swing;
    tx += (lookPt.x - tx) * swing; tz += (lookPt.z - tz) * swing; ty = 0.9;
  }
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
}

// Uyarlanabilir çözünürlük: zayıf cihazda kare süresi uzarsa piksel oranı kademeli düşer, rahatlayınca geri çıkar
const DPR_MAX = Math.min(window.devicePixelRatio || 1, 2);
const DPR_MIN = 0.75;
let dpr = DPR_MAX;
let perfAcc = 0, perfN = 0;
function adaptQuality(dt) {
  perfAcc += dt; perfN++;
  if (perfN < 90) return;
  const avg = perfAcc / perfN;
  perfAcc = perfN = 0;
  const next = avg > 1 / 40 ? Math.max(DPR_MIN, dpr - 0.25) : avg < 1 / 56 ? Math.min(DPR_MAX, dpr + 0.25) : dpr;
  if (next !== dpr) { dpr = next; resize(); }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  celebration.resize(renderer.domElement.height, FOV);

  // 8 şeridin tamamı yatayda sığacak şekilde kamera mesafesi
  const halfW = (MAX_RUNNERS * LANE_W) / 2 * 1.08;
  const need = halfW / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect);
  cam.base = Math.max(12, need);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

function step(dt, now) {
  setRunnerTime(now / 1000);
  snap = game.snapshot();
  if (snap) { onSnapshot(snap); syncNames(snap); }
  if (!snap) { placeCamera(0, cam.back); world.update(now / 1000); return; }

  // Simülasyon 20 Hz adımlarla ilerler; aradaki kesri hızla ileri sararak 60 fps akıcılık
  const age = snap.age;
  let mean = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = snap.r[i], o = live[i];
    o.v = d[1];
    o.dist = d[0] + d[1] * age;
    o.phase = d[2] + d[1] * STRIDE * age;
    o.boostLevel = d[3];
    o.taps = d[4];
    o.rank = d[5];
    mean += o.dist;
    if (o.dist < min) min = o.dist;
    if (o.dist > max) max = o.dist;
  }
  mean /= count;

  // Kamera grubu takip eder: odak ortalama ile uçların ortası arasında, grup açıldıkça geri çekilir
  const focus = mean * 0.5 + ((max + min) / 2) * 0.5;
  const targetBack = cam.base + clamp((max - min - 8) * 0.5, 0, 30);
  if (snapCamera) {
    cam.dist = focus; cam.back = targetBack; snapCamera = false;
  } else {
    const k = 1 - Math.exp(-5 * dt);
    cam.dist += (focus - cam.dist) * k;
    cam.back += (targetBack - cam.back) * k;
  }

  for (let i = 0; i < count; i++) {
    const o = live[i];
    const v = views[i];
    lane(o.dist, laneX(snap.lanes[i], count), lanePt);
    v.root.position.set(lanePt.x, 0, lanePt.z);
    v.root.rotation.y = lanePt.psi;
    v.pose(o.phase, clamp(o.v / 7, 0, 1.4), o.boostLevel);
  }

  updateCelebration(dt, now / 1000);
  ui.sync(snap, live, 0);
  placeCamera(cam.dist, cam.back, swing);
  world.setFinish(snap.f);
  world.update(now / 1000);
  celebration.update(now / 1000, camera);
}

let prev = performance.now();
function frame(now) {
  const gap = now - prev;
  const dt = Math.min(gap / 1000, 0.05);
  prev = now;
  if (gap > 500) snapCamera = true; // sekme arka plandan döndü
  step(dt, now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
