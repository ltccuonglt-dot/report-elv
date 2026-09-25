# DB migrations — Supabase project `vlhwagmqpnbsijkzztvi`

## Trạng thái

- **001_indexes.sql** — ✅ **Đã apply 2026-09-25** (add 1 index cho FK
  `maintenance_cases.linked_ticket_id` mà advisor flag). Rollback bằng
  `DROP INDEX IF EXISTS idx_maintenance_cases_linked_ticket_id` — không mất
  data.
- **002_harden_trigger_search_path.sql** — ✅ **Đã apply 2026-09-25**
  (`SET search_path=''` cho 2 hàm trigger `set_updated_at` +
  `warranty_touch_updated_at`, sửa advisor WARN
  `function_search_path_mutable`). Rollback: `CREATE OR REPLACE FUNCTION`
  lại bỏ dòng `SET search_path`. KHÔNG đổi hành vi.

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

## Advisor Supabase còn lại (WARN, không blocking)

- ~~`function_search_path_mutable` × 2~~ — ✅ đã fix ở 002.
- `extension_in_public` × 1: `unaccent` nằm ở schema public. Đã kiểm: 3
  function trong `public.*` gọi `unaccent(...)` không schema-qualified →
  di dời `unaccent` sang schema riêng sẽ vỡ 3 hàm đó. Để nguyên vì WARN
  không blocking, chỉ khuyến nghị hardening.
- `anon_security_definer_function_executable` × 66 (và `authenticated`
  × 66): 66 RPC function là SECURITY DEFINER, gọi được từ anon key. Đây
  là **thiết kế cố ý** của app (RPC check admin password bên trong
  function), không phải lỗ hổng. Bỏ qua.
- `rls_enabled_no_policy` × 5: 5 bảng bật RLS mà không có policy → không
  bảng nào truy cập trực tiếp qua REST được, chỉ đi qua RPC. Đúng thiết kế.
- `unused_index` × 4: 4 index có sẵn (`idx_warranty_*` và index mới thêm)
  chưa có query nào chạy đến. Sẽ dùng khi warranty scale lên hoặc user
  hoàn tất maintenance case đầu tiên.
