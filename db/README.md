# DB migrations — cách chạy an toàn

Thư mục này chứa các câu SQL đề xuất chạy trên Supabase để **tăng tốc query**
mà app phía client hiện đang gọi. Chúng chỉ tạo INDEX — **không thêm/sửa/xoá
dữ liệu**, không đổi schema, hoàn toàn có thể `DROP INDEX` để rollback nếu
cần. Dù vậy, **luôn backup trước** khi chạy bất kỳ migration nào.

## Bước bắt buộc TRƯỚC khi chạy

1. Mở app → ⚙️ Cài đặt → nhập mật khẩu quản trị nhóm "settings"
2. Bấm **"Sao lưu Supabase → Drive"** (function `DB.backupSupabaseToDrive`
   trong client, chạy qua Apps Script, ghi 1 file JSON toàn bộ Supabase
   vào Drive folder `Report ELV - Anh Phieu Luu Tru`).
3. Đợi toast báo ✅ hoàn tất. Kiểm tra file mới có xuất hiện trong Drive.
4. **Ngoài ra** vào Supabase Dashboard → Project → Database → Backups →
   "Take a manual backup" (backup mức Postgres, đầy đủ hơn JSON dump).

Xong 2 bước backup → sang chạy migration.

## Cách chạy trên Supabase

1. Mở Supabase Dashboard → Project → SQL Editor
2. Copy toàn bộ file `.sql` bên dưới, paste vào editor
3. Bấm "Run"
4. Đọc kỹ output — mọi câu đều dùng `IF NOT EXISTS` nên chạy lại nhiều lần
   là an toàn (idempotent).

## Rollback nếu cần

Xoá index đã tạo cực đơn giản (không mất data):
```sql
DROP INDEX IF EXISTS idx_tickets_ticket_date;
DROP INDEX IF EXISTS idx_tickets_engineer;
DROP INDEX IF EXISTS idx_tickets_customer;
DROP INDEX IF EXISTS idx_tickets_status;
-- ... tương tự các index khác
```

Query sẽ trở lại tốc độ như cũ, dữ liệu KHÔNG thay đổi.

## Danh sách migration

- [`001_indexes.sql`](./migrations/001_indexes.sql) — index cho tickets,
  maintenance_cases, aeon_tickets, warranty, attendance, expense_lines
