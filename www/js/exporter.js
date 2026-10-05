// Выгрузка данных: Excel (для отчётов), CSV (для программ моделирования),
// резервная копия всей базы с фотографиями и восстановление из неё.

import * as store from './store.js';
import * as M from './model.js';
import { writeXlsx, toCsv } from './sheets.js';
import { writeZip, readZip } from './zip.js';
import { round, nowIso } from './util.js';

export const APP_VERSION = '1.0.0';

const r3 = v => (v == null || !Number.isFinite(v) ? null : round(v, 3));
const yes = b => (b ? 'да' : '');

// Таблицы проекта. Каждая: { key, sheet, csv, headers: [ru, en], rows }
export function projectTables(projectId) {
  const project = store.get('projects', projectId);
  const holes = M.holesOf(projectId);
  const holeById = new Map(holes.map(h => [h.id, h]));
  const hn = id => holeById.get(id)?.hole_number ?? '';
  const t = [];

  t.push({
    key: 'collars', sheet: 'Скважины', csv: 'collars.csv',
    headers: [
      ['Скважина', 'HOLEID'], ['Тип', 'TYPE'], ['Статус', 'STATUS'], ['Система координат', 'COORD_SYS'],
      ['Восток', 'EAST'], ['Север', 'NORTH'], ['Отметка', 'RL'], ['Широта', 'LAT'], ['Долгота', 'LON'],
      ['Азимут', 'AZIMUTH'], ['Угол', 'DIP'], ['Глубина проектная', 'DEPTH_PLAN'], ['Глубина фактическая', 'DEPTH'],
      ['Начало', 'START_DATE'], ['Окончание', 'END_DATE'], ['Станок', 'RIG'], ['Подрядчик', 'CONTRACTOR'],
      ['Комментарий', 'COMMENT'], ['ID', 'HOLE_UUID']
    ],
    rows: holes.map(h => [
      h.hole_number, h.hole_type, M.label(M.HOLE_STATUS, h.status), h.coordinate_system || project?.coordinate_system || '',
      h.easting, h.northing, h.elevation, h.latitude, h.longitude, h.collar_azimuth, h.collar_dip,
      h.planned_depth, h.final_depth, h.start_date, h.end_date, h.rig, h.contractor, h.comment, h.id
    ])
  });

  const survey = holes.flatMap(h => M.surveyOf(h.id).map(s => [h.hole_number, s.depth, s.azimuth, s.dip, s.survey_type, s.survey_date, s.is_valid === false ? 'нет' : 'да']));
  t.push({
    key: 'survey', sheet: 'Инклинометрия', csv: 'survey.csv',
    headers: [['Скважина', 'HOLEID'], ['Глубина', 'DEPTH'], ['Азимут', 'AZIMUTH'], ['Угол', 'DIP'], ['Тип замера', 'SURVEY_TYPE'], ['Дата', 'DATE'], ['Учитывать', 'VALID']],
    rows: survey
  });

  const ints = holes.flatMap(h => M.intervalsOf(h.id).map(i => ({ h, i })));
  t.push({
    key: 'lithology', sheet: 'Литология', csv: 'lithology.csv',
    headers: [
      ['Скважина', 'HOLEID'], ['От', 'FROM'], ['До', 'TO'], ['Длина', 'LENGTH'], ['Код породы', 'LITH_CODE'], ['Порода', 'LITHOLOGY'],
      ['Структура', 'STRUCTURE'], ['Текстура', 'TEXTURE'], ['Окисление', 'OXIDATION'], ['Цвет', 'COLOUR'],
      ['Изменения (сводно)', 'ALTERATION_SUMMARY'], ['Минерализация (сводно)', 'MINERALIZATION_SUMMARY'],
      ['Комментарий', 'COMMENT'], ['Геолог', 'LOGGED_BY'], ['Дата описания', 'LOGGED_DATE'], ['ID интервала', 'INTERVAL_UUID']
    ],
    rows: ints.map(({ h, i }) => {
      const l = M.ref('ref_lithology', i.lithology_id);
      return [h.hole_number, i.from_depth, i.to_depth, r3(i.to_depth - i.from_depth), l?.code, l?.name,
        M.ref('ref_structure', i.structure_id)?.name, M.ref('ref_texture', i.texture_id)?.name,
        M.label(M.OXIDATION, i.oxidation), i.color, M.intervalSummary({ alterations: i.alterations }),
        M.intervalSummary({ minerals: i.minerals }), i.comment, i.logged_by, i.logged_at, i.id];
    })
  });

  t.push({
    key: 'alteration', sheet: 'Изменения', csv: 'alteration.csv',
    headers: [['Скважина', 'HOLEID'], ['От', 'FROM'], ['До', 'TO'], ['Код изменения', 'ALT_CODE'], ['Изменение', 'ALTERATION'],
      ['Код интенсивности', 'INTENSITY_CODE'], ['Интенсивность', 'INTENSITY'], ['Ранг', 'INTENSITY_RANK'], ['Характер', 'STYLE'], ['ID интервала', 'INTERVAL_UUID']],
    rows: ints.flatMap(({ h, i }) => (i.alterations || []).map(a => {
      const alt = M.ref('ref_alteration', a.alteration_id), it = M.ref('ref_intensity', a.intensity_id);
      return [h.hole_number, i.from_depth, i.to_depth, alt?.code, alt?.name, it?.code, it?.name, it?.rank, a.style, i.id];
    }))
  });

  t.push({
    key: 'mineralization', sheet: 'Минерализация', csv: 'mineralization.csv',
    headers: [['Скважина', 'HOLEID'], ['От', 'FROM'], ['До', 'TO'], ['Код минерала', 'MINERAL_CODE'], ['Минерал', 'MINERAL'],
      ['Содержание, %', 'CONTENT_PCT'], ['Форма выделений', 'STYLE'], ['ID интервала', 'INTERVAL_UUID']],
    rows: ints.flatMap(({ h, i }) => (i.minerals || []).map(m => {
      const mi = M.ref('ref_mineral', m.mineral_id);
      return [h.hole_number, i.from_depth, i.to_depth, mi?.code, mi?.name, m.content_pct, M.label(M.MINERAL_STYLES, m.style), i.id];
    }))
  });

  t.push({
    key: 'veins', sheet: 'Прожилки', csv: 'veins.csv',
    headers: [['Скважина', 'HOLEID'], ['От', 'FROM'], ['До', 'TO'], ['Код типа', 'VEIN_CODE'], ['Тип прожилков', 'VEIN_TYPE'],
      ['Количество', 'COUNT'], ['На метр', 'PER_M'], ['Объём, %', 'VOLUME_PCT'], ['Мощность, мм', 'THICKNESS_MM'], ['Угол к оси керна', 'ALPHA'], ['ID интервала', 'INTERVAL_UUID']],
    rows: ints.flatMap(({ h, i }) => (i.veins || []).map(v => {
      const vt = M.ref('ref_vein_type', v.vein_type_id);
      return [h.hole_number, i.from_depth, i.to_depth, vt?.code, vt?.name, v.count, v.per_m, v.volume_pct, v.thickness_mm, v.alpha, i.id];
    }))
  });

  const samples = [...holes.flatMap(h => M.samplesOf(h.id)), ...M.qcSamples(projectId)];
  const sampleById = new Map(samples.map(s => [s.id, s]));
  t.push({
    key: 'samples', sheet: 'Пробы', csv: 'samples.csv',
    headers: [['Скважина', 'HOLEID'], ['Проба', 'SAMPLEID'], ['Тип пробы', 'SAMPLE_TYPE'], ['От', 'FROM'], ['До', 'TO'], ['Длина', 'LENGTH'],
      ['Стандарт', 'STANDARD'], ['Исходная проба', 'PARENT_SAMPLE'], ['Масса, кг', 'WEIGHT_KG'], ['Дата отправки', 'DISPATCH_DATE'],
      ['Комментарий', 'COMMENT'], ['ID пробы', 'SAMPLE_UUID']],
    rows: samples.map(s => [hn(s.hole_id), s.sample_number, M.label(M.SAMPLE_TYPES, s.sample_type), s.from_depth, s.to_depth,
      s.from_depth != null ? r3(s.to_depth - s.from_depth) : null, s.standard_code,
      sampleById.get(s.parent_sample_id)?.sample_number ?? '', s.weight_kg, s.dispatch_date, s.comment, s.id])
  });

  const assays = store.all('assays').filter(a => sampleById.has(a.sample_id));
  const best = M.assayIndex();
  t.push({
    key: 'assays_long', sheet: 'Анализы', csv: 'assays_long.csv',
    headers: [['Скважина', 'HOLEID'], ['Проба', 'SAMPLEID'], ['От', 'FROM'], ['До', 'TO'], ['Элемент', 'ELEMENT'],
      ['Значение лаборатории', 'LAB_VALUE'], ['Единица лаборатории', 'LAB_UNIT'], ['Значение', 'VALUE'], ['Единица', 'UNIT'],
      ['Ниже предела', 'BDL'], ['Предел обнаружения', 'DETECTION_LIMIT'], ['Лаборатория', 'LAB'], ['Метод', 'METHOD'],
      ['Партия', 'BATCH'], ['Дата анализа', 'ANALYSIS_DATE'], ['Действующий', 'IS_CURRENT'], ['Статус', 'STATUS']],
    rows: assays.map(a => {
      const s = sampleById.get(a.sample_id);
      const el = M.element(a.element_code);
      const ppm = M.assayPpm(a);
      const f = M.unitFactor(el?.default_unit);
      return [hn(s.hole_id), s.sample_number, s.from_depth, s.to_depth, a.element_code, a.value_text ?? a.value, a.unit,
        ppm != null && f ? Number((ppm / f).toPrecision(6)) : null, el?.default_unit, yes(a.below_detection), a.detection_limit,
        a.laboratory, a.method, a.batch_number, a.analysis_date, best.get(a.sample_id)?.get(a.element_code) === a ? 'да' : 'нет',
        a.status === 'rejected' ? 'отклонён' : 'принят'];
    })
  });

  const els = M.elements().filter(e => assays.some(a => a.element_code === e.code));
  t.push({
    key: 'assays_wide', sheet: 'Анализы сводная', csv: 'assays_wide.csv',
    headers: [['Скважина', 'HOLEID'], ['Проба', 'SAMPLEID'], ['Тип пробы', 'SAMPLE_TYPE'], ['От', 'FROM'], ['До', 'TO'],
      ...els.map(e => [`${e.code}, ${M.unitLabel(e.default_unit)}`, `${e.code}_${e.default_unit.replace('/', 'P').replace('%', 'PCT').toUpperCase()}`])],
    rows: samples.filter(s => best.has(s.id)).map(s => [hn(s.hole_id), s.sample_number, s.sample_type, s.from_depth, s.to_depth,
      ...els.map(e => { const v = M.grade(s.id, e.code); return v == null ? null : Number(v.toPrecision(6)); })])
  });

  t.push({
    key: 'photos', sheet: 'Фото', csv: 'photos.csv',
    headers: [['Скважина', 'HOLEID'], ['Ящик', 'BOX'], ['От', 'FROM'], ['До', 'TO'], ['Тип', 'TYPE'], ['Файл', 'FILE'],
      ['Снято', 'TAKEN_AT'], ['Комментарий', 'COMMENT'], ['ID фото', 'PHOTO_UUID']],
    rows: holes.flatMap(h => M.photosOf(h.id).map(p => [h.hole_number, p.box_number, p.from_depth, p.to_depth,
      M.label(M.PHOTO_TYPES, p.photo_type), `photos/${p.id}.jpg`, p.taken_at, p.comment, p.id]))
  });
  return t;
}

