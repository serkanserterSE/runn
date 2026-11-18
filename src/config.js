export const MAX_RUNNERS = 8;
export const LANE_W = 1.1;

// Koşucu formaları: slot numarasına göre sabit renkler (oyuncu adı her turda slota atanır). color: forma, pants: şort.
export const RUNNER_DEFS = [
  { color: 0xe4002b, fg: '#fff', hair: 0x2b1b12, pants: 0xf2f2f2 },
  { color: 0x0a5fd8, fg: '#fff', hair: 0xf2c14e, pants: 0xc8102e },
  { color: 0xf4f4f4, fg: '#1d2a44', hair: 0x5a3a22, pants: 0x0039a6 },
  { color: 0x2a2a2a, fg: '#fff', hair: 0xd9a066, pants: 0xffce00 },
  { color: 0x1b2a6b, fg: '#fff', hair: 0x8a3b12, pants: 0xf2f2f2 },
  { color: 0xff9ec4, fg: '#2b2b2b', hair: 0x111111, pants: 0xbc002d },
  { color: 0xffd400, fg: '#2b2b2b', hair: 0x111111, pants: 0xde2910 },
  { color: 0x00b8c4, fg: '#fff', hair: 0x1a1a1a, pants: 0x1b2a41 },
];

export const cssColor = (hex) => '#' + hex.toString(16).padStart(6, '0');
