// Пробы: список по скважине, редактор пробы, нарезка проб по интервалу,
// контрольные пробы проекта (стандарты, бланки, дубликаты).

import * as store from '../store.js';
import * as M from '../model.js';
import { h, clear, icon, fmt, fmtDepth, fmtGrade, num, toast, confirmDialog, nowIso, plural, fmtDate } from '../util.js';
import { field, textInput, numInput, textArea, chipGroup, select, dateInput, actionBar, emptyState, table, checkbox, banner } from '../components.js';

function assayLine(sampleId, max = 5) {
  const a = M.sampleAssays(sampleId);
  if (!a.length) return null;
  return a.slice(0, max).map(x => `${x.code} ${x.text} ${M.unitLabel(x.unit)}`).join(' · ');
}

export function samplesTab(ctx, hole) {
  const smp = M.samplesOf(hole.id);
  const qc = store.all('samples').filter(s => s.hole_id === hole.id && s.sample_type !== 'core')
    .sort((a, b) => String(a.sample_number).localeCompare(String(b.sample_number), 'ru', { numeric: true }));
  const idx = M.assayIndex();
  const withAssay = smp.filter(s => idx.has(s.id)).length;
  const metres = smp.reduce((s, x) => s + (x.to_depth - x.from_depth), 0);
  const root = h('div');

  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('b', null, `${smp.length} ${plural(smp.length, 'проба', 'пробы', 'проб')}`), h('span', { class: 'muted' }, ` · ${fmt(metres, 2)} м`)),
      smp.length ? h('span', { class: `badge ${withAssay === smp.length ? 'ok' : ''}` }, `с анализами ${withAssay}`) : null),
    h('div', { class: 'btn-row mt' },
      h('button', { class: 'btn small primary', onclick: () => ctx.go(`h/${hole.id}/s/new`) }, icon('plus', 18), 'Проба'),
      h('button', { class: 'btn small', onclick: () => ctx.go(`h/${hole.id}/slice`) }, 'Нарезать пробы'),
      h('button', { class: 'btn small', onclick: () => ctx.go(`h/${hole.id}/s/new?type=standard`) }, 'Стандарт / бланк'))));

  if (!smp.length && !qc.length) {
    root.append(emptyState('Проб пока нет', 'Добавьте пробу или нарежьте пробы по интервалу.'));
    return root;
  }

  const list = h('div', { class: 'list' });
  let prevTo = null;
  for (const s of smp) {
    if (prevTo != null && s.from_depth - prevTo > 0.005) {
      list.append(h('div', { class: 'hint', style: { padding: '0 6px' } }, `не опробовано ${fmtDepth(prevTo)}–${fmtDepth(s.from_depth)} м`));
    }
    const line = assayLine(s.id);
    list.append(h('button', { class: 'item', onclick: () => ctx.go(`h/${hole.id}/s/${s.id}`) },
      h('div', { class: 'bar', style: { background: line ? 'var(--accent)' : 'var(--line-strong)' } }),
      h('div', { class: 'body' },
        h('div', { class: 'main' }, h('span', { class: 'grow' }, s.sample_number), h('span', { class: 'depth small muted nowrap' }, `${fmtDepth(s.from_depth)}–${fmtDepth(s.to_depth)}`)),
        h('div', { class: 'meta' }, line || 'анализов нет'))));
    prevTo = s.to_depth;
  }
  root.append(list);

  if (qc.length) {
    root.append(h('div', { class: 'section-title' }, 'Контрольные пробы скважины'));
    root.append(h('div', { class: 'list' }, qc.map(s => h('button', { class: 'item', onclick: () => ctx.go(`h/${hole.id}/s/${s.id}`) },
      h('div', { class: 'bar', style: { background: 'var(--primary)' } }),
      h('div', { class: 'body' },
        h('div', { class: 'main' }, h('span', { class: 'grow' }, s.sample_number), h('span', { class: 'badge' }, M.label(M.SAMPLE_TYPES, s.sample_type))),
        h('div', { class: 'meta' }, [s.standard_code, assayLine(s.id) || 'анализов нет'].filter(Boolean).join(' · ')))))));
  }
  return root;
}

