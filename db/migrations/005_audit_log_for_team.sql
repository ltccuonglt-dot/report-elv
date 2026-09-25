-- ============================================================================
-- 005_audit_log_for_team.sql — Đã APPLY 2026-09-25.
-- ============================================================================
-- Vì app dùng cho nhiều người trong team → cần biết ai đã sửa/xoá phiếu
-- nào lúc nào. Thêm audit log server-side, KHÔNG đụng RPC/bảng hiện có,
-- KHÔNG bắt team refresh app.
--
-- Cấu trúc:
--   - Bảng public.audit_log (id, changed_at, table_name, row_id, op,
--     actor, old_data, new_data)
--   - Trigger `audit_row_change` gọi từ 3 bảng: tickets, maintenance_cases,
--     warranty_receipts (AFTER UPDATE OR DELETE)
--   - RPC public.list_audit_log(admin_pw, table, row_id, limit) — admin-only,
--     dùng cho UI xem lịch sử trong tương lai
--
-- Xem ngay bằng Supabase Dashboard → Table Editor → audit_log.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_audit_tickets ON public.tickets;
--   DROP TRIGGER IF EXISTS trg_audit_maintenance_cases ON public.maintenance_cases;
--   DROP TRIGGER IF EXISTS trg_audit_warranty_receipts ON public.warranty_receipts;
--   DROP FUNCTION IF EXISTS public.list_audit_log(text, text, bigint, int);
--   DROP FUNCTION IF EXISTS public.audit_row_change();
--   DROP TABLE IF EXISTS public.audit_log;
-- KHÔNG mất dữ liệu app (chỉ mất lịch sử audit đã tích luỹ).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           bigserial PRIMARY KEY,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  table_name   text NOT NULL,
  row_id       bigint,
  op           text NOT NULL,
  actor        text,
  old_data     jsonb,
  new_data     jsonb
);
COMMENT ON TABLE public.audit_log IS 'Nhat ky sua/xoa cua tickets/maintenance_cases/warranty_receipts. Chi ghi UPDATE va DELETE; truy cap qua RPC list_audit_log (admin).';

CREATE INDEX IF NOT EXISTS idx_audit_log_table_row  ON public.audit_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.audit_log (changed_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_direct_access" ON public.audit_log;
CREATE POLICY "deny_direct_access" ON public.audit_log FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON POLICY "deny_direct_access" ON public.audit_log IS 'Chan truy cap truc tiep. Doc qua RPC list_audit_log (admin).';

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
declare
  v_actor text;
begin
  begin
    v_actor := current_setting('request.jwt.claims', true)::jsonb->>'sub';
  exception when others then
    v_actor := null;
  end;

  if TG_OP = 'DELETE' then
    insert into public.audit_log(table_name, row_id, op, actor, old_data, new_data)
      values(TG_TABLE_NAME, (to_jsonb(OLD)->>'id')::bigint, 'DELETE', v_actor, to_jsonb(OLD), null);
    return OLD;
  else
    insert into public.audit_log(table_name, row_id, op, actor, old_data, new_data)
      values(TG_TABLE_NAME, (to_jsonb(NEW)->>'id')::bigint, 'UPDATE', v_actor, to_jsonb(OLD), to_jsonb(NEW));
    return NEW;
  end if;
end;
$function$;
-- Trigger function — không cần role gọi từ ngoài.
REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_audit_tickets            ON public.tickets;
DROP TRIGGER IF EXISTS trg_audit_maintenance_cases  ON public.maintenance_cases;
DROP TRIGGER IF EXISTS trg_audit_warranty_receipts  ON public.warranty_receipts;
CREATE TRIGGER trg_audit_tickets           AFTER UPDATE OR DELETE ON public.tickets           FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_maintenance_cases AFTER UPDATE OR DELETE ON public.maintenance_cases FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_warranty_receipts AFTER UPDATE OR DELETE ON public.warranty_receipts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE OR REPLACE FUNCTION public.list_audit_log(
  p_admin_password text,
  p_table text DEFAULT NULL,
  p_row_id bigint DEFAULT NULL,
  p_limit int DEFAULT 100
)
 RETURNS SETOF public.audit_log
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = ''
AS $function$
begin
  if not public.verify_admin(p_admin_password) then
    raise exception 'Sai mat khau quan tri';
  end if;
  return query
    select * from public.audit_log
     where (p_table is null or table_name = p_table)
       and (p_row_id is null or row_id = p_row_id)
     order by changed_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$function$;

GRANT EXECUTE ON FUNCTION public.list_audit_log(text, text, bigint, int) TO anon, authenticated;
