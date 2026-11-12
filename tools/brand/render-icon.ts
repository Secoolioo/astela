/**
 * Renders the application icon from the logo in `assets/brand/logo.webp`: the mark, without
 * the name, on a plate in the dark color of the logo, which follows the icon grid of the
 * operating systems. It writes `app/build/icon.png` (1024 × 1024 px), which electron-builder
 * turns into the icons of every package, and `assets/brand/app-icon.png` (256 × 256 px) for
 * the website. Run it after changing the logo; it uses the Chromium of the app's Playwright:
 *
 *   pnpm --filter app exec playwright install chromium
 *   node tools/brand/render-icon.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

interface Page {
  setContent(html: string): Promise<unknown>;
  screenshot(options: { path: string; omitBackground: boolean }): Promise<unknown>;
}
interface Playwright {
  chromium: {
    launch(): Promise<{
      newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
      close(): Promise<void>;
    }>;
  };
}

const root = resolve(import.meta.dirname, '../..');
const appRequire = createRequire(join(root, 'app/package.json'));
const { chromium } = appRequire('@playwright/test') as Playwright;

/**
 * The logo is 1254 px square. Its mark lies in `mark`; everything above the name, which
 * starts below `nameTop`, is the mark on the dark background of the logo.
 */
const logoSize = 1254;
const mark = { x: 261, y: 276, width: 745, height: 396 };
const nameTop = 720;
/** The background color of the logo around the mark, which the plate continues. */
const plateColor = '#050220';

/**
 * The page that draws the icon at a size: a plate of 824/1024 of the icon with a radius of
 * 186/1024, as the icon grids of macOS and Windows ask, and the mark at 86 % of its width.
 * The upper part of the logo fills the plate; it fades into the plate towards the edges, so
 * the light arcs in the corners of the logo and the glow around the mark end softly.
 * @param size - Width and height in pixels.
 * @param logo - The logo as a `data:` URL.
 */
function iconPage(size: number, logo: string): string {
  const unit = size / 1024;
  const scale = (824 * 0.86 * unit) / mark.width;
  const left = 412 * unit - (mark.x + mark.width / 2) * scale;
  const top = 412 * unit - (mark.y + mark.height / 2) * scale;
  return `<!doctype html><style>
html, body { margin: 0; background: transparent; }
.plate { position: absolute; left: ${100 * unit}px; top: ${100 * unit}px;
  width: ${824 * unit}px; height: ${824 * unit}px; border-radius: ${186 * unit}px;
  background: ${plateColor}; overflow: hidden; }
.logo { position: absolute; left: ${left}px; top: ${top}px;
  width: ${logoSize * scale}px; height: ${nameTop * scale}px;
  background: url(${logo}) 0 0 / ${logoSize * scale}px no-repeat;
  mask-image: linear-gradient(to bottom, #000 90%, transparent),
    radial-gradient(closest-side, #000 72%, transparent);
  mask-composite: intersect; }
</style><div class="plate"><div class="logo"></div></div>`;
}

const logo = `data:image/webp;base64,${readFileSync(join(root, 'assets/brand/logo.webp')).toString('base64')}`;
const browser = await chromium.launch();
for (const [size, file] of [
  [1024, 'app/build/icon.png'],
  [256, 'assets/brand/app-icon.png'],
] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(iconPage(size, logo));
  await page.screenshot({ path: join(root, file), omitBackground: true });
  console.log(`Wrote ${file}`);
}
await browser.close();
