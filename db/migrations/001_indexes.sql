-- ============================================================================
-- 001_indexes.sql — Tăng tốc query hay chạy nhất, KHÔNG đổi dữ liệu.
-- ============================================================================
-- Trước khi Run migration này:
--   1. Backup: app ⚙️ → "Sao lưu Supabase → Drive"
--   2. Backup: Supabase Dashboard → Database → Backups → "Take a manual backup"
-- Xem db/README.md để biết chi tiết.
--
-- Tất cả `CREATE INDEX IF NOT EXISTS` — chạy lại nhiều lần đều an toàn.
-- Nếu muốn rollback: `DROP INDEX IF EXISTS <ten>` không mất dữ liệu.
-- ============================================================================

-- ============ TICKETS (bảng chính, dùng nhiều nhất) =========================
-- listTickets(year,month): lọc theo ticket_date giữa 2 mốc + sort id.
-- renderManager filter: engineer, customer, status, priority.
-- Realtime channel subscribe theo table 'tickets' đã có index (id primary key).
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_date ON public.tickets (ticket_date DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_engineer    ON public.tickets (engineer);
CREATE INDEX IF NOT EXISTS idx_tickets_customer    ON public.tickets (customer);
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON public.tickets (status);
-- Composite khi lọc chồng nhiều điều kiện (thường gặp ở Quản lý)
CREATE INDEX IF NOT EXISTS idx_tickets_date_customer ON public.tickets (ticket_date DESC, customer);

-- ============ TICKET_PHOTOS =================================================
-- showPhotos(no): SELECT * FROM ticket_photos WHERE ticket_id=? ORDER BY id.
-- Không có FK index mặc định trong Postgres → thêm.
CREATE INDEX IF NOT EXISTS idx_ticket_photos_ticket_id ON public.ticket_photos (ticket_id);

-- ============ MAINTENANCE_CASES (Tiếp nhận Zalo, tab mặc định lúc mở app) ==
-- listMaintenanceCases: SELECT * ORDER BY id — id là PK, đã có index.
-- Nhưng lọc/render theo status/assigned_engineer cần index để nhanh.
CREATE INDEX IF NOT EXISTS idx_cases_status              ON public.maintenance_cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_engineer   ON public.maintenance_cases (assigned_engineer);
CREATE INDEX IF NOT EXISTS idx_cases_created_at          ON public.maintenance_cases (created_at DESC);

-- ============ AEON_TICKETS ===================================================
-- listAeonTickets: SELECT * ORDER BY ticket_date, id — hỗ trợ index (ticket_date, id).
CREATE INDEX IF NOT EXISTS idx_aeon_tickets_date_id ON public.aeon_tickets (ticket_date DESC, id);
CREATE INDEX IF NOT EXISTS idx_aeon_tickets_customer ON public.aeon_tickets (customer);

-- ============ WARRANTY_RECEIPTS =============================================
-- loadWarranty: SELECT * ORDER BY id DESC. Đã có PK. Lọc status/date thêm.
CREATE INDEX IF NOT EXISTS idx_warranty_received_at ON public.warranty_receipts (received_at DESC);

-- ============ PROJECT_CODES (autofill mã vụ việc) ==========================
-- Bảng 1200+ dòng, search_project_codes RPC gọi khi gõ tìm.
-- Nếu RPC dùng ILIKE thì cần pg_trgm index để nhanh; ILIKE '%q%' không dùng
-- được b-tree. Đây là gợi ý, chỉ tạo nếu đang dùng ILIKE % q %.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_project_codes_code_trgm ON public.project_codes USING gin (code gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_project_codes_name_trgm ON public.project_codes USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_project_codes_code ON public.project_codes (code);

-- ============ CTP (công tác phí) =============================================
-- Nhóm dòng theo trip_id: ctpCurrentLines filter trip_id === currentTripId.
-- Nếu bảng CTP đặt tên khác thì đổi tương ứng — không có tên chuẩn trong client code.
-- (Bỏ qua nếu chưa có bảng này, migration sẽ báo lỗi rõ tên bảng.)
-- CREATE INDEX IF NOT EXISTS idx_expense_lines_trip_id ON public.expense_lines (trip_id);
-- CREATE INDEX IF NOT EXISTS idx_expense_lines_engineer ON public.expense_lines (engineer_name);

-- ============ Sau khi chạy, kiểm tra ========================================
-- SELECT indexname, tablename, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND indexname LIKE 'idx_%' ORDER BY tablename, indexname;
