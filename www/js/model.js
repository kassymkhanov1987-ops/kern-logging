// Запросы к локальной базе: справочники, проекты, скважины, интервалы, пробы, анализы.

import * as store from './store.js';
import { naturalCompare, fmt, fmtGrade } from './util.js';

// Кэш, сбрасываемый при любом изменении данных
const cache = new Map();
function cached(key, fn) {
  const v = store.dataVersion();
  const c = cache.get(key);
  if (c && c.v === v) return c.value;
  const value = fn();
  cache.set(key, { v, value });
  return value;
}

// ---------- Справочники ----------

export const REF_TABLES = {
  ref_lithology: 'Породы',
  ref_alteration: 'Изменения',
  ref_intensity: 'Интенсивность',
  ref_mineral: 'Минералы',
  ref_vein_type: 'Прожилки',
  ref_structure: 'Структуры',
  ref_texture: 'Текстуры',
  ref_element: 'Элементы',
  ref_unit: 'Единицы'
};

export function refList(table, { activeOnly = true } = {}) {
  return cached(`ref:${table}:${activeOnly}`, () =>
    store.all(table)
      .filter(r => !activeOnly || r.is_active !== false)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || naturalCompare(a.name, b.name)));
}

export function refMap(table) {
  return cached(`refmap:${table}`, () => new Map(store.all(table, { withDeleted: true }).map(r => [r.id, r])));
}

export function ref(table, id) { return id ? refMap(table).get(id) || null : null; }

export function refByCode(table, code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  return store.all(table).find(r => String(r.code).toUpperCase() === c) || null;
}

export function unitFactor(code) {
  return store.get('ref_unit', code)?.factor_to_ppm ?? null;
}

export function element(code) { return store.get('ref_element', code); }

export function elements() { return refList('ref_element'); }

export const OXIDATION = [
  ['fresh', 'Первичная'], ['transitional', 'Переходная'], ['oxidized', 'Окисленная']
];
export const MINERAL_STYLES = [
  ['disseminated', 'вкрапл.'], ['veinlet', 'прожилки'], ['massive', 'массивн.'], ['nest', 'гнёзда'], ['fracture', 'по трещ.']
];
export const HOLE_TYPES = ['DD', 'RC', 'RAB', 'AC', 'TRENCH', 'OTHER'];
export const HOLE_STATUS = [
  ['planned', 'Проектная'], ['drilling', 'Бурится'], ['completed', 'Завершена'], ['abandoned', 'Ликвидирована']
];
export const SAMPLE_TYPES = [
  ['core', 'Керновая'], ['field_duplicate', 'Полевой дубликат'], ['lab_duplicate', 'Лаб. дубликат'],
  ['standard', 'Стандарт'], ['blank', 'Бланк']
];
export const PHOTO_TYPES = [['wet', 'Мокрый'], ['dry', 'Сухой'], ['detail', 'Деталь'], ['uv', 'УФ'], ['other', 'Другое']];

export const label = (pairs, key) => pairs.find(p => p[0] === key)?.[1] ?? key ?? '';

// ---------- Проекты и скважины ----------

export function projects() {
  return cached('projects', () => store.all('projects').sort((a, b) => naturalCompare(a.code, b.code)));
}

export function holesOf(projectId) {
  return cached(`holes:${projectId}`, () =>
    store.all('holes').filter(h => h.project_id === projectId).sort((a, b) => naturalCompare(a.hole_number, b.hole_number)));
}

export function holeDepth(hole) {
  if (!hole) return null;
  if (hole.final_depth) return hole.final_depth;
  if (hole.planned_depth) return hole.planned_depth;
  const ints = intervalsOf(hole.id), smp = samplesOf(hole.id);
  const m = Math.max(0, ...ints.map(i => i.to_depth), ...smp.map(s => s.to_depth));
  return m || null;
}

export function surveyOf(holeId, { validOnly = false } = {}) {
  return cached(`survey:${holeId}:${validOnly}`, () =>
    store.all('survey').filter(s => s.hole_id === holeId && (!validOnly || s.is_valid !== false))
      .sort((a, b) => a.depth - b.depth));
}

// ---------- Интервалы описания ----------

export function intervalsOf(holeId) {
  return cached(`int:${holeId}`, () =>
    store.all('intervals').filter(i => i.hole_id === holeId).sort((a, b) => a.from_depth - b.from_depth));
}

export function loggedMetres(holeId) {
  return intervalsOf(holeId).reduce((s, i) => s + (i.to_depth - i.from_depth), 0);
}

// Перекрывающиеся интервалы той же скважины (кроме exceptId)
export function overlapping(list, from, to, exceptId) {
  return list.filter(i => i.id !== exceptId && i.from_depth < to && i.to_depth > from);
}

export function intervalSummary(iv) {
  const parts = [];
  for (const a of iv.alterations || []) {
    const alt = ref('ref_alteration', a.alteration_id);
    const it = ref('ref_intensity', a.intensity_id);
    if (alt) parts.push(alt.name + (it ? ' ' + it.name.toLowerCase() : ''));
  }
  const mins = (iv.minerals || []).map(m => {
    const mi = ref('ref_mineral', m.mineral_id);
    return mi ? mi.code + (m.content_pct != null ? ' ' + fmt(m.content_pct) + '%' : '') : null;
  }).filter(Boolean);
  if (mins.length) parts.push(mins.join(', '));
  for (const v of iv.veins || []) {
    const vt = ref('ref_vein_type', v.vein_type_id);
    if (vt) parts.push(vt.name.toLowerCase() + ' прожилки' + (v.per_m != null ? ' ' + fmt(v.per_m) + '/м' : ''));
  }
  return parts.join('; ');
}

