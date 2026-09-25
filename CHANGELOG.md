# CHANGELOG — Report ELV

Nhật ký các thay đổi lớn cho app **Report ELV** (PWA hỗ trợ kỹ thuật ELV
AEON Mall Huế / Thanh Khê). Ghi lại tại sao đổi + cách rollback từng phần
để sau này chỉnh sửa dễ dàng, không lo phá cái gì.

## Kiến trúc tổng quan

- **Client**: PWA single-file `index.html` (~525 KB HTML+CSS+JS inline).
  Đăng ký `sw.js` service worker cache-first cho tài nguyên tĩnh.
- **Backend chính**: Supabase project `vlhwagmqpnbsijkzztvi` (region ap-southeast-1).
  - Postgres 17 + RPC pattern: client dùng anon key, mỗi RPC là
    `SECURITY DEFINER` + check admin password trong function body.
  - 14 bảng data + `audit_log` mới. RLS enabled + policy tuỳ bảng.
- **Backend phụ (giai đoạn chuyển đổi)**: Google Apps Script
  (`bao-cao-cong-viec/Code.gs`) — vẫn dùng cho: đồng bộ AEON Sheet, in Excel,
  quản lý ảnh Drive cũ. Chấm công & CTP đã chuyển hết sang Supabase.
- **Ảnh**: Cloudflare R2 (lưu chính, hiển thị `<img>` trực tiếp). Supabase
  Storage chỉ là trạm trung chuyển; Drive lưu ảnh cũ trước 2026-09.
- **Deploy**: GitHub Pages tự deploy từ `main`. Push `main` → GH Action
  `deploy.yml` auto bump `APP_BUILD` + `version.json` → Pages build → user
  refresh trong 15s (app poll `version.json`).
- **CI**: GH Action `ci.yml` — `node --check` JS + kiểm APP_BUILD/version.json
  sync + Playwright smoke test (`tests/smoke.mjs`) chạy trên mọi PR + push.

## Vai trò người dùng

- **1 Administrator** (bạn) — toàn quyền: đổi mật khẩu, xoá phiếu, chấm
  công/CTP, backup, xem audit log.
- **N Users** (team) — tạo/sửa/hoàn tất phiếu, tiếp nhận case Zalo, bảo hành.
  KHÔNG xoá được, KHÔNG vào Settings được, KHÔNG thấy audit log.

Auth model: 1 anon key duy nhất cho tất cả team, mỗi RPC check password
nội bộ. Không phải Supabase Auth. Advisor cảnh báo về "anon can execute
SECURITY DEFINER" x66 → **intentional**, không sửa.

---

# Đã làm trong session 2026-09-25

Backup toàn bộ 14 bảng vào JSON 601 KB trước khi bắt đầu, đã gửi user.

## 1. Tối ưu tải trang (client-side, không đụng data)

- Tách icon PNG khỏi base64 → `icon-192.png` + `icon-512.png` (dùng chung
  cho favicon, apple-touch-icon, manifest, topbar `<img class="brand-logo">`)
- Tách CTP logo → `ctp-logo.png`, lazy fetch qua `ensureCtpLogo()` khi bấm
  Export Excel CTP lần đầu
- **Bỏ Tailwind CDN** (`cdn.tailwindcss.com` ~300KB JIT runtime) — verify
  không có class Tailwind utility nào thực sự dùng, CSS custom 650 dòng tự đủ
- **Lazy-load 3 CDN nặng** qua `ensureXLSX / ensureJsPDF / ensureFflate`:
  - `xlsx-js-style` ~900KB → chỉ tải khi bấm Export Excel (5 chỗ)
  - `jsPDF` ~350KB → chỉ tải khi bấm Xuất PDF BBLV / Bảo hành
  - `fflate` ~30KB → chỉ tải khi CTP/Chấm công cần nhúng logo
  Cache Promise để lần sau resolve tức thì
