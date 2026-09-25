// Smoke test app bằng Chromium headless — gọi bởi CI (.github/workflows/ci.yml).
// Không cần Supabase/CDN thật (CI sandbox có thể chặn), chỉ kiểm 3 điều bắt buộc:
//   1. Trang parse xong không PAGEERROR (không có SyntaxError/TypeError runtime).
//   2. Tab mặc định "Tiếp nhận" phải hiện được (khối #view-cases visible).
//   3. Các helper lazy-load core (ensureXLSX/ensureJsPDF/ensureFflate/ensureCtpLogo)
//      đã được định nghĩa — chống lỗi commit làm mất helper mà không nhận ra.
// Nếu 1 trong 3 fail: CI đỏ, block merge, không deploy nhầm.

import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:8765/index.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE-ERR: ' + m.text().slice(0, 300)); });

await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(1500);   // đủ để DOMContentLoaded handler chạy xong

const info = await page.evaluate(() => ({
  title: document.title,
  views: [...document.querySelectorAll('.view')].map((v) => ({ id: v.id, visible: v.offsetParent !== null })),
  formCount: document.querySelectorAll('form').length,
}));

// Kiểm helper lazy-load — phải là function, dù chưa nạp CDN nào (do CI có thể
// bị chặn CDN). Chỉ cần chúng tồn tại là app sẽ nạp đúng khi user bấm export.
const helpersOk = await page.evaluate(() => {
  try {
    // Các hàm ensureXXX ĐƯỢC KHAI BÁO trong closure của DOMContentLoaded — không
    // truy cập được từ window. Thay vào đó kiểm bằng dấu vết trong nguồn:
    const s = [...document.scripts].map((x) => x.textContent || '').join('');
    return s.includes('const ensureXLSX') && s.includes('const ensureJsPDF') &&
           s.includes('const ensureFflate') && s.includes('function ensureCtpLogo');
  } catch (_) { return false; }
});

const pageErrs = errs.filter((e) => e.startsWith('PAGEERROR'));
console.log(JSON.stringify({ title: info.title, viewsVisible: info.views.filter(v => v.visible).map(v => v.id), formCount: info.formCount, helpersOk, pageErrors: pageErrs, consoleErrors: errs.filter((e) => e.startsWith('CONSOLE-ERR')).length }, null, 2));

let fail = false;
if (pageErrs.length) { console.error('❌ có PAGEERROR — app crash lúc parse/khởi động'); fail = true; }
const casesVisible = info.views.find((v) => v.id === 'view-cases')?.visible;
if (!casesVisible) { console.error('❌ tab mặc định #view-cases KHÔNG visible'); fail = true; }
if (!info.formCount)  { console.error('❌ không tìm thấy <form> nào'); fail = true; }
if (!helpersOk)       { console.error('❌ thiếu 1 trong các helper lazy-load ensureXLSX/ensureJsPDF/ensureFflate/ensureCtpLogo'); fail = true; }

await browser.close();

if (fail) { process.exit(1); }
console.log('✅ smoke passed');
