// Ввод интервала описания керна (п.45): порода, структура, текстура, окисление,
// изменения с интенсивностью, минерализация с содержанием, прожилкование, комментарий.
// Всё хранится по полям; комментарий — дополнительное поле.

import * as store from '../store.js';
import * as M from '../model.js';
import { h, clear, icon, fmt, fmtDepth, num, toast, confirmDialog, modal, uuid, todayIso, nowIso } from '../util.js';
import { field, textInput, numInput, textArea, chipGroup, actionBar, dateInput } from '../components.js';

export function intervalEditor(ctx, hid, iid) {
  const hole = store.get('holes', hid);
  if (!hole) throw new Error('Скважина не найдена');
  const isNew = iid === 'new';
  const existing = isNew ? null : store.get('intervals', iid);
  if (!isNew && !existing) throw new Error('Интервал не найден');
  const all = M.intervalsOf(hid);
  const depth = M.holeDepth(hole);

  const d = existing ? structuredClone(existing) : {
    hole_id: hid, from_depth: num(ctx.query.from) ?? (all.length ? all[all.length - 1].to_depth : 0),
    to_depth: num(ctx.query.to), lithology_id: null, structure_id: null, texture_id: null, oxidation: null,
    color: '', comment: '', alterations: [], minerals: [], veins: [],
    logged_by: store.setting('geologist', ''), logged_at: todayIso()
  };
  d.alterations ||= []; d.minerals ||= []; d.veins ||= [];
  let dirty = false;
  const touch = () => { dirty = true; };
  ctx.setDirty(() => dirty);
  ctx.setTop({ title: isNew ? 'Новый интервал' : `Интервал ${fmtDepth(d.from_depth)}–${fmtDepth(d.to_depth)}`, sub: hole.hole_number, back: `h/${hid}` });

  const previous = () => {
    const before = all.filter(i => i.id !== d.id && i.to_depth <= (d.from_depth ?? 0) + 1e-6);
    return before[before.length - 1] || null;
  };

  const root = h('div', { class: 'form' });

  // ----- Глубины -----
  const lenEl = h('div', { class: 'stat' });
  const depthMsg = h('div');
  const fromIn = numInput(d.from_depth, v => { d.from_depth = v; touch(); checkDepths(); }, { class: 'big' });
  const toIn = numInput(d.to_depth, v => { d.to_depth = v; touch(); checkDepths(); }, { class: 'big', enterkeyhint: 'done' });
  const checkDepths = () => {
    clear(depthMsg); clear(lenEl);
    fromIn.classList.remove('invalid'); toIn.classList.remove('invalid');
    const f = d.from_depth, t = d.to_depth;
    lenEl.append(h('div', { class: 'v' }, f != null && t != null && t > f ? fmt(t - f, 2) : '—'), h('div', { class: 'k' }, 'Длина, м'));
    if (f == null || t == null) return true;
    if (t <= f) { toIn.classList.add('invalid'); depthMsg.append(h('div', { class: 'error-text' }, '«До» должно быть больше «От»')); return false; }
    const over = M.overlapping(all, f, t, d.id);
    if (over.length) {
      toIn.classList.add('invalid'); fromIn.classList.add('invalid');
      depthMsg.append(h('div', { class: 'error-text' }, 'Перекрывается с ' + over.map(o => `${fmtDepth(o.from_depth)}–${fmtDepth(o.to_depth)}`).join(', ')));
      return false;
    }
    if (depth && t > depth + 1e-6) depthMsg.append(h('div', { class: 'warn-text' }, `Глубже забоя скважины (${fmt(depth, 2)} м)`));
    return true;
  };
  const quick = step => h('button', { type: 'button', class: 'chip small', onclick: () => {
    if (d.from_depth == null) return;
    d.to_depth = Math.round((d.from_depth + step) * 1000) / 1000; toIn.value = d.to_depth; touch(); checkDepths();
  } }, `+${String(step).replace('.', ',')} м`);

  root.append(h('div', { class: 'card form' },
    h('div', { class: 'grid3' }, field('От, м', fromIn), field('До, м', toIn), lenEl),
    h('div', { class: 'chips' }, quick(0.5), quick(1), quick(2), quick(3), quick(5)),
    depthMsg));
  checkDepths();

  const prev = previous();
  if (isNew && prev) {
    root.append(h('button', { type: 'button', class: 'btn block', onclick: () => {
      d.lithology_id = prev.lithology_id; d.structure_id = prev.structure_id; d.texture_id = prev.texture_id;
      d.oxidation = prev.oxidation; d.color = prev.color || '';
      d.alterations = (prev.alterations || []).map(a => ({ ...a, id: uuid() }));
      d.minerals = (prev.minerals || []).map(m => ({ ...m, id: uuid() }));
      d.veins = (prev.veins || []).map(v => ({ ...v, id: uuid() }));
      touch(); buildBody();
      toast(`Скопировано описание ${fmtDepth(prev.from_depth)}–${fmtDepth(prev.to_depth)} м`, 'ok');
    } }, icon('copy'), `Как предыдущий (${fmtDepth(prev.from_depth)}–${fmtDepth(prev.to_depth)})`));
  }

  const body = h('div', { class: 'form' });
  root.append(body);

  const buildBody = () => {
    clear(body);
    // Порода
    const lith = M.refList('ref_lithology').map(l => ({ id: l.id, name: l.name, code: l.code, color: l.display_color }));
    body.append(h('div', { class: 'card' }, h('h3', null, 'Порода'),
      chipGroup(lith, d.lithology_id, v => { d.lithology_id = v; touch(); }, { search: true })));

    const simple = (title, table, key) => h('div', { class: 'card' }, h('h3', null, title),
      chipGroup(M.refList(table).map(r => ({ id: r.id, name: r.name })), d[key], v => { d[key] = v; touch(); }, { small: true, showCode: false }));
    body.append(simple('Структура', 'ref_structure', 'structure_id'));
    body.append(simple('Текстура', 'ref_texture', 'texture_id'));
    body.append(h('div', { class: 'card' }, h('h3', null, 'Окисление'),
      chipGroup(M.OXIDATION.map(([id, name]) => ({ id, name })), d.oxidation, v => { d.oxidation = v; touch(); }, { small: true, showCode: false })));

    body.append(subSection('Изменения', 'Добавить изменение', d.alterations, 'ref_alteration',
      refId => ({ id: uuid(), alteration_id: refId, intensity_id: null }),
      (row, rerender) => {
        const alt = M.ref('ref_alteration', row.alteration_id);
        return [
          h('div', { class: 'subrow-head' }, alt?.display_color ? h('span', { class: 'swatch', style: { background: alt.display_color } }) : null,
            h('span', { class: 'grow' }, alt?.name ?? '?'), removeBtn(d.alterations, row, rerender)),
          chipGroup(M.refList('ref_intensity').map(r => ({ id: r.id, name: r.name })), row.intensity_id, v => { row.intensity_id = v; touch(); }, { small: true, showCode: false })
        ];
      }));

    body.append(subSection('Минерализация', 'Добавить минерал', d.minerals, 'ref_mineral',
      refId => ({ id: uuid(), mineral_id: refId, content_pct: null, style: null }),
      (row, rerender) => {
        const mi = M.ref('ref_mineral', row.mineral_id);
        return [
          h('div', { class: 'subrow-head' }, h('span', { class: 'grow' }, `${mi?.name ?? '?'} `, h('span', { class: 'muted small' }, mi?.code ?? '')),
            removeBtn(d.minerals, row, rerender)),
          h('div', { class: 'row' }, h('div', { style: { width: '120px' } }, field('Содержание, %', numInput(row.content_pct, v => { row.content_pct = v; touch(); })))),
          chipGroup(M.MINERAL_STYLES.map(([id, name]) => ({ id, name })), row.style, v => { row.style = v; touch(); }, { small: true, showCode: false })
        ];
      }));

    body.append(subSection('Прожилкование', 'Добавить прожилки', d.veins, 'ref_vein_type',
      refId => ({ id: uuid(), vein_type_id: refId, per_m: null, volume_pct: null, thickness_mm: null, alpha: null }),
      (row, rerender) => {
        const vt = M.ref('ref_vein_type', row.vein_type_id);
        const n = (key, label) => field(label, numInput(row[key], v => { row[key] = v; touch(); }));
        return [
          h('div', { class: 'subrow-head' }, h('span', { class: 'grow' }, `${vt?.name ?? '?'} прожилки`), removeBtn(d.veins, row, rerender)),
          h('div', { class: 'grid4' }, n('per_m', 'шт/м'), n('volume_pct', 'объём, %'), n('thickness_mm', 'мощн., мм'), n('alpha', 'угол к оси, °'))
        ];
      }));

    body.append(h('div', { class: 'card form' },
      field('Цвет породы', textInput(d.color, v => { d.color = v; touch(); }, { placeholder: 'серый, розовато-серый…', autocapitalize: 'sentences' })),
      field('Комментарий геолога', textArea(d.comment, v => { d.comment = v; touch(); }, { placeholder: 'Свободное описание — дополнительно к полям выше' })),
      h('div', { class: 'grid2' },
        field('Геолог', textInput(d.logged_by, v => { d.logged_by = v; touch(); }, { autocapitalize: 'words' })),
        field('Дата описания', dateInput(d.logged_at, v => { d.logged_at = v; touch(); })))));
  };

  // Список подзаписей (изменения, минералы, прожилки) с кнопкой добавления
  function subSection(title, addLabel, rows, refTable, make, renderRow) {
    const list = h('div', { class: 'subrow-list' });
    const rerender = () => {
      clear(list);
      for (const row of rows) list.append(h('div', { class: 'subrow' }, renderRow(row, rerender)));
    };
    rerender();
    const add = () => {
      const used = new Set(rows.map(r => r.alteration_id || r.mineral_id || r.vein_type_id));
      const items = M.refList(refTable).map(r => ({ id: r.id, name: r.name, code: r.code, color: refTable === 'ref_alteration' ? r.display_color : null, used: used.has(r.id) }))
        .filter(r => refTable !== 'ref_alteration' || !r.used);
      let m;
      m = modal({
        title: addLabel,
        content: chipGroup(items, null, id => { if (!id) return; rows.push(make(id)); touch(); rerender(); m.close(); }, { search: true, showCode: refTable === 'ref_mineral' })
      });
    };
    return h('div', { class: 'card' }, h('h3', null, title), list,
      h('button', { type: 'button', class: 'btn small mt', onclick: add }, icon('plus', 18), addLabel));
  }

  function removeBtn(rows, row, rerender) {
    return h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Убрать', onclick: () => {
      rows.splice(rows.indexOf(row), 1); touch(); rerender();
    } }, icon('close', 20));
  }

  buildBody();

  // ----- Сохранение -----
  const save = async next => {
    if (d.from_depth == null || d.to_depth == null) { toast('Укажите глубины «От» и «До»', 'error'); fromIn.focus(); return; }
    if (!checkDepths()) { toast('Исправьте глубины интервала', 'error'); window.scrollTo(0, 0); return; }
    if (!d.lithology_id && !await confirmDialog('Порода не выбрана. Сохранить интервал без породы?', { okLabel: 'Сохранить' })) return;
    if (depth && d.to_depth > depth + 1e-6 && !await confirmDialog(`Интервал глубже забоя скважины (${fmt(depth, 2)} м). Сохранить?`, { okLabel: 'Сохранить' })) return;
    const rec = {
      ...d,
      alterations: d.alterations.filter(a => a.alteration_id),
      minerals: d.minerals.filter(m => m.mineral_id),
      veins: d.veins.filter(v => v.vein_type_id),
      color: (d.color || '').trim() || null,
      comment: (d.comment || '').trim() || null
    };
    if (rec.logged_by) store.setSetting('geologist', rec.logged_by);
    const saved = await store.put('intervals', rec);
    dirty = false;
    toast(`Сохранено ${fmtDepth(saved.from_depth)}–${fmtDepth(saved.to_depth)} м`, 'ok');
    if (next) {
      const hd = M.holeDepth(hole);
      if (hd && saved.to_depth >= hd - 1e-6) { toast('Описание дошло до забоя', 'ok'); ctx.go(`h/${hid}`, { replace: true }); }
      else ctx.go(`h/${hid}/i/new?from=${saved.to_depth}`, { replace: true });
    } else ctx.go(`h/${hid}`, { replace: true });
  };

  const del = async () => {
    if (!await confirmDialog(`Удалить интервал ${fmtDepth(existing.from_depth)}–${fmtDepth(existing.to_depth)} м?`, { okLabel: 'Удалить', danger: true })) return;
    await store.put('intervals', { ...existing, deleted_at: nowIso() });
    dirty = false;
    toast('Интервал удалён');
    ctx.go(`h/${hid}`, { replace: true });
  };

  root.append(actionBar(
    existing ? h('button', { class: 'btn icon-only', 'aria-label': 'Удалить', onclick: del }, icon('trash')) : null,
    h('button', { class: 'btn', onclick: () => save(false) }, 'Сохранить'),
    h('button', { class: 'btn primary', onclick: () => save(true) }, 'Сохранить и далее', icon('next', 18))));

  if (isNew && d.to_depth == null) setTimeout(() => toIn.focus(), 150);
  return root;
}
