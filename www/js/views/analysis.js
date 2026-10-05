// Фильтры по содержаниям (п.51) и минерализованные интервалы (п.52).

import * as store from '../store.js';
import * as M from '../model.js';
import * as C from '../calc.js';
import { h, clear, icon, fmt, fmtDepth, fmtGrade, toast, plural } from '../util.js';
import { field, numInput, select, segmented, tabs, table, stat, emptyState, banner } from '../components.js';
import { setHighlight } from './striplog.js';

export function analysisView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  const tab = ctx.query.t === 'mineral' ? 'mineral' : 'filter';
  ctx.setTop({ title: tab === 'filter' ? 'Фильтр по содержаниям' : 'Рудные интервалы', sub: project.code, back: `p/${pid}` });
  const root = h('div');
  root.append(tabs([['filter', 'Фильтр'], ['mineral', 'Рудные интервалы']], tab, t => ctx.go(`p/${pid}/analysis?t=${t}`, { replace: true })));
  const holeIds = M.holesOf(pid).map(x => x.id);
  const els = M.elementsWithData(holeIds);
  if (!els.length) {
    root.append(emptyState('Анализов пока нет', 'Загрузите результаты лаборатории, чтобы искать интервалы по содержаниям.',
      h('button', { class: 'btn primary', onclick: () => ctx.go(`p/${pid}/import`) }, icon('upload'), 'Импорт анализов')));
    return root;
  }
  root.append(tab === 'filter' ? filterPanel(ctx, pid, els) : mineralPanel(ctx, pid, els));
  return root;
}

const unitOpts = () => M.refList('ref_unit', { activeOnly: false }).map(u => [u.code, M.unitLabel(u.code)]);

function filterPanel(ctx, pid, els) {
  const saved = store.setting(`filter:${pid}`);
  const st = saved || { match: 'all', conds: [{ element: els[0].code, op: '>', value: els[0].code === 'Au' ? 1 : null, unit: els[0].default_unit }] };
  const root = h('div', { class: 'form' });
  const condBox = h('div', { class: 'list' });
  const out = h('div');

  const drawConds = () => {
    clear(condBox);
    st.conds.forEach((c, i) => {
      condBox.append(h('div', { class: 'subrow' },
        h('div', { class: 'row' },
          h('div', { style: { flex: '1.2' } }, select(els.map(e => [e.code, `${e.code} — ${e.name}`]), c.element, v => { c.element = v; c.unit = M.element(v).default_unit; drawConds(); })),
          h('div', { style: { width: '78px' } }, select(C.OPS.map(o => [o, o]), c.op, v => { c.op = v; })),
          st.conds.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Убрать условие', onclick: () => { st.conds.splice(i, 1); drawConds(); } }, icon('close', 20)) : null),
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, numInput(c.value, v => { c.value = v; }, { placeholder: 'значение' })),
          h('div', { style: { width: '100px' } }, select(unitOpts(), c.unit, v => { c.unit = v; })))));
    });
  };
  const run = () => {
    clear(out);
    const conds = st.conds.filter(c => c.element && c.value != null);
    if (!conds.length) { toast('Задайте значение в условии', 'warn'); return; }
    store.setSetting(`filter:${pid}`, st);
    const res = C.filterSamples(pid, conds, st.match);
    const label = conds.map(C.conditionText).join(st.match === 'all' ? ' И ' : ' ИЛИ ');
    if (!res.length) { out.append(banner('info', `Нет проб, где ${label}`)); return; }
    const metres = res.reduce((s, r) => s + (r.sample.to_depth - r.sample.from_depth), 0);
    const byHole = new Map();
    for (const r of res) { if (!byHole.has(r.hole.id)) byHole.set(r.hole.id, []); byHole.get(r.hole.id).push(r); }
    const shownEls = [...new Set([...conds.map(c => c.element), ...els.slice(0, 5).map(e => e.code)])].slice(0, 6);
    out.append(h('div', { class: 'stats mb' },
      stat(res.length, plural(res.length, 'проба', 'пробы', 'проб')),
      stat(fmt(metres, 2), 'метров'),
      stat(byHole.size, plural(byHole.size, 'скважина', 'скважины', 'скважин'))));
    out.append(h('p', { class: 'hint' }, `Условие: ${label}. Нажмите на строку — колонка скважины с подсветкой найденных проб.`));
    out.append(table(['Скважина', 'От', 'До', 'Проба', ...shownEls.map(c => `${c}, ${M.unitLabel(M.element(c).default_unit)}`)],
      res.map(r => [r.hole.hole_number, fmtDepth(r.sample.from_depth), fmtDepth(r.sample.to_depth), r.sample.sample_number,
        ...shownEls.map(c => fmtGrade(M.grade(r.sample.id, c)))]),
      {
        numeric: [1, 2, ...shownEls.map((_, i) => 4 + i)],
        onRow: i => {
          const hid = res[i].hole.id;
          setHighlight(hid, { sampleIds: byHole.get(hid).map(r => r.sample.id), label: `Пробы, где ${label}` });
          ctx.go(`h/${hid}?t=column`);
        }
      }));
  };

  drawConds();
  root.append(h('div', { class: 'card form' },
    h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Условия'),
      segmented([['all', 'Все (И)'], ['any', 'Любое (ИЛИ)']], st.match, v => { st.match = v; })),
    condBox,
    h('button', { class: 'btn small', onclick: () => { st.conds.push({ element: els[0].code, op: '>', value: null, unit: els[0].default_unit }); drawConds(); } }, icon('plus', 18), 'Условие')),
    h('button', { class: 'btn primary block', onclick: run }, icon('filter'), 'Найти'),
    out);
  if (saved) run();
  return root;
}

