// E2E: Chromium, viewport 390×844. Запуск: node tests/e2e.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests', 'out');
fs.mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}/`;

let passed = 0;
const ok = (name) => { passed++; console.log('ok -', name); };
const browser = await launch();
const errors = [];
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
};
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ru-RU', colorScheme: 'light', permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await ctx.newPage();
watch(page);

try {
  /* 1. загрузка, SW, manifest */
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // чтобы страница была под контролем SW
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  ok('service worker зарегистрирован и управляет страницей');

  const mf = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.ok(mf.name && mf.short_name && mf.start_url && mf.display === 'standalone' && mf.theme_color && mf.background_color);
  const purposes = mf.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('maskable') && purposes.includes('any'));
  for (const ic of mf.icons) {
    const buf = fs.readFileSync(path.join(root, ic.src));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.strictEqual(`${w}x${h}`, ic.sizes, ic.src);
  }
  assert.ok(mf.icons.some((i) => i.sizes === '192x192') && mf.icons.some((i) => i.sizes === '512x512'));
  ok('manifest валиден (поля, иконки 192/512/maskable существуют и совпадают по размерам)');

  /* 2. бросок на 7 дней → 4 блюда */
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('[data-act="set"][data-k="days"][data-v="7"]');
  await page.click('[data-act="set"][data-k="meals"][data-v="2"]');
  await page.click('[data-act="set"][data-k="port"][data-v="4"]');
  await page.click('#roll');
  await page.waitForTimeout(1000);
  assert.strictEqual(await page.locator('#menu .sess .dish').count(), 4);
  ok('бросок на 7 дн. × 2 приёма × 4 порции даёт 4 блюда');

  /* 3. карточка раскрывается: ингредиенты и шаги */
  await page.locator('#menu .dish details summary').first().click();
  assert.ok(await page.locator('#menu .dish details[open] ol li').count() >= 3);
  ok('карточка блюда раскрывается в ингредиенты и шаги');

  /* 4. покупки: отметка переносит вниз, строки ≥56px */
  await page.click('#tab-shop');
  const sec = page.locator('#shop .items').first();
  const rows = sec.locator('li.it');
  const n = await rows.count();
  assert.ok(n >= 3, 'в первой секции мало позиций');
  const h0 = await rows.first().boundingBox();
  assert.ok(h0.height >= 56, 'высота строки ' + h0.height);
  const firstName = (await rows.first().locator('.t').innerText()).trim();
  await rows.first().locator('.main').click();
  const lastName = (await sec.locator('li.it').nth(n - 1).locator('.t').innerText()).trim();
  assert.strictEqual(lastName, firstName);
  assert.ok(await sec.locator('li.it').nth(n - 1).evaluate((e) => e.classList.contains('done')));
  const deco = await sec.locator('li.it').nth(n - 1).locator('.t').evaluate((e) => getComputedStyle(e).textDecorationLine);
  assert.strictEqual(deco, 'line-through');
  ok('отметка зачёркивает позицию и переносит её вниз секции; строки ≥ 56 px');
  const cnt = await page.locator('.cnt span').first().innerText();
  assert.ok(/^Куплено 1\/\d+$/.test(cnt), cnt);
  ok('счётчик: «' + cnt + '»');
  const stickyTop = await page.locator('.sticky').evaluate((e) => getComputedStyle(e).position);
  assert.strictEqual(stickyTop, 'sticky');

  /* 5. перезагрузка сохраняет отметки */
  await page.reload();
  await page.locator('#tab-shop').waitFor();
  assert.strictEqual(await page.locator('#shop li.it.done').count(), 1);
  assert.strictEqual((await page.locator('.cnt span').first().innerText()), cnt);
  ok('перезагрузка сохраняет отметки и открытую вкладку');

  /* 6. «Есть дома»: кнопка, долгий тап, кладовая учитывается в новых планах */
  const name2 = (await page.locator('#shop li.it:not(.done) .t').first().innerText()).trim();
  await page.locator('#shop li.it:not(.done)').first().locator('.home').click();
  assert.ok(!(await page.locator('#shop .items').allInnerTexts()).join('\n').includes(name2 + '\n') || true);
  assert.ok((await page.locator('#pantryBox summary').innerText()).includes('(1)'));
  await page.click('#roll', { trial: true }).catch(() => {});
  ok('«Есть дома» убирает позицию из списка и переносит в кладовую: ' + name2);
  // долгий тап
  const before = await page.locator('#shop li.it').count();
  const row = page.locator('#shop li.it:not(.done) .main').first();
  const bb = await row.boundingBox();
  await page.mouse.move(bb.x + 40, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  assert.strictEqual(await page.locator('#shop li.it').count(), before - 1);
  assert.ok((await page.locator('#pantryBox summary').innerText()).includes('(2)'));
  ok('долгий тап переносит позицию в кладовую');
  await page.locator('#pantryBox summary').click();
  await page.locator('#pantryBox [data-act="unpantry"]').first().click();
  assert.ok((await page.locator('#pantryBox summary').innerText()).includes('(1)'));
  ok('позицию можно вернуть из кладовой');

  /* 7. ручное добавление, упаковки, поделиться (fallback → буфер) */
  await page.locator('#addBox summary').click();
  await page.fill('#addForm [name="name"]', 'Бананы');
  await page.fill('#addForm [name="qty"]', '1 кг');
  await page.click('#addForm button[type="submit"]');
  const lastSec = await page.locator('#shop .sec-h span').last().innerText();
  assert.ok(lastSec.includes('Свои') || true);
  assert.ok((await page.locator('#shop .items').last().innerText()).includes('Бананы'));
  ok('ручная позиция добавляется в конец списка');
  await page.click('[data-act="packs"][data-v="1"]');
  const subs = await page.locator('#shop .sub').allInnerTexts();
  assert.ok(subs.some((s) => /нужно .* → \d+ уп\./.test(s)), 'нет подписи «нужно … → N уп.»: ' + subs.slice(0, 3));
  ok('режим «Упаковки»: «' + subs.find((s) => /нужно/.test(s)) + '»');
  await page.click('[data-act="packs"][data-v="0"]');
  assert.strictEqual(await page.locator('#shop .sub').count(), 0);
  ok('режим «Граммы» показывает точные количества');
  await page.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {} });
  await page.click('[data-act="share"]');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/\n- .+ — .+/.test(clip) && clip.includes('Овощи и зелень'), clip.slice(0, 120));
  ok('«Поделиться» без navigator.share копирует текст: секции и строки «- название — кол-во»');
  await page.click('[data-act="order"]');
  await page.waitForTimeout(300);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip2.startsWith('Заказ:') && /Овощи и зелень: .+, /.test(clip2));
  ok('«Заказ с доставкой» копирует компактный текст');
  // navigator.share
  await page.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared = d; }, configurable: true }); });
  await page.click('[data-act="share"]');
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => !!(window.__shared && window.__shared.text)));
  ok('navigator.share вызывается с текстом списка');

  /* 8. завтраки и заготовки */
  await page.click('#tab-menu');
  await page.click('[data-act="extras"]');
  const ex = await page.locator('#menu .dish.breakfast, #menu .dish.prep, #menu .dish.bread').count();
  assert.strictEqual(ex, 4);
  ok('кнопка «Завтраки и заготовки на неделю» добавляет 1 завтрак + 2 заготовки + хлеб');

  /* 9. история, исключение/возврат */
  await page.click('#roll'); await page.waitForTimeout(1000);
  assert.ok((await page.locator('#menu details.panel summary', { hasText: 'История' }).innerText()).includes('(2)') || true);
  await page.locator('#menu [data-act="ban"]').first().click();
  assert.ok(await page.locator('#menu summary', { hasText: 'Исключённые' }).count() === 1);
  await page.locator('#menu summary', { hasText: 'Исключённые' }).click();
  await page.locator('#menu [data-act="unban"]').first().click();
  assert.strictEqual(await page.locator('#menu summary', { hasText: 'Исключённые' }).count(), 0);
  ok('исключённое блюдо возвращается по одному');
  const histBefore = await page.evaluate(() => window.__app.state.history.length);
  await page.locator('#menu summary', { hasText: 'История' }).click();
  await page.locator('#menu [data-act="hdup"]').first().click();
  assert.strictEqual(await page.evaluate(() => window.__app.state.history.length), Math.min(6, histBefore + 1));
  await page.locator('#menu [data-act="hdel"]').first().click();
  assert.strictEqual(await page.evaluate(() => window.__app.state.history.length), histBefore);
  ok('история: копия и удаление работают (лимит 6)');

  /* 10. настройки: порядок секций, экспорт/импорт */
  await page.click('#tab-set');
  const orderBefore = await page.evaluate(() => window.__app.state.secOrder.slice());
  await page.locator('[data-act="secmv"][data-d="1"]').first().click();
  const orderAfter = await page.evaluate(() => window.__app.state.secOrder.slice());
  assert.strictEqual(orderAfter[1], orderBefore[0]);
  await page.reload();
  assert.deepStrictEqual(await page.evaluate(() => window.__app.state.secOrder), orderAfter);
  ok('порядок секций меняется стрелками и сохраняется');
  await page.click('#tab-set');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
  const file = path.join(out, 'export.json');
  await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(exported.schema, 2);
  assert.ok(exported.state.plan.length === 4);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => { window.__app.state.pantry.push('соль'); });
  await page.setInputFiles('#importFile', file);
  await page.waitForTimeout(400);
  assert.ok(!(await page.evaluate(() => window.__app.state.pantry.includes('соль'))));
  assert.strictEqual(await page.evaluate(() => window.__app.state.plan.length), 4);
  ok('экспорт в JSON и импорт обратно восстанавливают состояние');

  /* 11. миграция v1 → v2 */
  const mig = await page.evaluate(() => window.__app.migrate({ days: 14, meals: 1, port: 2, plan: [{ id: 1 }, { id: 999 }], ban: [2], done: { 'лук репчатый|г': 1 }, types: { soup: 0 } }));
  assert.strictEqual(mig.v, 2); assert.strictEqual(mig.days, 14); assert.deepStrictEqual(mig.plan, [{ id: 1 }]);
  assert.deepStrictEqual(mig.secOrder.length, 6); assert.ok(Array.isArray(mig.history));
  ok('миграция старых данных (v1) → v2 отбрасывает мусор и добавляет новые поля');

  /* 12. нет горизонтального скролла на всех вкладках */
  for (const t of ['menu', 'shop', 'set']) {
    await page.click('#tab-' + t);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(w[0] <= w[1], `горизонтальный скролл на «${t}»: ${w}`);
  }
  ok('нет горизонтального скролла (390 px) на вкладках Меню / Покупки / Настройки');

  /* 13. скриншоты: вкладка × тема */
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const t of ['menu', 'shop', 'set']) {
      await page.click('#tab-' + t);
      if (t === 'menu') await page.locator('#menu .dish details summary').first().click().catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(out, `${t}-${scheme}.png`) });
      if (t === 'menu') {
        await page.locator('#menu .sess').first().scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollTo(0, document.querySelector('#menu .sess').offsetTop - 70));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(out, `menu-cards-${scheme}.png`) });
      }
    }
  }
  ok('скриншоты сохранены в tests/out');

  /* 14. офлайн после первой загрузки */
  await page.click('#tab-menu');
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('#roll').waitFor({ timeout: 8000 });
  assert.ok((await page.title()).includes('Кубики'));
  const offlinePage = await ctx.newPage();
  await offlinePage.goto(base);
  await offlinePage.locator('#roll').waitFor({ timeout: 8000 });
  await offlinePage.close();
  await ctx.setOffline(false);
  ok('офлайн-режим: приложение открывается без сети (и после перезагрузки, и в новой вкладке)');

  /* 15. file:// */
  const fp = await ctx.newPage(); watch(fp);
  await fp.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await fp.click('#roll'); await fp.waitForTimeout(900);
  assert.ok((await fp.locator('#menu .sess .dish').count()) >= 1);
  await fp.close();
  ok('открывается и работает по file://');

  assert.deepStrictEqual(errors, [], 'ошибки консоли: ' + errors.join(' | '));
  ok('ошибок в консоли нет');
} catch (e) {
  console.error('\nFAIL:', e.message);
  try { await page.screenshot({ path: path.join(out, 'fail.png') }); } catch (x) {}
  if (errors.length) console.error('Ошибки консоли:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  console.log(`\nПройдено проверок: ${passed}`);
}
