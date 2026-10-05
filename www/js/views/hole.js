// Экран скважины (вкладки) и паспорт скважины.

import * as store from '../store.js';
import * as M from '../model.js';
import * as G from '../geo.js';
import { h, icon, fmt, fmtDepth, num, toast, confirmDialog, modal, nowIso, plural } from '../util.js';
import { field, textInput, numInput, textArea, select, dateInput, chipGroup, tabs, fab, actionBar, emptyState, banner, stat, table, checkbox } from '../components.js';
import { samplesTab } from './samples.js';
import { columnTab } from './striplog.js';
import { photosTab } from './photos.js';

const TABS = [['log', 'Описание'], ['samples', 'Пробы'], ['column', 'Колонка'], ['photos', 'Фото'], ['survey', 'Инклинометрия'], ['passport', 'Паспорт']];

export function holeView(ctx, hid) {
  const hole = store.get('holes', hid);
  if (!hole) throw new Error('Скважина не найдена');
  const project = store.get('projects', hole.project_id);
  const tab = TABS.some(t => t[0] === ctx.query.t) ? ctx.query.t : 'log';
  const depth = M.holeDepth(hole);
  ctx.setTop({ title: hole.hole_number, sub: `${project?.code ?? ''}${depth ? ` · ${fmt(depth, 1)} м` : ''}`, back: `p/${hole.project_id}` });
  const root = h('div');
  root.append(tabs(TABS, tab, t => ctx.go(`h/${hid}?t=${t}`, { replace: true })));
  if (tab === 'log') root.append(logTab(ctx, hole));
  else if (tab === 'samples') root.append(samplesTab(ctx, hole));
  else if (tab === 'column') root.append(columnTab(ctx, hole));
  else if (tab === 'photos') root.append(photosTab(ctx, hole));
  else if (tab === 'survey') root.append(surveyTab(ctx, hole));
  else root.append(passportTab(ctx, hole));
  return root;
}

// ---------- Описание: список интервалов ----------

function logTab(ctx, hole) {
  const ints = M.intervalsOf(hole.id);
  const depth = M.holeDepth(hole);
  const logged = M.loggedMetres(hole.id);
  const last = ints[ints.length - 1];
  const root = h('div');
  const newInterval = (from, to) => ctx.go(`h/${hole.id}/i/new?from=${from ?? ''}${to != null ? `&to=${to}` : ''}`);

  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('b', null, `Описано ${fmt(logged, 2)} м`), depth ? h('span', { class: 'muted' }, ` из ${fmt(depth, 2)} м`) : null),
      h('span', { class: 'badge' }, `${ints.length} ${plural(ints.length, 'интервал', 'интервала', 'интервалов')}`)),
    depth ? h('div', { class: 'progress mt' }, h('div', { style: { width: Math.min(100, logged / depth * 100) + '%' } })) : null));

  if (!ints.length) {
    root.append(emptyState('Описания пока нет', 'Начните с первого интервала от устья.',
      h('button', { class: 'btn primary', onclick: () => newInterval(0) }, icon('plus'), 'Описать интервал от 0 м')));
  } else {
    const list = h('div', { class: 'list' });
    let prevTo = 0;
    for (const iv of ints) {
      if (iv.from_depth - prevTo > 0.005) {
        const a = prevTo, b = iv.from_depth;
        list.append(h('div', { class: 'gap-item', onclick: () => newInterval(a, b) }, icon('warn', 18),
          h('span', { class: 'grow' }, `Пропуск ${fmtDepth(a)}–${fmtDepth(b)} м`), h('b', null, 'Описать')));
      }
      const lith = M.ref('ref_lithology', iv.lithology_id);
      const summary = M.intervalSummary(iv);
      list.append(h('button', { class: 'item', onclick: () => ctx.go(`h/${hole.id}/i/${iv.id}`) },
        h('div', { class: 'bar', style: { background: lith?.display_color || 'var(--line-strong)', width: '14px' } }),
        h('div', { class: 'body' },
          h('div', { class: 'main' },
            h('span', { class: 'depth nowrap' }, `${fmtDepth(iv.from_depth)}–${fmtDepth(iv.to_depth)}`),
            h('span', { class: 'grow' }, lith?.name || h('span', { class: 'warn-text' }, 'порода не указана'))),
          summary || iv.comment ? h('div', { class: 'meta' }, [summary, iv.comment].filter(Boolean).join(' · ')) : null),
        h('div', { class: 'side small' }, `${fmt(iv.to_depth - iv.from_depth, 2)} м`)));
      prevTo = Math.max(prevTo, iv.to_depth);
    }
    root.append(list);
    if (depth && last && last.to_depth < depth - 0.005) {
      root.append(h('button', { class: 'btn block mt', onclick: () => newInterval(last.to_depth) }, icon('plus'), `Следующий интервал от ${fmtDepth(last.to_depth)} м`));
    }
  }
  root.append(fab('plus', 'Новый интервал', () => newInterval(last ? last.to_depth : 0)));
  return root;
}

