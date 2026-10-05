// Общие помощники: построение DOM, форматирование, диалоги, файлы.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const isSvg = tag.startsWith('svg:');
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') {
        if (isSvg) el.setAttribute('class', v); else el.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' ||
                            k === 'textContent' || k === 'hidden' || k === 'multiple')) {
        el[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : v);
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Число из поля ввода: '45,2' → 45.2; пусто или мусор → null
export function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Округление без хвостовых нулей: 1.2500 → '1.25'
export function fmt(v, maxDec = 3) {
  if (v == null || !Number.isFinite(v)) return '';
  const r = Number(v.toFixed(maxDec));
  return String(r);
}

// Глубина всегда с двумя знаками: 45.2 → '45.20'
export function fmtDepth(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toFixed(2);
}

export function fmtGrade(v) {
  if (v == null || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return fmt(v, 1);
  if (a >= 1) return fmt(v, 2);
  if (a >= 0.01) return fmt(v, 3);
  return fmt(v, 4);
}

export function round(v, dec = 3) {
  const k = 10 ** dec;
  return Math.round(v * k) / k;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function byNum(key) {
  return (a, b) => (a[key] ?? Infinity) - (b[key] ?? Infinity);
}

export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- Уведомления и диалоги ----------

export function toast(message, kind = 'info', ms = 2600) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

// Модальное окно. content — узел; actions — [{label, kind, onClick → false чтобы не закрывать}]
export function modal({ title, content, actions = [], wide = false, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    window.removeEventListener('popstate', onPop);
    onClose?.();
  };
  const onPop = () => close();
  const box = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' },
      h('h2', null, title || ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: close }, icon('close'))),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('div', { class: 'modal-actions' },
      actions.map(a => h('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); }
      }, a.label))) : null);
  backdrop.append(box);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  window.addEventListener('popstate', onPop);
  return { close, box };
}

export function confirmDialog(message, { okLabel = 'Да', danger = false, title = 'Подтвердите' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title,
      content: h('p', { class: 'confirm-text' }, message),
      actions: [
        { label: 'Отмена', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', inputmode } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const input = h('input', { class: 'input', value, placeholder, inputmode });
    const m = modal({
      title,
      content: h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, input),
      actions: [
        { label: 'Отмена', onClick: () => { answered = true; resolve(null); } },
        { label: 'OK', kind: 'primary', onClick: () => { answered = true; resolve(input.value); } }
      ],
      onClose: () => { if (!answered) resolve(null); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { answered = true; resolve(input.value); m.close(); }
    });
    setTimeout(() => input.focus(), 50);
  });
}

// ---------- Файлы ----------

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// Сохранить файл на устройстве: в приложении APK — через системное «Поделиться»,
// в браузере — загрузкой (Android кладёт в «Загрузки»).
export async function saveFile(blob, fileName) {
  const cap = globalThis.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const fs = cap.Plugins?.Filesystem || cap.registerPlugin?.('Filesystem');
    const share = cap.Plugins?.Share || cap.registerPlugin?.('Share');
    if (fs && share) {
      const base64 = await blobToBase64(blob);
      const res = await fs.writeFile({ path: fileName, data: base64, directory: 'CACHE' });
      await share.share({ title: fileName, url: res.uri });
      return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  return 'downloaded';
}

// Отправить файл через «Поделиться» (Telegram, почта …), если браузер умеет
export async function shareFile(blob, fileName) {
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return true;
    }
  }
  return false;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function fileStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function safeFileName(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
}

// ---------- Иконки (встроенные SVG) ----------

const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  column: 'M8 3v18M16 3v18M4 3h16v18H4z',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2L9 3 6 4l.3 2-1.4 1.4-2-.3-1 3 2 1v0l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3z',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  section: 'M3 20L9 4M14 20l5-16M3 12h18',
  compare: 'M5 3v18M12 3v18M19 3v18',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11',
  hole: 'M12 3v18M8 3h8M10 21h4',
  next: 'M9 5l7 7-7 7',
  share: 'M16 6l-4-4-4 4M12 2v13M5 10v10h14V10',
  photo: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  survey: 'M12 3v6l6 10M12 9l-6 10',
  zoomIn: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5M8 11h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 11v6M12 7.5v.5',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7'
};

export function icon(name, size = 22) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}