- Chỉ Supabase JS SDK còn defer ở boot (createClient chạy top-level)
- **`sw.js` cache-first** cho asset tĩnh (icon, maps/*.jpg, font Google, CDN
  thư viện) + network-only cho `index.html`/`version.json`/API → mở lại app
  nhanh + offline, vẫn giữ auto-update
- Preconnect Supabase + `cdn.jsdelivr.net` + dns-prefetch `cdnjs`
- Debounce `#mgrSearch` + `#whSearch` 180ms
- Auto-update poll: chỉ chạy khi `document.visibilityState==='visible'`

**Kết quả đo**: fresh page load ~2.4 MB → ~0.7 MB (**-70%**). `index.html`
600 KB → 525 KB. `manifest.json` 110 KB → 707 B.

**Rollback**: `git revert <commit sha>` — không đụng data.

## 2. UX

- **CTP: auto-delete đợt sau Export Excel** — CTP là hồ sơ dùng 1 lần, sau
  khi xuất Excel confirm rồi tự `DB.deleteTrip()` xoá cả trip + dòng chi
  phí. Có confirm + yêu cầu admin pw `settings`, cancel = giữ nguyên
- Xoá 80 dòng code chết `btnCtpPrintMap` (đánh dấu "KHÔNG còn dùng" từ trước)
- Fix duplicate function `ctpCurrentLines()` (khai báo 2 lần)
- Xoá 2 defensive `typeof XLSX==='undefined'` giờ redundant

## 3. Database migrations (đã APPLY qua Supabase MCP)

Xem `db/README.md` + `db/migrations/*.sql`. Rollback từng migration ghi
trong header từng file.

- **001**: `CREATE INDEX idx_maintenance_cases_linked_ticket_id` (fix FK
  unindexed advisor). Rollback: `DROP INDEX IF EXISTS ...`
- **002**: `SET search_path=''` cho 2 trigger function `set_updated_at` +
  `warranty_touch_updated_at` (fix advisor `function_search_path_mutable`
  WARN x2)
- **003**: Move `unaccent` extension từ `public` → `extensions` schema
  (fix advisor `extension_in_public`). `search_project_codes` đã có sẵn
  `search_path TO 'public','extensions'` nên không đứt
- **004**: Explicit `deny_direct_access` policy cho 5 bảng RLS-no-policy
  (app_config, app_users, attendance, expense_lines, trips). RPC vẫn qua
  được vì owned by `postgres` (`rolbypassrls=true`). Verify: grep source
  không có `sb.from(...)` direct trên 5 bảng
- **005**: Audit log — bảng `public.audit_log` (id, changed_at, table_name,
  row_id, op, actor, old_data jsonb, new_data jsonb) + 6 trigger AFTER
  UPDATE/DELETE trên `tickets` + `maintenance_cases` + `warranty_receipts`
  + RPC `list_audit_log(admin_pw, table, row_id, limit)` admin-only. Xem
  chi tiết trong migration file
- **006** (áp trực tiếp không sinh file .sql): `edit_ticket` RPC thêm
  optional `p_expected_updated_at` → concurrent-edit protection. Client
  cũ chưa refresh KHÔNG truyền param → hành vi cũ giữ nguyên (backward
  compat). Client mới truyền → RPC so, mismatch raise `stale_write`
  exception

**Trạng thái advisor sau tất cả migrations**:
- Performance: chỉ còn INFO `unused_index` (index chưa có query — sẽ dùng
  khi scale). Không có ERROR/WARN
- Security: chỉ còn WARN `anon/authenticated_security_definer_function_executable`
  ×68 — intentional design của app (RPC + password), không sửa

## 4. Security fixes

- **Xoá hardcoded admin password `Cuongok09` khỏi `bao-cao-cong-viec/Code.gs`**
  (đã lộ trên git history). `getAdminPassword()` giờ đọc từ Script
  Properties: `ADMIN_PASSWORD_OVERRIDE` (user đổi qua app) →
  `ADMIN_PASSWORD_INITIAL` (seed lần đầu) → `''` fail-secure. Không mất
  quyền admin hiện tại vì `ADMIN_PASSWORD_OVERRIDE` đã có sẵn.
  **CẦN LÀM TAY**: redeploy Code.gs lên Apps Script mới có hiệu lực
  server-side (không cấp bách vì override đã tồn tại)

## 5. Feature: Audit log viewer (admin-only)

Trong Settings modal (⚙️) — chỉ Administrator mở được vì Settings đã yêu
cầu admin pw:
- Nhập admin pw + chọn bảng + tuỳ chọn row_id → bấm "Xem nhật ký"
- Danh sách hiện: op pill (UPDATE/DELETE), tên phiếu ngắn, thời gian, actor
- Nút "So sánh trước/sau" trên từng dòng → modal diff:
  - Field không đổi: nền xám
  - Field khổi khác: nền vàng, `- old` đỏ, `+ new` xanh
- Xem trực tiếp qua Supabase Dashboard → Table Editor → `audit_log`

Cách rollback nếu không muốn audit log nữa: xem `db/migrations/005_audit_log_for_team.sql`
header — có full DROP script.

## 6. Feature: Concurrent-edit protection

Khi team nhiều người sửa cùng 1 phiếu, người thứ 2 KHÔNG ghi đè im lặng
người thứ 1 nữa:
- `edit_ticket` RPC nhận optional `p_expected_updated_at` (backward compat)
- Client `startEdit(no)` lưu `editingUpdatedAt = rec.updatedAt` khi mở form
- Submit gửi giá trị đó lên → RPC so với `updated_at` hiện tại trong DB
- Mismatch → raise `stale_write` exception có timestamp VN
- Client bắt error → toast: "Phiếu #X vừa bị người khác sửa lúc HH:MM:SS
  DD/MM/YYYY. Hủy sửa hiện tại, tải lại rồi sửa lại"
- Form KHÔNG reset → user copy được nội dung mình gõ trước khi cancel

**Rollback**: `CREATE OR REPLACE FUNCTION edit_ticket` bỏ param
`p_expected_updated_at` + block if. Client cũ vẫn chạy.

## 7. CI/CD infrastructure

- `.github/workflows/ci.yml` — chạy trên PR + push main:
  - `node --check` cú pháp JS
  - Kiểm APP_BUILD trong `index.html` khớp `version.json`
  - Playwright smoke test (`tests/smoke.mjs`): không PAGEERROR, tab mặc
    định visible, đủ ensureXXX helpers
- `.github/workflows/deploy.yml` — trên push main:
  - Auto-bump APP_BUILD + version.json = UTC timestamp
  - Commit trả với tag `[skip ci]` (chống loop)
  - Cụm `pages:` COMMENTED sẵn — không cần vì GitHub Pages đã tự deploy
    trên repo này từ trước
- `tests/smoke.mjs` — Playwright smoke, standalone
- `.gitignore` — bỏ qua `node_modules/`, `package*.json`, `http.log/pid`

---

# Cấu trúc thư mục hiện tại

```
report-elv/
├── index.html              # PWA single-file (525 KB, ~7600 dòng)
├── sw.js                   # Service worker (cache-first static)
├── manifest.json           # PWA manifest, trỏ tới icon files
├── icon-192.png            # Icon 192×192 (dùng chung mọi nơi)
├── icon-512.png            # Icon 512×512 (any + maskable)
├── ctp-logo.png            # Logo SOECO cho Export CTP (lazy fetch)
├── version.json            # Build timestamp cho auto-update
├── CHANGELOG.md            # File này
├── db/
│   ├── README.md           # Hướng dẫn migration + trạng thái
│   └── migrations/         # SQL migrations đã apply
│       ├── 001_indexes.sql
│       ├── 002_harden_trigger_search_path.sql
│       ├── 003_move_unaccent_to_extensions.sql
│       ├── 004_explicit_deny_policies.sql
│       └── 005_audit_log_for_team.sql
├── tests/
│   └── smoke.mjs           # Playwright smoke, chạy trong CI
├── .github/workflows/
│   ├── ci.yml              # Lint + smoke test
│   └── deploy.yml          # Auto-bump build stamp
├── maps/                   # Ảnh JPG bản đồ CTP (tĩnh)
└── bao-cao-cong-viec/      # Google Apps Script backend phụ
    ├── Code.gs             # Backend Sheet cũ (chấm công/CTP đã chuyển)
    └── index.html          # Bản cũ, không dùng nữa
```

---

# Cách rollback nhanh nếu có gì đó bể

## Client (HTML/JS/CSS)
```bash
git log --oneline -20                  # xem commit history
git revert <commit-sha>                # revert 1 commit cụ thể
git push origin main                   # auto deploy Pages
```
Team refresh app → auto-update poll bắt build mới → tự reload trong 15s.

## Database (Supabase)
Xem header từng file `db/migrations/*.sql` — có full rollback SQL.
Tổng quan:
- Index: `DROP INDEX IF EXISTS <tên>` — không mất data
- Policy: `DROP POLICY IF EXISTS <tên> ON <bảng>` — không mất data
- Trigger: `DROP TRIGGER IF EXISTS <tên> ON <bảng>` — không mất data
- Function: `CREATE OR REPLACE FUNCTION` lại bản cũ — không mất data
- Extension move: `ALTER EXTENSION unaccent SET SCHEMA public` — không mất data

## Restore data từ backup JSON
File `supabase-backup-2026-09-25.json` — 601 KB, 14 bảng, 1469 dòng.
Cách restore:
1. `TRUNCATE public.<bảng> CASCADE` (careful — sẽ xoá dữ liệu mới thêm)
2. Insert lại từ JSON qua Supabase Dashboard → Table Editor → Import,
   hoặc chạy script `INSERT INTO public.<bảng> SELECT * FROM jsonb_populate_recordset(NULL::public.<bảng>, '<json_array>')`

Ảnh trên Cloudflare R2 KHÔNG bị đụng — URL vẫn còn trong data → restore
là ảnh về đúng chỗ.

---

# Còn cần làm tay (không có API remote)

1. **Redeploy `bao-cao-cong-viec/Code.gs` lên Apps Script** — để security
   fix mật khẩu có hiệu lực server-side. Cách: mở Apps Script editor →
   paste `Code.gs` mới → Deploy → New version. Không cấp bách
2. **Delete branch `claude/bold-ramanujan-punjhe`** trên GitHub UI (đã merge
   nhưng CLI không xoá được do proxy)
3. **QA tay trên điện thoại**: refresh app → smoke test các flow chính
