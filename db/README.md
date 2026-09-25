# DB migrations — Supabase project `vlhwagmqpnbsijkzztvi`

## Trạng thái

Tất cả migration bên dưới đã apply trong session 2026-09-25 qua Supabase
MCP. Backup `supabase-backup-2026-09-25.json` (601 KB, 14 bảng, 1469 dòng)
đã tách riêng cho anh — restore lại được nếu cần.

- **001_indexes.sql** — ✅ apply. `idx_maintenance_cases_linked_ticket_id`
  (FK unindexed advisor flag).
- **002_harden_trigger_search_path.sql** — ✅ apply. `SET search_path=''`
  cho 2 trigger `set_updated_at` + `warranty_touch_updated_at` (WARN
  `function_search_path_mutable`).
- **003_move_unaccent_to_extensions.sql** — ✅ apply. `unaccent` extension
  chuyển từ `public` → `extensions` schema (WARN `extension_in_public`).
  `search_project_codes` đã có `search_path TO 'public','extensions'` sẵn.
- **004_explicit_deny_policies.sql** — ✅ apply. Deny-all policy cho 5
  bảng RLS-no-policy (INFO): `app_config, app_users, attendance,
  expense_lines, trips`. RPC vẫn qua được vì owned by `postgres`
  (`rolbypassrls=true`).
- **005_audit_log_for_team.sql** — ✅ apply. Vì app dùng cho team →
  bảng `audit_log` + trigger AFTER UPDATE/DELETE trên 3 bảng
  (`tickets`, `maintenance_cases`, `warranty_receipts`) + RPC
  `list_audit_log` admin-only. Xem qua Supabase Dashboard → Table
  Editor → `audit_log`, hoặc gọi RPC:
  ```js
  supabase.rpc('list_audit_log', {
    p_admin_password: '...',   // mật khẩu quản trị nhóm 'settings'
    p_table: 'tickets',        // hoặc null cho tất cả
    p_row_id: null,            // hoặc id cụ thể cho phép filter
    p_limit: 100
  })
  ```

## Cách chạy migration mới (khi thêm file kế tiếp)

1. **Backup Supabase (bắt buộc)** — 2 cách chồng lên nhau cho chắc:
   - App: ⚙️ Cài đặt → "Sao lưu Supabase → Drive" (JSON toàn bộ bảng)
   - Supabase Dashboard → Database → Backups → "Take manual backup" (native
     Postgres backup, restore được nhanh nhất)
2. Mở Supabase Dashboard → SQL Editor
3. Copy toàn bộ file `.sql` cần chạy, paste, bấm Run
4. Đọc kỹ output. Mọi migration ở đây phải dùng `IF NOT EXISTS` /
   `IF EXISTS` để chạy lại nhiều lần đều an toàn.

## Backup dữ liệu hiện tại

Xem file `supabase-backup-2026-09-25.json` được gửi cho anh (601 KB JSON,
14 bảng, 1469 dòng, ảnh R2/Supabase Storage giữ nguyên URL — restore lại
là toàn bộ ticket + ảnh về đúng chỗ).

Restore từ backup JSON: bulk-insert vào từng bảng qua Supabase Dashboard
Table Editor → Insert → "Import data from CSV/JSON", hoặc chạy 1 script
psql client-side.

## Advisor Supabase còn lại (không có ERROR, chỉ WARN thiết kế cố ý)

- ~~`function_search_path_mutable` × 2~~ — ✅ fix ở 002.
- ~~`extension_in_public` × 1~~ — ✅ fix ở 003.
- ~~`rls_enabled_no_policy` × 5~~ — ✅ fix ở 004.
- `anon_security_definer_function_executable` × 68 (và `authenticated`
  × 68): 68 RPC là SECURITY DEFINER, gọi được từ anon key. Đây là
  **thiết kế cố ý** của app (RPC check admin password bên trong function
  body). Muốn "sửa" phải rewrite auth: bỏ anon key, dùng Supabase Auth
  users hoặc service_role — sẽ phá app cho cả team. **Bỏ qua**.
- `unused_index` × 6: index có sẵn (`idx_warranty_*`, index mới thêm,
  index audit_log) chưa có query nào chạy đến. Sẽ dùng khi warranty/audit
  scale lên hoặc admin bấm view audit lần đầu.
