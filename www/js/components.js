// Повторно используемые элементы интерфейса.

import { h, clear, icon, num, fmtDepth } from './util.js';

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null,
    control,
    hint ? h('span', { class: 'hint' }, hint) : null);
}

export function textInput(value, onInput, opts = {}) {
  const el = h('input', { class: `input ${opts.class || ''}`, value: value ?? '', placeholder: opts.placeholder || '', type: opts.type || 'text', inputmode: opts.inputmode, autocomplete: 'off', autocapitalize: opts.autocapitalize || 'off', list: opts.list });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function numInput(value, onInput, opts = {}) {
  const el = h('input', {
    class: `input num ${opts.class || ''}`, value: value ?? '', placeholder: opts.placeholder || '',
    inputmode: 'decimal', autocomplete: 'off', enterkeyhint: opts.enterkeyhint
  });
  el.addEventListener('input', () => onInput(num(el.value), el.value));
  return el;
}

export function textArea(value, onInput, opts = {}) {
  const el = h('textarea', { class: 'input', placeholder: opts.placeholder || '', rows: opts.rows || 3 });
  el.value = value ?? '';
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function select(options, value, onChange, opts = {}) {
  const el = h('select', { class: 'input' },
    opts.empty != null ? h('option', { value: '' }, opts.empty) : null,
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, label)));
  el.addEventListener('change', () => onChange(el.value || null));
  return el;
}

export function dateInput(value, onInput) {
  const el = h('input', { class: 'input', type: 'date', value: value || '' });
  el.addEventListener('input', () => onInput(el.value || null));
  return el;
}

export function checkbox(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'checkline' }, input, h('span', null, label));
}

// Выбор одного значения чипами. items: [{id, name, code?, color?}]
export function chipGroup(items, selectedId, onChange, opts = {}) {
  const wrap = h('div');
  let current = selectedId;
  let query = '';
  const box = h('div', { class: 'chips' });
  const draw = () => {
    clear(box);
    const q = query.trim().toLowerCase();
    const list = q ? items.filter(it => it.name.toLowerCase().includes(q) || String(it.code || '').toLowerCase().includes(q)) : items;
    for (const it of list) {
      const on = it.id === current;
      box.append(h('button', {
        type: 'button', class: `chip${on ? ' on' : ''}${opts.small ? ' small' : ''}`,
        onclick: () => {
          current = on && opts.allowClear !== false ? null : it.id;
          draw();
          onChange(current);
        }
      },
        it.color ? h('span', { class: 'swatch', style: { background: it.color } }) : null,
        h('span', null, it.name),
        it.code && opts.showCode !== false ? h('span', { class: 'code' }, it.code) : null));
    }
    if (!list.length) box.append(h('span', { class: 'hint' }, 'Ничего не найдено'));
  };
  if (opts.search && items.length > 10) {
    const s = h('input', { class: 'input chip-search', placeholder: 'Поиск…', autocomplete: 'off' });
    s.addEventListener('input', () => { query = s.value; draw(); });
    wrap.append(s);
  }
  wrap.append(box);
  draw();
  wrap.setValue = v => { current = v; draw(); };
  return wrap;
}

// Сегментированный переключатель
export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const draw = () => {
    clear(el);
    for (const [v, label] of options) {
      el.append(h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; draw(); onChange(v); } }, label));
    }
  };
  draw();
  return el;
}

export function tabs(items, active, onChange) {
  return h('nav', { class: 'tabs' },
    items.map(([key, label]) => h('button', { type: 'button', class: `tab${key === active ? ' on' : ''}`, onclick: () => onChange(key) }, label)));
}

export function stat(value, label, kind = '') {
  return h('div', { class: `stat ${kind}` }, h('div', { class: 'v' }, value), h('div', { class: 'k' }, label));
}

export function banner(kind, text, action) {
  return h('div', { class: `banner ${kind}` },
    icon(kind === 'warn' ? 'warn' : kind === 'ok' ? 'check' : 'info', 20),
    h('div', { class: 'grow' }, text),
    action || null);
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, title), text ? h('div', null, text) : null,
    action ? h('div', { class: 'mt' }, action) : null);
}

export function fab(iconName, label, onClick) {
  return h('button', { class: 'fab', 'aria-label': label, title: label, onclick: onClick }, icon(iconName, 28));
}

export function actionBar(...buttons) {
  return h('div', { class: 'actionbar' }, buttons);
}

export function depthRange(from, to) {
  return `${fmtDepth(from)}–${fmtDepth(to)}`;
}

export function table(headers, rows, { onRow, numeric = [] } = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 't' },
      h('thead', null, h('tr', null, headers.map((t, i) => h('th', { class: numeric.includes(i) ? 'n' : '' }, t)))),
      h('tbody', null, rows.map((r, ri) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(ri) : null },
        r.map((c, i) => h('td', { class: numeric.includes(i) ? 'n' : '' }, c ?? '')))))));
}
