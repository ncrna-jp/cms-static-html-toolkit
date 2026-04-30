import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const root = config.siteDir;

let scanned = 0;
let changed = 0;
let windowLoadFixed = 0;
let recaptchaScriptsRemoved = 0;
let recaptchaWidgetsDisabled = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

    scanned += 1;
    const before = await readFile(full, 'utf8');
    let after = before;

    after = after.replace(/jQuery\(window\)\.load\(function\(\)\s*\{/g, () => {
      windowLoadFixed += 1;
      return 'jQuery(function() {';
    });

    after = after.replace(
      /\s*<script\b[^>]*src=(["'])[^"']*media\/plg_captcha_recaptcha\/js\/recaptcha\.min\.[^"']+\.js\1[^>]*><\/script>/g,
      () => {
        recaptchaScriptsRemoved += 1;
        return '';
      },
    );

    after = after.replace(
      /<div id="jform_captcha" class="[^"]*\bg-recaptcha\b[^"]*"[^>]*><\/div>/g,
      () => {
        recaptchaWidgetsDisabled += 1;
        return '<div id="jform_captcha" class="static-captcha-disabled"></div>';
      },
    );

    if (after !== before) {
      changed += 1;
      await writeFile(full, after);
    }
  }
}

await walk(root);
console.log({ scanned, changed, windowLoadFixed, recaptchaScriptsRemoved, recaptchaWidgetsDisabled });
