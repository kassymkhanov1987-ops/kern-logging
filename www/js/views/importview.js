// Импорт лабораторных анализов из Excel/CSV (п.48) и история загрузок.

import * as store from '../store.js';
import * as M from '../model.js';
import * as I from '../importer.js';
import { readTableFile } from '../sheets.js';
import { h, clear, icon, fmt, toast, confirmDialog, modal, pickFile, todayIso, plural } from '../util.js';
import { field, textInput, select, dateInput, stat, table, banner, emptyState, actionBar } from '../components.js';

export function importView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Импорт анализов', sub: project.code, back: `p/${pid}` });

  const st = {
    file: null, sheets: [], sheet: 0, headerRow: 0, mapping: [], result: null,
    meta: {
      laboratory: store.setting('last_lab', ''), method: store.setting('last_method', ''),
      batch_number: '', analysis_date: todayIso()
    }
  };
  const root = h('div', { class: 'form' });
  const fileCard = h('div', { class: 'card form' });
  const mapCard = h('div', { class: 'card form hidden' });
  const metaCard = h('div', { class: 'card form hidden' });
  const resultCard = h('div', { class: 'hidden' });
  const bar = actionBar();
  bar.classList.add('hidden');
  root.append(
    h('p', { class: 'hint', style: { margin: 0 } }, 'Файл лаборатории Excel (.xlsx) или CSV. Анализы привязываются к пробам по номеру (Sample_ID). Перед загрузкой приложение проверит скважины, номера проб, интервалы и дубли.'),
    fileCard, mapCard, metaCard, resultCard, bar);

  const rows = () => st.sheets[st.sheet]?.rows || [];
  const headers = () => (rows()[st.headerRow] || []).map(v => String(v ?? '').trim());
  const dataRows = () => rows().slice(st.headerRow + 1);
  const invalidate = () => { st.result = null; resultCard.classList.add('hidden'); drawBar(); };

  const drawFile = () => {
    clear(fileCard);
    fileCard.append(h('h3', null, '1. Файл'));
    fileCard.append(h('button', { class: 'btn primary', onclick: chooseFile }, icon('upload'), st.file ? 'Выбрать другой файл' : 'Выбрать файл'));
    if (!st.file) return;
    fileCard.append(h('div', null, h('b', null, st.file.name), h('span', { class: 'muted' }, ` · ${rows().length} строк`)));
    if (st.sheets.length > 1) {
      fileCard.append(field('Лист', select(st.sheets.map((s, i) => [i, s.name]), st.sheet, v => {
        st.sheet = Number(v); st.headerRow = I.detectHeaderRow(rows()); st.mapping = I.suggestMapping(headers()); invalidate(); drawFile(); drawMap();
      })));
    }
    const opts = rows().slice(0, 30).map((r, i) => [i, `Строка ${i + 1}: ${(r || []).filter(c => c !== '').slice(0, 4).join(' | ').slice(0, 60)}`]);
    fileCard.append(field('Строка заголовков', select(opts, st.headerRow, v => {
      st.headerRow = Number(v); st.mapping = I.suggestMapping(headers()); invalidate(); drawMap();
    }), 'Определяется автоматически; поменяйте, если в начале файла шапка лаборатории'));
  };

  const roleOptions = [['skip', '— не загружать —'], ['sample', 'Номер пробы (Sample_ID)'], ['hole', 'Скважина'], ['from', 'От, м'], ['to', 'До, м'],
    ...M.elements().map(e => [`el:${e.code}`, `${e.code} — ${e.name}`])];
  const unitOptions = () => M.refList('ref_unit', { activeOnly: false }).map(u => [u.code, M.unitLabel(u.code)]);

  const drawMap = () => {
    clear(mapCard);
    mapCard.classList.toggle('hidden', !st.file);
    if (!st.file) return;
    mapCard.append(h('h3', null, '2. Сопоставление колонок'));
    const hs = headers();
    const sampleVals = i => dataRows().filter(r => r && r[i] !== '' && r[i] != null).slice(0, 2).map(r => r[i]).join(', ');
    const list = h('div', { class: 'list' });
    hs.forEach((name, i) => {
      if (!name && !sampleVals(i)) return;
      const m = st.mapping[i] || { role: 'skip' };
      const value = m.role === 'element' ? `el:${m.element}` : m.role;
      const unitBox = h('div');
      const drawUnit = () => {
        clear(unitBox);
        const mm = st.mapping[i];
        if (mm?.role !== 'element') return;
        unitBox.append(h('div', { class: 'row' },
          h('div', { style: { width: '120px' } }, select(unitOptions(), mm.unit, v => { mm.unit = v; mm.unitGuessed = false; invalidate(); drawUnit(); })),
          mm.unitGuessed ? h('span', { class: 'badge warn' }, 'единица не указана в файле — проверьте') : null));
      };
      list.append(h('div', { class: 'subrow' },
        h('div', { class: 'subrow-head' }, h('span', { class: 'grow' }, name || `Колонка ${i + 1}`), h('span', { class: 'muted small' }, sampleVals(i))),
        select(roleOptions, value, v => {
          if (v.startsWith('el:')) {
            const code = v.slice(3);
            const d = I.detectElement(name);
            st.mapping[i] = { role: 'element', element: code, unit: d?.element === code ? d.unit : M.element(code).default_unit, unitGuessed: !(d?.element === code && !d.unitGuessed) };
          } else st.mapping[i] = { role: v };
          invalidate(); drawUnit();
        }),
        unitBox));
      drawUnit();
    });
    mapCard.append(list);
    mapCard.append(h('p', { class: 'hint', style: { margin: 0 } }, 'Нет нужного элемента в списке? Добавьте его: Настройки → Справочники → Элементы.'));
    metaCard.classList.remove('hidden');
  };

  const drawMeta = () => {
    clear(metaCard);
    metaCard.append(h('h3', null, '3. Лаборатория'),
      h('div', { class: 'grid2' },
        field('Лаборатория', textInput(st.meta.laboratory, v => { st.meta.laboratory = v; invalidate(); })),
        field('Метод анализа', textInput(st.meta.method, v => { st.meta.method = v; invalidate(); }, { placeholder: 'FA-AAS, ICP-OES…' }))),
      h('div', { class: 'grid2' },
        field('Номер партии', textInput(st.meta.batch_number, v => { st.meta.batch_number = v; invalidate(); })),
        field('Дата анализа', dateInput(st.meta.analysis_date, v => { st.meta.analysis_date = v; invalidate(); }))),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Лаборатория, метод и партия отличают повторный анализ от дубля: тот же файл второй раз не загрузится.'));
  };

  const drawResult = () => {
    clear(resultCard);
    const r = st.result;
    if (!r) { resultCard.classList.add('hidden'); return; }
    resultCard.classList.remove('hidden');
    const s = r.summary;
    const box = h('div', { class: 'card' }, h('h3', null, '4. Итог проверки'),
      h('div', { class: 'stats' },
        stat(s.rows_total, 'Загружено строк'),
        stat(s.linked, 'Связано', s.linked ? 'ok' : ''),
        stat(s.sample_not_found, 'Не найден Sample_ID', s.sample_not_found ? 'danger' : ''),
        stat(s.duplicate, 'Дубликатов', s.duplicate ? 'warn' : ''),
        s.hole_not_found ? stat(s.hole_not_found, 'Скважина не найдена', 'danger') : null,
        s.hole_mismatch ? stat(s.hole_mismatch, 'Проба из другой скважины', 'danger') : null,
        s.interval_mismatch ? stat(s.interval_mismatch, 'Интервал не совпадает', 'warn') : null,
        s.error ? stat(s.error, 'Ошибки в значениях', 'danger') : null,
        s.empty ? stat(s.empty, 'Без значений') : null),
      h('p', { class: 'hint' }, `К загрузке: ${s.values} ${plural(s.values, 'значение', 'значения', 'значений')} по ${s.linked} ${plural(s.linked, 'пробе', 'пробам', 'пробам')}. Строки с проблемами не загружаются.`));
    const problems = r.rows.filter(x => x.status !== 'linked');
    if (problems.length) {
      const shown = problems.slice(0, 200);
      box.append(table(['Строка', 'Sample_ID', 'Проблема', 'Подробно'],
        shown.map(p => [p.rowNo, p.sampleNumber, I.STATUS[p.status], p.message]), { numeric: [0] }));
      if (problems.length > shown.length) box.append(h('p', { class: 'hint' }, `Показаны первые ${shown.length} из ${problems.length}.`));
    }
    resultCard.append(box);
  };

  const drawBar = () => {
    clear(bar);
    bar.classList.toggle('hidden', !st.file);
    if (!st.file) return;
    if (!st.result) bar.append(h('button', { class: 'btn primary', onclick: check }, icon('check'), 'Проверить'));
    else bar.append(
      h('button', { class: 'btn', onclick: () => { invalidate(); window.scrollTo(0, 0); } }, 'Изменить'),
      h('button', { class: 'btn primary', disabled: !st.result.summary.linked, onclick: doImport }, icon('upload'), `Загрузить ${st.result.summary.values}`));
  };

  async function chooseFile() {
    const f = await pickFile('.xlsx,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv');
    if (!f) return;
    try {
      st.sheets = await readTableFile(f);
    } catch (e) { toast(e.message, 'error', 6000); return; }
    if (!st.sheets.length || !st.sheets.some(s => s.rows.length)) { toast('В файле нет данных', 'error'); return; }
    st.file = f;
    st.sheet = Math.max(0, st.sheets.findIndex(s => s.rows.length > 1));
    st.headerRow = I.detectHeaderRow(rows());
    st.mapping = I.suggestMapping(headers());
    if (!st.meta.batch_number) st.meta.batch_number = f.name.replace(/\.[^.]+$/, '');
    invalidate(); drawFile(); drawMap(); drawMeta(); drawBar();
  }

  function check() {
    try {
      st.result = I.validate(pid, dataRows(), st.mapping, { ...st.meta, headerRow: st.headerRow });
    } catch (e) { toast(e.message, 'error', 5000); return; }
    drawResult(); drawBar();
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function doImport() {
    const s = st.result.summary;
    if (s.rows_total - s.linked > 0 && !await confirmDialog(`${s.rows_total - s.linked} строк с проблемами не будут загружены. Загрузить остальные ${s.linked}?`, { okLabel: 'Загрузить' })) return;
    await I.commit(pid, st.file.name, st.result, st.mapping, st.meta);
    store.setSetting('last_lab', st.meta.laboratory);
    store.setSetting('last_method', st.meta.method);
    clear(root);
    root.append(
      banner('ok', `Загружено ${s.values} ${plural(s.values, 'значение', 'значения', 'значений')} по ${s.linked} ${plural(s.linked, 'пробе', 'пробам', 'пробам')}.`),
      h('div', { class: 'card' }, h('h3', null, 'Итог импорта'),
        h('div', { class: 'stats' },
          stat(s.rows_total, 'Загружено'), stat(s.linked, 'Связано', 'ok'),
          stat(s.sample_not_found, 'Не найден Sample_ID', s.sample_not_found ? 'danger' : ''),
          stat(s.duplicate, 'Дубликатов', s.duplicate ? 'warn' : ''))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => ctx.go(`p/${pid}`, { replace: true }) }, 'К проекту'),
        h('button', { class: 'btn', onclick: () => ctx.go(`p/${pid}/analysis`, { replace: true }) }, 'Фильтры и рудные интервалы')));
    toast('Анализы загружены', 'ok');
  }

  drawFile(); drawMeta(); drawBar();
  return root;
}

