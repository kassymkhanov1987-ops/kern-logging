// Импорт лабораторных анализов (п.47–48).
// Файл → строка заголовков → сопоставление колонок → проверка → загрузка → итог.

import * as store from './store.js';
import * as M from './model.js';
import { num, nowIso, uuid } from './util.js';

const norm = s => String(s ?? '').trim().toUpperCase().replace(/[\s._]+/g, '_');

const ALIASES = {
  hole: ['HOLE_ID', 'HOLEID', 'HOLE', 'BHID', 'HOLE_NO', 'HOLE_NUMBER', 'DHID', 'СКВАЖИНА', 'СКВ', '№_СКВ', '№СКВ', 'НОМЕР_СКВАЖИНЫ', 'СКВ_№'],
  sample: ['SAMPLE_ID', 'SAMPLEID', 'SAMPLE', 'SAMPLE_NO', 'SAMPLE_NUMBER', 'SAMP_ID', 'SAMPLE_NAME', 'CLIENT_ID', 'ПРОБА', '№_ПРОБЫ', '№ПРОБЫ', 'НОМЕР_ПРОБЫ', 'ШИФР_ПРОБЫ', 'ШИФР', 'ПРОБА_№'],
  from: ['FROM', 'FROM_M', 'DEPTH_FROM', 'MFROM', 'ОТ', 'ОТ_М', 'ИНТЕРВАЛ_ОТ', 'ГЛУБИНА_ОТ', 'С'],
  to: ['TO', 'TO_M', 'DEPTH_TO', 'MTO', 'ДО', 'ДО_М', 'ИНТЕРВАЛ_ДО', 'ГЛУБИНА_ДО', 'ПО']
};

function unitFromText(rest) {
  const u = String(rest || '').toUpperCase();
  if (/PPB/.test(u)) return 'ppb';
  if (/PPM/.test(u)) return 'ppm';
  if (/KG\/T|КГ\/Т/.test(u)) return 'kg/t';
  if (/G\/T|GPT|Г\/Т/.test(u)) return 'g/t';
  if (/PCT|%/.test(u)) return '%';
  return null;
}

// Колонка элемента: 'Au', 'AU_PPM', 'Au (g/t)', 'Cu %', 'Au-AA23'
export function detectElement(header) {
  const m = /^\s*([A-Za-z]{1,2})(?:(?:[\s_\-(\[,]+|(?=%))(.*))?$/.exec(String(header ?? ''));
  if (!m) return null;
  const el = M.elements().find(e => e.code.toUpperCase() === m[1].toUpperCase());
  if (!el) return null;
  const unit = unitFromText(m[2]);
  return { element: el.code, unit: unit || el.default_unit, unitGuessed: !unit };
}

export function suggestMapping(headers) {
  const used = new Set();
  const map = headers.map(() => ({ role: 'skip' }));
  for (const role of ['sample', 'hole', 'from', 'to']) {
    const i = headers.findIndex((h, k) => !used.has(k) && ALIASES[role].includes(norm(h)));
    if (i >= 0) { map[i] = { role }; used.add(i); }
  }
  headers.forEach((h, i) => {
    if (used.has(i)) return;
    const d = detectElement(h);
    if (d) map[i] = { role: 'element', ...d };
  });
  return map;
}

// Строка заголовков: первая, где найден Sample_ID и хотя бы один элемент
export function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    const hasSample = r.some(c => ALIASES.sample.includes(norm(c)));
    const hasEl = r.some(c => detectElement(c));
    if (hasSample && hasEl) return i;
  }
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if ((rows[i] || []).filter(c => detectElement(c)).length >= 2) return i;
  }
  return 0;
}

