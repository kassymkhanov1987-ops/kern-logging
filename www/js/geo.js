// Пространственные расчёты (п.55–57): траектория скважины методом минимальной кривизны
// по координатам устья и инклинометрии, проекция на линию разреза.
// Координаты: восток (easting), север (northing), отметка (elevation).
// В отечественной геодезии X — север, Y — восток; здесь оси названы однозначно.

import * as M from './model.js';

const rad = d => d * Math.PI / 180;
const dirVec = (az, dip) => [Math.cos(rad(dip)) * Math.sin(rad(az)), Math.cos(rad(dip)) * Math.cos(rad(az)), Math.sin(rad(dip))];

export function hasCollar(hole) {
  return hole && hole.easting != null && hole.northing != null && hole.elevation != null;
}

// Станции: устье (азимут/угол) + замеры инклинометрии
function stations(hole) {
  const st = [];
  const surveys = M.surveyOf(hole.id, { validOnly: true });
  const hasZero = surveys.some(s => s.depth === 0);
  if (!hasZero && hole.collar_azimuth != null && hole.collar_dip != null)
    st.push({ md: 0, t: dirVec(hole.collar_azimuth, hole.collar_dip) });
  for (const s of surveys) {
    if (st.length && st[st.length - 1].md === s.depth) continue;
    st.push({ md: s.depth, t: dirVec(s.azimuth, s.dip) });
  }
  if (!st.length) st.push({ md: 0, t: [0, 0, -1] });                 // нет данных — вертикально
  else if (st[0].md > 0) st.unshift({ md: 0, t: st[0].t });          // первый замер не с устья
  // позиции станций
  st[0].p = [hole.easting, hole.northing, hole.elevation];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    const len = b.md - a.md;
    const beta = Math.acos(Math.max(-1, Math.min(1, dot(a.t, b.t))));
    const rf = beta < 1e-9 ? 1 : 2 / beta * Math.tan(beta / 2);
    b.p = a.p.map((v, k) => v + len / 2 * rf * (a.t[k] + b.t[k]));
  }
  return st;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Координаты точек скважины на глубинах depths → [{depth, x, y, z}]
export function xyzAt(hole, depths) {
  if (!hasCollar(hole)) return null;
  const st = stations(hole);
  const n = st.length;
  return depths.map(d => {
    let p;
    if (d >= st[n - 1].md) {
      const s = st[n - 1];
      p = s.p.map((v, k) => v + (d - s.md) * s.t[k]);
    } else {
      let i = 0;
      while (st[i + 1].md <= d) i++;
      const a = st[i], b = st[i + 1];
      const len = b.md - a.md, f = (d - a.md) / len;
      const beta = Math.acos(Math.max(-1, Math.min(1, dot(a.t, b.t))));
      let u, rf;
      if (beta < 1e-9) { u = a.t; rf = 1; }
      else {
        const s = Math.sin(beta);
        u = a.t.map((v, k) => (Math.sin((1 - f) * beta) * v + Math.sin(f * beta) * b.t[k]) / s);
        const bf = f * beta;
        rf = bf < 1e-9 ? 1 : 2 / bf * Math.tan(bf / 2);
      }
      p = a.p.map((v, k) => v + f * len / 2 * rf * (a.t[k] + u[k]));
    }
    return { depth: d, x: p[0], y: p[1], z: p[2] };
  });
}

export function trace(hole, step = 5) {
  const depth = M.holeDepth(hole) || 0;
  const ds = new Set([0, depth]);
  for (let d = step; d < depth; d += step) ds.add(Math.round(d * 1000) / 1000);
  for (const s of M.surveyOf(hole.id, { validOnly: true })) if (s.depth <= depth) ds.add(s.depth);
  return xyzAt(hole, [...ds].sort((a, b) => a - b));
}

// Проекция на линию разреза, проходящую через (e0, n0) по азимуту az:
// along — расстояние вдоль линии, offset — удаление от плоскости (+ справа)
export function toSection(x, y, e0, n0, az) {
  const dx = x - e0, dy = y - n0;
  return { along: dx * Math.sin(rad(az)) + dy * Math.cos(rad(az)), offset: dx * Math.cos(rad(az)) - dy * Math.sin(rad(az)) };
}

export function azimuthBetween(e1, n1, e2, n2) {
  const a = Math.atan2(e2 - e1, n2 - n1) * 180 / Math.PI;
  return (a + 360) % 360;
}
