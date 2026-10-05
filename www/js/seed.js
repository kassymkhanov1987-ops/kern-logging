// Начальные справочники. Правятся в приложении (Настройки → Справочники).
// У записей из этого списка постоянные ID (одинаковые на всех телефонах),
// чтобы данные разных геологов потом можно было свести в одну базу.

import * as store from './store.js';

// Стабильный UUID из строки (FNV-1a, 4×32 бит)
export function stableId(s) {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b9);
    const str = `${k}:${s}`;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    parts.push(h.toString(16).padStart(8, '0'));
  }
  const x = parts.join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

const UNITS = [
  ['ppb', 'ppb (мг/т)', 0.001],
  ['ppm', 'ppm (г/т)', 1],
  ['g/t', 'г/т', 1],
  ['kg/t', 'кг/т', 1000],
  ['%', '%', 10000]
];

const ELEMENTS = [
  ['Au', 'Золото', 'g/t', '#C9A227'],
  ['Ag', 'Серебро', 'g/t', '#7D8BA1'],
  ['Pb', 'Свинец', '%', '#4F5D6B'],
  ['Zn', 'Цинк', '%', '#2F80B5'],
  ['Cu', 'Медь', '%', '#C2601E'],
  ['Mo', 'Молибден', 'ppm', '#6B5B95'],
  ['As', 'Мышьяк', 'ppm', '#6F8A2E'],
  ['Sb', 'Сурьма', 'ppm', '#9C6644'],
  ['Bi', 'Висмут', 'ppm', '#B5838D'],
  ['Fe', 'Железо', '%', '#8B3A3A'],
  ['S', 'Сера', '%', '#C9A800']
];

const LITHOLOGY = [
  ['AND', 'Андезит', 'вулканические', '#7FA77F', 'v'],
  ['DAC', 'Дацит', 'вулканические', '#A9C5A0', 'v'],
  ['TUF', 'Туф', 'вулканические', '#C8D5B9', 'dots'],
  ['DIO', 'Диорит', 'интрузивные', '#8FA6C1', 'crosses'],
  ['GRD', 'Гранодиорит', 'интрузивные', '#E8A0A0', 'crosses'],
  ['GR', 'Гранит', 'интрузивные', '#F2C2C2', 'crosses'],
  ['GB', 'Габбро', 'интрузивные', '#5E7D6B', 'crosses'],
  ['DYK', 'Дайка', 'интрузивные', '#4F5D75', 'solid'],
  ['QV', 'Кварцевая жила', 'жильные', '#F4F1DE', 'solid'],
  ['QZ', 'Кварцевая зона', 'жильные', '#ECE4B7', 'dashes'],
  ['BX', 'Брекчия', 'тектонические', '#B08968', 'triangles'],
  ['SST', 'Песчаник', 'осадочные', '#E9D8A6', 'dots'],
  ['SLT', 'Алевролит', 'осадочные', '#CDB891', 'dashes'],
  ['LST', 'Известняк', 'осадочные', '#BFD7EA', 'bricks'],
  ['SCH', 'Сланец', 'метаморфические', '#9A8C98', 'waves'],
  ['CLAY', 'Глина (кора выветривания)', 'рыхлые', '#D9B382', 'solid'],
  ['OVB', 'Рыхлые отложения', 'рыхлые', '#EADBC8', 'dots']
];

const ALTERATION = [
  ['SER', 'Серицитизация', '#E9C46A'], ['SIL', 'Окварцевание', '#D8E2DC'],
  ['CHL', 'Хлоритизация', '#2A9D8F'], ['EP', 'Эпидотизация', '#8AB17D'],
  ['CARB', 'Карбонатизация', '#A8DADC'], ['KF', 'Калишпатизация', '#E76F51'],
  ['ARG', 'Аргиллизация', '#DDB892'], ['PROP', 'Пропилитизация', '#6A994E'],
  ['LIM', 'Лимонитизация', '#BC6C25'], ['BER', 'Березитизация', '#D4A373']
];

const INTENSITY = [['W', 'Слабая', 1], ['M', 'Умеренная', 2], ['S', 'Сильная', 3], ['I', 'Интенсивная', 4]];

