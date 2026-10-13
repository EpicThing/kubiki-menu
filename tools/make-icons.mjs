// Генерация PNG-иконок из SVG через Chromium: node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#8b2a1b';

// scale — доля холста под кубик; rounded — скруглять ли фон (для «any»; maskable и iOS — фон на весь холст)
const svg = ({ scale, rounded }, px = 512) => {
  const s = 512 * scale, o = (512 - s) / 2, r = s * 0.2, body = s - 12;
  const pips = [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]]
    .map(([x, y]) => `<circle cx="${(o + body * x).toFixed(1)}" cy="${(o + body * y).toFixed(1)}" r="${(body * 0.075).toFixed(1)}" fill="${BG}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 96 : 0}" fill="${BG}"/>
  <rect x="${o + 6}" y="${o + 14}" width="${body}" height="${body}" rx="${r}" fill="#00000040"/>
  <rect x="${o}" y="${o}" width="${body}" height="${body}" rx="${r}" fill="#fbf6ea"/>
  ${pips}
</svg>`;
};

const jobs = [
  ['icons/icon-512.png', 512, { scale: 0.74, rounded: true }],
  ['icons/icon-192.png', 192, { scale: 0.74, rounded: true }],
  ['icons/maskable-512.png', 512, { scale: 0.54, rounded: false }],
  ['icons/apple-touch-icon.png', 180, { scale: 0.64, rounded: false }],
];

fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
fs.writeFileSync(path.join(root, 'icons/icon.svg'), svg({ scale: 0.74, rounded: true }));
const browser = await launch();
const page = await browser.newPage();
for (const [file, size, o] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(o, size)}</body>`);
  await page.screenshot({ path: path.join(root, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('ok', file);
}
await browser.close();
