// Выгрузка проекта в Excel / CSV и контроль качества данных.

import * as store from '../store.js';
import * as M from '../model.js';
import { dataIssues } from '../calc.js';
import { exportExcel, exportCsvZip } from '../exporter.js';
import { h, icon, toast, saveFile, shareFile, fileStamp, safeFileName, plural } from '../util.js';
import { stat, emptyState, banner } from '../components.js';

export function exportView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Выгрузка', sub: project.code, back: `p/${pid}` });
  const holes = M.holesOf(pid);
  const ints = holes.reduce((s, x) => s + M.intervalsOf(x.id).length, 0);
  const smp = holes.reduce((s, x) => s + M.samplesOf(x.id).length, 0);
  const idx = M.assayIndex();
  const assays = M.projectSamples(pid).reduce((s, x) => s + (idx.get(x.id)?.size || 0), 0);
  const base = `${safeFileName(project.code)}_${fileStamp()}`;

  const run = async (kind, how) => {
    try {
      toast('Готовлю файл…');
      const blob = kind === 'xlsx' ? await exportExcel(pid) : await exportCsvZip(pid);
      const name = kind === 'xlsx' ? `${base}.xlsx` : `${base}_csv.zip`;
      if (how === 'share' && await shareFile(blob, name)) return;
      await saveFile(blob, name);
      toast(`Файл ${name} сохранён в «Загрузки»`, 'ok', 4000);
    } catch (e) {
      console.error(e);
      toast('Не удалось сформировать файл: ' + e.message, 'error', 6000);
    }
  };
  const canShare = !!navigator.canShare;
  const buttons = kind => h('div', { class: 'btn-row mt' },
    h('button', { class: 'btn primary', onclick: () => run(kind, 'save') }, icon('download'), 'Сохранить'),
    canShare ? h('button', { class: 'btn', onclick: () => run(kind, 'share') }, icon('share'), 'Отправить') : null);

  return h('div', null,
    h('div', { class: 'stats mb' },
      stat(holes.length, plural(holes.length, 'скважина', 'скважины', 'скважин')),
      stat(ints, 'интервалов описания'), stat(smp, 'проб'), stat(assays, 'значений анализов')),
    h('div', { class: 'card' }, h('h3', null, 'Excel (.xlsx)'),
      h('div', null, 'Все данные проекта на отдельных листах: скважины, инклинометрия, литология, изменения, минерализация, прожилки, пробы, анализы (подробно и сводной таблицей), список фото. Заголовки на русском.'),
      buttons('xlsx')),
    h('div', { class: 'card' }, h('h3', null, 'CSV для программ моделирования'),
      h('div', null, 'Архив с отдельными CSV-файлами (collars, survey, lithology, assays…) с латинскими заголовками HOLEID / FROM / TO — для Micromine, Leapfrog, Surpac и др. Кодировка UTF-8, разделитель — запятая.'),
      buttons('csv')),
    h('div', { class: 'card' }, h('h3', null, 'Резервная копия'),
      h('div', null, 'Полная копия всех проектов с фотографиями — в Настройках.'),
      h('button', { class: 'btn mt', onclick: () => ctx.go('settings') }, icon('settings'), 'Перейти в настройки')));
}

export function issuesView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Контроль данных', sub: project.code, back: `p/${pid}` });
  const issues = dataIssues(pid);
  const root = h('div');
  if (!issues.length) { root.append(banner('ok', 'Замечаний нет.')); return root; }
  const n = s => issues.filter(i => i.severity === s).length;
  root.append(h('div', { class: 'stats mb' },
    stat(n('error'), 'ошибок', n('error') ? 'danger' : ''), stat(n('warning'), 'предупреждений', n('warning') ? 'warn' : ''), stat(n('info'), 'к сведению')));
  const open = it => {
    const t = it.target || {};
    if (t.interval) ctx.go(`h/${it.hole.id}/i/${t.interval}`);
    else if (t.sample) ctx.go(`h/${it.hole.id}/s/${t.sample}`);
    else ctx.go(`h/${it.hole.id}?t=${t.tab || 'log'}`);
  };
  root.append(h('div', { class: 'card', style: { padding: 0 } }, issues.map(it => h('div', { class: 'issue', onclick: () => open(it) },
    h('span', { class: `dot ${it.severity}` }),
    h('div', { class: 'grow' }, h('b', null, it.hole.hole_number), ' — ', it.text)))));
  return root;
}
