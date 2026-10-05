// 2D-разрез по скважинам (п.55): траектории, литология, содержания, рудные интервалы.

import * as store from '../store.js';
import * as M from '../model.js';
import * as G from '../geo.js';
import { mineralizedIntervals } from '../calc.js';
import { h, clear, esc, icon, fmt, fmtGrade, toast, saveFile } from '../util.js';
import { field, numInput, select, emptyState, banner } from '../components.js';
import { svgToPng } from './striplog.js';

const GRADE_COLORS = [['#C9CEC9', 'ниже борта'], ['#F2C14E', '1–2 борта'], ['#E8892B', '2–5 бортов'], ['#B83227', '≥ 5 бортов']];

function gradeColor(v, cutoff) {
  if (v == null || !(cutoff > 0)) return null;
  if (v < cutoff) return GRADE_COLORS[0][0];
  if (v < 2 * cutoff) return GRADE_COLORS[1][0];
  if (v < 5 * cutoff) return GRADE_COLORS[2][0];
  return GRADE_COLORS[3][0];
}

function niceStep(range, target) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function offsetLine(pts, d) {
  if (pts.length < 2 || !d) return pts;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / len * d, p[1] + dx / len * d];
  });
}

const poly = pts => pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

export function buildSection(holes, { azimuth, element, cutoff, unit, scale = null, width = 900 }) {
  const uLabel = unit ? M.unitLabel(unit) : '';
  const e0 = holes[0].easting, n0 = holes[0].northing;
  const proj = (x, y, z) => { const s = G.toSection(x, y, e0, n0, azimuth); return { a: s.along, o: s.offset, z }; };
  const data = holes.map(hole => {
    const tr = G.trace(hole, 2).map(p => proj(p.x, p.y, p.z));
    const seg = (from, to) => {
      const ds = [from];
      for (let d = Math.ceil(from / 2) * 2; d < to; d += 2) if (d > from) ds.push(d);
      ds.push(to);
      return G.xyzAt(hole, ds).map(p => proj(p.x, p.y, p.z));
    };
    const lith = M.intervalsOf(hole.id).map(iv => ({ iv, l: M.ref('ref_lithology', iv.lithology_id), pts: seg(iv.from_depth, iv.to_depth) }));
    const smp = element ? M.samplesOf(hole.id).map(s => ({ s, v: M.grade(s.id, element, unit), pts: seg(s.from_depth, s.to_depth) })).filter(x => x.v != null) : [];
    const ore = element && cutoff > 0 ? mineralizedIntervals(hole, element, cutoff, { unit }).map(m => ({ m, pts: seg(m.from, m.to) })) : [];
    return { hole, tr, lith, smp, ore };
  });
  const all = data.flatMap(d => d.tr);
  let minA = Math.min(...all.map(p => p.a)), maxA = Math.max(...all.map(p => p.a));
  let minZ = Math.min(...all.map(p => p.z)), maxZ = Math.max(...all.map(p => p.z));
  const spanA = Math.max(20, maxA - minA), spanZ = Math.max(20, maxZ - minZ);
  minA -= spanA * 0.08 + 10; maxA += spanA * 0.08 + 10; minZ -= spanZ * 0.05 + 5; maxZ += spanZ * 0.05 + 20;
  const L = 58, T = 28, R = 20, B = 40;
  const k = scale || Math.max(0.3, Math.min(8, (width - L - R) / (maxA - minA)));
  const W = Math.round(L + R + (maxA - minA) * k), Hh = Math.round(T + B + (maxZ - minZ) * k);
  const X = a => L + (a - minA) * k, Y = z => T + (maxZ - z) * k;
  const toXY = pts => pts.map(p => [X(p.a), Y(p.z)]);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" font-family="Roboto, system-ui, sans-serif">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#FFFFFF"/>`);
  // сетка
  const zs = niceStep(maxZ - minZ, 8), as = niceStep(maxA - minA, 8);
  for (let z = Math.ceil(minZ / zs) * zs; z <= maxZ; z += zs) {
    o.push(`<line x1="${L}" y1="${Y(z)}" x2="${W - R}" y2="${Y(z)}" stroke="#E6E9E6"/>`);
    o.push(`<text x="${L - 6}" y="${Y(z) + 3.5}" font-size="10" fill="#4A545D" text-anchor="end">${fmt(z, 0)}</text>`);
  }
  for (let a = Math.ceil(minA / as) * as; a <= maxA; a += as) {
    o.push(`<line x1="${X(a)}" y1="${T}" x2="${X(a)}" y2="${Hh - B}" stroke="#EEF0EE"/>`);
    o.push(`<text x="${X(a)}" y="${Hh - B + 14}" font-size="10" fill="#4A545D" text-anchor="middle">${fmt(a, 0)}</text>`);
  }
  o.push(`<rect x="${L}" y="${T}" width="${W - L - R}" height="${Hh - T - B}" fill="none" stroke="#9AA39C"/>`);
  o.push(`<text x="${L}" y="${Hh - 8}" font-size="10.5" fill="#4A545D">Расстояние вдоль линии разреза, м (азимут ${fmt(azimuth, 1)}°)</text>`);
  o.push(`<text x="12" y="${T + (Hh - T - B) / 2}" font-size="10.5" fill="#4A545D" transform="rotate(-90 12 ${T + (Hh - T - B) / 2})" text-anchor="middle">Абс. отметка, м</text>`);

  const lw = Math.max(5, Math.min(10, 1.6 * k + 3));
  const placed = [];          // подписи — без наложения друг на друга
  const place = (x, y, w, anchor) => {
    let yy = y;
    const x1 = anchor === 'end' ? x - w : x, x2 = x1 + w;
    for (let guard = 0; guard < 40; guard++) {
      const hit = placed.find(r => x1 < r.x2 && x2 > r.x1 && Math.abs(yy - r.y) < 13);
      if (!hit) break;
      yy = hit.y + 13;
    }
    placed.push({ x1, x2, y: yy });
    return yy;
  };
  const labels = [];
  data.forEach((d, i) => {
    const top = toXY([d.tr[0]])[0];
    const w = d.hole.hole_number.length * 6.6;
    labels.push({ x: top[0], y: place(top[0] - w / 2, top[1] - 8 - (i % 2) * 14, w, 'start'), d, top });
  });
  for (const d of data) {
    o.push(`<polyline points="${poly(toXY(d.tr))}" fill="none" stroke="#2B3238" stroke-width="1"/>`);
    for (const { l, pts } of d.lith) {
      o.push(`<polyline points="${poly(toXY(pts))}" fill="none" stroke="${l?.display_color || '#DDD'}" stroke-width="${lw}" stroke-linecap="butt"/>`);
    }
    for (const { v, pts } of d.smp) {
      const c = gradeColor(v, cutoff) || '#999';
      o.push(`<polyline points="${poly(offsetLine(toXY(pts), lw + 1))}" fill="none" stroke="${c}" stroke-width="${lw}" stroke-linecap="butt"/>`);
    }
    for (const { m, pts } of d.ore) {
      const xy = offsetLine(toXY(pts), lw * 2 + 6);
      o.push(`<polyline points="${poly(xy)}" fill="none" stroke="#8A5A12" stroke-width="2.5"/>`);
      const mid = xy[Math.floor(xy.length / 2)];
      const base = toXY(pts)[Math.floor(pts.length / 2)];
      const left = mid[0] < base[0];
      const text = `${fmt(m.length, 1)} м × ${fmtGrade(m.grade)} ${uLabel}`;
      const tx = mid[0] + (left ? -8 : 8);
      const ty = place(tx, mid[1] + 3, text.length * 6, left ? 'end' : 'start');
      if (Math.abs(ty - mid[1] - 3) > 1) o.push(`<line x1="${mid[0]}" y1="${mid[1]}" x2="${tx}" y2="${ty - 3}" stroke="#8A5A12" stroke-width="0.8"/>`);
      o.push(`<text x="${tx}" y="${ty}" font-size="10" font-weight="700" fill="#8A5A12" text-anchor="${left ? 'end' : 'start'}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(text)}</text>`);
    }
  }
  for (const { x, y, d, top } of labels) {
    const off = d.tr[0].o;
    o.push(`<circle cx="${top[0]}" cy="${top[1]}" r="3.5" fill="#1F4E5F"/>`);
    if (Math.abs(y - top[1] + 8) > 1) o.push(`<line x1="${top[0]}" y1="${top[1] - 4}" x2="${x}" y2="${y + 2}" stroke="#6B757E" stroke-width="0.7"/>`);
    o.push(`<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="#1B2228" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(d.hole.hole_number)}</text>`);
    if (Math.abs(off) >= 1) o.push(`<text x="${top[0] + 6}" y="${top[1] + 4}" font-size="9" fill="#6B757E">${off > 0 ? '+' : '−'}${fmt(Math.abs(off), 0)} м</text>`);
  }
  o.push('</svg>');
  return { markup: o.join(''), width: W, height: Hh, k };
}

