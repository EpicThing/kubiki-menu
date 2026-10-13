// Общий запуск Chromium для тестов и генерации иконок.
// Порядок: Chromium из Playwright → установленный Google Chrome → Microsoft Edge (оба на движке Chromium).
import { chromium } from 'playwright';

export async function launch(opts = {}) {
  let first;
  for (const extra of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch({ ...opts, ...extra });
    } catch (e) {
      first = first || e;
    }
  }
  throw first;
}