// ---------- Пробы ----------

export function samplesOf(holeId) {
  return cached(`smp:${holeId}`, () =>
    store.all('samples').filter(s => s.hole_id === holeId && s.sample_type === 'core')
      .sort((a, b) => a.from_depth - b.from_depth));
}

export function projectSamples(projectId) {
  return cached(`psmp:${projectId}`, () => store.all('samples').filter(s => s.project_id === projectId));
}

export function qcSamples(projectId) {
  return projectSamples(projectId).filter(s => s.sample_type !== 'core')
    .sort((a, b) => naturalCompare(a.sample_number, b.sample_number));
}

// Индекс номеров проб проекта (без учёта регистра)
export function sampleIndex(projectId) {
  return cached(`sidx:${projectId}`, () => {
    const m = new Map();
    for (const s of projectSamples(projectId)) m.set(String(s.sample_number).trim().toUpperCase(), s);
    return m;
  });
}

// Следующий номер пробы: KOSM26DD-014-013 после KOSM26DD-014-012
export function nextSampleNumber(hole) {
  const prefix = `${hole.hole_number}-`;
  let max = 0, width = 3;
  for (const s of projectSamples(hole.project_id)) {
    const n = String(s.sample_number);
    if (!n.toUpperCase().startsWith(prefix.toUpperCase())) continue;
    const tail = n.slice(prefix.length);
    if (/^\d+$/.test(tail)) { max = Math.max(max, Number(tail)); width = Math.max(width, tail.length); }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

// ---------- Анализы ----------

// Действующий анализ по пробе и элементу: последний принятый (по дате анализа, затем по загрузке)
export function assayIndex() {
  return cached('assayIndex', () => {
    const bySample = new Map();
    for (const a of store.all('assays')) {
      if (a.status === 'rejected') continue;
      let m = bySample.get(a.sample_id);
      if (!m) { m = new Map(); bySample.set(a.sample_id, m); }
      const cur = m.get(a.element_code);
      if (!cur || newer(a, cur)) m.set(a.element_code, a);
    }
    return bySample;
  });
}

function newer(a, b) {
  const da = a.analysis_date || '', db = b.analysis_date || '';
  if (da !== db) return da > db;
  return (a.created_at || '') > (b.created_at || '');
}

// Значение в ppm для расчётов: ниже предела обнаружения → половина предела
export function assayPpm(a) {
  if (!a) return null;
  const f = unitFactor(a.unit);
  if (f == null) return null;
  const v = a.below_detection ? (a.detection_limit ?? 0) / 2 : a.value;
  return v == null ? null : v * f;
}

// Содержание элемента в пробе в нужных единицах (по умолчанию — единица элемента)
export function grade(sampleId, elementCode, unit) {
  const a = assayIndex().get(sampleId)?.get(elementCode);
  if (!a) return null;
  const ppm = assayPpm(a);
  const u = unit || element(elementCode)?.default_unit;
  const f = unitFactor(u);
  return ppm == null || !f ? null : ppm / f;
}

export function sampleAssays(sampleId) {
  const m = assayIndex().get(sampleId);
  if (!m) return [];
  return elements().filter(e => m.has(e.code)).map(e => {
    const a = m.get(e.code);
    const v = grade(sampleId, e.code);
    return {
      code: e.code, name: e.name, unit: e.default_unit, value: v, bdl: !!a.below_detection,
      text: a.below_detection ? `<${fmtGrade(convert(a.detection_limit, a.unit, e.default_unit))}` : fmtGrade(v),
      lab: a.laboratory, batch: a.batch_number, date: a.analysis_date, assay: a
    };
  });
}

export function convert(value, fromUnit, toUnit) {
  const f1 = unitFactor(fromUnit), f2 = unitFactor(toUnit);
  if (value == null || !f1 || !f2) return null;
  return value * f1 / f2;
}

export function unitLabel(code) {
  return code === 'g/t' ? 'г/т' : code === 'kg/t' ? 'кг/т' : code;
}

// Элементы, по которым есть анализы в скважинах
export function elementsWithData(holeIds) {
  const ids = new Set(holeIds);
  const idx = assayIndex();
  const found = new Set();
  for (const s of store.all('samples')) {
    if (!ids.has(s.hole_id)) continue;
    const m = idx.get(s.id);
    if (m) for (const k of m.keys()) found.add(k);
  }
  return elements().filter(e => found.has(e.code));
}

// ---------- Фото ----------

export function photosOf(holeId) {
  return cached(`ph:${holeId}`, () =>
    store.all('photos').filter(p => p.hole_id === holeId)
      .sort((a, b) => (a.from_depth ?? 1e9) - (b.from_depth ?? 1e9) || (a.taken_at || '').localeCompare(b.taken_at || '')));
}

export function photosForRange(holeId, from, to) {
  return photosOf(holeId).filter(p => p.from_depth != null && p.to_depth != null && p.from_depth < to && p.to_depth > from);
}
