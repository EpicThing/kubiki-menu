// Юнит-тест агрегации без зависимостей: node tests/aggregate.test.js
const assert = require('assert');
const L = require('../logic.js');
const D = require('../data.js');
const BY = Object.fromEntries(D.RECIPES.map((r) => [r.id, r]));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const find = (items, name, unit) => items.find((i) => i.name === name && (unit === undefined || i.unit === unit));

const mini = {
  1: { id: 1, needsSide: false, ingredients: [
    { name: 'лук репчатый', qty: 100, unit: 'г', section: 'veg' },
    { name: 'яйцо', qty: 2, unit: 'шт', section: 'dairy' },
    { name: 'паприка', qty: null, unit: '', section: 'spice' }] },
  2: { id: 2, needsSide: true, ingredients: [
    { name: 'лук репчатый', qty: 150, unit: 'г', section: 'veg' },
    { name: 'лук репчатый', qty: 1, unit: 'шт', section: 'veg' },
    { name: 'паприка', qty: 2, unit: 'ч.л.', section: 'spice' }] },
};

t('одинаковые продукты складываются', () => {
  const items = L.aggregate([{ id: 1 }, { id: 2 }], [], { port: 4, days: 7, recipes: mini });
  assert.strictEqual(find(items, 'лук репчатый', 'г').qty, 250);
});
t('разные единицы не смешиваются', () => {
  const items = L.aggregate([{ id: 1 }, { id: 2 }], [], { port: 4, days: 7, recipes: mini });
  assert.strictEqual(find(items, 'лук репчатый', 'шт').qty, 1);
  assert.strictEqual(items.filter((i) => i.name === 'лук репчатый').length, 2);
});
t('«по вкусу» поглощается количеством того же продукта', () => {
  const items = L.aggregate([{ id: 1 }, { id: 2 }], [], { port: 4, days: 7, recipes: mini });
  assert.strictEqual(items.filter((i) => i.name === 'паприка').length, 1);
  assert.strictEqual(find(items, 'паприка').qty, 2);
  const only = L.aggregate([{ id: 1 }], [], { port: 4, days: 7, recipes: mini });
  assert.strictEqual(find(only, 'паприка').qty, null);
});
t('масштаб по числу порций (2 порции = половина от 4)', () => {
  const a = L.aggregate([{ id: 1 }], [], { port: 2, days: 7, recipes: mini });
  assert.strictEqual(find(a, 'лук репчатый').qty, 50);
  assert.strictEqual(find(a, 'яйцо').qty, 1);
});
t('гарнир добавляется для needsSide (порции × 75 г)', () => {
  const a = L.aggregate([{ id: 2 }], [], { port: 4, days: 7, recipes: mini });
  assert.strictEqual(find(a, 'Гарнир (рис/греча/макароны, сухая)').qty, 300);
});
t('заготовки не масштабируются порциями, а по неделям горизонта', () => {
  const rec = { 9: { id: 9, ingredients: [{ name: 'морковь', qty: 500, unit: 'г', section: 'veg' }] } };
  assert.strictEqual(find(L.aggregate([], [9], { port: 2, days: 7, recipes: rec }), 'морковь').qty, 500);
  assert.strictEqual(find(L.aggregate([], [9], { port: 2, days: 14, recipes: rec }), 'морковь').qty, 1000);
});
t('кладовая помечает позиции по названию', () => {
  const a = L.aggregate([{ id: 1 }], [], { port: 4, days: 7, recipes: mini, pantry: ['Лук репчатый'] });
  assert.strictEqual(find(a, 'лук репчатый').pantry, true);
  assert.strictEqual(find(a, 'яйцо').pantry, false);
});
t('округление до упаковок: яйца до 10', () => {
  const pi = L.packInfo({ name: 'яйцо', unit: 'шт', qty: 12 }, D.PACKS);
  assert.strictEqual(pi.packs, 2); assert.strictEqual(pi.total, 20);
  assert.strictEqual(L.packInfo({ name: 'яйцо', unit: 'шт', qty: 10 }, D.PACKS).packs, 1);
});
t('округление до упаковок: фарш до 400 г, томаты до банки 400 г', () => {
  assert.strictEqual(L.packInfo({ name: 'фарш (курица/индейка)', unit: 'г', qty: 350 }, D.PACKS).packs, 1);
  assert.strictEqual(L.packInfo({ name: 'фарш (курица/индейка)', unit: 'г', qty: 1000 }, D.PACKS).packs, 3);
  assert.strictEqual(L.packInfo({ name: 'томаты в с.с.', unit: 'г', qty: 600 }, D.PACKS).packs, 2);
});
t('упаковки не применяются при другой единице и для продуктов без упаковки', () => {
  assert.strictEqual(L.packInfo({ name: 'яйцо', unit: 'г', qty: 5 }, D.PACKS), null);
  assert.strictEqual(L.packInfo({ name: 'морковь', unit: 'г', qty: 100 }, D.PACKS), null);
});
t('подпись «нужно 350 г → 1 уп.»', () => {
  const d = L.describeItem({ name: 'фарш (курица/индейка)', unit: 'г', qty: 350 }, D.PACKS, true);
  assert.ok(d.sub.startsWith('нужно 350 г → 1 уп.'), d.sub);
  assert.strictEqual(L.describeItem({ name: 'фарш (курица/индейка)', unit: 'г', qty: 350 }, D.PACKS, false).main, '350 г');
});
t('данные: один продукт — одна единица во всех рецептах', () => {
  const units = {};
  D.RECIPES.forEach((r) => r.ingredients.forEach((g) => { if (g.qty != null) (units[g.name] = units[g.name] || new Set()).add(g.unit); }));
  const bad = Object.entries(units).filter(([, u]) => u.size > 1).map(([k, u]) => k + ':' + [...u]);
  assert.deepStrictEqual(bad, []);
});
t('текст списка: секции и строки «- название — кол-во»', () => {
  const items = L.aggregate([{ id: 1 }], [], { port: 4, days: 7, recipes: mini });
  const txt = L.buildText(items, { sections: D.SECTIONS, order: D.SECTION_ORDER, packs: D.PACKS, usePacks: false });
  assert.ok(txt.includes('Овощи и зелень\n- лук репчатый — 100 г'), txt);
  assert.ok(txt.includes('Молочка и яйца\n- яйцо — 2 шт'), txt);
});
t('генерация: 7 дней × 2 приёма × 4 порции = 4 блюда, без супов подряд и без повторов', () => {
  for (let k = 0; k < 200; k++) {
    const s = { days: 7, meals: 2, port: 4, types: { soup: 1, meat: 1, fish: 1, bean: 1 }, plan: [], ban: [] };
    const p = L.generate(s, D.RECIPES, Math.random);
    assert.strictEqual(p.length, 4);
    assert.strictEqual(new Set(p.map((x) => x.id)).size, 4);
    assert.ok(!p.some((x, i) => i && BY[x.id].type === 'soup' && BY[p[i - 1].id].type === 'soup'));
  }
});
t('генерация: закрепление и исключение учитываются', () => {
  const s = { days: 14, meals: 2, port: 4, types: { soup: 1, meat: 1, fish: 1, bean: 1 }, plan: [{ id: 1, lock: true }], ban: [2, 3] };
  const p = L.generate(s, D.RECIPES, Math.random);
  assert.strictEqual(p.length, 8);
  assert.ok(p.some((x) => x.id === 1 && x.lock));
  assert.ok(!p.some((x) => x.id === 2 || x.id === 3));
});
t('бюджетный режим смещает выбор в сторону дешёвых блюд', () => {
  const avg = (budget) => {
    let sum = 0, c = 0;
    for (let k = 0; k < 300; k++) {
      const s = { days: 14, meals: 2, port: 4, budget, types: { soup: 1, meat: 1, fish: 1, bean: 1 }, plan: [], ban: [] };
      L.generate(s, D.RECIPES, Math.random).forEach((x) => { sum += BY[x.id].cost; c++; });
    }
    return sum / c;
  };
  assert.ok(avg(true) < avg(false), 'бюджетный план должен быть дешевле');
});
t('рецептов 31, у 22 основных есть steps 3–6', () => {
  assert.strictEqual(D.RECIPES.length, 31);
  D.RECIPES.filter((r) => r.id <= 22).forEach((r) => assert.ok(r.steps.length >= 3 && r.steps.length <= 6, r.name));
  assert.deepStrictEqual([...new Set(D.RECIPES.filter((r) => r.id > 22).map((r) => r.type))].sort(), ['bread', 'breakfast', 'prep']);
});
console.log('\nВсего пройдено: ' + n);
