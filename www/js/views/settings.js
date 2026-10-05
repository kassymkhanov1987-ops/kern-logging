// Настройки: геолог, резервная копия и восстановление, хранилище, справочники, пример.

import * as store from '../store.js';
import * as M from '../model.js';
import { backup, readBackup, restore, APP_VERSION } from '../exporter.js';
import { loadDemo } from '../demo.js';
import { h, clear, icon, fmt, fmtBytes, toast, confirmDialog, modal, pickFile, saveFile, shareFile, fileStamp, nowIso, uuid } from '../util.js';
import { field, textInput, numInput, select, checkbox, fab, banner, stat } from '../components.js';

export function settingsView(ctx) {
  ctx.setTop({ title: 'Настройки', back: '' });
  const root = h('div');

  root.append(h('div', { class: 'card form' }, h('h3', null, 'Геолог'),
    field('ФИО (подставляется в описание интервалов)', textInput(store.setting('geologist', ''), v => store.setSetting('geologist', v.trim()), { autocapitalize: 'words' }))));

  // Резервная копия
  const last = store.setting('last_backup_at');
  const progress = h('div', { class: 'hint' });
  const doBackup = async how => {
    try {
      progress.textContent = 'Собираю данные…';
      const blob = await backup((k, n) => { progress.textContent = `Фото ${k} из ${n}…`; });
      const name = `kern_backup_${fileStamp()}.zip`;
      progress.textContent = `Размер копии: ${fmtBytes(blob.size)}`;
      if (!(how === 'share' && await shareFile(blob, name))) await saveFile(blob, name);
      await store.setSetting('last_backup_at', nowIso());
      toast('Резервная копия создана', 'ok');
      ctx.refresh();
    } catch (e) {
      progress.textContent = '';
      toast('Не удалось создать копию: ' + e.message, 'error', 6000);
    }
  };
  const doRestore = async () => {
    const f = await pickFile('.zip,application/zip');
    if (!f) return;
    let parsed;
    try { parsed = await readBackup(f); } catch (e) { toast(e.message, 'error', 6000); return; }
    const c = parsed.counts;
    const ok = await confirmDialog(
      `В копии от ${new Date(parsed.data.created_at).toLocaleString('ru-RU')}:\n` +
      `проектов ${c.projects}, скважин ${c.holes}, интервалов ${c.intervals}, проб ${c.samples}, анализов ${c.assays}, фото ${c.photos}.\n\n` +
      'Все текущие данные на телефоне будут ЗАМЕНЕНЫ данными из копии. Продолжить?', { okLabel: 'Заменить', danger: true, title: 'Восстановление' });
    if (!ok) return;
    await restore(parsed);
    toast('Данные восстановлены', 'ok');
    ctx.go('', { replace: true });
  };
  root.append(h('div', { class: 'card' }, h('h3', null, 'Резервная копия'),
    h('div', null, 'Данные хранятся только на этом телефоне. Делайте копию регулярно и храните её вне телефона (компьютер, облако, почта).'),
    h('p', { class: 'muted small' }, last ? `Последняя копия: ${new Date(last).toLocaleString('ru-RU')}` : 'Копия ещё не делалась'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => doBackup('save') }, icon('save'), 'Создать копию'),
      navigator.canShare ? h('button', { class: 'btn', onclick: () => doBackup('share') }, icon('share'), 'Отправить копию') : null,
      h('button', { class: 'btn', onclick: doRestore }, icon('upload'), 'Восстановить')),
    progress));

  // Хранилище
  const storageBox = h('div', { class: 'hint' }, 'Проверяю…');
  root.append(h('div', { class: 'card' }, h('h3', null, 'Память'), storageBox));
  store.storageInfo().then(info => {
    clear(storageBox);
    const offline = !!navigator.serviceWorker?.controller || !!globalThis.Capacitor?.isNativePlatform?.();
    storageBox.append(
      h('div', { class: `badge ${offline ? 'ok' : 'warn'}`, style: { marginBottom: '8px', whiteSpace: 'normal', padding: '4px 10px' } },
        offline ? 'Приложение сохранено на телефоне и работает без интернета' : 'Офлайн-режим ещё не готов — откройте приложение с интернетом и подождите несколько секунд'),
      h('div', null, info.usage != null ? `Занято: ${fmtBytes(info.usage)}${info.quota ? ` из доступных ${fmtBytes(info.quota)}` : ''}` : 'Объём неизвестен'),
      info.persisted ? h('div', { class: 'badge ok mt' }, 'Браузер не удалит данные при нехватке места')
        : h('div', null,
          h('div', { class: 'warn-text mt' }, 'Браузер может очистить данные при нехватке места. Установите приложение на главный экран (меню Chrome → «Установить приложение») и нажмите кнопку ниже.'),
          h('button', { class: 'btn small mt', onclick: async () => { const r = await store.requestPersistence(); toast(r ? 'Готово' : 'Браузер отказал — установите приложение на главный экран', r ? 'ok' : 'warn', 5000); ctx.refresh(); } }, 'Защитить данные')));
  });

  // Справочники
  root.append(h('div', { class: 'card' }, h('h3', null, 'Справочники'),
    h('div', { class: 'list' }, Object.entries(M.REF_TABLES).map(([t, name]) =>
      h('button', { class: 'item', style: { minHeight: '50px' }, onclick: () => ctx.go('dict/' + t) },
        h('div', { class: 'body' }, h('div', { class: 'main' }, h('span', { class: 'grow' }, name), h('span', { class: 'badge' }, store.all(t).length))),
        h('div', { class: 'side' }, icon('next')))))));

  root.append(h('div', { class: 'card form' }, h('h3', null, 'Фото и пробы'),
    field('Размер фото по длинной стороне, пикс.', select([[1600, '1600 — экономно'], [2400, '2400 — стандарт'], [3200, '3200 — подробно']], store.setting('photo_max_side', 2400), v => store.setSetting('photo_max_side', Number(v)))),
    field('Длина пробы по умолчанию при нарезке, м', numInput(store.setting('sample_length', 1), v => { if (v > 0) store.setSetting('sample_length', v); }))));

  root.append(h('div', { class: 'card' }, h('h3', null, 'Пример данных'),
    h('div', null, 'Проект DEMO со скважинами KOSM26DD-014 и KOSM26DD-015 из примеров ТЗ: описание, пробы, анализы, инклинометрия.'),
    h('button', { class: 'btn mt', onclick: async () => { const pid = await loadDemo(); toast('Пример загружен', 'ok'); ctx.go('p/' + pid); } }, 'Загрузить пример')));

  root.append(h('p', { class: 'hint', style: { textAlign: 'center' } }, `Описание керна · версия ${APP_VERSION} · работает без интернета`));
  return root;
}

