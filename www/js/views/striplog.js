// Геологическая колонка скважины (п.49), графики содержаний (п.53),
// карточка интервала по нажатию (п.50), подсветка результатов фильтра (п.51–52).

import * as store from '../store.js';
import * as M from '../model.js';
import { h, clear, esc, icon, fmt, fmtDepth, fmtGrade, modal, toast, saveFile, safeFileName } from '../util.js';
import { banner } from '../components.js';
import { openPhoto, thumbUrl } from './photos.js';

// Подсветка, которую ставит экран фильтров / рудных интервалов перед переходом на колонку
export const highlight = { holeId: null, sampleIds: new Set(), ranges: [], label: '' };
export function setHighlight(holeId, { sampleIds = [], ranges = [], label = '' } = {}) {
  highlight.holeId = holeId; highlight.sampleIds = new Set(sampleIds); highlight.ranges = ranges; highlight.label = label;
}
export function clearHighlight() { setHighlight(null); }

const PATTERNS = {
  crosses: { w: 10, h: 10, d: 'M3 5h4M5 3v4' },
  v: { w: 10, h: 10, d: 'M2.5 3l2.5 4.5 2.5-4.5' },
  dots: { w: 8, h: 8, d: 'M2 2h.01M6 6h.01', cap: true },
  dashes: { w: 12, h: 8, d: 'M1 2h5M7 6h4' },
  bricks: { w: 12, h: 10, d: 'M0 5h12M0 10h12M6 0v5M0 5v5M12 5v5' },
  waves: { w: 12, h: 8, d: 'M0 5q3-4 6 0t6 0' },
  triangles: { w: 12, h: 10, d: 'M2 8l3-5 3 5z' }
};

let uid = 0;

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-12) return m * p;
  return 10 * p;
}

function tickStep(scale) {
  for (const s of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200]) if (s * scale >= 36) return s;
  return 500;
}

function textColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#1B2228';
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? '#1B2228' : '#FFFFFF';
}