export async function exportExcel(projectId) {
  const project = store.get('projects', projectId);
  const tables = projectTables(projectId);
  const info = [
    ['Параметр', 'Значение'],
    ['Проект', `${project.code} — ${project.name}`],
    ['Выгружено', new Date().toLocaleString('ru-RU')],
    ['Система координат', project.coordinate_system || ''],
    ['Координаты', 'Восток / Север / Отметка. В отечественной системе: Север = X, Восток = Y'],
    ['Ниже предела обнаружения', 'В листе «Анализы сводная» — половина предела; исходное значение — в листе «Анализы»'],
    ['Повторные анализы', 'В сводной — последний принятый результат (по дате анализа)'],
    ['Версия приложения', APP_VERSION]
  ];
  const sheets = [
    ...tables.map(t => ({ name: t.sheet, rows: [t.headers.map(h => h[0]), ...t.rows] })),
    { name: 'О выгрузке', rows: info }
  ];
  return writeXlsx(sheets);
}

export async function exportCsvZip(projectId) {
  const tables = projectTables(projectId);
  const files = tables.map(t => ({ name: t.csv, data: toCsv([t.headers.map(h => h[1]), ...t.rows]) }));
  files.push({ name: 'README.txt', data:
    'Выгрузка приложения описания керна.\r\n' +
    'CSV: кодировка UTF-8, разделитель — запятая, десятичный разделитель — точка.\r\n' +
    'EAST/NORTH/RL — восток/север/отметка (в отечественной системе NORTH = X, EAST = Y).\r\n' +
    'DIP отрицательный — вниз. В assays_wide ниже предела обнаружения записана половина предела.\r\n' });
  return writeZip(files);
}

