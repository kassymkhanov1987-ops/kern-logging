// Сопоставление скважин (п.54): колонки рядом в одном масштабе.

import * as store from '../store.js';
import * as M from '../model.js';
import { h, clear, icon, fmt, toast, saveFile } from '../util.js';
import { select, emptyState } from '../components.js';
import { stripLogSvg, attachStripLogClicks, defaultScale, svgToPng } from './striplog.js';

export function compareView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Сопоставление скважин', sub: project.code, back: `p/${pid}` });
  const holes = M.holesOf(pid).filter(x => M.holeDepth(x));
  const root = h('div');
  if (holes.length < 1) { root.append(emptyState('Нет скважин с описанием', 'Добавьте описание хотя бы в одну скважину.')); return root; }

  const saved = store.setting(`compare:${pid}`) || {};
  let sel = (saved.holes || []).filter(id => holes.some(x => x.id === id));
  if (!sel.length) sel = holes.slice(0, 3).map(x => x.id);
  const els = M.elementsWithData(holes.map(x => x.id));
  let el = saved.element && els.some(e => e.code === saved.element) ? saved.element : (els.find(e => e.code === 'Au')?.code || els[0]?.code || '');
  let scale = saved.scale || defaultScale(Math.max(...holes.map(x => M.holeDepth(x))));
  const persist = () => store.setSetting(`compare:${pid}`, { holes: sel, element: el, scale });

  const chips = h('div', { class: 'chips' });
  const drawChips = () => {
    clear(chips);
    for (const x of holes) {
      const on = sel.includes(x.id);
      chips.append(h('button', { type: 'button', class: `chip small${on ? ' on' : ''}`, onclick: () => {
        sel = on ? sel.filter(id => id !== x.id) : holes.filter(y => sel.includes(y.id) || y.id === x.id).map(y => y.id);
        persist(); drawChips(); draw();
      } }, x.hole_number));
    }
  };
  const wrap = h('div', { class: 'compare-wrap' });
  let parts = [];
  const draw = () => {
    clear(wrap);
    parts = [];
    const chosen = holes.filter(x => sel.includes(x.id));
    if (!chosen.length) { wrap.append(h('div', { class: 'empty' }, 'Выберите скважины')); return; }
    const depthMax = Math.max(...chosen.map(x => M.holeDepth(x)));
    for (const x of chosen) {
      const r = stripLogSvg(x, { scale, elements: el ? [el] : [], compact: true, depthMax, title: x.hole_number });
      parts.push(r);
      const div = h('div', { html: r.markup });
      attachStripLogClicks(div, ctx);
      wrap.append(div);
    }
  };
  const zoom = k => { scale = Math.max(0.5, Math.min(40, Math.round(scale * k * 2) / 2)); persist(); draw(); };

  root.append(h('div', { class: 'card' }, h('h3', null, 'Скважины'), chips));
  root.append(h('div', { class: 'striplog-tools' },
    h('button', { class: 'icon-btn', 'aria-label': 'Уменьшить', style: { border: '1px solid var(--line)' }, onclick: () => zoom(1 / 1.5) }, icon('zoomOut')),
    h('button', { class: 'icon-btn', 'aria-label': 'Увеличить', style: { border: '1px solid var(--line)' }, onclick: () => zoom(1.5) }, icon('zoomIn')),
    els.length ? h('div', { style: { width: '150px' } }, select([['', 'без графика'], ...els.map(e => [e.code, `${e.code}, ${M.unitLabel(e.default_unit)}`])], el, v => { el = v || ''; persist(); draw(); })) : null,
    h('span', { style: { flex: 1 } }),
    h('button', { class: 'btn small', onclick: async () => {
      if (!parts.length) return;
      const w = parts.reduce((s, p) => s + p.width, 0), hh = Math.max(...parts.map(p => p.height));
      let x = 0;
      const inner = parts.map(p => { const g = `<g transform="translate(${x},0)">${p.markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`; x += p.width; return g; }).join('');
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><rect width="${w}" height="${hh}" fill="#fff"/>${inner}</svg>`;
      try { await saveFile(await svgToPng(markup, w, hh), `${project.code}_сопоставление.png`); } catch (e) { toast(e.message, 'error'); }
    } }, icon('download', 18), 'PNG')));
  root.append(wrap, h('p', { class: 'hint' }, 'Колонки выровнены по глубине от устья. Нажмите на интервал — карточка с описанием и анализами.'));
  drawChips();
  draw();
  return root;
}