export function sampleEditor(ctx, hid, sid) {
  const hole = store.get('holes', hid);
  if (!hole) throw new Error('Скважина не найдена');
  const isNew = sid === 'new';
  const existing = isNew ? null : store.get('samples', sid);
  if (!isNew && !existing) throw new Error('Проба не найдена');
  const smp = M.samplesOf(hid);
  const last = smp[smp.length - 1];
  const type = ctx.query.type && M.SAMPLE_TYPES.some(t => t[0] === ctx.query.type) ? ctx.query.type : 'core';
  const d = existing ? { ...existing } : {
    project_id: hole.project_id, hole_id: hid, sample_type: type,
    sample_number: M.nextSampleNumber(hole),
    from_depth: type === 'core' ? (num(ctx.query.from) ?? last?.to_depth ?? null) : null, to_depth: null
  };
  let dirty = false;
  const touch = () => { dirty = true; };
  ctx.setDirty(() => dirty);
  ctx.setTop({ title: isNew ? 'Новая проба' : d.sample_number, sub: hole.hole_number, back: `h/${hid}?t=samples` });
  const depth = M.holeDepth(hole);
  const err = h('div', { class: 'error-text' });
  const root = h('div', { class: 'form' });

  const depthBox = h('div');
  const extraBox = h('div');
  const lenEl = h('div', { class: 'stat' });
  const updLen = () => {
    clear(lenEl);
    lenEl.append(h('div', { class: 'v' }, d.from_depth != null && d.to_depth > d.from_depth ? fmt(d.to_depth - d.from_depth, 2) : '—'), h('div', { class: 'k' }, 'Длина, м'));
  };
  const drawType = () => {
    clear(depthBox); clear(extraBox);
    const t = d.sample_type;
    if (t === 'core' || t === 'field_duplicate') {
      const toIn = numInput(d.to_depth, v => { d.to_depth = v; touch(); updLen(); }, { class: 'big' });
      const fromIn = numInput(d.from_depth, v => { d.from_depth = v; touch(); updLen(); }, { class: 'big' });
      const q = step => h('button', { type: 'button', class: 'chip small', onclick: () => {
        if (d.from_depth == null) return; d.to_depth = Math.round((d.from_depth + step) * 1000) / 1000; toIn.value = d.to_depth; touch(); updLen();
      } }, `+${String(step).replace('.', ',')} м`);
      updLen();
      depthBox.append(h('div', { class: 'card form' },
        h('div', { class: 'grid3' }, field('От, м', fromIn), field('До, м', toIn), lenEl),
        h('div', { class: 'chips' }, q(0.5), q(1), q(1.5), q(2))));
      if (isNew && d.to_depth == null) setTimeout(() => toIn.focus(), 150);
    }
    if (t === 'field_duplicate' || t === 'lab_duplicate') {
      const opts = smp.filter(s => s.id !== d.id).map(s => [s.id, `${s.sample_number} (${fmtDepth(s.from_depth)}–${fmtDepth(s.to_depth)})`]);
      extraBox.append(h('div', { class: 'card' }, field('Исходная проба', select(opts, d.parent_sample_id, v => {
        d.parent_sample_id = v; touch();
        const p = store.get('samples', v);
        if (p && d.sample_type === 'field_duplicate') { d.from_depth = p.from_depth; d.to_depth = p.to_depth; drawType(); }
      }, { empty: '— выберите —' }))));
    }
    if (t === 'standard') {
      extraBox.append(h('div', { class: 'card' }, field('Стандарт (CRM)', textInput(d.standard_code, v => { d.standard_code = v; touch(); }, { placeholder: 'OREAS 235' }))));
    }
  };

  root.append(h('div', { class: 'card form' },
    field('Номер пробы (Sample_ID)', textInput(d.sample_number, v => { d.sample_number = v; touch(); }, { class: 'big', autocapitalize: 'characters' })),
    field('Тип', chipGroup(M.SAMPLE_TYPES.map(([id, name]) => ({ id, name })), d.sample_type, v => {
      d.sample_type = v || 'core'; touch();
      if (d.sample_type === 'standard' || d.sample_type === 'blank' || d.sample_type === 'lab_duplicate') { d.from_depth = null; d.to_depth = null; }
      drawType();
    }, { allowClear: false, showCode: false, small: true }))));
  root.append(depthBox, extraBox);
  drawType();

  root.append(h('div', { class: 'card form' },
    h('div', { class: 'grid2' },
      field('Масса, кг', numInput(d.weight_kg, v => { d.weight_kg = v; touch(); })),
      field('Дата отправки', dateInput(d.dispatch_date, v => { d.dispatch_date = v; touch(); }))),
    field('Комментарий', textArea(d.comment, v => { d.comment = v; touch(); }, { rows: 2 }))));

  if (existing) {
    const assays = store.all('assays').filter(a => a.sample_id === existing.id)
      .sort((a, b) => (M.element(a.element_code)?.sort_order ?? 0) - (M.element(b.element_code)?.sort_order ?? 0) || (b.analysis_date || '').localeCompare(a.analysis_date || ''));
    const best = M.assayIndex().get(existing.id);
    const box = h('div', { class: 'card' }, h('h3', null, 'Анализы'));
    if (!assays.length) box.append(h('div', { class: 'hint' }, 'Результатов нет — загрузите файл лаборатории в проекте («Импорт анализов»).'));
    else {
      box.append(table(['Элемент', 'Значение', 'Лаборатория / партия', 'Дата', ''],
        assays.map(a => [
          a.element_code,
          h('span', { style: { fontWeight: best?.get(a.element_code) === a ? 700 : 400, textDecoration: a.status === 'rejected' ? 'line-through' : '' } },
            `${a.value_text ?? a.value} ${M.unitLabel(a.unit)}`),
          [a.laboratory, a.batch_number].filter(Boolean).join(' / '),
          fmtDate(a.analysis_date),
          h('button', { class: 'btn small ghost', onclick: async e => {
            e.stopPropagation();
            await store.put('assays', { ...a, status: a.status === 'rejected' ? 'accepted' : 'rejected' });
            ctx.refresh();
          } }, a.status === 'rejected' ? 'Вернуть' : 'Отклонить')
        ])));
      box.append(h('p', { class: 'hint' }, 'Жирным — действующий результат (последний принятый). Отклонённый анализ не участвует в расчётах.'));
    }
    root.append(box);
  }
  root.append(err);

  const save = async next => {
    err.textContent = '';
    const number = (d.sample_number || '').trim();
    if (!number) { err.textContent = 'Укажите номер пробы'; return; }
    const dup = M.sampleIndex(hole.project_id).get(number.toUpperCase());
    if (dup && dup.id !== d.id) { err.textContent = `Проба ${number} уже есть в проекте`; return; }
    const withDepth = d.sample_type === 'core' || d.sample_type === 'field_duplicate';
    if (withDepth) {
      if (d.from_depth == null || d.to_depth == null) { err.textContent = 'Укажите интервал пробы'; return; }
      if (d.to_depth <= d.from_depth) { err.textContent = '«До» должно быть больше «От»'; return; }
      if (d.sample_type === 'core') {
        const over = M.overlapping(smp, d.from_depth, d.to_depth, d.id);
        if (over.length) { err.textContent = 'Перекрывается с ' + over.map(o => `${o.sample_number} (${fmtDepth(o.from_depth)}–${fmtDepth(o.to_depth)})`).join(', '); return; }
      }
      if (depth && d.to_depth > depth + 1e-6 && !await confirmDialog(`Проба глубже забоя (${fmt(depth, 2)} м). Сохранить?`)) return;
    } else { d.from_depth = null; d.to_depth = null; }
    const rec = await store.put('samples', { ...d, sample_number: number });
    dirty = false;
    toast(`Проба ${number} сохранена`, 'ok');
    if (next) ctx.go(`h/${hid}/s/new?type=${rec.sample_type === 'core' ? 'core' : rec.sample_type}${rec.to_depth != null ? `&from=${rec.to_depth}` : ''}`, { replace: true });
    else ctx.go(`h/${hid}?t=samples`, { replace: true });
  };

  const del = async () => {
    const n = store.all('assays').filter(a => a.sample_id === existing.id).length;
    if (!await confirmDialog(`Удалить пробу ${existing.sample_number}?${n ? `\nУ неё ${n} результатов анализов — они тоже перестанут учитываться.` : ''}`, { okLabel: 'Удалить', danger: true })) return;
    await store.put('samples', { ...existing, deleted_at: nowIso() });
    dirty = false;
    toast('Проба удалена');
    ctx.go(`h/${hid}?t=samples`, { replace: true });
  };

  root.append(actionBar(
    existing ? h('button', { class: 'btn icon-only', 'aria-label': 'Удалить', onclick: del }, icon('trash')) : null,
    h('button', { class: 'btn', onclick: () => save(false) }, 'Сохранить'),
    h('button', { class: 'btn primary', onclick: () => save(true) }, 'Сохранить и далее', icon('next', 18))));
  return root;
}