const DICT_FIELDS = {
  ref_lithology: ['color', 'pattern', 'group'],
  ref_alteration: ['color'],
  ref_intensity: ['rank'],
  ref_mineral: ['formula', 'ore'],
  ref_element: ['unit', 'color'],
  ref_vein_type: [], ref_structure: [], ref_texture: []
};
const PATTERN_OPTS = [['solid', 'сплошная'], ['crosses', 'крестики (интрузивные)'], ['v', 'галочки (вулканические)'], ['dots', 'точки'], ['dashes', 'штрихи'], ['bricks', 'кирпичи (карбонаты)'], ['waves', 'волны (сланцы)'], ['triangles', 'треугольники (брекчии)']];

export function dictView(ctx, table) {
  const title = M.REF_TABLES[table];
  if (!title) throw new Error('Справочник не найден');
  ctx.setTop({ title, back: 'settings' });
  const items = M.refList(table, { activeOnly: false });
  const root = h('div');
  if (table === 'ref_unit') {
    root.append(banner('info', 'Единицы и коэффициенты пересчёта фиксированы: г/т = ppm, % = 10 000 ppm, ppb = 0,001 ppm.'));
    root.append(h('div', { class: 'list' }, items.map(u => h('div', { class: 'item', style: { cursor: 'default' } },
      h('div', { class: 'body' }, h('div', { class: 'main' }, h('span', { class: 'grow' }, u.name), h('span', { class: 'muted small' }, `× ${u.factor_to_ppm} ppm`)))))));
    return root;
  }
  root.append(h('p', { class: 'hint' }, 'Записи, которые уже использовались, не удаляются — их можно скрыть из списков выбора.'));
  root.append(h('div', { class: 'list' }, items.map(it => h('button', { class: 'item', style: { minHeight: '52px', opacity: it.is_active === false ? 0.55 : 1 }, onclick: () => edit(it) },
    h('div', { class: 'bar', style: { background: it.display_color || 'transparent' } }),
    h('div', { class: 'body' }, h('div', { class: 'main' }, h('span', { class: 'grow' }, it.name), h('span', { class: 'muted small' }, it.code),
      it.is_active === false ? h('span', { class: 'badge' }, 'скрыт') : null),
      table === 'ref_element' ? h('div', { class: 'meta' }, `по умолчанию в ${M.unitLabel(it.default_unit)}`) : null)))));
  root.append(fab('plus', 'Добавить', () => edit(null)));

  function edit(it) {
    const isEl = table === 'ref_element';
    const d = it ? { ...it } : { code: '', name: '', is_active: true, sort_order: (items[items.length - 1]?.sort_order ?? 0) + 10,
      display_color: '#9AA5B1', pattern: table === 'ref_lithology' ? 'solid' : undefined, default_unit: isEl ? 'ppm' : undefined, rank: table === 'ref_intensity' ? items.length + 1 : undefined };
    const f = DICT_FIELDS[table] || [];
    const err = h('div', { class: 'error-text' });
    const colorIn = h('input', { type: 'color', class: 'input', value: d.display_color || '#9AA5B1', style: { padding: '4px', height: '48px' } });
    colorIn.addEventListener('input', () => { d.display_color = colorIn.value.toUpperCase(); });
    const codeIn = textInput(d.code, v => { d.code = v.trim(); }, { autocapitalize: 'off' });
    if (isEl && it) codeIn.disabled = true;
    const content = h('div', { class: 'form' },
      h('div', { class: 'grid2' }, field(isEl ? 'Символ' : 'Код', codeIn), field('Название', textInput(d.name, v => { d.name = v; }, { autocapitalize: 'sentences' }))),
      f.includes('color') ? field('Цвет', colorIn) : null,
      f.includes('pattern') ? field('Штриховка на колонке', select(PATTERN_OPTS, d.pattern || 'solid', v => { d.pattern = v; })) : null,
      f.includes('group') ? field('Группа пород', textInput(d.rock_group, v => { d.rock_group = v; })) : null,
      f.includes('formula') ? field('Формула', textInput(d.formula, v => { d.formula = v; })) : null,
      f.includes('ore') ? checkbox('Рудный минерал', d.is_ore !== false, v => { d.is_ore = v; }) : null,
      f.includes('rank') ? field('Ранг (1 — слабая)', numInput(d.rank, v => { d.rank = v; })) : null,
      f.includes('unit') ? field('Единица по умолчанию', select(M.refList('ref_unit', { activeOnly: false }).map(u => [u.code, M.unitLabel(u.code)]), d.default_unit, v => { d.default_unit = v; })) : null,
      field('Порядок в списке', numInput(d.sort_order, v => { d.sort_order = v; })),
      checkbox('Показывать в списках выбора', d.is_active !== false, v => { d.is_active = v; }),
      err);
    modal({
      title: it ? it.name : 'Новая запись',
      content,
      actions: [{ label: 'Сохранить', kind: 'primary', onClick: async () => {
        if (!d.code || !d.name?.trim()) { err.textContent = 'Укажите код и название'; return false; }
        if (isEl && !/^[A-Z][a-z]?$/.test(d.code)) { err.textContent = 'Символ элемента: одна-две латинские буквы, первая заглавная (Au, Te, S)'; return false; }
        const dup = store.all(table).find(x => x.id !== d.id && String(x.code).toUpperCase() === d.code.toUpperCase());
        if (dup) { err.textContent = `Код ${d.code} уже занят (${dup.name})`; return false; }
        const rec = { ...d, name: d.name.trim() };
        if (isEl) rec.id = rec.id || rec.code;
        else rec.id = rec.id || uuid();
        await store.put(table, rec);
        toast('Сохранено', 'ok');
        ctx.refresh();
      } }]
    });
  }
  return root;
}
