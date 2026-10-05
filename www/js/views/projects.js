// Главный экран (проекты), экран проекта, форма проекта.

import * as store from '../store.js';
import * as M from '../model.js';
import { dataIssues } from '../calc.js';
import { h, icon, fmt, toast, confirmDialog, plural, nowIso } from '../util.js';
import { field, textInput, textArea, fab, actionBar, emptyState, banner } from '../components.js';
import { loadDemo } from '../demo.js';

export function projectsView(ctx) {
  ctx.setTop({ title: 'Описание керна', actions: [{ icon: 'settings', label: 'Настройки', onClick: () => ctx.go('settings') }] });
  const list = M.projects();
  const root = h('div');
  let embedded = true;
  try { embedded = window.self !== window.top; } catch { /* чужой фрейм */ }
  if (embedded) {
    root.append(banner('info', 'Это предпросмотр. Здесь можно посмотреть экраны и пример данных, но сохранение файлов, камера и работа без интернета недоступны, а данные могут не сохраниться. Для работы приложение ставится на телефон с постоянного адреса.'));
  }

  const lastBackup = store.setting('last_backup_at');
  const hasData = store.all('intervals').length + store.all('samples').length > 0;
  if (hasData && (!lastBackup || Date.now() - Date.parse(lastBackup) > 7 * 864e5)) {
    root.append(banner('warn',
      lastBackup ? `Последняя резервная копия — ${new Date(lastBackup).toLocaleDateString('ru-RU')}. Данные хранятся только на этом телефоне.`
        : 'Резервная копия ещё не делалась. Данные хранятся только на этом телефоне.',
      h('button', { class: 'btn small', onclick: () => ctx.go('settings') }, 'Сделать')));
  }

  if (!list.length) {
    root.append(emptyState('Проектов пока нет', 'Создайте проект (месторождение или участок), затем добавьте скважины.',
      h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn primary', onclick: () => ctx.go('p/new') }, icon('plus'), 'Создать проект'),
        h('button', { class: 'btn', onclick: async () => { const pid = await loadDemo(); toast('Загружен пример из ТЗ', 'ok'); ctx.go('p/' + pid); } }, 'Открыть пример'))));
    root.append(h('p', { class: 'hint', style: { textAlign: 'center' } },
      'Есть резервная копия? ', h('a', { href: '#/settings' }, 'Восстановить в настройках')));
    return root;
  }

  root.append(h('div', { class: 'section-title' }, 'Проекты'));
  root.append(h('div', { class: 'list' }, list.map(p => {
    const holes = M.holesOf(p.id);
    const metres = holes.reduce((s, x) => s + M.loggedMetres(x.id), 0);
    return h('button', { class: 'item', onclick: () => ctx.go('p/' + p.id) },
      h('div', { class: 'bar', style: { background: 'var(--primary)' } }),
      h('div', { class: 'body' },
        h('div', { class: 'main' }, h('span', null, p.code), h('span', { class: 'grow muted', style: { fontWeight: 500 } }, p.name)),
        h('div', { class: 'meta' }, `${holes.length} ${plural(holes.length, 'скважина', 'скважины', 'скважин')} · описано ${fmt(metres, 1)} м`)),
      h('div', { class: 'side' }, icon('next')));
  })));
  root.append(fab('plus', 'Новый проект', () => ctx.go('p/new')));
  return root;
}