// ---------- Резервная копия ----------

export async function backup(onProgress) {
  const tables = store.dumpTables();
  const files = [{
    name: 'backup.json',
    data: JSON.stringify({ format: 'kern-logging-backup', version: 1, app_version: APP_VERSION, created_at: nowIso(), tables })
  }];
  const photos = tables.photos || [];
  let k = 0;
  for (const p of photos) {
    const blob = await store.getBlob(p.id);
    if (blob) files.push({ name: `photos/${p.id}.jpg`, data: blob, compress: false });
    onProgress?.(++k, photos.length);
  }
  return writeZip(files);
}

export async function readBackup(file) {
  const zip = readZip(await file.arrayBuffer());
  const entry = zip.get('backup.json');
  if (!entry) throw new Error('В архиве нет backup.json — это не резервная копия приложения');
  const data = JSON.parse(new TextDecoder().decode(await entry.read()));
  if (data.format !== 'kern-logging-backup') throw new Error('Неизвестный формат резервной копии');
  const blobs = [];
  for (const [name, e] of zip) {
    const m = /^photos\/(.+)\.jpg$/.exec(name);
    if (m) blobs.push([m[1], new Blob([await e.read()], { type: 'image/jpeg' })]);
  }
  const counts = {
    projects: (data.tables.projects || []).filter(r => !r.deleted_at).length,
    holes: (data.tables.holes || []).filter(r => !r.deleted_at).length,
    intervals: (data.tables.intervals || []).filter(r => !r.deleted_at).length,
    samples: (data.tables.samples || []).filter(r => !r.deleted_at).length,
    assays: (data.tables.assays || []).filter(r => !r.deleted_at).length,
    photos: blobs.length
  };
  return { data, blobs, counts };
}

export async function restore(parsed) {
  await store.replaceAll(parsed.data.tables, parsed.blobs);
}
