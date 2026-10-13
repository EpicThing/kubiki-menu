/* Кубики меню — интерфейс. Зависит от data.js (DATA) и logic.js (Logic). */
(function () {
  'use strict';
  const D = window.DATA, L = window.Logic;
  const R = D.RECIPES;
  const BY = Object.fromEntries(R.map((r) => [r.id, r]));
  const ALL_TYPES = Object.assign({}, D.TYPES, D.EXTRA_TYPES);
  const KEY = 'menu-dice-v2', OLD_KEY = 'menu-dice-v1', SCHEMA = 2, HIST_MAX = 6;
  const DN = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------------- состояние, схема и миграции ---------------- */
  const defaults = () => ({
    v: SCHEMA, days: 7, meals: 2, port: 4, types: { soup: 1, meat: 1, fish: 1, bean: 1 }, budget: false,
    plan: [], extras: [], ban: [], done: {}, pantry: [], manual: [], secOrder: D.SECTION_ORDER.slice(),
    packs: true, theme: 'auto', tab: 'menu', history: [], hid: null,
  });
  const isId = (x) => Number.isInteger(x) && !!BY[x];
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

  // Приводит данные любой версии (v1 прототипа, импорт из файла) к текущей схеме.
  function migrate(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;
    // v1 → v2: поля те же (days, meals, port, types, plan, ban, done, tab); новые поля берутся из defaults.
    s.days = pick(raw.days, [3, 7, 14, 21], s.days);
    s.meals = pick(raw.meals, [1, 2], s.meals);
    s.port = pick(raw.port, [2, 4], s.port);
    if (raw.types && typeof raw.types === 'object') Object.keys(s.types).forEach((t) => { if (t in raw.types) s.types[t] = raw.types[t] ? 1 : 0; });
    s.budget = !!raw.budget;
    const plan = (a) => (Array.isArray(a) ? a.filter((x) => x && isId(x.id) && BY[x.id].type in D.TYPES).map((x) => (x.lock ? { id: x.id, lock: true } : { id: x.id })) : []);
    s.plan = plan(raw.plan);
    s.extras = Array.isArray(raw.extras) ? raw.extras.filter((id) => isId(id) && BY[id].type in D.EXTRA_TYPES) : [];
    s.ban = Array.isArray(raw.ban) ? raw.ban.filter(isId) : [];
    if (raw.done && typeof raw.done === 'object') Object.keys(raw.done).forEach((k) => { if (raw.done[k]) s.done[k] = 1; });
    s.pantry = Array.isArray(raw.pantry) ? [...new Set(raw.pantry.filter((x) => typeof x === 'string' && x.trim()))] : [];
    s.manual = Array.isArray(raw.manual) ? raw.manual.filter((m) => m && typeof m.name === 'string' && m.name.trim()).map((m) => ({ id: String(m.id || uid()), name: m.name.trim().slice(0, 80), qty: String(m.qty || '').slice(0, 40) })) : [];
    if (Array.isArray(raw.secOrder)) {
      const o = raw.secOrder.filter((x, i, a) => D.SECTIONS[x] && a.indexOf(x) === i);
      s.secOrder = o.concat(D.SECTION_ORDER.filter((x) => !o.includes(x)));
    }
    s.packs = raw.packs !== false;
    s.theme = pick(raw.theme, ['auto', 'light', 'dark'], 'auto');
    s.tab = pick(raw.tab, ['menu', 'shop', 'set'], 'menu');
    if (Array.isArray(raw.history)) {
      s.history = raw.history.filter((h) => h && h.id && Array.isArray(h.plan)).slice(0, HIST_MAX).map((h) => {
        const m = migrate(Object.assign({}, h, { history: [] }));
        return { id: String(h.id), ts: +h.ts || Date.now(), days: m.days, meals: m.meals, port: m.port, types: m.types, budget: m.budget, plan: m.plan, extras: m.extras };
      });
    }
    s.hid = typeof raw.hid === 'string' && s.history.some((h) => h.id === raw.hid) ? raw.hid : null;
    return s;
  }

  let S;
  function load() {
    try {
      const j = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      S = migrate(j ? JSON.parse(j) : null);
    } catch (e) { S = defaults(); }
  }
  let saveErr = false;
  function save() {
    syncHistory();
    try { localStorage.setItem(KEY, JSON.stringify(S)); saveErr = false; } catch (e) { if (!saveErr) toast('Не удалось сохранить данные в браузере'); saveErr = true; }
  }

  /* ---------------- история ---------------- */
  const snap = () => ({ days: S.days, meals: S.meals, port: S.port, types: Object.assign({}, S.types), budget: S.budget, plan: S.plan.map((x) => Object.assign({}, x)), extras: S.extras.slice() });
  function pushHistory() {
    const h = Object.assign({ id: uid(), ts: Date.now() }, snap());
    S.history.unshift(h);
    S.history = S.history.slice(0, HIST_MAX);
    S.hid = h.id;
  }
  function syncHistory() {
    const h = S.history.find((x) => x.id === S.hid);
    if (h && S.plan.length) Object.assign(h, snap());
  }

  /* ---------------- утилиты ---------------- */
  let toastT;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2400);
  }
  const fmtDate = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const money = (n) => n.toLocaleString('ru-RU') + ' ₽';
  const plural = L.ruPlural;

  function applyTheme() {
    const root = document.documentElement;
    if (S.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', S.theme);
    const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const b = $('themeBtn');
    b.textContent = dark ? '☀' : '☾';
    b.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }

  /* ---------------- вычисления ---------------- */
  const opts = () => ({ port: S.port, days: S.days, recipes: BY, pantry: S.pantry, sideDryG: D.SIDE_DRY_G });
  const items = () => L.aggregate(S.plan, S.extras, opts());
  const rngState = () => ({ days: S.days, meals: S.meals, port: S.port, types: S.types, budget: S.budget, plan: S.plan, ban: S.ban });

  function regen() { S.plan = L.generate(rngState(), R, Math.random, D.QUOTAS); }

  function dayStats(d) {
    let k = D.BREAKFAST.kcal, p = D.BREAKFAST.protein;
    const g = Math.floor(d / S.port);
    for (let m = 0; m < S.meals; m++) {
      const x = S.plan[g * S.meals + m]; if (!x) continue;
      const r = BY[x.id];
      k += r.kcal + (r.needsSide ? D.SIDE_KCAL : 0);
      p += r.protein + (r.needsSide ? D.SIDE_PROTEIN : 0);
    }
    return [k, p];
  }
  const dayLbl = (d) => DN[d % 7] + (S.days > 7 ? ' · н' + (Math.floor(d / 7) + 1) : '');

  /* ---------------- меню ---------------- */
  const seg = (key, vals, cur, fmt) => `<div class="seg" role="group">${vals.map((v) => `<button data-act="set" data-k="${key}" data-v="${v}" aria-pressed="${v === cur}">${fmt(v)}</button>`).join('')}</div>`;

  function ingList(r, f) {
    return r.ingredients.map((g) => `<li>${esc(g.name)} — ${g.qty == null ? 'по вкусу' : L.fmtQty(g.qty * f, g.unit)}</li>`).join('');
  }

  function dishCard(r, o) {
    const acts = o.extra
      ? `<button class="ib" data-act="xre" data-i="${o.i}" aria-label="Заменить: ${esc(r.name)}">↻</button><button class="ib" data-act="xdel" data-i="${o.i}" aria-label="Убрать из недельного набора: ${esc(r.name)}">✕</button>`
      : `<button class="ib" data-act="lock" data-i="${o.i}" aria-pressed="${!!o.lock}" aria-label="${o.lock ? 'Открепить' : 'Закрепить'}: ${esc(r.name)}">${o.lock ? '●' : '○'}</button><button class="ib" data-act="re" data-i="${o.i}" aria-label="Перебросить: ${esc(r.name)}">↻</button><button class="ib" data-act="ban" data-i="${o.i}" aria-label="Больше не предлагать: ${esc(r.name)}">✕</button>`;
    const f = o.extra ? 1 : S.port / 4;
    const head = o.extra ? 'Ингредиенты на рецепт' : `Ингредиенты на ${S.port} порц.`;
    const meta = o.extra ? `${r.kcal} ккал · ${r.protein} г белка${r.note ? ' · ' + esc(r.note) : ''}` : `${r.kcal} ккал · ${r.protein} г белка / порция${r.needsSide ? ' · + гарнир ~' + D.SIDE_KCAL + ' ккал' : ''} · ≈${money(Math.round(r.cost * S.port / 4))}`;
    return `<div class="dish ${r.type}"><div class="dtop"><div><div class="tag">${ALL_TYPES[r.type]} · №${r.id}</div><div class="dn">${esc(r.name)}</div>
      <div class="meta">${meta}</div>${!o.extra && r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div><div class="acts">${acts}</div></div>
      <details id="dc-${o.extra ? 'x' : 'p'}${o.i}-${r.id}"><summary>Ингредиенты и шаги</summary><div class="h3">${head}</div><ul>${ingList(r, f)}</ul><div class="h3">Как готовить</div><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details></div>`;
  }

  function renderMenu() {
    const N = L.nBatches(S);
    const cost = S.plan.length || S.extras.length ? L.planCost(S.plan, S.extras, opts()) : 0;
    let h = `<div class="panel">
      <div class="row"><span class="lbl">Горизонт</span>${seg('days', [3, 7, 14, 21], S.days, (v) => v + ' дн.')}</div>
      <div class="row"><span class="lbl">Приёмов в день</span>${seg('meals', [1, 2], S.meals, (v) => (v === 1 ? '1 (обед/ужин)' : '2 (обед + ужин)'))}</div>
      <div class="row"><span class="lbl">Порций с варки</span>${seg('port', [2, 4], S.port, (v) => v + ' порц.')}</div>
      <div class="row"><span class="lbl">Категории</span><div style="display:flex;gap:6px;flex-wrap:wrap">${Object.keys(D.TYPES).map((t) => `<button class="chip" data-act="type" data-t="${t}" aria-pressed="${!!S.types[t]}">${D.TYPES[t]}</button>`).join('')}</div></div>
      <label class="sw"><input type="checkbox" data-act="budget" ${S.budget ? 'checked' : ''}><span>Бюджетный: чаще дешёвые блюда</span></label>
      <button class="roll" id="roll" data-act="roll"><span class="die" id="die" aria-hidden="true">⚄</span>Бросить кубики</button>
      <button class="roll alt" data-act="extras">🥣 Завтраки и заготовки на неделю</button>
      <div class="note" id="info">Сварить ${N} ${plural(N, 'блюдо', 'блюда', 'блюд')} по ${S.port} порц.${S.plan.length ? ` · план ≈ ${money(cost)} (цены приблизительные)` : ''}</div></div>`;

    if (S.ban.length) {
      h += `<details class="panel" id="banBox"><summary>Исключённые блюда (${S.ban.length})</summary>${S.ban.map((id) => `<div class="list-btn"><span>${esc(BY[id].name)}</span><button class="btn sm" data-act="unban" data-id="${id}" aria-label="Вернуть: ${esc(BY[id].name)}">Вернуть</button></div>`).join('')}</details>`;
    }

    if (!S.plan.length) h += '<div class="empty">Брось кубики — получишь меню.</div>';
    else {
      const groups = Math.ceil(S.days / S.port);
      for (let g = 0; g < groups; g++) {
        const d0 = g * S.port, d1 = Math.min(S.days, d0 + S.port) - 1;
        h += `<div class="sess"><h2>Готовка ${g + 1}<span>${dayLbl(d0)} – ${dayLbl(d1)} · в холодильнике до ${S.port} дн.</span></h2>`;
        for (let m = 0; m < S.meals; m++) {
          const i = g * S.meals + m, x = S.plan[i]; if (!x) continue;
          h += dishCard(BY[x.id], { i, lock: x.lock });
        }
        h += `<table><tr><th>День</th>${(S.meals === 1 ? ['Обед/ужин'] : ['Обед', 'Ужин']).map((n) => `<th>${n}</th>`).join('')}<th class="n">с завтраком</th></tr>`;
        for (let d = d0; d <= d1; d++) {
          const [k, p] = dayStats(d);
          h += `<tr><td>${dayLbl(d)}</td>${Array.from({ length: S.meals }, (_, m) => { const x = S.plan[g * S.meals + m]; return `<td>${x ? esc(BY[x.id].name) : '—'}</td>`; }).join('')}<td class="n">${k} ккал · ${p} г</td></tr>`;
        }
        h += '</table></div>';
      }
      h += `<p class="note">Цель ~2150 ккал: разницу добирают хлеб/гарнир, шейк, фрукты. Гарнир ~${D.SIDE_KCAL} ккал уже учтён там, где он нужен. Завтрак фиксированный (~${D.BREAKFAST.kcal} ккал).</p>`;
    }

    if (S.extras.length) {
      const mult = Math.max(1, Math.ceil(S.days / 7));
      h += `<h2 class="h2">Завтраки и заготовки${mult > 1 ? ` (в покупках ×${mult})` : ''}</h2>${S.extras.map((id, i) => dishCard(BY[id], { i, extra: true })).join('')}`;
    }

    if (S.history.length) {
      h += `<details class="panel" id="histBox"><summary>История планов (${S.history.length})</summary>${S.history.map((x) => {
        const n = x.plan.length;
        return `<div class="list-btn"><div><div>${x.id === S.hid ? '● ' : ''}${x.days} дн. · ${n} ${plural(n, 'блюдо', 'блюда', 'блюд')}</div><div class="hist-date">${fmtDate(x.ts)}</div></div>
          <div class="bar" style="margin:0"><button class="btn sm" data-act="hopen" data-id="${x.id}">Открыть</button><button class="btn sm" data-act="hdup" data-id="${x.id}" aria-label="Дублировать план от ${fmtDate(x.ts)}">Копия</button><button class="ib" data-act="hdel" data-id="${x.id}" aria-label="Удалить план от ${fmtDate(x.ts)}">🗑</button></div></div>`;
      }).join('')}</details>`;
    }
    $('menu').innerHTML = h;
  }

  /* ---------------- покупки ---------------- */
  function shopModel() {
    const all = items();
    const vis = all.filter((i) => !i.pantry);
    const pantryNames = S.pantry.slice().sort((a, b) => a.localeCompare(b, 'ru'));
    const manual = S.manual;
    const total = vis.length + manual.length;
    const done = vis.filter((i) => S.done[i.key]).length + manual.filter((m) => S.done['m:' + m.id]).length;
    return { vis, manual, total, done, pantryNames };
  }

  function itemRow(it) {
    const d = !!S.done[it.key];
    const ds = L.describeItem(it, D.PACKS, S.packs);
    return `<li class="it ${d ? 'done' : ''}"><div class="main" role="checkbox" aria-checked="${d}" tabindex="0" data-act="toggle" data-key="${esc(it.key)}" data-name="${esc(it.name)}"><span class="box" aria-hidden="true">✓</span><span class="tx"><span class="t">${esc(it.name)}</span>${ds.sub ? `<span class="sub">${esc(ds.sub)}</span>` : ''}</span><span class="q">${ds.sub ? esc(ds.main) : esc(ds.main)}</span></div>
      <button class="home" data-act="home" data-name="${esc(it.name)}" aria-label="Есть дома: ${esc(it.name)}" title="Есть дома">🏠</button></li>`;
  }
  function manualRow(m) {
    const k = 'm:' + m.id, d = !!S.done[k];
    return `<li class="it manual ${d ? 'done' : ''}"><div class="main" role="checkbox" aria-checked="${d}" tabindex="0" data-act="toggle" data-key="${esc(k)}"><span class="box" aria-hidden="true">✓</span><span class="tx"><span class="t">${esc(m.name)}</span></span><span class="q">${esc(m.qty)}</span></div>
      <button class="home" data-act="mdel" data-id="${esc(m.id)}" aria-label="Удалить: ${esc(m.name)}" title="Удалить">✕</button></li>`;
  }

  function renderShop() {
    const root = $('shop');
    const M = shopModel();
    $('shopBadge').hidden = !M.total || M.done === M.total;
    $('shopBadge').textContent = M.total - M.done;
    if (!S.plan.length && !S.extras.length && !S.manual.length) {
      root.innerHTML = '<div class="empty">Список появится после броска.</div>' + addForm() + pantryBlock(M);
      return;
    }
    const pct = M.total ? Math.round((M.done / M.total) * 100) : 0;
    let h = `<div class="sticky"><div class="cnt"><span>Куплено ${M.done}/${M.total}</span><small>${pct}%</small></div>
      <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${M.total}" aria-valuenow="${M.done}" aria-label="Прогресс покупок"><i style="width:${pct}%"></i></div></div>
      <div class="bar" style="margin-top:12px"><button class="btn pri" data-act="share">Поделиться</button><button class="btn" data-act="order">Заказ с доставкой</button>
      <div class="seg" role="group" aria-label="Режим количества"><button data-act="packs" data-v="0" aria-pressed="${!S.packs}">Граммы</button><button data-act="packs" data-v="1" aria-pressed="${S.packs}">Упаковки</button></div></div>
      <div class="note" style="margin-top:0">Тап по строке — отметить. Долгий тап или 🏠 — «есть дома».</div>`;
    const g = L.groupBySection(M.vis);
    S.secOrder.forEach((s) => {
      const arr = g[s]; if (!arr || !arr.length) return;
      const sorted = arr.slice().sort((a, b) => (!!S.done[a.key]) - (!!S.done[b.key]));
      const dn = arr.filter((i) => S.done[i.key]).length;
      h += `<div class="sec-h"><span>${D.SECTIONS[s]}</span><span>${dn}/${arr.length}</span></div><ul class="items">${sorted.map(itemRow).join('')}</ul>`;
    });
    if (S.manual.length) {
      const sorted = S.manual.slice().sort((a, b) => (!!S.done['m:' + a.id]) - (!!S.done['m:' + b.id]));
      h += `<div class="sec-h"><span>Свои позиции</span><span>${S.manual.filter((m) => S.done['m:' + m.id]).length}/${S.manual.length}</span></div><ul class="items">${sorted.map(manualRow).join('')}</ul>`;
    }
    h += addForm() + pantryBlock(M) + `<div class="bar"><button class="btn" data-act="clr">Сбросить отметки</button></div>`;
    root.innerHTML = h;
  }
  const addForm = () => `<details class="panel" style="margin-top:16px"${S.addOpen ? ' open' : ''} id="addBox"><summary>＋ Добавить свою позицию</summary><form class="add" id="addForm" autocomplete="off"><input name="name" placeholder="Название" aria-label="Название позиции" maxlength="80" required><input name="qty" class="q" placeholder="Кол-во" aria-label="Количество" maxlength="40"><button class="btn pri" type="submit">Добавить</button></form></details>`;
  const pantryBlock = (M) => `<details class="panel" id="pantryBox"><summary>Есть дома (${M.pantryNames.length})</summary>${M.pantryNames.length ? M.pantryNames.map((n) => `<div class="list-btn"><span>${esc(n)}</span><button class="btn sm" data-act="unpantry" data-name="${esc(n)}" aria-label="Вернуть в список: ${esc(n)}">Вернуть</button></div>`).join('') : '<p class="note">Пусто. Позиции из «Есть дома» не попадают в списки покупок никогда.</p>'}</details>`;

  /* ---------------- настройки ---------------- */
  function renderSettings() {
    $('set').innerHTML = `<div class="panel"><div class="row"><span class="lbl">Тема</span><div class="seg" role="group">${[['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, n]) => `<button data-act="theme" data-v="${v}" aria-pressed="${S.theme === v}">${n}</button>`).join('')}</div></div></div>
      <div class="panel"><div class="lbl" style="margin-bottom:6px">Порядок секций в магазине</div><ul class="sec-order">${S.secOrder.map((s, i) => `<li><span>${i + 1}. ${D.SECTIONS[s]}</span><button class="ib" data-act="secmv" data-s="${s}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше: ${D.SECTIONS[s]}">▲</button><button class="ib" data-act="secmv" data-s="${s}" data-d="1" ${i === S.secOrder.length - 1 ? 'disabled' : ''} aria-label="Ниже: ${D.SECTIONS[s]}">▼</button></li>`).join('')}</ul></div>
      <div class="panel"><div class="lbl" style="margin-bottom:6px">Данные</div><div class="bar"><button class="btn" data-act="export">Экспорт в JSON</button><button class="btn" data-act="import">Импорт из JSON</button></div>
      <p class="note">В файл попадают план, отметки, кладовая, история и настройки. Данные хранятся только на этом устройстве.</p>
      <div class="bar"><button class="btn" data-act="wipe">Стереть все данные</button></div></div>
      <p class="note">Кубики меню · схема данных v${SCHEMA} · ${R.length} рецептов · без аналитики и серверов.</p>`;
  }

  function render() {
    const open = new Set([...document.querySelectorAll("details[id]")].filter((d) => d.open).map((d) => d.id));
    applyTheme();
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
    ['menu', 'shop', 'set'].forEach((t) => { $(t).hidden = S.tab !== t; });
    if (S.tab === 'menu') renderMenu();
    if (S.tab === 'shop') renderShop(); else { const M = shopModel(); $('shopBadge').hidden = !M.total || M.done === M.total; $('shopBadge').textContent = M.total - M.done; }
    if (S.tab === 'set') renderSettings();
    open.forEach((id) => { const d = $(id); if (d) d.open = true; });
  }

  /* ---------------- Wake Lock ---------------- */
  let wl = null;
  async function wakeOn() {
    try {
      if (!('wakeLock' in navigator) || S.tab !== 'shop' || document.visibilityState !== 'visible' || wl) return;
      wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => { wl = null; });
    } catch (e) { wl = null; }
  }
  function wakeOff() { try { if (wl) wl.release(); } catch (e) { /* игнор */ } wl = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeOn(); });

  function setTab(t) {
    S.tab = t; clearTimeout(toastT); $('toast').classList.remove('on'); save(); render(); window.scrollTo(0, 0);
    if (t === 'shop') wakeOn(); else wakeOff();
  }

  /* ---------------- поделиться / копировать ---------------- */
  function listText(compact) {
    const M = shopModel();
    const pending = M.vis.filter((i) => !S.done[i.key]);
    const manual = M.manual.filter((m) => !S.done['m:' + m.id]);
    return L.buildText(pending, { sections: D.SECTIONS, order: S.secOrder, packs: D.PACKS, usePacks: S.packs, compact, manual, title: compact ? 'Заказ:' : 'Покупки на ' + S.days + ' дн.' });
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  }
  async function shareText(text, title) {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) ok = fallbackCopy(text);
    if (ok) toast('Список скопирован');
    else {
      $('dlgMsg').textContent = 'Не удалось скопировать автоматически — выдели и скопируй текст вручную.';
      $('dlgText').value = text;
      try { $('dlg').showModal(); } catch (e) { $('dlg').setAttribute('open', ''); }
      $('dlgText').select();
    }
  }

  /* ---------------- действия ---------------- */
  function roll() {
    if (!Object.keys(D.TYPES).some((t) => S.types[t] && R.some((r) => r.type === t && !S.ban.includes(r.id)))) { toast('Включи хотя бы одну категорию'); return; }
    const die = $('die'), faces = '⚀⚁⚂⚃⚄⚅';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let n = 0;
    const t = setInterval(() => {
      if (die) die.textContent = faces[Math.random() * 6 | 0];
      if (++n > (reduce ? 0 : 8)) {
        clearInterval(t);
        S.plan = S.plan.filter((x) => x.lock); regen();
        S.done = {}; pushHistory(); save(); render();
      }
    }, 60);
  }

  function doHome(name) {
    if (!S.pantry.some((n) => n.toLowerCase() === name.toLowerCase())) S.pantry.push(name);
    save(); render(); toast('«' + name + '» — есть дома');
  }

  const actions = {
    roll,
    set(b) { S[b.dataset.k] = +b.dataset.v; S.plan = S.plan.filter((x) => x.lock); regen(); save(); render(); },
    type(b) { S.types[b.dataset.t] = S.types[b.dataset.t] ? 0 : 1; save(); render(); },
    budget(b) { S.budget = b.checked; save(); render(); },
    extras() { S.extras = L.generateExtras(S, R, Math.random, D.EXTRA_PICKS); syncOrPush(); save(); render(); toast('Набор на неделю обновлён'); },
    lock(b) { const x = S.plan[+b.dataset.i]; if (x) { x.lock = !x.lock; if (!x.lock) delete x.lock; } save(); render(); },
    re(b) { replace(+b.dataset.i, false); },
    ban(b) { replace(+b.dataset.i, true); },
    unban(b) { S.ban = S.ban.filter((id) => id !== +b.dataset.id); save(); render(); },
    xre(b) {
      const i = +b.dataset.i, cur = BY[S.extras[i]]; if (!cur) return;
      const c = R.filter((r) => r.type === cur.type && !S.extras.includes(r.id));
      if (c.length) S.extras[i] = c[Math.random() * c.length | 0].id; else toast('Других вариантов нет');
      save(); render();
    },
    xdel(b) { S.extras.splice(+b.dataset.i, 1); save(); render(); },
    hopen(b) {
      const h = S.history.find((x) => x.id === b.dataset.id); if (!h) return;
      Object.assign(S, { days: h.days, meals: h.meals, port: h.port, types: Object.assign({}, h.types), budget: h.budget, plan: h.plan.map((x) => Object.assign({}, x)), extras: h.extras.slice(), hid: h.id, done: {} });
      save(); render(); window.scrollTo(0, 0); toast('План открыт, отметки сброшены');
    },
    hdup(b) {
      const h = S.history.find((x) => x.id === b.dataset.id); if (!h) return;
      const c = JSON.parse(JSON.stringify(h)); c.id = uid(); c.ts = Date.now();
      S.history.unshift(c); S.history = S.history.slice(0, HIST_MAX); save(); render(); toast('Копия добавлена');
    },
    hdel(b) { S.history = S.history.filter((x) => x.id !== b.dataset.id); if (S.hid === b.dataset.id) S.hid = null; save(); render(); },
    toggle(b) {
      const k = b.dataset.key;
      if (S.done[k]) delete S.done[k]; else S.done[k] = 1;
      const kbd = document.activeElement === b;
      save(); render();
      if (kbd) { const nb = [...document.querySelectorAll('[data-act="toggle"]')].find((e) => e.dataset.key === k); if (nb) nb.focus(); }
    },
    home(b) { doHome(b.dataset.name); },
    unpantry(b) { S.pantry = S.pantry.filter((n) => n !== b.dataset.name); save(); render(); },
    mdel(b) { S.manual = S.manual.filter((m) => m.id !== b.dataset.id); delete S.done['m:' + b.dataset.id]; save(); render(); },
    packs(b) { S.packs = b.dataset.v === '1'; save(); render(); },
    share() { shareText(listText(false), 'Покупки'); },
    order() { shareText(listText(true), 'Заказ с доставкой'); },
    clr() { S.done = {}; save(); render(); toast('Отметки сброшены'); },
    theme(b) { S.theme = b.dataset.v; save(); render(); },
    secmv(b) {
      const i = S.secOrder.indexOf(b.dataset.s), j = i + +b.dataset.d;
      if (i < 0 || j < 0 || j >= S.secOrder.length) return;
      [S.secOrder[i], S.secOrder[j]] = [S.secOrder[j], S.secOrder[i]];
      save(); render();
      const nb = document.querySelector(`[data-act="secmv"][data-s="${b.dataset.s}"][data-d="${b.dataset.d}"]`); if (nb && !nb.disabled) nb.focus();
    },
    export() {
      const data = { app: 'kubiki-menu', schema: SCHEMA, exportedAt: new Date().toISOString(), state: S };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kubiki-menu-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Файл сохранён');
    },
    import() { $('importFile').click(); },
    wipe() {
      if (!confirm('Стереть план, отметки, кладовую и историю на этом устройстве?')) return;
      S = defaults(); S.tab = 'set'; save(); render(); toast('Данные стёрты');
    },
  };
  function syncOrPush() { if (!S.hid && (S.plan.length || S.extras.length)) pushHistory(); }

  function replace(i, ban) {
    const cur = S.plan[i]; if (!cur) return;
    if (ban && !S.ban.includes(cur.id)) S.ban.push(cur.id);
    const id = L.pickReplacement(rngState(), R, i, Math.random);
    if (id) S.plan[i] = { id };
    else if (ban) { S.plan.splice(i, 1); toast('Замены нет — блюдо убрано из плана'); }
    else toast('Других вариантов нет');
    save(); render();
  }

  /* ---------------- события ---------------- */
  let suppress = false, lpT = null, lpX = 0, lpY = 0;
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (suppress && b.closest('.main')) { suppress = false; e.preventDefault(); return; } // клик, завершающий долгий тап
    if (b.dataset.act === 'budget' || b.tagName === 'INPUT') return; // обрабатывается в change
    const fn = actions[b.dataset.act];
    if (fn) fn(b);
  });
  document.addEventListener('change', (e) => {
    const c = e.target;
    if (c.dataset && c.dataset.act === 'budget') actions.budget(c);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.matches && e.target.matches('[data-act="toggle"]')) { e.preventDefault(); actions.toggle(e.target); }
  });
  // долгий тап по строке = «Есть дома»
  document.addEventListener('pointerdown', (e) => {
    const m = e.target.closest('.main[data-name]'); if (!m || e.button > 0) return;
    lpX = e.clientX; lpY = e.clientY;
    lpT = setTimeout(() => { lpT = null; suppress = true; if (navigator.vibrate) { try { navigator.vibrate(25); } catch (x) { /* игнор */ } } doHome(m.dataset.name); setTimeout(() => { suppress = false; }, 400); }, 600);
  });
  const cancelLp = () => { if (lpT) { clearTimeout(lpT); lpT = null; } };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => document.addEventListener(n, cancelLp, true));
  document.addEventListener('pointermove', (e) => { if (lpT && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) cancelLp(); });
  document.addEventListener('scroll', cancelLp, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.main[data-name]')) e.preventDefault(); });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'addForm') return;
    e.preventDefault();
    const f = e.target, name = f.name.value.trim(); if (!name) return;
    S.manual.push({ id: uid(), name: name.slice(0, 80), qty: f.qty.value.trim().slice(0, 40) });
    save(); render(); toast('Добавлено в конец списка');
  });

  $('themeBtn').addEventListener('click', () => {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    S.theme = dark ? 'light' : 'dark'; save(); render();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const raw = j && j.state ? j.state : j;
      if (!raw || typeof raw !== 'object' || !('plan' in raw || 'history' in raw || 'pantry' in raw)) throw new Error('формат');
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      const tab = S.tab; S = migrate(raw); S.tab = tab; save(); render(); toast('Данные импортированы');
    } catch (err) { toast('Не удалось прочитать файл'); }
  });

  /* ---------------- запуск ---------------- */
  load();
  if (!S.plan.length) { regen(); if (S.plan.length) { pushHistory(); } }
  save();
  render();
  if (S.tab === 'shop') wakeOn();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  window.__app = { get state() { return S; }, migrate };
})();