export function projectView(ctx, pid) {
  const p = store.get('projects', pid);
  if (!p) throw new Error('Проект не найден');
  ctx.setTop({ title: p.code, sub: p.name, back: '', actions: [{ icon: 'edit', label: 'Изменить проект', onClick: () => ctx.go(`p/${pid}/edit`) }] });
  const holes = M.holesOf(pid);
  const issues = dataIssues(pid).filter(i => i.severity !== 'info').length;
  const imports = store.all('imports').filter(i => i.project_id === pid).length;
  const qc = M.qcSamples(pid).length;
  const tool = (ic, label, route, badge) =>
    h('button', { class: 'tool', onclick: () => ctx.go(`p/${pid}/${route}`) }, icon(ic), h('span', null, label),
      badge ? h('span', { class: `badge ${badge.kind || ''}` }, badge.text) : null);

  const root = h('div');
  root.append(h('div', { class: 'tools' },
    tool('upload', 'Импорт анализов', 'import'),
    tool('filter', 'Фильтры и рудные интервалы', 'analysis'),
    tool('compare', 'Сопоставление скважин', 'compare'),
    tool('section', 'Разрез', 'section'),
    tool('download', 'Выгрузка Excel / CSV', 'export'),
    tool('warn', 'Контроль данных', 'issues', issues ? { text: issues, kind: 'warn' } : null),
    tool('layers', 'Контрольные пробы', 'qc', qc ? { text: qc } : null),
    tool('book', 'Загрузки анализов', 'imports', imports ? { text: imports } : null)));

  root.append(h('div', { class: 'section-title' }, `Скважины · ${holes.length}`));
  if (!holes.length) {
    root.append(emptyState('Скважин пока нет', 'Добавьте скважину: номер, координаты устья, азимут и угол.',
      h('button', { class: 'btn primary', onclick: () => ctx.go(`p/${pid}/hole/new`) }, icon('plus'), 'Добавить скважину')));
  } else {
    const idx = M.assayIndex();
    root.append(h('div', { class: 'list' }, holes.map(hole => {
      const depth = hole.final_depth || hole.planned_depth;
      const logged = M.loggedMetres(hole.id);
      const smp = M.samplesOf(hole.id);
      const withAssay = smp.filter(s => idx.has(s.id)).length;
      const pct = depth ? Math.min(100, Math.round(logged / depth * 100)) : null;
      const st = hole.status;
      return h('button', { class: 'item', onclick: () => ctx.go('h/' + hole.id) },
        h('div', { class: 'bar', style: { background: st === 'completed' ? 'var(--ok)' : st === 'drilling' ? 'var(--accent)' : st === 'abandoned' ? 'var(--danger)' : 'var(--line-strong)' } }),
        h('div', { class: 'body' },
          h('div', { class: 'main' }, h('span', { class: 'grow' }, hole.hole_number),
            h('span', { class: 'badge' }, M.label(M.HOLE_STATUS, st))),
          h('div', { class: 'meta' },
            [depth ? `${fmt(depth, 1)} м` : 'глубина не задана',
              `описано ${fmt(logged, 1)} м${pct != null ? ` (${pct}%)` : ''}`,
              `проб ${smp.length}${smp.length ? `, с анализами ${withAssay}` : ''}`].join(' · ')),
          pct != null ? h('div', { class: 'progress', style: { marginTop: '6px' } }, h('div', { style: { width: pct + '%' } })) : null),
        h('div', { class: 'side' }, icon('next')));
    })));
  }
  root.append(fab('plus', 'Новая скважина', () => ctx.go(`p/${pid}/hole/new`)));
  return root;
}

export function projectForm(ctx, pid) {
  const existing = pid ? store.get('projects', pid) : null;
  if (pid && !existing) throw new Error('Проект не найден');
  const d = existing ? { ...existing } : { code: '', name: '', coordinate_system: '', description: '' };
  let dirty = false;
  const touch = () => { dirty = true; };
  ctx.setDirty(() => dirty);
  ctx.setTop({ title: existing ? 'Проект' : 'Новый проект', back: existing ? `p/${pid}` : '' });
  const err = h('div', { class: 'error-text' });

  const save = async () => {
    const code = d.code.trim(), name = d.name.trim();
    if (!code || !name) { err.textContent = 'Укажите код и название проекта'; return; }
    const dup = M.projects().find(p => p.id !== d.id && p.code.trim().toUpperCase() === code.toUpperCase());
    if (dup) { err.textContent = `Проект с кодом ${code} уже есть`; return; }
    const rec = await store.put('projects', { ...d, code, name });
    dirty = false;
    toast('Проект сохранён', 'ok');
    ctx.go(`p/${rec.id}`, { replace: true });
  };
  const del = async () => {
    const holes = M.holesOf(pid).length;
    if (!await confirmDialog(`Удалить проект ${existing.code}${holes ? ` и ${holes} ${plural(holes, 'скважину', 'скважины', 'скважин')}` : ''}?\nДанные останутся в резервных копиях, сделанных раньше.`, { okLabel: 'Удалить', danger: true })) return;
    const now = nowIso();
    const ops = [{ table: 'projects', row: { ...existing, deleted_at: now } }];
    for (const hl of M.holesOf(pid)) ops.push({ table: 'holes', row: { ...hl, deleted_at: now } });
    await store.batch(ops);
    dirty = false;
    toast('Проект удалён');
    ctx.go('', { replace: true });
  };

  return h('div', null,
    h('div', { class: 'card form' },
      field('Код проекта', textInput(d.code, v => { d.code = v; touch(); }, { placeholder: 'KOS', autocapitalize: 'characters' })),
      field('Название', textInput(d.name, v => { d.name = v; touch(); }, { placeholder: 'Коскудук', autocapitalize: 'sentences' })),
      field('Система координат', textInput(d.coordinate_system, v => { d.coordinate_system = v; touch(); }, { placeholder: 'Местная, UTM 43N, МСК …' })),
      field('Описание', textArea(d.description, v => { d.description = v; touch(); })),
      err),
    existing ? h('button', { class: 'btn danger block', onclick: del }, icon('trash'), 'Удалить проект') : null,
    actionBar(h('button', { class: 'btn primary', onclick: save }, icon('save'), 'Сохранить')));
}