// Значение из лаборатории: '1,25' | '<0.01' | '>100' | '-0.005' (= ниже предела) | '' | 'н/а'
export function parseValue(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { empty: true };
    return raw < 0 ? { bdl: true, dl: Math.abs(raw) } : { value: raw };
  }
  const t = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.').toUpperCase();
  if (['', '-', '--', 'NA', 'N/A', 'Н/А', 'ND', 'NS', 'IS', 'LNR', 'NULL', 'NAN', 'X'].includes(t)) return { empty: true };
  let m;
  if ((m = /^<(\d*\.?\d+)$/.exec(t))) return { bdl: true, dl: Number(m[1]) };
  if ((m = /^>(\d*\.?\d+)$/.exec(t))) return { value: Number(m[1]), above: true };
  if (/^-?\d*\.?\d+(E[-+]?\d+)?$/.test(t)) {
    const v = Number(t);
    return v < 0 ? { bdl: true, dl: Math.abs(v) } : { value: v };
  }
  return { invalid: true };
}

export const STATUS = {
  linked: 'Связано',
  sample_not_found: 'Не найден Sample_ID',
  hole_not_found: 'Скважина не найдена',
  hole_mismatch: 'Проба из другой скважины',
  interval_mismatch: 'Интервал не совпадает',
  duplicate: 'Дубликат',
  empty: 'Нет значений',
  error: 'Ошибка в значениях'
};

// Проверка без записи. rows — строки данных (после заголовка).
export function validate(projectId, dataRows, mapping, meta) {
  const col = role => mapping.findIndex(m => m.role === role);
  const cSample = col('sample'), cHole = col('hole'), cFrom = col('from'), cTo = col('to');
  if (cSample < 0) throw new Error('Укажите колонку с номером пробы (Sample_ID)');
  const elCols = mapping.map((m, i) => ({ ...m, i })).filter(m => m.role === 'element');
  if (!elCols.length) throw new Error('Не выбрано ни одной колонки с результатами анализов');
  const dupEl = elCols.map(c => c.element).filter((e, i, a) => a.indexOf(e) !== i);
  if (dupEl.length) throw new Error(`Элемент ${dupEl[0]} выбран для нескольких колонок`);

  const sidx = M.sampleIndex(projectId);
  const holes = new Map(M.holesOf(projectId).map(h => [h.hole_number.trim().toUpperCase(), h]));
  const existing = existingKeys(meta);
  const seen = new Map();
  const out = [];

  dataRows.forEach((r, k) => {
    const rowNo = k + 1 + (meta.headerRow ?? 0) + 1;      // номер строки в файле
    const sn = String(r[cSample] ?? '').trim();
    if (!sn) return;                                     // пустые строки пропускаем
    const res = { rowNo, sampleNumber: sn, status: null, message: '', values: [] };
    out.push(res);
    const key = sn.toUpperCase();
    if (seen.has(key)) {
      res.status = 'duplicate'; res.message = `Sample_ID повторяется в файле (впервые — строка ${seen.get(key)})`;
      return;
    }
    seen.set(key, rowNo);
    const hn = cHole >= 0 ? String(r[cHole] ?? '').trim() : '';
    const hole = hn ? holes.get(hn.toUpperCase()) : null;
    if (hn && !hole) { res.status = 'hole_not_found'; res.message = `Скважина ${hn} не найдена в проекте`; return; }
    const s = sidx.get(key);
    if (!s) { res.status = 'sample_not_found'; res.message = `Проба ${sn} не найдена`; return; }
    res.sample = s;
    if (hole && s.hole_id !== hole.id) {
      const real = store.get('holes', s.hole_id)?.hole_number || '—';
      res.status = 'hole_mismatch'; res.message = `Проба числится в скважине ${real}, в файле — ${hn}`;
      return;
    }
    const f = cFrom >= 0 ? num(r[cFrom]) : null, t = cTo >= 0 ? num(r[cTo]) : null;
    if (s.from_depth != null && ((f != null && Math.abs(f - s.from_depth) > 0.01) || (t != null && Math.abs(t - s.to_depth) > 0.01))) {
      res.status = 'interval_mismatch';
      res.message = `В файле ${f ?? '?'}–${t ?? '?'} м, в базе ${s.from_depth}–${s.to_depth} м`;
      return;
    }
    const bad = [];
    for (const c of elCols) {
      const raw = r[c.i];
      const pv = parseValue(raw);
      if (pv.invalid) { bad.push(`${c.element} = «${raw}»`); continue; }
      if (pv.empty) continue;
      res.values.push({ element: c.element, unit: c.unit, raw: String(raw), ...pv });
    }
    if (bad.length) { res.status = 'error'; res.message = 'Нечисловые значения: ' + bad.join(', '); res.values = []; return; }
    if (!res.values.length) { res.status = 'empty'; res.message = 'В строке нет результатов'; return; }
    const fresh = res.values.filter(v => !existing.has(assayKey(s.id, v.element, meta)));
    if (!fresh.length) { res.status = 'duplicate'; res.message = 'Эти результаты уже загружены (та же лаборатория, метод и партия)'; res.values = []; return; }
    if (fresh.length < res.values.length) res.message = `${res.values.length - fresh.length} значений уже были загружены`;
    res.values = fresh;
    res.status = 'linked';
  });

  const summary = { rows_total: out.length };
  for (const k of Object.keys(STATUS)) summary[k] = out.filter(r => r.status === k).length;
  summary.values = out.reduce((s, r) => s + (r.status === 'linked' ? r.values.length : 0), 0);
  return { rows: out, summary };
}