// ---------- Инклинометрия ----------

function surveyTab(ctx, hole) {
  const root = h('div');
  const rows = M.surveyOf(hole.id);
  if (hole.collar_azimuth != null && hole.collar_dip != null && !rows.some(r => r.depth === 0)) {
    root.append(banner('info', `На устье: азимут ${fmt(hole.collar_azimuth, 1)}°, угол ${fmt(hole.collar_dip, 1)}° (из паспорта скважины)`));
  }
  if (rows.length) {
    root.append(table(['Глубина, м', 'Азимут, °', 'Угол, °', 'Тип', 'Учитывать'],
      rows.map(r => [fmtDepth(r.depth), fmt(r.azimuth, 2), fmt(r.dip, 2), r.survey_type || '', r.is_valid === false ? 'нет' : 'да']),
      { numeric: [0, 1, 2], onRow: i => editSurvey(ctx, hole, rows[i]) }));
  } else {
    root.append(emptyState('Замеров нет', 'Траектория считается по азимуту и углу устья.'));
  }
  // Итог траектории
  if (G.hasCollar(hole)) {
    const depth = M.holeDepth(hole);
    if (depth) {
      const [top, bottom] = G.xyzAt(hole, [0, depth]);
      const horiz = Math.hypot(bottom.x - top.x, bottom.y - top.y);
      root.append(h('div', { class: 'section-title' }, 'Забой по расчёту'),
        h('div', { class: 'stats' },
          stat(fmt(bottom.x, 2), 'Восток'), stat(fmt(bottom.y, 2), 'Север'), stat(fmt(bottom.z, 2), 'Отметка'),
          stat(fmt(horiz, 1) + ' м', 'Отход от устья'), stat(fmt(top.z - bottom.z, 1) + ' м', 'По вертикали')),
        h('p', { class: 'hint' }, 'Метод минимальной кривизны по устью и замерам инклинометрии.'));
    }
  } else {
    root.append(banner('warn', 'Нет координат устья — траекторию и разрез не построить. Заполните паспорт скважины.'));
  }
  root.append(fab('plus', 'Новый замер', () => editSurvey(ctx, hole, null)));
  return root;
}

function editSurvey(ctx, hole, row) {
  const last = M.surveyOf(hole.id).slice(-1)[0];
  const d = row ? { ...row } : { hole_id: hole.id, depth: null, azimuth: last?.azimuth ?? hole.collar_azimuth ?? null, dip: last?.dip ?? hole.collar_dip ?? null, survey_type: last?.survey_type || '', is_valid: true };
  const err = h('div', { class: 'error-text' });
  const content = h('div', { class: 'form' },
    h('div', { class: 'grid3' },
      field('Глубина, м', numInput(d.depth, v => { d.depth = v; })),
      field('Азимут, °', numInput(d.azimuth, v => { d.azimuth = v; })),
      field('Угол, °', numInput(d.dip, v => { d.dip = v; }), '− вниз')),
    field('Тип замера', textInput(d.survey_type, v => { d.survey_type = v; }, { placeholder: 'гироскоп, Reflex, мультишот…' })),
    field('Дата', dateInput(d.survey_date, v => { d.survey_date = v; })),
    checkbox('Учитывать в расчёте траектории', d.is_valid !== false, v => { d.is_valid = v; }),
    err);
  const actions = [];
  if (row) actions.push({ label: 'Удалить', kind: 'danger', onClick: async () => { await store.softDelete('survey', row.id); ctx.refresh(); } });
  actions.push({ label: 'Сохранить', kind: 'primary', onClick: async () => {
    if (d.depth == null || d.depth < 0 || d.azimuth == null || d.dip == null) { err.textContent = 'Заполните глубину, азимут и угол'; return false; }
    if (d.azimuth < 0 || d.azimuth >= 360) { err.textContent = 'Азимут — от 0 до 360°'; return false; }
    if (d.dip < -90 || d.dip > 90) { err.textContent = 'Угол — от −90 до 90°'; return false; }
    if (M.surveyOf(hole.id).some(s => s.id !== d.id && s.depth === d.depth)) { err.textContent = 'Замер на этой глубине уже есть'; return false; }
    await store.put('survey', d);
    ctx.refresh();
  } });
  modal({ title: row ? 'Замер инклинометрии' : 'Новый замер', content, actions });
}

// ---------- Паспорт ----------