function mineralPanel(ctx, pid, els) {
  const def = els.find(e => e.code === 'Au') || els[0];
  const st = store.setting(`mineral:${pid}`) || { element: def.code, cutoff: def.code === 'Au' ? 0.5 : null, unit: def.default_unit, maxWaste: 0, minLength: 0 };
  const root = h('div', { class: 'form' });
  const out = h('div');
  const unitBox = h('div');
  const drawUnit = () => { clear(unitBox); unitBox.append(select(unitOpts(), st.unit, v => { st.unit = v; })); };
  const run = () => {
    clear(out);
    if (st.cutoff == null) { toast('Укажите бортовое содержание', 'warn'); return; }
    store.setSetting(`mineral:${pid}`, st);
    const res = C.projectMineralized(pid, st.element, st.cutoff, { unit: st.unit, maxWaste: st.maxWaste || 0, minLength: st.minLength || 0 });
    const u = M.unitLabel(st.unit);
    if (!res.length) { out.append(banner('info', `Нет интервалов с ${st.element} ≥ ${fmt(st.cutoff)} ${u}`)); return; }
    out.append(h('p', { class: 'hint' }, `${res.length} ${plural(res.length, 'интервал', 'интервала', 'интервалов')} с ${st.element} ≥ ${fmt(st.cutoff)} ${u}. Содержание — средневзвешенное по длине проб. Сортировка по метрограмму (длина × содержание).`));
    out.append(table(['Скважина', 'От', 'До', 'Длина, м', `${st.element}, ${u}`, 'м × сод.', 'Проб', 'Пустая, м'],
      res.map(r => [r.hole_number, fmtDepth(r.from), fmtDepth(r.to), fmt(r.length, 2), fmtGrade(r.grade), fmt(r.metal, 2), r.samples, r.waste ? fmt(r.waste, 2) : '']),
      {
        numeric: [1, 2, 3, 4, 5, 6, 7],
        onRow: i => {
          const r = res[i];
          const all = res.filter(x => x.hole_id === r.hole_id);
          setHighlight(r.hole_id, {
            sampleIds: all.flatMap(x => x.sampleIds),
            ranges: all.map(x => ({ from: x.from, to: x.to, label: `${fmt(x.length, 2)} м × ${fmtGrade(x.grade)} ${u} ${st.element}` })),
            label: `Рудные интервалы ${st.element} ≥ ${fmt(st.cutoff)} ${u}`
          });
          ctx.go(`h/${r.hole_id}?t=column`);
        }
      }));
  };
  drawUnit();
  root.append(h('div', { class: 'card form' },
    h('div', { class: 'grid2' },
      field('Элемент', select(els.map(e => [e.code, `${e.code} — ${e.name}`]), st.element, v => { st.element = v; st.unit = M.element(v).default_unit; drawUnit(); })),
      field('Бортовое содержание', h('div', { class: 'row' }, h('div', { class: 'grow' }, numInput(st.cutoff, v => { st.cutoff = v; })), h('div', { style: { width: '96px' } }, unitBox)))),
    h('div', { class: 'grid2' },
      field('Внутренняя пустая порода, м', numInput(st.maxWaste, v => { st.maxWaste = v; }), '0 — интервал прерывается на первой пробе ниже борта'),
      field('Минимальная длина, м', numInput(st.minLength, v => { st.minLength = v; })))),
    h('button', { class: 'btn primary block', onclick: run }, icon('chart'), 'Рассчитать'),
    out);
  run();
  return root;
}
