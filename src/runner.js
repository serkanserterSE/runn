import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cssColor } from './config.js';

// Paylaşılan geometri / materyaller (draw call ve bellek tasarrufu)
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CYL_S = new THREE.CylinderGeometry(1, 1, 1, 10);
const SHADOW_GEO = new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2);
const TRAIL_GEO = new THREE.PlaneGeometry(0.5, 1).rotateX(-Math.PI / 2);

const plastic = (color) => new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x333333 });
const SKIN = plastic(0xffd21f);
const SHOE = plastic(0x222222);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const TRAIL_MAT = new THREE.MeshBasicMaterial({
  color: 0xffe27a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
});

const HALO_GEO = new THREE.TorusGeometry(0.28, 0.06, 6, 18).rotateX(Math.PI / 2);
const CLOUD_GEO = mergeGeometries([
  new THREE.BoxGeometry(0.9, 0.3, 0.6),
  new THREE.BoxGeometry(0.55, 0.3, 0.45).translate(-0.2, 0.22, 0),
  new THREE.BoxGeometry(0.45, 0.25, 0.4).translate(0.25, 0.18, 0),
]);
const CLOUD_MAT = new THREE.MeshLambertMaterial({ color: 0x6d7a8c });
// Yağmur damlaları: tek geometri, GPU'da düşer (paylaşılan uTime)
const RAIN_TIME = { value: 0 };
const RAIN_GEO = (() => {
  const parts = [];
  const rnd = (n) => { const x = Math.sin(n * 91.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 7; i++) {
    const g = new THREE.BoxGeometry(0.035, 0.16, 0.035).translate((rnd(i) - 0.5) * 0.7, 0, (rnd(i + 9) - 0.5) * 0.4);
    const n = g.attributes.position.count;
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(new Float32Array(n).fill(rnd(i + 3)), 1));
    parts.push(g);
  }
  return mergeGeometries(parts);
})();
const RAIN_MAT = new THREE.MeshBasicMaterial({ color: 0x66b6ff, transparent: true, opacity: 0.85, depthWrite: false });
RAIN_MAT.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = RAIN_TIME;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPh;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.y -= fract(uTime * 0.9 + aPh) * 1.9 + 0.25;`);
};
const PODIUM_MATS = [0xffc933, 0xc9d1da, 0xcd7f32].map((c) => plastic(c)); // altın, gümüş, bronz

// Ad etiketi: koşucunun başında, her zaman kameraya dönük. Canvas yalnızca ad/vurgu değişince yeniden çizilir.
const LABEL_W = 256, LABEL_H = 64;
function createLabel(color) {
  const c = document.createElement('canvas');
  c.width = LABEL_W; c.height = LABEL_H;
  const g = c.getContext('2d');
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, fog: false }));
  sprite.scale.set(1.5, 0.375, 1);
  let key = '';
  return {
    sprite,
    set(name, mine) {
      const k = `${mine ? 1 : 0}${name}`;
      if (k === key) return;
      key = k;
      g.clearRect(0, 0, LABEL_W, LABEL_H);
      g.font = '800 34px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const w = Math.min(LABEL_W - 8, g.measureText(name).width + 34);
      g.fillStyle = mine ? '#ffd400' : 'rgba(255,255,255,.92)';
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.beginPath();
      g.roundRect((LABEL_W - w) / 2, 6, w, LABEL_H - 12, 20);
      g.fill(); g.stroke();
      g.fillStyle = '#1d2a44';
      g.fillText(name, LABEL_W / 2, LABEL_H / 2 + 2, LABEL_W - 40);
      map.needsUpdate = true;
    },
  };
}

function part(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

function pivot(x, y) {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  return g;
}

function bibTexture(number, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = cssColor(color);
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = '#111';
  g.font = '900 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(number), 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Yağmur animasyonu zamanı (tüm koşucular için ortak). */
export const setRunnerTime = (t) => { RAIN_TIME.value = t; };

/** Arkadan görünen Lego minifig koşucu. Yüz yönü -z. */
export function createRunner(def, number) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shirt = plastic(def.color);
  const pants = plastic(def.pants);
  const hair = plastic(def.hair);
  const shirtColor = new THREE.Color(def.color);

  const legL = pivot(-0.15, 0.44);
  const legR = pivot(0.15, 0.44);
  for (const leg of [legL, legR]) {
    leg.add(part(BOX, pants, 0.27, 0.4, 0.3, 0, -0.2, 0));
    leg.add(part(BOX, SHOE, 0.27, 0.08, 0.38, 0, -0.4, -0.04));
    body.add(leg);
  }
  body.add(part(BOX, pants, 0.62, 0.12, 0.34, 0, 0.5, 0));
  body.add(part(BOX, shirt, 0.62, 0.58, 0.34, 0, 0.85, 0));

  const armL = pivot(-0.4, 1.08);
  const armR = pivot(0.4, 1.08);
  for (const arm of [armL, armR]) {
    arm.add(part(BOX, shirt, 0.18, 0.36, 0.2, 0, -0.18, 0));
    arm.add(part(BOX, SKIN, 0.15, 0.15, 0.15, 0, -0.43, 0));
    body.add(arm);
  }

  const head = pivot(0, 1.14); // boyun: baş öne eğilebilsin
  head.add(part(CYL, SKIN, 0.2, 0.28, 0.2, 0, 0.14, 0));
  head.add(part(CYL, hair, 0.215, 0.16, 0.215, 0, 0.22, 0));
  head.add(part(BOX, hair, 0.4, 0.26, 0.09, 0, 0.15, 0.15));
  head.add(part(CYL_S, hair, 0.085, 0.07, 0.085, 0, 0.335, 0));
  // Yüz (-z yönünde): kutlamada kameraya dönülünce görünür. Ağız köşeleri gülümseme/üzüntü için oynar.
  const FACE = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  head.add(part(BOX, FACE, 0.05, 0.07, 0.02, -0.075, 0.19, -0.2));
  head.add(part(BOX, FACE, 0.05, 0.07, 0.02, 0.075, 0.19, -0.2));
  head.add(part(BOX, FACE, 0.09, 0.025, 0.02, 0, 0.085, -0.2));
  const mouthL = part(BOX, FACE, 0.035, 0.025, 0.02, -0.07, 0.1, -0.2);
  const mouthR = part(BOX, FACE, 0.035, 0.025, 0.02, 0.07, 0.1, -0.2);
  head.add(mouthL, mouthR);
  body.add(head);

  const bib = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: bibTexture(number, def.color) }),
  );
  bib.position.set(0, 0.86, 0.172);
  body.add(bib);

  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.position.y = 0.16;
  shadow.renderOrder = 1;
  root.add(shadow);

  const trail = new THREE.Mesh(TRAIL_GEO, TRAIL_MAT);
  trail.position.y = 0.2;
  trail.visible = false;
  root.add(trail);

  const label = createLabel(cssColor(def.color));
  label.sprite.position.y = 1.85;
  body.add(label.sprite);

  // Podyum (ilk üç): koşucunun altında yükselen madalya renkli blok
  const podium = new THREE.Mesh(BOX, PODIUM_MATS[0]);
  podium.visible = false;
  root.add(podium);

  // Taç/halka: ilk üçün başında dönen madalya rengi halka
  const halo = new THREE.Mesh(HALO_GEO, PODIUM_MATS[0]);
  halo.position.y = 2.25;
  halo.visible = false;
  body.add(halo);

  // Üzgün bulut + yağmur: yalnızca üzgünken görünür
  const cloud = new THREE.Group();
  cloud.position.set(0, 2.9, 0);
  cloud.add(new THREE.Mesh(CLOUD_GEO, CLOUD_MAT));
  const rain = new THREE.Mesh(RAIN_GEO, RAIN_MAT);
  rain.frustumCulled = false;
  cloud.add(rain);
  cloud.visible = false;
  root.add(cloud);

  let lastBoost = -1;
  let shown = 0; // 0 yok, 1 kazanan modu, 2 üzgün modu (görünürlük durumu)
  let lastRank = 0;

  return {
    root,
    /** Başın üstündeki ad etiketi; mine: bu cihazdaki oyuncu (vurgulu). */
    setName: label.set,
    /** phase: adım fazı, amp: hareket şiddeti (0 = dururken), boost: 0..1 */
    pose(phase, amp, boost) {
      const s = Math.sin(phase);
      const swing = 0.85 * amp;
      legL.rotation.x = s * swing;
      legR.rotation.x = -s * swing;
      armL.rotation.x = -s * swing * 1.1;
      armR.rotation.x = s * swing * 1.1;
      body.position.y = Math.abs(Math.cos(phase)) * 0.07 * amp;
      body.rotation.x = -0.1 * amp;
      body.rotation.z = s * 0.05 * amp;

      if (Math.abs(boost - lastBoost) > 0.01) {
        lastBoost = boost;
        shirt.emissive.copy(shirtColor);
        shirt.emissiveIntensity = boost * 0.7;
        trail.visible = boost > 0.03;
        trail.scale.z = Math.max(0.001, boost * 3);
        trail.position.z = 0.3 + boost * 1.5;
      }
    },

    /**
     * Duygu animasyonu; pose()'dan SONRA çağrılır ve k (0..1) kadar karıştırır.
     * kind: 1 = kutlama (ilk üç), 2 = üzgün. t: saniye, rank: 1-tabanlı sıra.
     */
    emote(t, kind, rank, k) {
      if (k <= 0) {
        if (shown) this.clearEmote();
        return;
      }
      if (shown !== kind || lastRank !== rank) {
        shown = kind; lastRank = rank;
        const win = kind === 1;
        podium.visible = halo.visible = win;
        cloud.visible = !win;
        if (win) { podium.material = halo.material = PODIUM_MATS[Math.min(rank, 3) - 1]; }
      }
      const mix = (a, b) => a + (b - a) * k;
      mouthL.position.y = mouthR.position.y = kind === 1 ? 0.105 : 0.065; // gülümse / somurt
      if (kind === 1) {
        const lift = rank === 1 ? 1 : rank === 2 ? 0.7 : 0.45; // podyum yüksekliği
        const w = 7 + rank * 0.6; // sevinç temposu
        const jump = Math.abs(Math.sin(t * w + rank)) * (0.55 - rank * 0.08);
        const wave = Math.sin(t * w * 1.6);
        const bounce = lift * k;
        podium.scale.set(0.95, 0.7 * bounce + 0.001, 0.8);
        podium.position.y = 0.35 * bounce;
        legL.rotation.x = mix(legL.rotation.x, 0.5 * jump);
        legR.rotation.x = mix(legR.rotation.x, -0.5 * jump);
        armL.rotation.x = mix(armL.rotation.x, 0);
        armR.rotation.x = mix(armR.rotation.x, 0);
        armL.rotation.z = mix(0, -(2.5 + 0.35 * wave)); // kollar havada, iki yana
        armR.rotation.z = mix(0, 2.5 - 0.35 * wave);
        body.position.y = mix(body.position.y, 0.7 * bounce + jump);
        body.rotation.x = mix(body.rotation.x, 0.12); // hafif geriye, göğüs önde
        body.rotation.z = mix(body.rotation.z, Math.sin(t * w * 0.5) * 0.08);
        head.rotation.x = mix(head.rotation.x, 0.25);
        head.rotation.y = 0;
        halo.rotation.y = t * 3;
        halo.position.y = 2.25 + Math.sin(t * 4) * 0.05;
      } else {
        // üzgün: omuzlar düşük, baş öne, kollar sarkık ve yavaş sallanır
        const sway = Math.sin(t * 1.3 + rank);
        legL.rotation.x = mix(legL.rotation.x, 0);
        legR.rotation.x = mix(legR.rotation.x, 0);
        armL.rotation.x = mix(armL.rotation.x, 0.15 + 0.06 * sway);
        armR.rotation.x = mix(armR.rotation.x, 0.15 - 0.06 * sway);
        armL.rotation.z = armR.rotation.z = 0;
        body.position.y = mix(body.position.y, -0.04);
        body.rotation.x = mix(body.rotation.x, -0.26);
        body.rotation.z = mix(body.rotation.z, sway * 0.03);
        head.rotation.x = mix(head.rotation.x, -0.32); // yüzü görünsün diye aşırı eğilmez
        head.rotation.y = mix(0, Math.sin(t * 2.1 + rank) * 0.35); // "yok be" diye başını sallar
        cloud.scale.setScalar(k);
        cloud.position.y = 2.9 + Math.sin(t * 2 + rank) * 0.05;
      }
    },

    /** Duygu efektlerini kapatır (yeni yarış). */
    clearEmote() {
      shown = 0; lastRank = 0;
      mouthL.position.y = mouthR.position.y = 0.1;
      podium.visible = halo.visible = cloud.visible = false;
      armL.rotation.z = armR.rotation.z = 0;
      head.rotation.set(0, 0, 0);
    },
  };
}