function passportTab(ctx, hole) {
  const project = store.get('projects', hole.project_id);
  const kv = (k, v) => [h('div', { class: 'k' }, k), h('div', null, v ?? '—')];
  const has = v => v != null && v !== '';
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'kv' },
        kv('Номер', hole.hole_number),
        kv('Тип', hole.hole_type),
        kv('Статус', M.label(M.HOLE_STATUS, hole.status)),
        kv('Восток', has(hole.easting) ? fmt(hole.easting, 3) : null),
        kv('Север', has(hole.northing) ? fmt(hole.northing, 3) : null),
        kv('Отметка', has(hole.elevation) ? fmt(hole.elevation, 3) : null),
        kv('Система координат', hole.coordinate_system || project?.coordinate_system),
        has(hole.latitude) ? kv('Широта / долгота', `${fmt(hole.latitude, 6)}, ${fmt(hole.longitude, 6)}`) : null,
        kv('Азимут / угол', has(hole.collar_azimuth) ? `${fmt(hole.collar_azimuth, 1)}° / ${fmt(hole.collar_dip, 1)}°` : null),
        kv('Глубина проектная', has(hole.planned_depth) ? `${fmt(hole.planned_depth, 2)} м` : null),
        kv('Глубина фактическая', has(hole.final_depth) ? `${fmt(hole.final_depth, 2)} м` : null),
        kv('Бурение', [hole.start_date, hole.end_date].filter(Boolean).map(d => new Date(d).toLocaleDateString('ru-RU')).join(' — ') || null),
        kv('Станок', hole.rig),
        kv('Подрядчик', hole.contractor),
        kv('Комментарий', hole.comment))),
    h('button', { class: 'btn primary block', onclick: () => ctx.go(`h/${hole.id}/edit`) }, icon('edit'), 'Изменить паспорт'));
}