export function importsHistoryView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Загрузки анализов', sub: project.code, back: `p/${pid}` });
  const imports = store.all('imports').filter(i => i.project_id === pid).sort((a, b) => (b.imported_at || '').localeCompare(a.imported_at || ''));
  const root = h('div');
  if (!imports.length) {
    root.append(emptyState('Загрузок пока не было', null, h('button', { class: 'btn primary', onclick: () => ctx.go(`p/${pid}/import`) }, icon('upload'), 'Импорт анализов')));
    return root;
  }
  root.append(h('div', { class: 'list' }, imports.map(imp => {
    const s = imp.summary || {};
    return h('button', { class: 'item', onclick: () => details(imp) },
      h('div', { class: 'bar', style: { background: 'var(--primary)' } }),
      h('div', { class: 'body' },
        h('div', { class: 'main' }, h('span', { class: 'grow' }, imp.file_name), h('span', { class: 'small muted nowrap' }, new Date(imp.imported_at).toLocaleDateString('ru-RU'))),
        h('div', { class: 'meta' }, [imp.laboratory, imp.batch_number, `связано ${s.linked ?? 0} из ${s.rows_total ?? 0}`, s.sample_not_found ? `не найдено ${s.sample_not_found}` : null].filter(Boolean).join(' · '))));
  })));

  function details(imp) {
    const s = imp.summary || {};
    const probs = imp.problems || [];
    const n = store.all('assays').filter(a => a.import_id === imp.id).length;
    modal({
      title: imp.file_name,
      wide: true,
      content: h('div', null,
        h('p', { class: 'muted', style: { marginTop: 0 } }, [imp.laboratory, imp.method, imp.batch_number, imp.analysis_date ? new Date(imp.analysis_date).toLocaleDateString('ru-RU') : null].filter(Boolean).join(' · ')),
        h('div', { class: 'stats' }, stat(s.rows_total ?? 0, 'Строк'), stat(s.linked ?? 0, 'Связано', 'ok'), stat(s.sample_not_found ?? 0, 'Не найден Sample_ID'), stat(s.duplicate ?? 0, 'Дубликатов'), stat(n, 'Значений в базе')),
        probs.length ? h('div', { class: 'mt' }, table(['Строка', 'Sample_ID', 'Проблема', 'Подробно'], probs.slice(0, 300).map(p => [p.row, p.sample, I.STATUS[p.status], p.message]), { numeric: [0] })) : null),
      actions: [{ label: 'Отменить загрузку', kind: 'danger', onClick: async () => {
        if (!await confirmDialog(`Удалить ${n} значений анализов, загруженных из файла ${imp.file_name}?`, { okLabel: 'Удалить', danger: true })) return false;
        const k = await I.undoImport(imp.id);
        toast(`Удалено ${k} значений`, 'ok');
        ctx.refresh();
      } }]
    });
  }
  return root;
}