const assayKey = (sampleId, el, meta) =>
  [sampleId, el, (meta.laboratory || '').trim().toUpperCase(), (meta.method || '').trim().toUpperCase(), (meta.batch_number || '').trim().toUpperCase()].join('|');

function existingKeys(meta) {
  const s = new Set();
  for (const a of store.all('assays')) s.add(assayKey(a.sample_id, a.element_code, { laboratory: a.laboratory, method: a.method, batch_number: a.batch_number }));
  return s;
}

// Запись проверенных строк со статусом «Связано»
export async function commit(projectId, fileName, result, mapping, meta) {
  const importId = uuid();
  const ops = [];
  const now = nowIso();
  for (const r of result.rows) {
    if (r.status !== 'linked') continue;
    for (const v of r.values) {
      ops.push({ table: 'assays', row: {
        id: uuid(), sample_id: r.sample.id, element_code: v.element,
        value: v.bdl ? null : v.value, value_text: v.raw, unit: v.unit,
        detection_limit: v.bdl ? v.dl : null, below_detection: !!v.bdl, above_limit: !!v.above,
        laboratory: meta.laboratory || null, method: meta.method || null, batch_number: meta.batch_number || null,
        analysis_date: meta.analysis_date || null, import_id: importId, status: 'accepted'
      } });
    }
  }
  ops.push({ table: 'imports', row: {
    id: importId, project_id: projectId, file_name: fileName, imported_at: now,
    laboratory: meta.laboratory || null, method: meta.method || null, batch_number: meta.batch_number || null,
    analysis_date: meta.analysis_date || null,
    mapping: mapping.map(m => ({ ...m })), summary: result.summary,
    problems: result.rows.filter(r => r.status !== 'linked').map(r => ({ row: r.rowNo, sample: r.sampleNumber, status: r.status, message: r.message }))
  } });
  await store.batch(ops);
  return importId;
}

// Отмена загрузки: удалить все анализы этого импорта
export async function undoImport(importId) {
  const ops = store.all('assays', { withDeleted: true })
    .filter(a => a.import_id === importId).map(a => ({ table: 'assays', id: a.id, delete: true }));
  const imp = store.get('imports', importId);
  if (imp) ops.push({ table: 'imports', row: { ...imp, deleted_at: nowIso() } });
  await store.batch(ops);
  return ops.length - (imp ? 1 : 0);
}
