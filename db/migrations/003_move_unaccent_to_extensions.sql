-- ============================================================================
-- 003_move_unaccent_to_extensions.sql — Đã APPLY 2026-09-25.
-- ============================================================================
-- Advisor: extension_in_public WARN. Extension `unaccent` được cài trong
-- schema `public` (mặc định) — nhắc di dời ra schema riêng để giữ public
-- schema sạch chỉ chứa app data + RPC.
--
-- Hàm `search_project_codes` đã có sẵn `SET search_path TO 'public',
-- 'extensions'` nên vẫn resolve được `unaccent(...)` sau khi di dời —
-- KHÔNG cần đổi function body, đã test `search_project_codes('aeon',5)`
-- trả 5 rows sau migration.
--
-- Rollback: `ALTER EXTENSION unaccent SET SCHEMA public;`
-- KHÔNG mất dữ liệu.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
ALTER EXTENSION unaccent SET SCHEMA extensions;
