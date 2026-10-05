// Чтение и запись таблиц: Excel 2007+ (.xlsx) и CSV. Без сторонних библиотек.

import { writeZip, readZip, readText } from './zip.js';

// ---------- Запись .xlsx ----------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function xmlEsc(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

function sheetXml(rows, widths) {
  const ncols = Math.max(1, ...rows.map(r => r.length));
  const w = widths || Array.from({ length: ncols }, (_, c) => {
    let m = 6;
    for (const r of rows.slice(0, 300)) m = Math.max(m, String(r[c] ?? '').length);
    return Math.min(60, m + 2);
  });
  const cols = w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('');
  const body = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = colName(ci) + (ri + 1);
      const style = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

function sheetName(name, used) {
  let n = String(name).replace(/[\[\]:*?/\\]/g, '_').slice(0, 31) || 'Лист';
  let k = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)}_${k++}`;
  used.add(n.toLowerCase());
  return n;
}

// sheets: [{ name, rows: [[...], ...] }] — первая строка каждого листа — заголовок
export async function writeXlsx(sheets) {
  const used = new Set();
  const names = sheets.map(s => sheetName(s.name, used));
  const files = [
    { name: '[Content_Types].xml', data: XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' },
    { name: '_rels/.rels', data: XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { name: 'xl/workbook.xml', data: XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>' },
    { name: 'xl/styles.xml', data: XML_HEAD +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE7ECEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) }))
  ];
  return writeZip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------- Чтение .xlsx ----------

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Не удалось разобрать XML в файле Excel');
  return doc;
}
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node) {
  // строка из <si>/<is>: склеиваем все <t>, кроме фонетических подсказок <rPh>
  return byTag(node, 't').filter(t => t.parentNode?.localName !== 'rPh').map(t => t.textContent).join('');
}

// → [{ name, rows }]
export async function readXlsx(buffer) {
  const zip = readZip(buffer);
  const wb = await readText(zip, 'xl/workbook.xml');
  if (!wb) throw new Error('В файле нет книги Excel (это не .xlsx?)');
  const rels = parseXml(await readText(zip, 'xl/_rels/workbook.xml.rels') || '<Relationships/>');
  const relMap = new Map(byTag(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const ssText = await readText(zip, 'xl/sharedStrings.xml');
  const shared = ssText ? byTag(parseXml(ssText), 'si').map(textOf) : [];
  const sheets = [];
  for (const s of byTag(parseXml(wb), 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap.get(rid);
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await readText(zip, target);
    if (!xml) continue;
    const rows = [];
    for (const row of byTag(parseXml(xml), 'row')) {
      const ri = Number(row.getAttribute('r')) - 1;
      const r = [];
      let auto = 0;
      for (const c of byTag(row, 'c')) {
        const ci = colIndex(c.getAttribute('r')) ?? auto;
        auto = ci + 1;
        const t = c.getAttribute('t');
        const v = byTag(c, 'v')[0]?.textContent;
        let val;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(byTag(c, 'is')[0] || c);
        else if (t === 'str' || t === 'b') val = v ?? '';
        else if (t === 'e') val = '';
        else val = v == null || v === '' ? '' : Number(v);
        r[ci] = val;
      }
      rows[Number.isFinite(ri) && ri >= 0 ? ri : rows.length] = r;
    }
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, r => Array.from(r || [], v => v ?? '')) });
  }
  return sheets;
}

// ---------- CSV ----------

export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);   // CSV из русского Excel
  }
}

export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => first.split(ch).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCsv(rows, sep = ',') {
  const cell = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",;\r\n\t]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(cell).join(sep)).join('\r\n') + '\r\n';
}

// Прочитать файл таблицы → [{ name, rows }]
export async function readTableFile(file) {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) return readXlsx(buf);
  if (name.endsWith('.xls') || (head[0] === 0xD0 && head[1] === 0xCF)) {
    throw new Error('Старый формат Excel (.xls) не поддерживается. Откройте файл в Excel и сохраните как .xlsx или CSV');
  }
  return [{ name: file.name, rows: parseCsv(decodeText(buf)) }];
}