const MINERALS = [
  ['Py', 'Пирит', 'FeS2', true], ['Cpy', 'Халькопирит', 'CuFeS2', true], ['Gn', 'Галенит', 'PbS', true],
  ['Sp', 'Сфалерит', 'ZnS', true], ['Po', 'Пирротин', 'Fe1-xS', true], ['Apy', 'Арсенопирит', 'FeAsS', true],
  ['Mol', 'Молибденит', 'MoS2', true], ['Bn', 'Борнит', 'Cu5FeS4', true], ['Cc', 'Халькозин', 'Cu2S', true],
  ['Mag', 'Магнетит', 'Fe3O4', true], ['Hem', 'Гематит', 'Fe2O3', true], ['Lim', 'Лимонит', 'FeO(OH)', true],
  ['Mal', 'Малахит', 'Cu2CO3(OH)2', true], ['VG', 'Видимое золото', 'Au', true],
  ['Qz', 'Кварц', 'SiO2', false], ['Cal', 'Кальцит', 'CaCO3', false]
];

const VEINS = [
  ['QZ', 'Кварцевые'], ['QZC', 'Кварц-карбонатные'], ['CARB', 'Карбонатные'],
  ['QZS', 'Кварц-сульфидные'], ['SULF', 'Сульфидные'], ['CHL', 'Хлоритовые'], ['EP', 'Эпидотовые']
];

const STRUCTURES = [
  ['FG', 'Мелкозернистая'], ['MG', 'Среднезернистая'], ['CG', 'Крупнозернистая'],
  ['POR', 'Порфировая'], ['APH', 'Афанитовая'], ['CLAS', 'Обломочная'], ['BLAS', 'Бластовая']
];

const TEXTURES = [
  ['MAS', 'Массивная'], ['BAND', 'Полосчатая'], ['SCH', 'Сланцеватая'], ['BX', 'Брекчиевая'],
  ['DISS', 'Вкрапленная'], ['VNL', 'Прожилковая'], ['AMY', 'Миндалекаменная'], ['FLOW', 'Флюидальная']
];

export function seedRows() {
  const rows = [];
  const add = (table, row) => rows.push({ table, row });
  UNITS.forEach(([code, name, f], i) => add('ref_unit', { id: code, code, name, factor_to_ppm: f, sort_order: i }));
  ELEMENTS.forEach(([code, name, unit, color], i) =>
    add('ref_element', { id: code, code, name, default_unit: unit, display_color: color, sort_order: (i + 1) * 10, is_active: true }));
  LITHOLOGY.forEach(([code, name, group, color, pattern], i) =>
    add('ref_lithology', { id: stableId('ref_lithology:' + code), code, name, rock_group: group, display_color: color, pattern, sort_order: (i + 1) * 10, is_active: true }));
  ALTERATION.forEach(([code, name, color], i) =>
    add('ref_alteration', { id: stableId('ref_alteration:' + code), code, name, display_color: color, sort_order: (i + 1) * 10, is_active: true }));
  INTENSITY.forEach(([code, name, rank]) =>
    add('ref_intensity', { id: stableId('ref_intensity:' + code), code, name, rank, sort_order: rank, is_active: true }));
  MINERALS.forEach(([code, name, formula, ore], i) =>
    add('ref_mineral', { id: stableId('ref_mineral:' + code), code, name, formula, is_ore: ore, sort_order: (i + 1) * 10, is_active: true }));
  VEINS.forEach(([code, name], i) =>
    add('ref_vein_type', { id: stableId('ref_vein_type:' + code), code, name, sort_order: (i + 1) * 10, is_active: true }));
  STRUCTURES.forEach(([code, name], i) =>
    add('ref_structure', { id: stableId('ref_structure:' + code), code, name, sort_order: (i + 1) * 10, is_active: true }));
  TEXTURES.forEach(([code, name], i) =>
    add('ref_texture', { id: stableId('ref_texture:' + code), code, name, sort_order: (i + 1) * 10, is_active: true }));
  return rows;
}

// Заполнить справочники, если база новая
export async function ensureSeed() {
  if (store.count('ref_unit') > 0) return false;
  await store.batch(seedRows());
  await store.setSetting('schema_version', 1);
  return true;
}