// Нарезка проб по интервалу с заданной длиной, с учётом литологических контактов
export function slicePlan(hole, from, to, length, { contacts = true, minLength = 0.3 } = {}) {
  const bounds = new Set([from, to]);
  if (contacts) {
    const ints = M.intervalsOf(hole.id);
    for (let k = 1; k < ints.length; k++) {
      const a = ints[k - 1], b = ints[k];
      if (Math.abs(a.to_depth - b.from_depth) < 1e-6 && a.lithology_id !== b.lithology_id && b.from_depth > from && b.from_depth < to) bounds.add(b.from_depth);
    }
  }
  const pts = [...bounds].sort((a, b) => a - b);
  const pieces = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const n = Math.floor((b - a) / length + 1e-9);
    const rem = Math.round(((b - a) - n * length) * 1000) / 1000;
    const seg = [];
    for (let i = 0; i < n; i++) seg.push([a + i * length, a + (i + 1) * length]);
    if (rem > 1e-6) {
      if (seg.length && rem < minLength) seg[seg.length - 1][1] = b;
      else seg.push([a + n * length, b]);
    }
    if (!seg.length) seg.push([a, b]);
    pieces.push(...seg.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
  }
  return pieces;
}

export function sliceSamplesView(ctx, hid) {
  const hole = store.get('holes', hid);
  if (!hole) throw new Error('Скважина не найдена');
  ctx.setTop({ title: 'Нарезать пробы', sub: hole.hole_number, back: `h/${hid}?t=samples` });
  const smp = M.samplesOf(hid);
  const ints = M.intervalsOf(hid);
  const p = {
    from: smp.length ? smp[smp.length - 1].to_depth : (ints[0]?.from_depth ?? 0),
    to: ints.length ? ints[ints.length - 1].to_depth : M.holeDepth(hole),
    length: Number(store.setting('sample_length', 1)),
    minLength: 0.3, contacts: true,
    start: M.nextSampleNumber(hole)
  };
  const preview = h('div');
  const root = h('div', { class: 'form' });

  const numbers = (start, count) => {
    const m = /^(.*?)(\d+)$/.exec(start.trim());
    if (!m) return null;
    const base = m[1], n0 = Number(m[2]), w = m[2].length;
    return Array.from({ length: count }, (_, i) => base + String(n0 + i).padStart(w, '0'));
  };

  let plan = [];
  const draw = () => {
    clear(preview);
    plan = [];
    if (p.from == null || p.to == null || p.length == null || p.to <= p.from || p.length <= 0) {
      preview.append(h('div', { class: 'hint' }, 'Укажите интервал и длину пробы'));
      return;
    }
    const pieces = slicePlan(hole, p.from, p.to, p.length, { contacts: p.contacts, minLength: p.minLength ?? 0 });
    const nums = numbers(p.start || '', pieces.length);
    if (!nums) { preview.append(h('div', { class: 'error-text' }, 'Номер первой пробы должен заканчиваться цифрами, например KOSM26DD-014-001')); return; }
    const sidx = M.sampleIndex(hole.project_id);
    plan = pieces.map(([a, b], i) => {
      const over = M.overlapping(smp, a, b).length > 0;
      const dup = sidx.has(nums[i].toUpperCase());
      return { a, b, number: nums[i], problem: over ? 'перекрывает существующую пробу' : dup ? 'номер уже занят' : '' };
    });
    const bad = plan.filter(x => x.problem).length;
    preview.append(
      bad ? banner('warn', `${bad} из ${plan.length} проб не будут созданы: перекрытие или занятый номер.`) : null,
      table(['Проба', 'От', 'До', 'Длина', ''], plan.map(x => [x.number, fmtDepth(x.a), fmtDepth(x.b), fmt(x.b - x.a, 2), x.problem ? h('span', { class: 'warn-text' }, x.problem) : '']), { numeric: [1, 2, 3] }));
  };

  root.append(h('div', { class: 'card form' },
    h('div', { class: 'grid3' },
      field('От, м', numInput(p.from, v => { p.from = v; draw(); })),
      field('До, м', numInput(p.to, v => { p.to = v; draw(); })),
      field('Длина пробы, м', numInput(p.length, v => { p.length = v; draw(); }))),
    h('div', { class: 'grid2' },
      field('Номер первой пробы', textInput(p.start, v => { p.start = v; draw(); }, { autocapitalize: 'characters' })),
      field('Мин. длина остатка, м', numInput(p.minLength, v => { p.minLength = v; draw(); }), 'Короче — присоединяется к соседней')),
    checkbox('Не переходить через литологические контакты', p.contacts, v => { p.contacts = v; draw(); })));
  root.append(preview);
  draw();

  root.append(actionBar(h('button', { class: 'btn primary', onclick: async () => {
    const ok = plan.filter(x => !x.problem);
    if (!ok.length) { toast('Нечего создавать', 'warn'); return; }
    await store.batch(ok.map(x => ({ table: 'samples', row: { project_id: hole.project_id, hole_id: hid, sample_type: 'core', sample_number: x.number, from_depth: x.a, to_depth: x.b } })));
    if (p.length) store.setSetting('sample_length', p.length);
    toast(`Создано ${ok.length} ${plural(ok.length, 'проба', 'пробы', 'проб')}`, 'ok');
    ctx.go(`h/${hid}?t=samples`, { replace: true });
  } }, icon('check'), 'Создать пробы')));
  return root;
}

export function qcView(ctx, pid) {
  const project = store.get('projects', pid);
  if (!project) throw new Error('Проект не найден');
  ctx.setTop({ title: 'Контрольные пробы', sub: project.code, back: `p/${pid}` });
  const qc = M.qcSamples(pid);
  const root = h('div');
  root.append(h('p', { class: 'hint' }, 'Стандарты, бланки и дубликаты. Они не участвуют в колонках, фильтрах и рудных интервалах. Добавляются на вкладке «Пробы» скважины.'));
  if (!qc.length) { root.append(emptyState('Контрольных проб нет')); return root; }
  const holes = new Map(M.holesOf(pid).map(x => [x.id, x]));
  root.append(table(['Проба', 'Тип', 'Скважина', 'Стандарт / исходная', 'Результаты'],
    qc.map(s => [s.sample_number, M.label(M.SAMPLE_TYPES, s.sample_type), holes.get(s.hole_id)?.hole_number ?? '',
      s.standard_code || store.get('samples', s.parent_sample_id)?.sample_number || '', assayLine(s.id, 6) || '—']),
    { onRow: i => { const s = qc[i]; if (s.hole_id) ctx.go(`h/${s.hole_id}/s/${s.id}`); } }));
  return root;
}