export function holeForm(ctx, hid, pid) {
  const existing = hid ? store.get('holes', hid) : null;
  if (hid && !existing) throw new Error('Скважина не найдена');
  const projectId = existing?.project_id ?? pid;
  const project = store.get('projects', projectId);
  if (!project) throw new Error('Проект не найден');
  const d = existing ? { ...existing } : {
    project_id: projectId, hole_number: '', hole_type: 'DD', status: 'drilling', coordinate_system: project.coordinate_system || '',
    collar_dip: -60
  };
  let dirty = false;
  const touch = () => { dirty = true; };
  ctx.setDirty(() => dirty);
  ctx.setTop({ title: existing ? `Паспорт ${existing.hole_number}` : 'Новая скважина', sub: project.code, back: existing ? `h/${hid}?t=passport` : `p/${projectId}` });
  const err = h('div', { class: 'error-text' });
  const dipWarn = h('div', { class: 'warn-text' });
  const checkDip = () => { dipWarn.textContent = d.collar_dip > 0 ? 'Угол положительный — скважина восходящая. Для наклонной вниз обычно отрицательный (−60).' : ''; };
  checkDip();
  const n = (key, label, hint) => field(label, numInput(d[key], v => { d[key] = v; touch(); if (key === 'collar_dip') checkDip(); }), hint);
  const latInput = numInput(d.latitude, v => { d.latitude = v; touch(); });
  const lonInput = numInput(d.longitude, v => { d.longitude = v; touch(); });

  const gps = () => {
    if (!navigator.geolocation) { toast('GPS недоступен в этом браузере', 'warn'); return; }
    toast('Определяю координаты…');
    navigator.geolocation.getCurrentPosition(pos => {
      d.latitude = Number(pos.coords.latitude.toFixed(7));
      d.longitude = Number(pos.coords.longitude.toFixed(7));
      latInput.value = d.latitude; lonInput.value = d.longitude; touch();
      toast(`Точность ±${Math.round(pos.coords.accuracy)} м`, 'ok');
    }, e => toast('Не удалось получить координаты: ' + e.message, 'error'), { enableHighAccuracy: true, timeout: 30000 });
  };

  const save = async () => {
    const number = (d.hole_number || '').trim();
    if (!number) { err.textContent = 'Укажите номер скважины'; return; }
    if (M.holesOf(projectId).some(x => x.id !== d.id && x.hole_number.trim().toUpperCase() === number.toUpperCase())) {
      err.textContent = `Скважина ${number} уже есть в проекте`; return;
    }
    if (d.collar_azimuth != null && (d.collar_azimuth < 0 || d.collar_azimuth >= 360)) { err.textContent = 'Азимут — от 0 до 360°'; return; }
    if (d.collar_dip != null && (d.collar_dip < -90 || d.collar_dip > 90)) { err.textContent = 'Угол — от −90 до 90°'; return; }
    if ((d.final_depth != null && d.final_depth <= 0) || (d.planned_depth != null && d.planned_depth <= 0)) { err.textContent = 'Глубина должна быть больше нуля'; return; }
    if (existing && d.final_depth) {
      const deeper = M.intervalsOf(hid).filter(i => i.to_depth > d.final_depth + 1e-6).length + M.samplesOf(hid).filter(s => s.to_depth > d.final_depth + 1e-6).length;
      if (deeper && !await confirmDialog(`${deeper} интервалов и проб окажутся глубже забоя ${fmt(d.final_depth, 2)} м. Сохранить?`)) return;
    }
    const rec = await store.put('holes', { ...d, hole_number: number });
    dirty = false;
    toast('Скважина сохранена', 'ok');
    ctx.go(existing ? `h/${rec.id}?t=passport` : `h/${rec.id}`, { replace: true });
  };

  const del = async () => {
    const ni = M.intervalsOf(hid).length, ns = M.samplesOf(hid).length;
    if (!await confirmDialog(`Удалить скважину ${existing.hole_number}?${ni || ns ? `\nВместе с ней скроются ${ni} интервалов описания и ${ns} проб.` : ''}`, { okLabel: 'Удалить', danger: true })) return;
    const now = nowIso();
    const ops = [{ table: 'holes', row: { ...existing, deleted_at: now } }];
    for (const i of M.intervalsOf(hid)) ops.push({ table: 'intervals', row: { ...i, deleted_at: now } });
    for (const s of store.all('samples').filter(s => s.hole_id === hid)) ops.push({ table: 'samples', row: { ...s, deleted_at: now } });
    for (const s of M.surveyOf(hid)) ops.push({ table: 'survey', row: { ...s, deleted_at: now } });
    for (const p of M.photosOf(hid)) ops.push({ table: 'photos', row: { ...p, deleted_at: now } });
    await store.batch(ops);
    dirty = false;
    toast('Скважина удалена');
    ctx.go(`p/${projectId}`, { replace: true });
  };

  return h('div', { class: 'form' },
    h('div', { class: 'card form' },
      field('Номер скважины', textInput(d.hole_number, v => { d.hole_number = v; touch(); }, { placeholder: 'KOSM26DD-014', autocapitalize: 'characters', class: 'big' })),
      field('Тип', chipGroup(M.HOLE_TYPES.map(t => ({ id: t, name: t })), d.hole_type, v => { d.hole_type = v || 'DD'; touch(); }, { allowClear: false, showCode: false, small: true })),
      field('Статус', chipGroup(M.HOLE_STATUS.map(([id, name]) => ({ id, name })), d.status, v => { d.status = v || 'drilling'; touch(); }, { allowClear: false, showCode: false, small: true }))),
    h('div', { class: 'card form' },
      h('h3', null, 'Устье'),
      h('div', { class: 'grid3' }, n('easting', 'Восток (Y)'), n('northing', 'Север (X)'), n('elevation', 'Отметка (Z)')),
      h('p', { class: 'hint', style: { margin: 0 } }, 'В отечественной системе: Север = X, Восток = Y. Не перепутайте при вводе.'),
      field('Система координат', textInput(d.coordinate_system, v => { d.coordinate_system = v; touch(); })),
      h('div', { class: 'grid2' }, n('collar_azimuth', 'Азимут, °'), n('collar_dip', 'Угол, °', 'Отрицательный — вниз: −60')),
      dipWarn,
      h('div', { class: 'grid2' }, field('Широта', latInput), field('Долгота', lonInput)),
      h('button', { class: 'btn small', type: 'button', onclick: gps }, 'Взять координаты с GPS телефона')),
    h('div', { class: 'card form' },
      h('h3', null, 'Бурение'),
      h('div', { class: 'grid2' }, n('planned_depth', 'Глубина проектная, м'), n('final_depth', 'Глубина фактическая, м')),
      h('div', { class: 'grid2' },
        field('Начало', dateInput(d.start_date, v => { d.start_date = v; touch(); })),
        field('Окончание', dateInput(d.end_date, v => { d.end_date = v; touch(); }))),
      h('div', { class: 'grid2' },
        field('Станок', textInput(d.rig, v => { d.rig = v; touch(); })),
        field('Подрядчик', textInput(d.contractor, v => { d.contractor = v; touch(); }))),
      field('Комментарий', textArea(d.comment, v => { d.comment = v; touch(); }))),
    err,
    existing ? h('button', { class: 'btn danger block', onclick: del }, icon('trash'), 'Удалить скважину') : null,
    actionBar(h('button', { class: 'btn primary', onclick: save }, icon('save'), 'Сохранить')));
}