// SVG-разметка колонки. Возвращает { markup, width, height }.
export function stripLogSvg(hole, { scale = 4, elements = [], compact = false, depthMax, highlightSamples, ranges = [], title } = {}) {
  const id = `sl${++uid}`;
  const depth = depthMax ?? (M.holeDepth(hole) || 10);
  const ints = M.intervalsOf(hole.id);
  const smp = M.samplesOf(hole.id);
  const A = compact ? 36 : 48, WL = compact ? 40 : 70, WA = compact ? 0 : 14, WS = compact ? 0 : 62, WE = compact ? 66 : 92, GAP = 12;
  const H = title ? 58 : 42, B = 14;
  const xL = A, xA = xL + WL, xS = xA + WA + (WA ? 2 : 0), xE0 = xS + WS + (WS ? GAP : 2);
  const width = xE0 + elements.length * (WE + GAP) + 4;
  const height = H + depth * scale + B;
  const Y = d => H + d * scale;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Roboto, system-ui, sans-serif">`);
  out.push('<defs>');
  for (const [k, p] of Object.entries(PATTERNS)) {
    out.push(`<pattern id="${id}-${k}" width="${p.w}" height="${p.h}" patternUnits="userSpaceOnUse"><path d="${p.d}" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="${p.cap ? 2.2 : 0.9}" stroke-linecap="round"/></pattern>`);
  }
  out.push(`<pattern id="${id}-none" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="#C9CFCB" stroke-width="1"/></pattern>`);
  out.push('</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);
  if (title) out.push(`<text x="${xL}" y="18" font-size="14" font-weight="700" fill="#1B2228">${esc(title)}</text>`);

  // заголовки колонок
  const hy = H - 10;
  out.push(`<text x="${A - 6}" y="${hy}" font-size="10" fill="#6B757E" text-anchor="end">м</text>`);
  out.push(`<text x="${xL + WL / 2}" y="${hy}" font-size="10.5" font-weight="700" fill="#4A545D" text-anchor="middle">${compact ? 'Пор.' : 'Порода'}</text>`);
  if (WA) out.push(`<text x="${xA + WA / 2}" y="${hy}" font-size="9" font-weight="700" fill="#4A545D" text-anchor="middle">Изм</text>`);
  if (WS) out.push(`<text x="${xS + WS / 2}" y="${hy}" font-size="10.5" font-weight="700" fill="#4A545D" text-anchor="middle">Пробы</text>`);

  // шкала глубин и сетка
  const step = tickStep(scale);
  for (let d = 0; d <= depth + 1e-9; d += step) {
    const y = Y(d);
    out.push(`<line x1="${A - 4}" y1="${y}" x2="${width}" y2="${y}" stroke="#E6E9E6" stroke-width="1"/>`);
    out.push(`<text x="${A - 6}" y="${y + 3.5}" font-size="10" fill="#4A545D" text-anchor="end">${fmt(d, 1)}</text>`);
  }
  // неописанная часть
  out.push(`<rect x="${xL}" y="${Y(0)}" width="${WL}" height="${depth * scale}" fill="url(#${id}-none)"/>`);

  // литология
  for (const iv of ints) {
    const l = M.ref('ref_lithology', iv.lithology_id);
    const y1 = Y(iv.from_depth), hgt = Math.max(0.5, (iv.to_depth - iv.from_depth) * scale);
    const color = l?.display_color || '#E0E0E0';
    out.push(`<rect x="${xL}" y="${y1}" width="${WL}" height="${hgt}" fill="${color}"/>`);
    if (l?.pattern && PATTERNS[l.pattern]) out.push(`<rect x="${xL}" y="${y1}" width="${WL}" height="${hgt}" fill="url(#${id}-${l.pattern})"/>`);
    out.push(`<line x1="${xL}" y1="${y1}" x2="${xL + WL}" y2="${y1}" stroke="#2B3238" stroke-width="0.8"/>`);
    if (hgt >= 13 && l) out.push(`<text x="${xL + WL / 2}" y="${y1 + hgt / 2 + 4}" font-size="${compact ? 9.5 : 11}" font-weight="700" fill="${textColor(color)}" text-anchor="middle" paint-order="stroke" stroke="${color}" stroke-width="3">${esc(l.code)}</text>`);
    if (WA) {
      const a = (iv.alterations || [])[0];
      const alt = a && M.ref('ref_alteration', a.alteration_id);
      if (alt) {
        const rank = M.ref('ref_intensity', a.intensity_id)?.rank ?? 2;
        out.push(`<rect x="${xA + 1}" y="${y1}" width="${WA}" height="${hgt}" fill="${alt.display_color || '#999'}" fill-opacity="${Math.min(1, 0.2 + rank * 0.2)}"/>`);
      }
    }
    out.push(`<rect class="sl-int" data-iid="${iv.id}" x="${xL}" y="${y1}" width="${WL + WA + 2}" height="${hgt}" fill="transparent"/>`);
  }
  out.push(`<rect x="${xL}" y="${Y(0)}" width="${WL}" height="${depth * scale}" fill="none" stroke="#2B3238" stroke-width="1"/>`);

  // пробы
  if (WS) {
    for (const s of smp) {
      const y1 = Y(s.from_depth), hgt = Math.max(0.5, (s.to_depth - s.from_depth) * scale);
      const hl = highlightSamples?.has(s.id);
      out.push(`<rect class="sl-int" data-sid="${s.id}" x="${xS + 1}" y="${y1 + 0.5}" width="${WS - 2}" height="${Math.max(0.5, hgt - 1)}" fill="${hl ? '#F5D38A' : '#F4F6F4'}" stroke="${hl ? '#B7802A' : '#B9C0BA'}" stroke-width="${hl ? 1.5 : 0.8}"/>`);
      if (hgt >= 12) {
        const short = String(s.sample_number).split('-').pop();
        out.push(`<text x="${xS + WS / 2}" y="${y1 + hgt / 2 + 3.5}" font-size="10" fill="#4A545D" text-anchor="middle" pointer-events="none">${esc(short)}</text>`);
      }
    }
  }

  // графики содержаний
  elements.forEach((code, k) => {
    const el = M.element(code);
    if (!el) return;
    const x0 = xE0 + k * (WE + GAP);
    const vals = smp.map(s => ({ s, v: M.grade(s.id, code) })).filter(x => x.v != null);
    const max = niceMax(Math.max(0, ...vals.map(x => x.v)));
    out.push(`<text x="${x0 + WE / 2}" y="${hy - 11}" font-size="10.5" font-weight="700" fill="${el.display_color || '#333'}" text-anchor="middle">${esc(code)}, ${esc(M.unitLabel(el.default_unit))}</text>`);
    out.push(`<text x="${x0}" y="${hy + 1}" font-size="9" fill="#6B757E">0</text><text x="${x0 + WE}" y="${hy + 1}" font-size="9" fill="#6B757E" text-anchor="end">${fmtGrade(max)}</text>`);
    out.push(`<rect x="${x0}" y="${Y(0)}" width="${WE}" height="${depth * scale}" fill="#FAFBFA" stroke="#D9DDD8" stroke-width="1"/>`);
    out.push(`<line x1="${x0 + WE / 2}" y1="${Y(0)}" x2="${x0 + WE / 2}" y2="${Y(depth)}" stroke="#ECEFEC" stroke-width="1"/>`);
    for (const { s, v } of vals) {
      const y1 = Y(s.from_depth), hgt = Math.max(0.8, (s.to_depth - s.from_depth) * scale - (scale > 3 ? 0.6 : 0));
      const w = Math.max(1, Math.min(1, v / max) * (WE - 2));
      const hl = highlightSamples?.has(s.id);
      out.push(`<rect class="sl-int" data-sid="${s.id}" x="${x0 + 1}" y="${y1}" width="${w}" height="${hgt}" fill="${el.display_color || '#555'}" fill-opacity="${hl ? 1 : 0.8}"${hl ? ' stroke="#1B2228" stroke-width="1"' : ''}/>`);
      if (hgt >= 11 && !compact) {
        const tx = w > WE - 30 ? x0 + w - 2 : x0 + w + 3;
        out.push(`<text x="${tx}" y="${y1 + hgt / 2 + 3.5}" font-size="9.5" fill="${w > WE - 30 ? '#FFFFFF' : '#1B2228'}" text-anchor="${w > WE - 30 ? 'end' : 'start'}" pointer-events="none">${fmtGrade(v)}</text>`);
      }
    }
  });

  // рудные интервалы
  for (const r of ranges) {
    const y1 = Y(r.from), hgt = (r.to - r.from) * scale;
    const x1 = WS ? xS - 2 : xL - 2, x2 = width - 2;
    out.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${hgt}" fill="rgba(183,128,42,.10)" stroke="#B7802A" stroke-width="2" stroke-dasharray="6 3" pointer-events="none"/>`);
    if (r.label) out.push(`<text x="${x2 - 4}" y="${y1 - 4}" font-size="10.5" font-weight="700" fill="#8A5A12" text-anchor="end" pointer-events="none">${esc(r.label)}</text>`);
  }
  out.push(`<text x="${A - 6}" y="${Y(depth) + 12}" font-size="10" font-weight="700" fill="#1B2228" text-anchor="end">${fmt(depth, 1)}</text>`);
  out.push('</svg>');
  return { markup: out.join(''), width, height };
}

// Клик по колонке → карточка интервала или пробы
export function attachStripLogClicks(container, ctx) {
  container.addEventListener('click', e => {
    const t = e.target.closest?.('[data-iid],[data-sid]');
    if (!t) return;
    if (t.dataset.iid) showIntervalCard(ctx, t.dataset.iid);
    else if (t.dataset.sid) showSampleCard(ctx, t.dataset.sid);
  });
}

function assayGrid(sampleId) {
  const a = M.sampleAssays(sampleId);
  if (!a.length) return h('div', { class: 'hint' }, 'Анализов нет');
  return h('div', { class: 'assay-grid' }, a.map(x => h('div', { class: 'assay' },
    h('div', { class: 'el' }, x.name ? `${x.code} · ${x.name}` : x.code),
    h('div', { class: 'val' }, x.text, ' ', h('small', null, M.unitLabel(x.unit))))));
}

export function showIntervalCard(ctx, intervalId) {
  const iv = store.get('intervals', intervalId);
  if (!iv) return;
  const hole = store.get('holes', iv.hole_id);
  const l = M.ref('ref_lithology', iv.lithology_id);
  const kv = (k, v) => v ? [h('div', { class: 'k' }, k), h('div', null, v)] : null;
  const alts = (iv.alterations || []).map(a => {
    const alt = M.ref('ref_alteration', a.alteration_id), it = M.ref('ref_intensity', a.intensity_id);
    return alt ? `${alt.name}${it ? ' — ' + it.name.toLowerCase() : ''}` : null;
  }).filter(Boolean);
  const mins = (iv.minerals || []).map(m => {
    const mi = M.ref('ref_mineral', m.mineral_id);
    return mi ? `${mi.code} (${mi.name})${m.content_pct != null ? ' — ' + fmt(m.content_pct) + ' %' : ''}${m.style ? ', ' + M.label(M.MINERAL_STYLES, m.style) : ''}` : null;
  }).filter(Boolean);
  const veins = (iv.veins || []).map(v => {
    const vt = M.ref('ref_vein_type', v.vein_type_id);
    return vt ? [`${vt.name} прожилки`, v.per_m != null ? `${fmt(v.per_m)} шт/м` : null, v.volume_pct != null ? `${fmt(v.volume_pct)} %` : null,
      v.thickness_mm != null ? `${fmt(v.thickness_mm)} мм` : null, v.alpha != null ? `${fmt(v.alpha)}° к оси` : null].filter(Boolean).join(', ') : null;
  }).filter(Boolean);
  const samples = M.samplesOf(iv.hole_id).filter(s => s.from_depth < iv.to_depth && s.to_depth > iv.from_depth);
  const photos = M.photosForRange(iv.hole_id, iv.from_depth, iv.to_depth);
  const photoBox = h('div', { class: 'photo-grid' });
  for (const p of photos) {
    const img = h('img', { alt: '' });
    thumbUrl(p.id).then(u => { if (u) img.src = u; });
    photoBox.append(h('button', { class: 'photo-tile', onclick: () => openPhoto(ctx, p) }, img,
      h('div', { class: 'cap' }, `${p.box_number ? 'Ящик ' + p.box_number + ' · ' : ''}${fmtDepth(p.from_depth)}–${fmtDepth(p.to_depth)}`)));
  }

  const content = h('div', null,
    h('div', { class: 'kv' },
      kv('Скважина', hole?.hole_number),
      kv('Интервал', `${fmtDepth(iv.from_depth)}–${fmtDepth(iv.to_depth)} м (${fmt(iv.to_depth - iv.from_depth, 2)} м)`),
      kv('Литология', l ? h('span', null, h('span', { class: 'swatch', style: { background: l.display_color } }), ' ', l.name) : 'не указана'),
      kv('Структура', M.ref('ref_structure', iv.structure_id)?.name),
      kv('Текстура', M.ref('ref_texture', iv.texture_id)?.name),
      kv('Окисление', iv.oxidation ? M.label(M.OXIDATION, iv.oxidation) : null),
      kv('Цвет', iv.color),
      kv('Изменение', alts.length ? h('div', null, alts.map(a => h('div', null, a))) : null),
      kv('Минерализация', mins.length ? h('div', null, mins.map(a => h('div', null, a))) : null),
      kv('Прожилки', veins.length ? h('div', null, veins.map(a => h('div', null, a))) : null),
      kv('Комментарий', iv.comment),
      kv('Описал', [iv.logged_by, iv.logged_at ? new Date(iv.logged_at).toLocaleDateString('ru-RU') : null].filter(Boolean).join(', '))),
    h('div', { class: 'section-title' }, samples.length > 1 ? 'Пробы' : 'Проба'),
    samples.length ? h('div', { class: 'list' }, samples.map(s => h('div', { class: 'card', style: { margin: 0 } },
      h('div', { class: 'row mb' }, h('b', { class: 'grow' }, s.sample_number), h('span', { class: 'depth muted small' }, `${fmtDepth(s.from_depth)}–${fmtDepth(s.to_depth)}`)),
      assayGrid(s.id)))) : h('div', { class: 'hint' }, 'Интервал не опробован'),
    photos.length ? h('div', { class: 'section-title' }, 'Фото керна') : null,
    photos.length ? photoBox : null);

  modal({
    title: `${hole?.hole_number ?? ''} · ${fmtDepth(iv.from_depth)}–${fmtDepth(iv.to_depth)} м`,
    content,
    actions: [{ label: 'Редактировать', kind: 'primary', onClick: () => ctx.go(`h/${iv.hole_id}/i/${iv.id}`) }]
  });
}

export function showSampleCard(ctx, sampleId) {
  const s = store.get('samples', sampleId);
  if (!s) return;
  const lith = M.intervalsOf(s.hole_id).filter(i => i.from_depth < s.to_depth && i.to_depth > s.from_depth)
    .map(i => M.ref('ref_lithology', i.lithology_id)?.name).filter(Boolean);
  modal({
    title: s.sample_number,
    content: h('div', null,
      h('p', { class: 'muted', style: { marginTop: 0 } }, `${fmtDepth(s.from_depth)}–${fmtDepth(s.to_depth)} м · ${fmt(s.to_depth - s.from_depth, 2)} м${lith.length ? ' · ' + [...new Set(lith)].join(', ') : ''}`),
      assayGrid(s.id)),
    actions: [{ label: 'Открыть пробу', onClick: () => ctx.go(`h/${s.hole_id}/s/${s.id}`) }]
  });
}

export function defaultScale(depth) {
  return Math.max(1, Math.min(20, Math.round(1100 / Math.max(depth || 50, 10) * 2) / 2));
}

export function elementPicker(available, selected, onChange) {
  const box = h('div', { class: 'chips' });
  const draw = () => {
    clear(box);
    for (const e of available) {
      const on = selected.includes(e.code);
      box.append(h('button', { type: 'button', class: `chip small${on ? ' on' : ''}`, onclick: () => {
        selected = on ? selected.filter(c => c !== e.code) : [...selected, e.code].sort((a, b) =>
          available.findIndex(x => x.code === a) - available.findIndex(x => x.code === b));
        draw(); onChange(selected);
      } }, h('span', { class: 'swatch', style: { background: e.display_color || '#999' } }), e.code));
    }
  };
  draw();
  return box;
}

export async function svgToPng(markup, width, height) {
  const ratio = Math.min(3, 8000 / Math.max(width, height));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Не удалось отрисовать изображение')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(width * ratio); c.height = Math.round(height * ratio);
    const g = c.getContext('2d');
    g.scale(ratio, ratio);
    g.drawImage(img, 0, 0);
    return await new Promise(res => c.toBlob(res, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export function columnTab(ctx, hole) {
  const root = h('div');
  const depth = M.holeDepth(hole);
  if (!depth) {
    root.append(banner('warn', 'Не задана глубина скважины и нет описания — колонку не построить.'));
    return root;
  }
  const available = M.elementsWithData([hole.id]);
  let selected = (store.setting('striplog_elements') || ['Au', 'Ag', 'Pb', 'Zn', 'Cu']).filter(c => available.some(e => e.code === c));
  if (!selected.length) selected = available.slice(0, 3).map(e => e.code);
  let scale = Number(store.setting(`scale:${hole.id}`)) || defaultScale(depth);
  const active = highlight.holeId === hole.id;

  const wrap = h('div', { class: 'striplog-wrap' });
  const legend = h('div', { class: 'legend' });
  const draw = () => {
    const { markup } = stripLogSvg(hole, { scale, elements: selected, highlightSamples: active ? highlight.sampleIds : null, ranges: active ? highlight.ranges : [] });
    wrap.innerHTML = markup;
    clear(legend);
    const used = new Map();
    for (const iv of M.intervalsOf(hole.id)) { const l = M.ref('ref_lithology', iv.lithology_id); if (l) used.set(l.id, l); }
    for (const l of used.values()) legend.append(h('span', null, h('span', { class: 'swatch', style: { background: l.display_color } }), `${l.code} — ${l.name}`));
  };
  const zoom = k => {
    scale = Math.max(0.5, Math.min(40, Math.round(scale * k * 2) / 2));
    store.setSetting(`scale:${hole.id}`, scale);
    draw();
  };
  if (active) {
    root.append(banner('info', highlight.label || 'Подсвечены найденные пробы',
      h('button', { class: 'btn small', onclick: () => { clearHighlight(); ctx.refresh(); } }, 'Сбросить')));
  }
  root.append(h('div', { class: 'striplog-tools' },
    h('button', { class: 'icon-btn', 'aria-label': 'Уменьшить', onclick: () => zoom(1 / 1.5), style: { border: '1px solid var(--line)' } }, icon('zoomOut')),
    h('button', { class: 'icon-btn', 'aria-label': 'Увеличить', onclick: () => zoom(1.5), style: { border: '1px solid var(--line)' } }, icon('zoomIn')),
    h('span', { class: 'small muted' }, `${fmt(scale, 1)} пикс/м`),
    h('span', { class: 'grow', style: { flex: 1 } }),
    h('button', { class: 'btn small', onclick: async () => {
      const { markup, width, height } = stripLogSvg(hole, { scale, elements: selected, title: `${hole.hole_number} — геологическая колонка`, highlightSamples: active ? highlight.sampleIds : null, ranges: active ? highlight.ranges : [] });
      try { await saveFile(await svgToPng(markup, width, height), `${safeFileName(hole.hole_number)}_колонка.png`); }
      catch (e) { toast(e.message, 'error'); }
    } }, icon('download', 18), 'PNG')));
  if (available.length) {
    root.append(elementPicker(available, selected, sel => { selected = sel; store.setSetting('striplog_elements', sel); draw(); }));
  } else root.append(h('p', { class: 'hint' }, 'Анализов нет — графики содержаний появятся после импорта результатов лаборатории.'));
  root.append(h('div', { class: 'mt' }), wrap, legend,
    h('p', { class: 'hint' }, 'Нажмите на интервал породы — откроется карточка с описанием, анализами и фото. Нажмите на пробу — её анализы.'));
  attachStripLogClicks(wrap, ctx);
  draw();
  return root;
}
