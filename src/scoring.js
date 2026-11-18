// Puanlama: sıraya göre puan. Yalnızca gerçek oyuncular genel sıralamaya yazılır (botlar yarışır ama kaydedilmez).
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
export const FIELDS = ['points', 'wins', 'podiums', 'dist', 'races'];

/** rows: yarış sonucu, birinciden sonuncuya [{ pid|null, name, dist }] → gerçek oyuncuların toplamlara katkısı */
export function scoreDelta(rows) {
  const out = [];
  rows.forEach((r, i) => {
    if (!r.pid) return;
    out.push({ pid: r.pid, name: r.name, points: POINTS[i] ?? 0, wins: i === 0 ? 1 : 0, podiums: i < 3 ? 1 : 0, dist: Math.round(r.dist), races: 1 });
  });
  return out;
}

/** totals: { [pid]: {name, points, wins, podiums, dist, races} } → sıralı satırlar [[ad, puan, galibiyet, podyum, mesafe, yarış]] */
export function toRows(totals, limit = 20) {
  const rows = Object.values(totals).map((t) => [t.name, t.points, t.wins, t.podiums, t.dist, t.races]);
  rows.sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[4] - a[4] || (a[0] < b[0] ? -1 : 1));
  return rows.slice(0, limit);
}

export const emptyTotal = (name) => ({ name, points: 0, wins: 0, podiums: 0, dist: 0, races: 0 });
