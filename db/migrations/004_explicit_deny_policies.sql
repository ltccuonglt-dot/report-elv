-- ============================================================================
-- 004_explicit_deny_policies.sql — Đã APPLY 2026-09-25.
-- ============================================================================
-- Advisor: rls_enabled_no_policy INFO × 5. 5 bảng bật RLS mà 0 policy:
--   app_config, app_users, attendance, expense_lines, trips
-- Đây là default deny → đúng thiết kế: 5 bảng này chỉ truy cập qua RPC
-- SECURITY DEFINER (owned by `postgres` role có `rolbypassrls=true`), không
-- có `sb.from(...)` nào trong client code truy cập trực tiếp (đã verify).
--
-- Thêm explicit "deny_direct_access" policy để advisor không còn cảnh báo
-- + document intent rõ ràng cho maintainer sau. KHÔNG đổi hành vi: RPC vẫn
-- qua được (bypass RLS), direct REST/GraphQL vẫn bị chặn.
--
-- Rollback: `DROP POLICY "deny_direct_access" ON public.<table>;`
-- KHÔNG mất dữ liệu.
-- ============================================================================

CREATE POLICY "deny_direct_access" ON public.app_config    FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access" ON public.app_users     FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access" ON public.attendance    FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access" ON public.expense_lines FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY "deny_direct_access" ON public.trips         FOR ALL TO public USING (false) WITH CHECK (false);

COMMENT ON POLICY "deny_direct_access" ON public.app_config    IS 'Chan truy cap truc tiep qua REST/GraphQL. Truy cap chi qua RPC SECURITY DEFINER (bypass RLS).';
COMMENT ON POLICY "deny_direct_access" ON public.app_users     IS 'Chan truy cap truc tiep qua REST/GraphQL. Truy cap chi qua RPC SECURITY DEFINER (bypass RLS).';
COMMENT ON POLICY "deny_direct_access" ON public.attendance    IS 'Chan truy cap truc tiep qua REST/GraphQL. Truy cap chi qua RPC SECURITY DEFINER (bypass RLS).';
COMMENT ON POLICY "deny_direct_access" ON public.expense_lines IS 'Chan truy cap truc tiep qua REST/GraphQL. Truy cap chi qua RPC SECURITY DEFINER (bypass RLS).';
COMMENT ON POLICY "deny_direct_access" ON public.trips         IS 'Chan truy cap truc tiep qua REST/GraphQL. Truy cap chi qua RPC SECURITY DEFINER (bypass RLS).';
