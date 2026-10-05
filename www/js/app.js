// Оболочка приложения: запуск, маршруты, верхняя панель.

import * as store from './store.js';
import { ensureSeed } from './seed.js';
import { h, clear, icon, toast } from './util.js';
import { projectsView, projectView, projectForm } from './views/projects.js';
import { holeView, holeForm } from './views/hole.js';
import { intervalEditor } from './views/interval.js';
import { sampleEditor, sliceSamplesView, qcView } from './views/samples.js';
import { importView, importsHistoryView } from './views/importview.js';
import { analysisView } from './views/analysis.js';
import { compareView } from './views/compare.js';
import { sectionView } from './views/section.js';
import { exportView, issuesView } from './views/exportview.js';
import { settingsView, dictView } from './views/settings.js';

const ROUTES = [
  [/^$/, projectsView],
  [/^p\/new$/, (ctx) => projectForm(ctx, null)],
  [/^p\/([^/]+)$/, projectView],
  [/^p\/([^/]+)\/edit$/, projectForm],
  [/^p\/([^/]+)\/hole\/new$/, (ctx, pid) => holeForm(ctx, null, pid)],
  [/^p\/([^/]+)\/import$/, importView],
  [/^p\/([^/]+)\/imports$/, importsHistoryView],
  [/^p\/([^/]+)\/analysis$/, analysisView],
  [/^p\/([^/]+)\/compare$/, compareView],
  [/^p\/([^/]+)\/section$/, sectionView],
  [/^p\/([^/]+)\/export$/, exportView],
  [/^p\/([^/]+)\/issues$/, issuesView],
  [/^p\/([^/]+)\/qc$/, qcView],
  [/^h\/([^/]+)$/, holeView],
  [/^h\/([^/]+)\/edit$/, (ctx, hid) => holeForm(ctx, hid)],
  [/^h\/([^/]+)\/i\/([^/]+)$/, intervalEditor],
  [/^h\/([^/]+)\/s\/([^/]+)$/, sampleEditor],
  [/^h\/([^/]+)\/slice$/, sliceSamplesView],
  [/^settings$/, settingsView],
  [/^dict\/([a-z_]+)$/, dictView]
];

const topbar = document.getElementById('topbar');
const view = document.getElementById('view');
let current = { dirty: null, cleanup: [] };
let lastHash = location.hash;
let skipNext = false;
const stack = [];

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, qs] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function go(hash, { replace = false } = {}) {
  const target = '#/' + hash.replace(/^#?\/?/, '');
  if (replace) {
    history.replaceState(null, '', target);
    stack.pop();
    render();
  } else {
    location.hash = target;
  }
}

function goBack(parent) {
  const target = '#/' + String(parent).replace(/^#?\/?/, '');
  if (stack.length >= 2 && stack[stack.length - 2] === target) history.back();
  else go(parent, { replace: true });
}

function setTop({ title = 'Описание керна', sub = '', back = null, actions = [] } = {}) {
  clear(topbar);
  if (back != null) topbar.append(h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => goBack(back) }, icon('back')));
  topbar.append(h('div', { class: 'title' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null));
  for (const a of actions) {
    topbar.append(h('button', { class: 'icon-btn', 'aria-label': a.label, title: a.label, onclick: a.onClick }, icon(a.icon)));
  }
  document.title = title === 'Описание керна' ? title : `${title} — Описание керна`;
}

async function render() {
  for (const fn of current.cleanup) { try { fn(); } catch { /* ignore */ } }
  current = { dirty: null, cleanup: [] };
  lastHash = location.hash;
  const { path, query } = parseHash();
  const full = '#/' + (location.hash.replace(/^#\/?/, '').split('?')[0]);
  if (stack[stack.length - 1] !== full) {
    if (stack.length >= 2 && stack[stack.length - 2] === full) stack.pop();
    else stack.push(full);
  }
  const ctx = {
    query,
    setTop,
    go,
    refresh: () => render(),
    setDirty: fn => { current.dirty = fn; },
    onCleanup: fn => current.cleanup.push(fn)
  };
  let node;
  try {
    const match = ROUTES.find(([re]) => re.test(path));
    if (!match) {
      setTop({ title: 'Не найдено', back: '' });
      node = h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Страница не найдена'));
    } else {
      const params = path.match(match[0]).slice(1);
      node = await match[1](ctx, ...params);
    }
  } catch (e) {
    console.error(e);
    setTop({ title: 'Ошибка', back: '' });
    node = h('div', { class: 'card' }, h('div', { class: 'error-text' }, e.message || String(e)));
  }
  clear(view);
  if (node) view.append(node);
  if (!query.keepScroll) window.scrollTo(0, 0);
}

// Предпросмотр внутри чужой страницы (iframe): системные диалоги там не работают
export const EMBEDDED = (() => { try { return window.self !== window.top; } catch { return true; } })();

window.addEventListener('hashchange', () => {
  if (skipNext) { skipNext = false; return; }
  if (!EMBEDDED && current.dirty?.() && !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) {
    skipNext = true;
    location.hash = lastHash;
    return;
  }
  render();
});

window.addEventListener('beforeunload', e => {
  if (current.dirty?.()) { e.preventDefault(); e.returnValue = ''; }
});

async function start() {
  try {
    await store.openDb();
    await ensureSeed();
  } catch (e) {
    view.innerHTML = '';
    view.append(h('div', { class: 'card' },
      h('div', { class: 'error-text' }, 'Не удалось открыть базу данных на устройстве'),
      h('p', null, e.message || String(e)),
      h('p', { class: 'hint' }, 'Проверьте, что браузер не в режиме «Инкогнито» и что на телефоне есть свободное место.')));
    return;
  }
  store.requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !globalThis.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Доступна новая версия — она включится при следующем запуске', 'info', 5000);
          }
        });
      });
    }).catch(() => { /* без офлайн-режима, но работает */ });
  }
  render();
}

start();
