// Расчёты: минерализованные интервалы (п.52), фильтры по содержаниям (п.51),
// контроль качества данных.

import * as M from './model.js';
import { fmtDepth, fmt } from './util.js';

const EPS = 1e-9;

// Непрерывные интервалы с содержанием >= cutoff.
// Среднее — средневзвешенное по длине: Σ(длина × содержание) / Σ(длина).
//   maxWaste — допустимая внутренняя пустая порода, м (0 = строго по ТЗ);
//   minLength — минимальная длина интервала; maxGap — допустимый зазор между пробами.
// Проба без анализа на элемент разрывает интервал.
export function mineralizedIntervals(hole, elementCode, cutoff, { unit, maxWaste = 0, minLength = 0, maxGap = 0.01 } = {}) {
  const u = unit || M.element(elementCode)?.default_unit;
  const out = [];
  let c = null;           // текущий интервал
  let w = null;           // накопленная пустая порода после последней рудной пробы

  const emit = () => {
    if (c && c.to - c.from >= minLength - EPS) {
      out.push({
        hole_id: hole.id, hole_number: hole.hole_number, element: elementCode, unit: u,
        from: c.from, to: c.to, length: c.to - c.from, grade: c.sum / c.len,
        metal: c.sum, samples: c.n, waste: c.waste, sampleIds: c.ids
      });
    }
    c = null; w = null;
  };
  const start = (s, g) => {
    c = { from: s.from_depth, to: s.to_depth, sum: g * (s.to_depth - s.from_depth), len: s.to_depth - s.from_depth, n: 1, waste: 0, ids: [s.id] };
  };

  for (const s of M.samplesOf(hole.id)) {
    const g = M.grade(s.id, elementCode, u);
    const len = s.to_depth - s.from_depth;
    if (c && s.from_depth - (w ? w.to : c.to) > maxGap + EPS) emit();      // разрыв в опробовании
    if (g != null && g >= cutoff - EPS) {
      if (!c) start(s, g);
      else {
        if (w) { c.sum += w.sum; c.len += w.len; c.n += w.n; c.waste += w.len; c.ids.push(...w.ids); w = null; }
        c.to = s.to_depth; c.sum += g * len; c.len += len; c.n++; c.ids.push(s.id);
      }
    } else if (c && g != null && (w ? w.len : 0) + len <= maxWaste + EPS) {
      if (!w) w = { to: s.to_depth, sum: 0, len: 0, n: 0, ids: [] };
      w.to = s.to_depth; w.sum += g * len; w.len += len; w.n++; w.ids.push(s.id);
    } else {
      emit();
    }
  }
  emit();
  return out;
}

export function projectMineralized(projectId, elementCode, cutoff, opts) {
  return M.holesOf(projectId)
    .flatMap(h => mineralizedIntervals(h, elementCode, cutoff, opts))
    .sort((a, b) => b.metal - a.metal);
}

// Фильтр проб: conditions = [{element, op, value, unit}], match = 'all' | 'any'
export const OPS = ['>', '>=', '<', '<=', '='];

export function filterSamples(projectId, conditions, match = 'all', holeIds = null) {
  const conds = conditions.filter(c => c.element && OPS.includes(c.op) && Number.isFinite(c.value));
  if (!conds.length) return [];
  const holes = M.holesOf(projectId).filter(h => !holeIds || holeIds.includes(h.id));
  const out = [];
  for (const h of holes) {
    for (const s of M.samplesOf(h.id)) {
      let hits = 0;
      for (const c of conds) {
        const v = M.grade(s.id, c.element, c.unit);
        if (v == null) continue;
        const ok = c.op === '>' ? v > c.value : c.op === '>=' ? v >= c.value - EPS : c.op === '<' ? v < c.value
          : c.op === '<=' ? v <= c.value + EPS : Math.abs(v - c.value) < EPS;
        if (ok) hits++;
      }
      if (match === 'all' ? hits === conds.length : hits > 0) out.push({ hole: h, sample: s });
    }
  }
  return out;
}

export function conditionText(c) {
  return `${c.element} ${c.op} ${fmt(c.value)} ${M.unitLabel(c.unit || M.element(c.element)?.default_unit)}`;
}

// Контроль данных проекта
export function dataIssues(projectId) {
  const issues = [];
  const add = (hole, severity, text, target) => issues.push({ hole, severity, text, target });
  for (const h of M.holesOf(projectId)) {
    const depth = h.final_depth || h.planned_depth;
    const ints = M.intervalsOf(h.id);
    const smp = M.samplesOf(h.id);
    if (h.easting == null || h.northing == null || h.elevation == null)
      add(h, 'warning', 'Нет координат устья — скважина не попадёт на разрез', { tab: 'passport' });
    if ((h.collar_azimuth == null || h.collar_dip == null) && !M.surveyOf(h.id, { validOnly: true }).length)
      add(h, 'warning', 'Нет азимута и угла устья и нет инклинометрии', { tab: 'passport' });
    let prev = null;
    for (const i of ints) {
      if (depth && i.to_depth > depth + EPS)
        add(h, 'error', `Интервал ${fmtDepth(i.from_depth)}–${fmtDepth(i.to_depth)} м глубже забоя (${fmtDepth(depth)} м)`, { interval: i.id });
      if (prev && i.from_depth - prev.to_depth > 0.01)
        add(h, 'warning', `Пропуск в описании ${fmtDepth(prev.to_depth)}–${fmtDepth(i.from_depth)} м`, { tab: 'log' });
      if (!i.lithology_id) add(h, 'warning', `Интервал ${fmtDepth(i.from_depth)}–${fmtDepth(i.to_depth)} м без породы`, { interval: i.id });
      prev = i;
    }
    if (ints.length && ints[0].from_depth > 0.01)
      add(h, 'info', `Описание начинается с ${fmtDepth(ints[0].from_depth)} м`, { tab: 'log' });
    const idx = M.assayIndex();
    let noAssay = 0;
    for (const s of smp) {
      if (depth && s.to_depth > depth + EPS)
        add(h, 'error', `Проба ${s.sample_number} (${fmtDepth(s.from_depth)}–${fmtDepth(s.to_depth)} м) глубже забоя`, { sample: s.id });
      if (!idx.has(s.id)) noAssay++;
    }
    if (noAssay) add(h, 'info', `${noAssay} проб без результатов анализов`, { tab: 'samples' });
  }
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
