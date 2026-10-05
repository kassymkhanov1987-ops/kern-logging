// Фото керна (п.50): съёмка камерой телефона, сжатие, привязка к ящику и интервалу.

import * as store from '../store.js';
import * as M from '../model.js';
import { h, clear, icon, fmt, fmtDepth, toast, confirmDialog, modal, uuid, nowIso, saveFile, shareFile, safeFileName, num } from '../util.js';
import { field, textInput, numInput, textArea, chipGroup, emptyState } from '../components.js';

const thumbCache = new Map();

export async function thumbUrl(id) {
  if (thumbCache.has(id)) return thumbCache.get(id);
  const blob = (await store.getBlob('thumb:' + id)) || (await store.getBlob(id));
  const url = blob ? URL.createObjectURL(blob) : null;
  thumbCache.set(id, url);
  return url;
}

async function resize(file, maxSide, quality) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hgt = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  return { blob, w, h: hgt };
}

function chooseImage(capture) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export async function addPhoto(ctx, hole, capture) {
  const file = await chooseImage(capture);
  if (!file) return;
  let full, thumb;
  try {
    full = await resize(file, Number(store.setting('photo_max_side', 2400)), 0.82);
    thumb = await resize(file, 360, 0.7);
  } catch {
    toast('Не удалось обработать снимок', 'error');
    return;
  }
  const photos = M.photosOf(hole.id);
  const last = photos.filter(p => p.to_depth != null).sort((a, b) => a.to_depth - b.to_depth).pop();
  const lastBox = Math.max(0, ...photos.map(p => Number(p.box_number) || 0));
  const d = {
    id: uuid(), hole_id: hole.id, box_number: lastBox ? String(lastBox + 1) : '1',
    from_depth: last?.to_depth ?? null, to_depth: null, photo_type: 'wet', comment: '',
    file_name: file.name, mime_type: 'image/jpeg', width: full.w, height: full.h, size: full.blob.size, taken_at: nowIso()
  };
  editPhotoMeta(ctx, hole, d, { full: full.blob, thumb: thumb.blob });
}

function editPhotoMeta(ctx, hole, d, blobs) {
  const err = h('div', { class: 'error-text' });
  const preview = h('img', { style: { width: '100%', borderRadius: '8px', display: 'block' }, alt: '' });
  if (blobs) preview.src = URL.createObjectURL(blobs.thumb);
  else thumbUrl(d.id).then(u => { if (u) preview.src = u; });
  const content = h('div', { class: 'form' }, preview,
    h('div', { class: 'grid3' },
      field('Ящик №', textInput(d.box_number, v => { d.box_number = v; }, { inputmode: 'numeric' })),
      field('От, м', numInput(d.from_depth, v => { d.from_depth = v; })),
      field('До, м', numInput(d.to_depth, v => { d.to_depth = v; }))),
    field('Тип снимка', chipGroup(M.PHOTO_TYPES.map(([id, name]) => ({ id, name })), d.photo_type, v => { d.photo_type = v || 'wet'; }, { allowClear: false, showCode: false, small: true })),
    field('Комментарий', textArea(d.comment, v => { d.comment = v; }, { rows: 2 })),
    err);
  modal({
    title: blobs ? 'Новое фото' : 'Фото керна',
    content,
    actions: [{ label: 'Сохранить', kind: 'primary', onClick: async () => {
      if (d.from_depth != null && d.to_depth != null && d.to_depth <= d.from_depth) { err.textContent = '«До» должно быть больше «От»'; return false; }
      if ((d.from_depth == null) !== (d.to_depth == null)) { err.textContent = 'Укажите обе глубины или ни одной'; return false; }
      if (blobs) {
        await store.putBlob(d.id, blobs.full);
        await store.putBlob('thumb:' + d.id, blobs.thumb);
      }
      await store.put('photos', d);
      toast('Фото сохранено', 'ok');
      ctx.refresh();
    } }]
  });
}

export async function openPhoto(ctx, p) {
  const blob = await store.getBlob(p.id);
  if (!blob) { toast('Файл фото не найден на устройстве', 'error'); return; }
  const url = URL.createObjectURL(blob);
  const hole = store.get('holes', p.hole_id);
  const view = h('div', { class: 'photo-view' }, h('img', { src: url, alt: 'Фото керна' }));
  view.addEventListener('click', () => view.classList.toggle('zoom'));
  const name = `${safeFileName(hole?.hole_number)}_ящик${safeFileName(p.box_number || '')}_${fmtDepth(p.from_depth)}-${fmtDepth(p.to_depth)}.jpg`;
  modal({
    title: `${hole?.hole_number ?? ''}${p.box_number ? ' · ящик ' + p.box_number : ''}`,
    wide: true,
    content: h('div', null, view,
      h('p', { class: 'muted small' },
        [p.from_depth != null ? `${fmtDepth(p.from_depth)}–${fmtDepth(p.to_depth)} м` : 'без интервала', M.label(M.PHOTO_TYPES, p.photo_type),
          p.taken_at ? new Date(p.taken_at).toLocaleString('ru-RU') : null, p.comment].filter(Boolean).join(' · '),
        ' · Нажмите на фото, чтобы увеличить.')),
    actions: [
      { label: 'Удалить', kind: 'danger', onClick: async () => {
        if (!await confirmDialog('Удалить фото?', { okLabel: 'Удалить', danger: true })) return false;
        await store.put('photos', { ...p, deleted_at: nowIso() });
        await store.deleteBlob(p.id); await store.deleteBlob('thumb:' + p.id);
        thumbCache.delete(p.id);
        toast('Фото удалено');
        ctx.refresh();
      } },
      { label: 'Изменить', onClick: () => editPhotoMeta(ctx, hole, { ...p }, null) },
      { label: 'Сохранить', kind: 'primary', onClick: async () => { if (!await shareFile(blob, name)) await saveFile(blob, name); return false; } }
    ],
    onClose: () => URL.revokeObjectURL(url)
  });
}

export function photosTab(ctx, hole) {
  const root = h('div');
  const photos = M.photosOf(hole.id);
  root.append(h('div', { class: 'card' },
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => addPhoto(ctx, hole, true) }, icon('camera'), 'Снять'),
      h('button', { class: 'btn', onclick: () => addPhoto(ctx, hole, false) }, icon('photo'), 'Из галереи')),
    h('p', { class: 'hint', style: { marginBottom: 0 } }, 'Снимки сжимаются до 2400 пикселей по длинной стороне (≈0,5–1 МБ), чтобы не занимать память телефона.')));
  if (!photos.length) { root.append(emptyState('Фото пока нет', 'Сфотографируйте ящики с керном и укажите интервал.')); return root; }
  const grid = h('div', { class: 'photo-grid' });
  for (const p of photos) {
    const img = h('img', { alt: '', loading: 'lazy' });
    thumbUrl(p.id).then(u => { if (u) img.src = u; });
    grid.append(h('button', { class: 'photo-tile', onclick: () => openPhoto(ctx, p) }, img,
      h('div', { class: 'cap' }, `${p.box_number ? 'Ящик ' + p.box_number : ''}${p.from_depth != null ? ` · ${fmtDepth(p.from_depth)}–${fmtDepth(p.to_depth)}` : ''}`)));
  }
  root.append(grid);
  return root;
}
