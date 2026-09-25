-- ============================================================================
-- 002_harden_trigger_search_path.sql — Đã APPLY 2026-09-25.
-- ============================================================================
-- Advisor: function_search_path_mutable (WARN × 2). 2 hàm trigger chỉ set
-- new.updated_at := now() (now() từ pg_catalog luôn có sẵn), nên set
-- search_path='' vô hại + chống kịch bản search_path bị hijack.
--
-- Rollback: chạy lại CREATE OR REPLACE BỎ dòng `SET search_path = ''`.
-- KHÔNG mất dữ liệu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.warranty_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
begin new.updated_at := now(); return new; end
$function$;
