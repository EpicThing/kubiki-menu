/* Чистая логика без DOM: генерация плана, агрегация покупок, упаковки, текст списка.
 * Классический скрипт (UMD): window.Logic в браузере, require() в Node-тестах. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const r1 = (x) => Math.round(x * 10) / 10;
  const nBatches = (s) => Math.ceil(s.days / s.port) * s.meals;
  const ruPlural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  };

  /* ---------- форматирование количеств ---------- */
  function fmtQty(q, u) {
    if (q == null) return 'по вкусу';
    q = r1(q);
    if (u === 'г') {
      q = Math.max(5, Math.round(q / 5) * 5);
      return q >= 1000 ? String(+(q / 1000).toFixed(2)).replace('.', ',') + ' кг' : q + ' г';
    }
    if (u === 'мл') {
      q = Math.max(5, Math.round(q / 5) * 5);
      return q >= 1000 ? String(+(q / 1000).toFixed(2)).replace('.', ',') + ' л' : q + ' мл';
    }
    // штучные единицы не должны превращаться в «0 шт»
    if (u === 'шт' || u === 'зубч.' || u === 'пучок') q = Math.ceil(q - 1e-9);
    return String(r1(q)).replace('.', ',') + (u ? ' ' + u : '');
  }

  /* ---------- упаковки ---------- */
  // item: {name, unit, qty}; возвращает null, если упаковки для позиции нет.
  function packInfo(item, packs) {
    const p = packs && packs[item.name];
    if (!p || item.qty == null || item.unit !== p.unit) return null;
    const n = Math.max(1, Math.ceil(r1(item.qty) / p.size - 1e-9));
    return { packs: n, total: n * p.size, unit: p.unit, size: p.size, label: p.label, need: item.qty };
  }

  // Как показать позицию: {main, sub}. usePacks — режим «упаковки».
  function describeItem(item, packs, usePacks) {
    const pi = usePacks ? packInfo(item, packs) : null;
    if (pi) {
      const tot = pi.packs === 1 ? pi.label : fmtQty(pi.total, pi.unit);
      return { main: pi.packs + ' уп.', sub: 'нужно ' + fmtQty(item.qty, item.unit) + ' → ' + pi.packs + ' уп. (' + tot + ')', pack: pi };
    }
    return { main: fmtQty(item.qty, item.unit), sub: '' };
  }

  /* ---------- агрегация ---------- */
  const itemKey = (name, unit) => name + '|' + unit;

  // plan: [{id}], extras: [id]. recipes: {id: recipe}. Возвращает плоский список позиций.
  function aggregate(plan, extras, opts) {
    const { port, days, recipes } = opts;
    const side = opts.sideDryG || 75;
    const f = port / 4;
    const mult = Math.max(1, Math.ceil(days / 7)); // заготовки/завтраки — на каждую неделю горизонта
    const map = new Map();
    const add = (name, unit, qty, section) => {
      const k = itemKey(name, unit);
      let it = map.get(k);
      if (!it) map.set(k, (it = { key: k, name, unit, qty: null, section }));
      if (qty != null) it.qty = (it.qty || 0) + qty;
    };
    let sidePorts = 0;
    (plan || []).forEach((x) => {
      const r = recipes[x.id];
      if (!r) return;
      if (r.needsSide) sidePorts += port;
      r.ingredients.forEach((g) => add(g.name, g.unit, g.qty == null ? null : g.qty * f, g.section));
    });
    (extras || []).forEach((id) => {
      const r = recipes[id];
      if (!r) return;
      r.ingredients.forEach((g) => add(g.name, g.unit, g.qty == null ? null : g.qty * mult, g.section));
    });
    if (sidePorts) add('Гарнир (рис/греча/макароны, сухая)', 'г', sidePorts * side, 'grocery');
    const arr = [...map.values()];
    // «по вкусу» не нужно, если тот же продукт уже есть с количеством
    const numeric = new Set(arr.filter((i) => i.qty != null).map((i) => i.name));
    const out = arr.filter((i) => i.qty != null || !numeric.has(i.name));
    const pantry = new Set((opts.pantry || []).map((n) => n.toLowerCase()));
    out.forEach((i) => { i.pantry = pantry.has(i.name.toLowerCase()); });
    out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return out;
  }

  function groupBySection(items) {
    const g = {};
    items.forEach((i) => (g[i.section] = g[i.section] || []).push(i));
    return g;
  }

  /* ---------- текст списка ---------- */
  // items — уже отфильтрованные позиции; manual — [{name, qty}] в конец.
  function buildText(items, opts) {
    const { sections, order, packs, usePacks, compact, title, manual } = opts;
    const g = groupBySection(items);
    const lines = [];
    if (title) lines.push(title);
    order.forEach((s) => {
      if (!g[s] || !g[s].length) return;
      if (compact) {
        lines.push(sections[s] + ': ' + g[s].map((i) => i.name + ' ' + describeItem(i, packs, usePacks).main).join(', '));
      } else {
        lines.push('', sections[s]);
        g[s].forEach((i) => lines.push('- ' + i.name + ' — ' + describeItem(i, packs, usePacks).main));
      }
    });
    if (manual && manual.length) {
      if (compact) lines.push('Свои: ' + manual.map((m) => m.name + (m.qty ? ' ' + m.qty : '')).join(', '));
      else {
        lines.push('', 'Свои позиции');
        manual.forEach((m) => lines.push('- ' + m.name + (m.qty ? ' — ' + m.qty : '')));
      }
    }
    return lines.join('\n').replace(/^\n/, '');
  }

  /* ---------- генерация ---------- */
  // Взвешенная перестановка (Efraimidis–Spirakis): при w=1 равна обычному шаффлу.
  function wshuffle(arr, rng, weight) {
    return arr
      .map((r) => ({ r, k: Math.pow(rng(), 1 / (weight ? weight(r) : 1)) }))
      .sort((a, b) => b.k - a.k)
      .map((x) => x.r);
  }
  const shuffle = (a, rng) => wshuffle(a, rng);

  function hasSoupPair(ids, BY) {
    for (let i = 1; i < ids.length; i++) if (BY[ids[i]].type === 'soup' && BY[ids[i - 1]].type === 'soup') return true;
    return false;
  }

  function makeCtx(s, recipes) {
    const main = recipes.filter((r) => ['soup', 'meat', 'fish', 'bean'].includes(r.type));
    const med = main.map((r) => r.cost || 0).sort((a, b) => a - b)[Math.floor(main.length / 2)] || 400;
    return { main, weight: s.budget ? (r) => Math.pow(med / Math.max(r.cost || med, 1), 2) : null };
  }

  // Возвращает новый plan ([{id, lock}]) длины nBatches (закреплённые сохраняются).
  function generate(s, recipes, rng, quotas) {
    rng = rng || Math.random;
    quotas = quotas || { soup: 0.3, meat: 0.4, fish: 0.15, bean: 0.15 };
    const BY = Object.fromEntries(recipes.map((r) => [r.id, r]));
    const N = nBatches(s);
    const ctx = makeCtx(s, recipes);
    let plan = (s.plan || []).slice(0, N).map((x) => (x && x.lock ? x : null));
    while (plan.length < N) plan.push(null);
    const used = new Set(plan.filter(Boolean).map((x) => x.id));
    const free = plan.reduce((a, x, i) => (x ? a : a.concat(i)), []);
    const ban = new Set(s.ban || []);
    const pool = (t, u) => ctx.main.filter((r) => r.type === t && s.types[t] && !ban.has(r.id) && !u.has(r.id));
    const en = Object.keys(quotas).filter((t) => s.types[t] && ctx.main.some((r) => r.type === t && !ban.has(r.id)));
    if (!en.length) return plan.filter(Boolean);

    const tw = en.reduce((a, t) => a + quotas[t], 0);
    const cnt = {}; const rem = []; let tot = 0;
    en.forEach((t) => { const v = (free.length * quotas[t]) / tw; cnt[t] = Math.floor(v); tot += cnt[t]; rem.push([t, v - cnt[t]]); });
    rem.sort((a, b) => b[1] - a[1]);
    for (let i = 0; tot < free.length; i++, tot++) cnt[rem[i % rem.length][0]]++;
    if (free.length >= 4 && en.includes('fish') && !cnt.fish) {
      cnt.fish = 1;
      const m = en.slice().sort((a, b) => cnt[b] - cnt[a])[0];
      cnt[m]--;
    }

    const picks = [];
    en.forEach((t) => {
      let p = wshuffle(pool(t, used), rng, ctx.weight);
      let k = cnt[t];
      while (k > 0) {
        if (!p.length) {
          p = wshuffle(pool(t, new Set()).filter((r) => !picks.includes(r.id)), rng, ctx.weight);
          if (!p.length) p = wshuffle(pool(t, new Set()), rng, ctx.weight);
        }
        if (!p.length) break;
        const r = p.shift();
        picks.push(r.id); used.add(r.id); k--;
      }
    });

    // расставить так, чтобы не было двух супов подряд (в т.ч. рядом с закреплёнными)
    let best = null;
    for (let a = 0; a < 60; a++) {
      const order = shuffle(picks, rng);
      const trial = plan.slice();
      free.forEach((i, j) => { trial[i] = order[j] ? { id: order[j] } : null; });
      const ids = trial.filter(Boolean).map((x) => x.id);
      best = trial;
      if (!hasSoupPair(ids, BY)) break;
    }
    return best.filter(Boolean);
  }

  // Подбор замены для блюда i (тот же тип, иначе любой). Возвращает id или null.
  function pickReplacement(s, recipes, i, rng) {
    rng = rng || Math.random;
    const cur = s.plan[i];
    if (!cur) return null;
    const BY = Object.fromEntries(recipes.map((r) => [r.id, r]));
    const ctx = makeCtx(s, recipes);
    const ban = new Set(s.ban || []);
    const usedIds = new Set(s.plan.map((x) => x.id));
    const t = BY[cur.id].type;
    let p = wshuffle(ctx.main.filter((r) => r.type === t && s.types[t] && !ban.has(r.id) && !usedIds.has(r.id)), rng, ctx.weight);
    if (!p.length) p = wshuffle(ctx.main.filter((r) => s.types[r.type] && !ban.has(r.id) && !usedIds.has(r.id)), rng, ctx.weight);
    return p.length ? p[0].id : null;
  }

  // Завтраки и заготовки на неделю: возвращает массив id.
  function generateExtras(s, recipes, rng, picks, keep) {
    rng = rng || Math.random;
    picks = picks || { breakfast: 1, prep: 2, bread: 1 };
    const ids = [];
    Object.keys(picks).forEach((t) => {
      const p = wshuffle(recipes.filter((r) => r.type === t), rng, s.budget ? (r) => 1 / Math.max(r.cost || 1, 1) : null);
      p.slice(0, picks[t]).forEach((r) => ids.push(r.id));
    });
    return ids;
  }

  /* ---------- стоимость и КБЖУ ---------- */
  function planCost(plan, extras, opts) {
    const { port, days, recipes } = opts;
    const mult = Math.max(1, Math.ceil(days / 7));
    let c = 0;
    (plan || []).forEach((x) => { const r = recipes[x.id]; if (r) c += (r.cost || 0) * (port / 4); });
    (extras || []).forEach((id) => { const r = recipes[id]; if (r) c += (r.cost || 0) * mult; });
    return Math.round(c / 10) * 10;
  }

  return { nBatches, ruPlural, fmtQty, packInfo, describeItem, aggregate, groupBySection, buildText, generate, pickReplacement, generateExtras, planCost, itemKey };
});
