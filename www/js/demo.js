// Пример данных из ТЗ: скважины KOSM26DD-014 и KOSM26DD-015.

import * as store from './store.js';
import * as M from './model.js';
import { uuid, nowIso, todayIso } from './util.js';

export async function loadDemo() {
  const exists = M.projects().find(p => p.code === 'DEMO');
  if (exists) return exists.id;
  const L = code => M.refByCode('ref_lithology', code)?.id ?? null;
  const A = code => M.refByCode('ref_alteration', code)?.id ?? null;
  const I = code => M.refByCode('ref_intensity', code)?.id ?? null;
  const Mi = code => M.refByCode('ref_mineral', code)?.id ?? null;
  const V = code => M.refByCode('ref_vein_type', code)?.id ?? null;
  const T = code => M.refByCode('ref_texture', code)?.id ?? null;
  const S = code => M.refByCode('ref_structure', code)?.id ?? null;
  const ops = [];
  const add = (table, row) => { ops.push({ table, row }); return row; };

  const p = add('projects', { id: uuid(), code: 'DEMO', name: 'Пример из ТЗ', coordinate_system: 'Местная система координат', description: 'Демонстрационные данные: примеры из разделов 47–56 ТЗ.' });
  const h14 = add('holes', { id: uuid(), project_id: p.id, hole_number: 'KOSM26DD-014', hole_type: 'DD', status: 'completed',
    easting: 12500, northing: 34800, elevation: 652.4, collar_azimuth: 125, collar_dip: -60, planned_depth: 325.4, final_depth: 325.4,
    start_date: '2026-08-02', end_date: '2026-08-19', rig: 'Буровой станок №3' });
  const h15 = add('holes', { id: uuid(), project_id: p.id, hole_number: 'KOSM26DD-015', hole_type: 'DD', status: 'completed',
    easting: 12540, northing: 34772, elevation: 650, collar_azimuth: 125, collar_dip: -55, planned_depth: 210, final_depth: 210,
    start_date: '2026-08-20', end_date: '2026-08-30', rig: 'Буровой станок №3' });
  for (const [d, az, dip] of [[0, 125, -60], [50, 126, -59], [100, 128, -58]])
    add('survey', { id: uuid(), hole_id: h14.id, depth: d, azimuth: az, dip, survey_type: 'мультишот', is_valid: true });

  const iv = (hole, from, to, lith, o = {}) => add('intervals', {
    id: uuid(), hole_id: hole.id, from_depth: from, to_depth: to, lithology_id: L(lith),
    texture_id: T(o.tex || 'MAS'), structure_id: S(o.str || null), oxidation: o.ox || 'fresh', color: o.color || null,
    alterations: (o.alt || []).map(([c, i]) => ({ id: uuid(), alteration_id: A(c), intensity_id: I(i) })),
    minerals: (o.min || []).map(([c, pct, style]) => ({ id: uuid(), mineral_id: Mi(c), content_pct: pct, style })),
    veins: (o.veins || []).map(([c, perm, vol, th, alpha]) => ({ id: uuid(), vein_type_id: V(c), per_m: perm, volume_pct: vol, thickness_mm: th, alpha })),
    comment: o.comment || null, logged_by: 'Иванов И.И.', logged_at: '2026-08-21'
  });
  iv(h14, 0, 12.5, 'AND', { ox: 'oxidized', str: 'POR', color: 'зеленовато-серый' });
  iv(h14, 12.5, 28, 'DIO', { str: 'MG', color: 'серый' });
  iv(h14, 28, 45.2, 'GRD', { str: 'MG', color: 'розовато-серый' });
  iv(h14, 45.2, 47.5, 'GRD', { str: 'MG', tex: 'VNL', alt: [['SER', 'W']], min: [['Py', 2, 'disseminated'], ['Cpy', 0.3, 'disseminated']],
    veins: [['QZ', 3, 2, 5, 40]], comment: 'Контакт с кварцевой зоной резкий, 40° к оси керна' });
  iv(h14, 47.5, 50.3, 'QZ', { tex: 'BX', alt: [['SIL', 'S'], ['SER', 'M']], min: [['Py', 3, 'veinlet'], ['Sp', 1, 'nest'], ['Gn', 0.5, 'nest']], comment: 'Брекчированный кварц с сульфидами' });
  iv(h14, 50.3, 325.4, 'GRD', { str: 'MG', alt: [['SER', 'W']], min: [['Py', 0.5, 'disseminated']] });
  iv(h15, 0, 8, 'OVB', { ox: 'oxidized', tex: null });
  iv(h15, 8, 60, 'AND', { str: 'POR' });
  iv(h15, 60, 72, 'GRD', { tex: 'VNL', alt: [['SER', 'S'], ['CHL', 'W']], min: [['Cpy', 1.5, 'veinlet'], ['Py', 1, 'disseminated']],
    veins: [['QZS', 6, 5, 3, 55]], comment: 'Зона прожилково-вкрапленной медной минерализации' });
  iv(h15, 72, 210, 'GRD', { str: 'MG' });

  const smp = {};
  const sample = (hole, n, from, to) => { smp[n] = add('samples', { id: uuid(), project_id: p.id, hole_id: hole.id, sample_number: n, sample_type: 'core', from_depth: from, to_depth: to, weight_kg: 3.2 }); };
  [[41, 43], [43, 45.2], [45.2, 47.5], [47.5, 49], [49, 52.3], [52.3, 53], [53, 54], [54, 56]].forEach(([a, b], i) =>
    sample(h14, `KOSM26DD-014-${String(10 + i).padStart(3, '0')}`, a, b));
  [[60, 62], [62, 64], [64, 66], [66, 68]].forEach(([a, b], i) => sample(h15, `KOSM26DD-015-${String(1 + i).padStart(3, '0')}`, a, b));

  const impId = uuid();
  const lab = { laboratory: 'Лаборатория А', method: 'FA-AAS / ICP-OES', batch_number: 'B-2026-0147', analysis_date: '2026-09-28', import_id: impId, status: 'accepted' };
  const res = {
    'KOSM26DD-014-010': [0.12, 1.1, 0.05, 0.11, 300], 'KOSM26DD-014-011': [0.30, 2.0, 0.08, 0.15, 450],
    'KOSM26DD-014-012': [1.25, 4.6, 0.21, 0.48, 700], 'KOSM26DD-014-013': [2.10, 6.2, 0.35, 0.90, 900],
    'KOSM26DD-014-014': [0.90, 3.1, 0.18, 0.40, 500], 'KOSM26DD-014-015': [0.20, 0.9, 0.04, 0.10, 200],
    'KOSM26DD-014-016': [3.00, 8.0, 0.50, 1.20, 1100], 'KOSM26DD-014-017': ['<0.01', '<0.5', 0.01, 0.03, 150],
    'KOSM26DD-015-001': [0.40, 1.0, 0.02, 0.05, 3500], 'KOSM26DD-015-002': [0.80, 1.5, 0.02, 0.06, 2800],
    'KOSM26DD-015-003': [1.60, 2.2, 0.03, 0.08, 1200], 'KOSM26DD-015-004': [0.20, 0.5, 0.01, 0.02, 500]
  };
  const els = [['Au', 'g/t'], ['Ag', 'g/t'], ['Pb', '%'], ['Zn', '%'], ['Cu', 'ppm']];
  let n = 0;
  for (const [sn, vals] of Object.entries(res)) {
    vals.forEach((v, k) => {
      const bdl = typeof v === 'string';
      add('assays', { id: uuid(), sample_id: smp[sn].id, element_code: els[k][0], unit: els[k][1], value: bdl ? null : v, value_text: String(v),
        below_detection: bdl, detection_limit: bdl ? Number(v.slice(1)) : null, above_limit: false, ...lab });
      n++;
    });
  }
  add('imports', { id: impId, project_id: p.id, file_name: 'Lab_B-2026-0147.xlsx (пример)', imported_at: nowIso(), laboratory: lab.laboratory, method: lab.method,
    batch_number: lab.batch_number, analysis_date: lab.analysis_date, summary: { rows_total: 12, linked: 12, sample_not_found: 0, duplicate: 0, values: n }, problems: [] });
  await store.batch(ops);
  return p.id;
}