export function sectionView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Разрез', sub: project.code, back: `p/${pid}` });
  const all = M.holesOf(pid);
  const holes = all.filter(G.hasCollar).filter(x => M.holeDepth(x));
  const root = h('div', { class: 'form' });
  if (!holes.length) {
    root.append(emptyState('Нет скважин с координатами', 'Для разреза нужны координаты устья (восток, север, отметка) и глубина. Заполните паспорт скважин.'));
    return root;
  }
  const missing = all.filter(x => !holes.includes(x));
  const saved = store.setting(`section:${pid}`) || {};
  const els = M.elementsWithData(holes.map(x => x.id));
  const st = {
    holes: (saved.holes || []).filter(id => holes.some(x => x.id === id)),
    azimuth: saved.azimuth ?? null,
    element: saved.element && els.some(e => e.code === saved.element) ? saved.element : (els.find(e => e.code === 'Au')?.code || els[0]?.code || ''),
    cutoff: saved.cutoff ?? 0.5,
    zoom: saved.zoom || 1
  };
  if (!st.holes.length) st.holes = holes.slice(0, 4).map(x => x.id);
  const persist = () => store.setSetting(`section:${pid}`, st);

  const autoAzimuth = chosen => {
    if (chosen.length < 2) return chosen[0]?.collar_azimuth ?? 90;
    let best = null;
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i], b = chosen[j];
      const dist = Math.hypot(a.easting - b.easting, a.northing - b.northing);
      if (!best || dist > best.dist) best = { dist, a, b };
    }
    if (best.dist < 1) return chosen[0].collar_azimuth ?? 90;
    let az = G.azimuthBetween(best.a.easting, best.a.northing, best.b.easting, best.b.northing);
    if (az >= 180) az -= 180;          // линия разреза без направления: 0–180°
    return Math.round(az * 10) / 10;
  };

  const chips = h('div', { class: 'chips' });
  const azInput = numInput(st.azimuth, v => { st.azimuth = v; persist(); draw(); });
  const out = h('div');
  const legend = h('div', { class: 'legend' });
  let last = null;

  const drawChips = () => {
    clear(chips);
    for (const x of holes) {
      const on = st.holes.includes(x.id);
      chips.append(h('button', { type: 'button', class: `chip small${on ? ' on' : ''}`, onclick: () => {
        st.holes = on ? st.holes.filter(id => id !== x.id) : [...st.holes, x.id];
        persist(); drawChips(); draw();
      } }, x.hole_number));
    }
  };

  const draw = () => {
    clear(out); clear(legend);
    const chosen = holes.filter(x => st.holes.includes(x.id));
    if (!chosen.length) { out.append(h('div', { class: 'empty' }, 'Выберите скважины')); return; }
    const az = st.azimuth ?? autoAzimuth(chosen);
    if (st.azimuth == null) azInput.placeholder = `авто: ${fmt(az, 1)}`;
    const el = st.element ? M.element(st.element) : null;
    const width = Math.min(window.innerWidth - 26, 960);
    // порядок скважин вдоль линии: начало отсчёта — самая «левая»
    const sorted = [...chosen].sort((a, b) => G.toSection(a.easting, a.northing, 0, 0, az).along - G.toSection(b.easting, b.northing, 0, 0, az).along);
    const base = buildSection(sorted, { azimuth: az, element: st.element, cutoff: st.cutoff, unit: el?.default_unit, width });
    last = st.zoom !== 1 ? buildSection(sorted, { azimuth: az, element: st.element, cutoff: st.cutoff, unit: el?.default_unit, scale: base.k * st.zoom, width }) : base;
    out.append(h('div', { class: 'striplog-wrap', html: last.markup }));
    const used = new Map();
    for (const x of chosen) for (const iv of M.intervalsOf(x.id)) { const l = M.ref('ref_lithology', iv.lithology_id); if (l) used.set(l.id, l); }
    for (const l of used.values()) legend.append(h('span', null, h('span', { class: 'swatch', style: { background: l.display_color } }), l.name));
    if (el && st.cutoff > 0) {
      GRADE_COLORS.forEach(([c, t]) => legend.append(h('span', null, h('span', { class: 'swatch', style: { background: c } }), `${st.element} ${t}`)));
      legend.append(h('span', null, h('span', { class: 'swatch', style: { background: '#8A5A12' } }), `рудный интервал ≥ ${fmt(st.cutoff)} ${M.unitLabel(el.default_unit)}`));
    }
    const far = chosen.map(x => ({ x, o: G.toSection(x.easting, x.northing, sorted[0].easting, sorted[0].northing, az).offset })).filter(r => Math.abs(r.o) > 50);
    if (far.length) out.prepend(banner('warn', `Далеко от линии разреза: ${far.map(r => `${r.x.hole_number} (${fmt(Math.abs(r.o), 0)} м)`).join(', ')}. Проекция может искажать картину.`));
  };

  const zoomBy = k => { st.zoom = Math.max(0.25, Math.min(8, st.zoom * k)); persist(); draw(); };
  root.append(h('div', { class: 'card form' },
    h('h3', { style: { margin: 0 } }, 'Скважины на разрезе'), chips,
    missing.length ? h('div', { class: 'hint' }, `Без координат или глубины: ${missing.map(x => x.hole_number).join(', ')}`) : null,
    h('div', { class: 'grid3' },
      field('Азимут линии, °', azInput, 'пусто — авто'),
      els.length ? field('Элемент', select([['', 'нет'], ...els.map(e => [e.code, e.code])], st.element, v => { st.element = v || ''; persist(); draw(); })) : h('div'),
      els.length ? field('Борт', numInput(st.cutoff, v => { st.cutoff = v; persist(); draw(); })) : h('div'))));
  root.append(h('div', { class: 'striplog-tools' },
    h('button', { class: 'icon-btn', 'aria-label': 'Уменьшить', style: { border: '1px solid var(--line)' }, onclick: () => zoomBy(1 / 1.5) }, icon('zoomOut')),
    h('button', { class: 'icon-btn', 'aria-label': 'Увеличить', style: { border: '1px solid var(--line)' }, onclick: () => zoomBy(1.5) }, icon('zoomIn')),
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn small', onclick: async () => {
      if (!last) return;
      try { await saveFile(await svgToPng(last.markup, last.width, last.height), `${project.code}_разрез.png`); } catch (e) { toast(e.message, 'error'); }
    } }, icon('download', 18), 'PNG')));
  root.append(out, legend,
    h('p', { class: 'hint' }, 'Масштаб по горизонтали и вертикали одинаковый. На траектории — порода, рядом с ней — содержание элемента по пробам, дальше — рудные интервалы с подписью «длина × содержание». Под номером скважины — удаление устья от линии разреза.'));
  drawChips();
  draw();
  return root;
}
