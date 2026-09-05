/**********************************************************************
 *  REPORT ELV — Google Apps Script (App -> Sheet)
 *  --------------------------------------------------------------
 *  Ghi phiếu từ app điện thoại vào Google Sheet.
 *  Cột: No | Date | Customer | System | Issue | Priority |
 *       Engineer | Support | Status | Remark
 *
 *  ✔ Nhiều người ghi cùng lúc (LockService chống trùng số phiếu)
 *  ✔ Trình bày đẹp giống báo cáo Ticket Database gốc AEON Huế
 *  ✔ Dashboard tự động (biểu đồ Online/On-Site, mức ưu tiên, trạng thái)
 *  ✔ Công thức dùng dấu ";" — vì Sheet đang ở locale vi_VN
 *
 *  CÁCH DÙNG: xem file HUONG-DAN.txt
 **********************************************************************/

// ⚠️ ĐỔI mã bảo mật này thành mã của riêng bạn (nhập giống trong app ⚙️)
var TOKEN = 'AEON-KT-2026';

// Mật khẩu quản trị MẶC ĐỊNH (chỉ dùng lần đầu, trước khi ai đổi qua app).
// Dùng để: (1) mở khóa màn Cài đặt trên app, (2) cho phép sửa phiếu KHÔNG giới hạn
// số lần (người dùng thường chỉ được sửa tối đa EDIT_LIMIT lần / phiếu).
// App KHÔNG còn tự lưu sẵn mật khẩu này nữa — luôn hỏi server (qua action
// 'verifyAdmin') để kiểm tra, nên đổi mật khẩu qua app (⚙️ → Đổi mật khẩu
// quản trị) là có hiệu lực ngay, không cần sửa code này/index.html nữa.
var ADMIN_PASSWORD = 'Cuongok09';
var EDIT_LIMIT = 5;

/* Mật khẩu quản trị THẬT ĐANG DÙNG — nếu đã từng đổi qua app thì lấy bản mới
   nhất lưu trong Script Properties, chưa đổi lần nào thì dùng ADMIN_PASSWORD
   mặc định ở trên. */
function getAdminPassword(){
  var v = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD_OVERRIDE');
  return v || ADMIN_PASSWORD;
}

/* Đổi mật khẩu quản trị — phải đúng mật khẩu HIỆN TẠI mới đổi được. Lưu vào
   Script Properties nên có hiệu lực ngay trên MỌI thiết bị, không cần sửa
   code. */
// Thư mục Drive dùng để lưu trữ lâu dài ảnh/PDF đính kèm phiếu (Supabase
// Storage giới hạn 1GB free tier — chuyển phiếu cũ >6 tháng sang đây để
// giải phóng dung lượng). Tạo 1 lần, tái sử dụng các lần sau.
function getOrCreateArchiveFolder_(){
  var name = 'Report ELV - Anh Phieu Luu Tru';
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

// Tải 1 file từ URL công khai (Supabase Storage) về rồi lưu vào Drive, trả
// về link Drive mới — dùng cho việc chuyển ảnh/PDF phiếu cũ sang lưu trữ.
// Bắt buộc đúng mật khẩu quản trị (đây là thao tác quản trị, admin tự bấm).
function handleArchiveFileToDrive(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  if (!data.fileUrl) return json({ok:false, error:'Thieu fileUrl'});
  try{
    var resp = UrlFetchApp.fetch(data.fileUrl, {muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) return json({ok:false, error:'Khong tai duoc file goc (HTTP '+resp.getResponseCode()+')'});
    var blob = resp.getBlob().setName(data.fileName || 'file');
    var folder = getOrCreateArchiveFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return json({ok:true, driveUrl:file.getUrl(), fileId:file.getId()});
  }catch(err){
    return json({ok:false, error:String(err)});
  }
}

// Xoá 1 file trong thư mục lưu trữ ảnh phiếu (dùng khi dọn file thử nghiệm
// hoặc xoá nhầm) — chỉ admin, chỉ xoá được file nằm trong đúng thư mục đó.
function handleDeleteDriveFile(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  try{
    var file = DriveApp.getFileById(data.fileId);
    var ok = false, parents = file.getParents();
    while (parents.hasNext()){
      if (parents.next().getName() === 'Report ELV - Anh Phieu Luu Tru') { ok = true; break; }
    }
    if (!ok) return json({ok:false, error:'File khong nam trong thu muc luu tru'});
    file.setTrashed(true);
    return json({ok:true});
  }catch(err){ return json({ok:false, error:String(err)}); }
}

function handleChangeAdminPassword(data){
  if (!(data.oldPassword && data.oldPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau hien tai'});
  }
  var newPass = String(data.newPassword || '').trim();
  if (newPass.length < 4) return json({ok:false, error:'Mat khau moi qua ngan (toi thieu 4 ky tu)'});
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_OVERRIDE', newPass);
  return json({ok:true});
}

// Sheet backup — mọi phiếu ghi/sửa ở Sheet chính sẽ tự động ghi thêm 1 bản
// vào đây (cùng thư mục Drive). Nếu backup lỗi thì KHÔNG chặn thao tác chính.
var BACKUP_SPREADSHEET_ID = '1Fs3dsRBfVw-zxYRoDKa5_slPLaddIm5_XFiwjCoVSUc';

// Sheet CHÍNH chứa phiếu ("Report ELV"). Mở theo ID thay vì
// getActiveSpreadsheet() để code chạy được ở CẢ 2 dạng project: gắn liền với
// Sheet (container-bound) lẫn project độc lập (standalone) — cần thiết vì
// backend hiện được triển khai từ project độc lập.
var MAIN_SPREADSHEET_ID = '1uefQz_JpqgN7ax4_M4CJtoiMuoTl03xfWVq5YKgS-ws';
function getMainSpreadsheet_(){
  return SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
}

var SHEET_NAME = 'Ticket Database';
var DASH_SHEET_NAME = 'Dashboard';
var ENGINEER_SHEET_NAME = 'Ky Su';
// Danh sách kỹ sư mặc định — chỉ dùng để khởi tạo sheet "Ky Su" LẦN ĐẦU TIÊN
// (sheet trống). Sau đó danh sách thật nằm trong sheet, thêm/xóa qua app ⚙️.
var DEFAULT_ENGINEERS = ['Nguyễn Thái Bảo','Võ Quỳnh Bảo Châu','Lê Minh Anh',
                          'Phạm Nguyễn Gia Huy','Nguyễn Trung Hiếu','Lê Tấn Cường'];
// WorkType (Loại công việc: Bảo hành/Bảo trì/Lắp mới/Khảo sát) thêm ở CUỐI
// (sau EditCount) chứ không chen giữa — để không phải sửa lại mọi chỗ đang
// tham chiếu số cột cố định (2=Date, 11=EditCount...) của các cột cũ.
var HEADERS = ['No','Date','Customer','System','Issue','Priority',
               'Engineer','Support','Status','Remark','EditCount','WorkType'];

// Định dạng theo bản gốc AEON Huế
var HEADER_BG = '#1F4E78';
var DASH_TITLE_BG = '#244061';   // màu nền tiêu đề Dashboard (theo file gốc AEON Huế)
var DASH_SUBHEAD_BG = '#92CDDC'; // màu nền header các bảng con trong Dashboard (theo file gốc)
var HEADER_FG = '#FFFFFF';
var COL_WIDTHS = [60,140,150,90,420,90,190,85,85,450,70,110];
var CENTER_COLS = [1,2,4,6,8,9,11,12]; // No, Date, System, Priority, Support, Status, EditCount, WorkType

/* ================= NHẬN PHIẾU MỚI (POST) ================= */
function doPost(e){
  var lock = LockService.getScriptLock();
  try{
    lock.waitLock(30000);

    var data = JSON.parse(e.postData.contents);
    if (TOKEN && data.token !== TOKEN) return json({ok:false, error:'Sai ma bao mat'});

    if (data.action === 'update') return handleUpdate(data);
    if (data.action === 'edit') return handleEdit(data);
    if (data.action === 'delete') return handleDelete(data);
    if (data.action === 'addEngineer') return handleAddEngineer(data);
    if (data.action === 'deleteEngineer') return handleDeleteEngineer(data);
    if (data.action === 'clearAllData') return handleClearAllData(data);
    if (data.action === 'syncBackup') return handleSyncBackup(data);
    if (data.action === 'clearBackupRange') return handleClearBackupRange(data);
    if (data.action === 'verifyAdmin') return json({ok: !!(data.pass && data.pass === getAdminPassword())});
    if (data.action === 'changeAdminPassword') return handleChangeAdminPassword(data);
    if (data.action === 'addAttendance') return handleAddAttendance(data);
    if (data.action === 'updateAttendance') return handleUpdateAttendance(data);
    if (data.action === 'deleteAttendance') return handleDeleteAttendance(data);
    if (data.action === 'clearAttendanceMonth') return handleClearAttendanceMonth(data);
    if (data.action === 'addExpense') return handleAddExpense(data);
    if (data.action === 'updateExpense') return handleUpdateExpense(data);
    if (data.action === 'deleteExpense') return handleDeleteExpense(data);
    if (data.action === 'deleteExpenseTrip') return handleDeleteExpenseTrip(data);
    if (data.action === 'archiveFileToDrive') return handleArchiveFileToDrive(data);
    if (data.action === 'deleteDriveFile') return handleDeleteDriveFile(data);

    var sh = getSheet();
    var no = nextTicketNo(sh);
    var dateVal = data.date ? new Date(data.date + 'T00:00:00') : new Date();

    sh.appendRow([
      no, dateVal, data.customer||'', data.system||'', data.issue||'',
      data.priority||'', data.engineer||'', data.support||'', data.status||'', data.remark||'', 0,
      data.workType||''
    ]);
    var row = sh.getLastRow();
    sh.getRange(row, 2).setNumberFormat('yyyy-mm-dd');
    styleDataRow(sh, row);
    SpreadsheetApp.flush();

    try{ ensureDashboard(); }catch(dashErr){ /* không chặn việc gửi phiếu nếu dashboard lỗi */ }
    // KHÔNG tự đồng bộ sang backup ở đây nữa (trước đây có) — để lỡ xóa/sửa
    // nhầm ở Sheet chính thì backup (từ lần bấm "Đồng bộ" gần nhất) vẫn còn
    // dữ liệu cũ mà xem/khôi phục lại. Chỉ admin bấm nút "Đồng bộ Sheet
    // chính → Backup" trong Cài đặt mới thật sự ghi đè backup.

    return json({ok:true, no:no});
  }catch(err){
    return json({ok:false, error:String(err)});
  }finally{
    try{ lock.releaseLock(); }catch(e2){}
  }
}

/* ============ LẤY DANH SÁCH / KIỂM TRA (GET) ============ */
function doGet(e){
  var p = e.parameter || {};
  if (TOKEN && p.token !== TOKEN) return json({ok:false, error:'Sai ma bao mat'});
  if (p.action === 'ping') return json({ok:true, msg:'pong'});
  if (p.action === 'engineers') return json({ok:true, data:listEngineers()});
  if (p.action === 'meta') return json({ok:true, signal:getSheetSignal()});
  if (p.action === 'periodInfo') return json(Object.assign({ok:true}, getPeriodInfo()));
  if (p.action === 'getOne') return handleGetOne(p);
  // Chấm công / Công tác phí — riêng tư (dữ liệu công/lương), nên bắt buộc
  // đúng mật khẩu quản trị mới ĐỌC được, không chỉ ẩn nút trên giao diện.
  if (p.action === 'listAttendance'){
    if (!(getAdminPassword() && p.adminPassword === getAdminPassword())) return json({ok:false, error:'Sai mat khau quan tri'});
    return json({ok:true, data:listAttendance(p.employee, p.year, p.month)});
  }
  if (p.action === 'listExpenses'){
    if (!(getAdminPassword() && p.adminPassword === getAdminPassword())) return json({ok:false, error:'Sai mat khau quan tri'});
    return json({ok:true, data:listExpenses()});
  }

  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:true, data:[]});

  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var rows = values.map(function(r){
    return {
      no:r[0], date:fmtDate(r[1]), customer:r[2], system:r[3], issue:r[4],
      priority:r[5], engineer:r[6], support:r[7], status:r[8], remark:r[9],
      editCount:Number(r[10])||0, workType:r[11]||''
    };
  }).filter(function(x){ return x.no !== '' && x.no != null; });

  // Lọc theo năm/tháng NGAY TRÊN SERVER nếu app yêu cầu (vd chỉ xin đúng
  // tháng hiện tại để tải nhanh/nhẹ trước) — trả về ít dữ liệu hơn qua mạng,
  // giúp app mở nhanh hơn khi Sheet có nhiều phiếu về sau. Không truyền
  // year/month thì trả về TOÀN BỘ như trước (không đổi hành vi mặc định).
  if (p.year || p.month){
    rows = rows.filter(function(r){
      if (!r.date) return false;
      var y = r.date.slice(0,4), m = r.date.slice(5,7);
      if (p.year && y !== String(p.year)) return false;
      if (p.month && m !== String(p.month)) return false;
      return true;
    });
  }

  // Sắp xếp No từ bé đến lớn (thứ tự tăng dần) — không đảo ngược nữa.
  rows.sort(function(a,b){ return Number(a.no) - Number(b.no); });
  return json({ok:true, data:rows});
}

/* ================= Sheet BACKUP (bản sao dự phòng) ================= */
/* Mở/khởi tạo sheet dữ liệu bên trong file backup — không bao giờ ném lỗi ra
   ngoài (trả về null nếu backup không mở được) để không ảnh hưởng Sheet chính. */
function getBackupSheet(){
  if (!BACKUP_SPREADSHEET_ID) return null;
  try{
    var bss = SpreadsheetApp.openById(BACKUP_SPREADSHEET_ID);
    ensureVietnamTimeZone(bss);
    var sh = bss.getSheetByName(SHEET_NAME);
    if (!sh){
      var all = bss.getSheets();
      for (var i = 0; i < all.length; i++){
        var nm = all[i].getName();
        if (nm !== DASH_SHEET_NAME && nm !== ENGINEER_SHEET_NAME){ sh = all[i]; break; }
      }
      if (!sh) sh = all[0];
    }
    if (sh.getLastRow() === 0){ sh.appendRow(HEADERS); styleHeader(sh); }
    ensureAllColumns(sh);
    return sh;
  }catch(err){ return null; }
}

/* Đồng bộ THỦ CÔNG toàn bộ Sheet chính -> backup (ghi đè hoàn toàn) — ĐÂY LÀ
   CÁCH DUY NHẤT backup được cập nhật (gửi/sửa/xóa phiếu ở Sheet chính KHÔNG
   tự động kéo theo backup nữa). Cố ý làm vậy để nếu lỡ xóa/sửa nhầm 1 phiếu
   ở Sheet chính, backup (tính từ lần bấm "Đồng bộ" gần nhất) vẫn còn dữ liệu
   cũ để admin tự xem/chép lại — chứ không bị mất theo luôn. CHỈ admin (đúng
   mật khẩu quản trị) mới gọi được. */
/* Tô đẹp 1 khối nhiều dòng liên tiếp (giống styleDataRow nhưng làm 1 lần cho
   cả khối, nhanh hơn nhiều so với gọi styleDataRow từng dòng riêng lẻ). */
function styleBlock(sh, startRow, numRows){
  if (numRows <= 0) return;
  var rng = sh.getRange(startRow, 1, numRows, HEADERS.length);
  rng.setBackground('#FFFFFF').setFontFamily('Times New Roman').setFontSize(12).setFontWeight('normal');
  rng.setBorder(true, true, true, true, true, true, '#D9D9D9', SpreadsheetApp.BorderStyle.SOLID);
  rng.setVerticalAlignment('middle');
  sh.getRange(startRow, 2, numRows, 1).setNumberFormat('yyyy-mm-dd');
  var aligns = [], wraps = [];
  for (var c = 1; c <= HEADERS.length; c++){
    aligns.push(CENTER_COLS.indexOf(c) > -1 ? 'center' : 'left');
    wraps.push(c === 5 || c === 10);
  }
  var alignRows = [], wrapRows = [];
  for (var r = 0; r < numRows; r++){ alignRows.push(aligns); wrapRows.push(wraps); }
  rng.setHorizontalAlignments(alignRows);
  rng.setWraps(wrapRows);
}

/* Nối thêm (KHÔNG xóa/ghi đè dữ liệu cũ) 1 danh sách dòng vào CUỐI backup —
   dùng khi lưu trữ dữ liệu trước lúc xóa kỳ (handleClearAllData), để backup
   tích lũy dần qua nhiều kỳ (6 tháng, 1 năm, 2 năm...) thay vì mất theo.
   Cột No được ĐÁNH LẠI liên tục theo backup (không giữ nguyên No gốc từ
   Sheet chính) — vì Sheet chính luôn bắt đầu lại từ No 1 mỗi kỳ mới, giữ
   nguyên sẽ khiến backup bị trùng No giữa các kỳ khác nhau (vd 2 phiếu khác
   nhau cùng là "No 1"). Đánh nối tiếp từ No lớn nhất đang có trong backup
   nên không bao giờ trùng, dù backup đã tích lũy bao nhiêu kỳ. */
function appendRowsToBackup(values){
  if (!values.length) return;
  var bsh = getBackupSheet();
  if (!bsh) return;
  var startRow = bsh.getLastRow() + 1;
  var maxNo = 0;
  if (startRow > 2){
    var existingNos = bsh.getRange(2, 1, startRow - 2, 1).getValues();
    for (var i = 0; i < existingNos.length; i++){
      var n = Number(existingNos[i][0]);
      if (!isNaN(n) && n > maxNo) maxNo = n;
    }
  }
  var renumbered = values.map(function(row, idx){
    var copy = row.slice();
    copy[0] = maxNo + idx + 1;
    return copy;
  });
  bsh.getRange(startRow, 1, renumbered.length, HEADERS.length).setValues(renumbered);
  styleBlock(bsh, startRow, renumbered.length);
}

/* "Dấu vân tay" 1 dòng dữ liệu — dùng để so trùng giữa Sheet chính và
   backup mà KHÔNG dựa vào cột No (No có thể khác nhau giữa 2 bên, vì backup
   tự đánh số riêng) hay cột EditCount (đổi liên tục không liên quan nội
   dung). Bỏ qua No + EditCount, ghép các cột còn lại thành 1 chuỗi để so. */
function rowFingerprint(row){
  var d = row[1];
  var dateStr = (d && typeof d.getFullYear === 'function') ? fmtDate(d) : String(d || '');
  return [dateStr, row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[11]].join('');
}

/* Đồng bộ THỦ CÔNG Sheet chính -> backup: CHỈ THÊM những phiếu backup CHƯA
   CÓ (so theo nội dung, không tính No/EditCount) — phiếu nào backup đã có
   rồi thì bỏ qua, không tạo trùng. AN TOÀN dùng bao nhiêu lần cũng được,
   kể cả khi backup đang lưu trữ dữ liệu các kỳ cũ (không xóa/ghi đè gì cả,
   chỉ thêm mới). Dùng để tự đồng bộ dần từng ít một trong ngày nếu muốn,
   không cần đợi tới lúc xóa kỳ 6 tháng. */
function handleSyncBackup(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau quan tri'});
  }
  var sh = getSheet();
  var bsh = getBackupSheet();
  if (!bsh) return json({ok:false, error:'Khong mo duoc file backup'});

  var last = sh.getLastRow();
  var mainValues = last >= 2 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];

  var blast = bsh.getLastRow();
  var backupValues = blast >= 2 ? bsh.getRange(2, 1, blast - 1, HEADERS.length).getValues() : [];

  var existing = {};
  backupValues.forEach(function(row){ existing[rowFingerprint(row)] = true; });

  var newRows = mainValues.filter(function(row){ return !existing[rowFingerprint(row)]; });

  if (newRows.length) appendRowsToBackup(newRows);
  SpreadsheetApp.flush();
  return json({ok:true, count: newRows.length, skipped: mainValues.length - newRows.length});
}

/* ================= Sheet "Ky Su" (danh sách kỹ sư) =================
   Lưu tên kỹ sư trên 1 sheet riêng để mọi thiết bị/mọi người dùng đều thấy
   giống nhau (khác localStorage — chỉ lưu trên 1 máy). Thêm/xóa qua app ⚙️,
   yêu cầu mật khẩu quản trị (adminPassword), giống cơ chế sửa phiếu không
   giới hạn số lần dành cho admin. */
function getEngineerSheet(){
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName(ENGINEER_SHEET_NAME);
  if (!sh){
    sh = ss.insertSheet(ENGINEER_SHEET_NAME);
    sh.getRange('A1').setValue('Ten Ky Su').setFontWeight('bold')
      .setBackground(HEADER_BG).setFontColor(HEADER_FG);
    sh.setColumnWidth(1, 220);
    sh.setFrozenRows(1);
    DEFAULT_ENGINEERS.forEach(function(name, i){ sh.getRange(i + 2, 1).setValue(name); });
    try{ sh.setTabColor('#92CDDC'); }catch(err){}
  }
  return sh;
}

function listEngineers(){
  var sh = getEngineerSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  var names = [];
  for (var i = 0; i < vals.length; i++){
    var n = String(vals[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

function handleAddEngineer(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau quan tri'});
  }
  var name = String(data.name || '').trim();
  if (!name) return json({ok:false, error:'Thieu ten ky su'});
  var sh = getEngineerSheet();
  var existing = listEngineers();
  if (existing.some(function(n){ return n.toLowerCase() === name.toLowerCase(); })){
    return json({ok:false, error:'Kỹ sư "'+name+'" đã có trong danh sách'});
  }
  sh.getRange(sh.getLastRow() + 1, 1).setValue(name);
  return json({ok:true, data:listEngineers()});
}

function handleDeleteEngineer(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau quan tri'});
  }
  var name = String(data.name || '').trim();
  if (!name) return json({ok:false, error:'Thieu ten ky su'});
  var sh = getEngineerSheet();
  var last = sh.getLastRow();
  if (last >= 2){
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++){
      if (String(vals[i][0] || '').trim() === name){ sh.deleteRow(i + 2); break; }
    }
  }
  return json({ok:true, data:listEngineers()});
}

/* Số phiếu (No) tiếp theo = MAX(No hiện có) + 1 — KHÔNG dùng số dòng
   (getLastRow), vì sau khi xóa 1 phiếu, số dòng giảm nhưng No lớn nhất thì
   không đổi; dùng số dòng sẽ khiến No mới bị trùng với 1 No cũ còn lại. */
/* Chữ ký ngắn gọn đại diện cho "có gì thay đổi không" — dùng cho app tự động
   kiểm tra mỗi 15 giây mà KHÔNG cần đọc/trả về toàn bộ dữ liệu (rất nhẹ, chỉ
   đọc 1 dòng cuối). Đổi khi: thêm/xóa phiếu (đổi số dòng) hoặc SỬA phiếu ở
   dòng cuối cùng. Không bắt được trường hợp hiếm: sửa 1 phiếu ở giữa danh
   sách mà không đụng dòng cuối — chấp nhận được vì app vẫn tự tải đầy đủ mỗi
   khi mở lại màn hình, chỉ ảnh hưởng độ trễ đồng bộ ngầm 15s giữa các máy. */
/* "Tín hiệu" đại diện cho TOÀN BỘ nội dung Sheet hiện tại — dùng để app biết
   "có gì thay đổi kể từ lần kiểm tra trước không" mà KHÔNG phải tải cả bảng
   về. Băm (MD5) toàn bộ dữ liệu thành 1 chuỗi ngắn: đọc hết dữ liệu vẫn XẢY
   RA ở đây (nhanh, chỉ tốn thời gian phía server, không tốn mạng), nhưng
   TRẢ VỀ cho app chỉ đúng 1 chuỗi ngắn — nên bắt được MỌI thay đổi (sửa bất
   kỳ dòng nào, kể cả không phải dòng cuối; sửa bởi admin dù không tăng
   editCount; đổi nhanh trạng thái qua dropdown...) mà vẫn nhẹ khi truyền qua
   mạng. (Bản cũ trước đây chỉ so dòng CUỐI CÙNG — bỏ sót các trường hợp trên.) */
function getSheetSignal(){
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return '0';
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var buf = [];
  for (var i = 0; i < values.length; i++){ buf.push(values[i].join(',')); }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, buf.join(';'));
  return last + '|' + Utilities.base64Encode(digest);
}

/* ================= Kỳ dữ liệu 6 tháng (nhắc + xóa toàn bộ) =================
   KHÔNG chia nhiều sheet — vẫn 1 sheet duy nhất như cũ (đơn giản, ít lỗi).
   Chỉ thêm: nhớ ngày bắt đầu kỳ dữ liệu hiện tại (lưu ở Script Properties,
   không phải trong Sheet) để app tự tính "còn bao nhiêu ngày tới hạn 6
   tháng" và nhắc admin chủ động vào ⚙️ Cài đặt bấm "Xóa toàn bộ dữ liệu". */
var DATA_PERIOD_MONTHS = 6;
function getOrInitPeriodStart(){
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty('DATA_PERIOD_START');
  if (!v){
    v = Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT+7','yyyy-MM-dd');
    props.setProperty('DATA_PERIOD_START', v);
  }
  return v;
}
function getPeriodInfo(){
  var start = getOrInitPeriodStart();
  var startDate = new Date(start + 'T00:00:00');
  var dueDate = new Date(startDate);
  dueDate.setMonth(dueDate.getMonth() + DATA_PERIOD_MONTHS);
  var now = new Date();
  var daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
  return {
    periodStart: start,
    dueDate: Utilities.formatDate(dueDate, Session.getScriptTimeZone()||'GMT+7','yyyy-MM-dd'),
    daysRemaining: daysRemaining
  };
}
/* Xóa TOÀN BỘ phiếu ở Sheet chính (bắt đầu kỳ mới), nhưng KHÔNG mất dữ liệu:
   trước khi xóa, toàn bộ phiếu hiện có được LƯU (nối thêm vào cuối, không
   ghi đè) sang backup — nên sau nhiều lần xóa (mỗi 6 tháng), backup tích
   lũy dần đủ 1 năm, 2 năm... dữ liệu cũ. Chỉ admin (đúng ADMIN_PASSWORD)
   mới gọi được. Sheet chính KHÔNG THỂ HOÀN TÁC sau khi xóa (nhưng dữ liệu
   vẫn còn nguyên trong backup). */
function handleClearAllData(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau quan tri'});
  }
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last >= 2){
    var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    try{ appendRowsToBackup(values); }catch(bkErr){ /* backup lỗi không chặn xóa Sheet chính */ }
    sh.deleteRows(2, last - 1);
  }
  PropertiesService.getScriptProperties().setProperty('DATA_PERIOD_START',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT+7','yyyy-MM-dd'));
  try{ ensureDashboard(); }catch(dashErr){}
  return json({ok:true});
}

/* Xóa CÓ CHỌN LỌC các dòng trong backup nằm trong khoảng ngày [from, to]
   (cả 2 đầu) — dùng khi backup đã lưu trữ quá lâu (vd hơn 2 năm) muốn dọn
   bớt cho nhẹ, KHÔNG đụng gì tới Sheet chính. Chỉ admin mới gọi được. */
function handleClearBackupRange(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Sai mat khau quan tri'});
  }
  var from = String(data.from || '');
  var to = String(data.to || '');
  if (!from || !to) return json({ok:false, error:'Thieu ngay bat dau/ket thuc'});

  var bsh = getBackupSheet();
  if (!bsh) return json({ok:false, error:'Khong mo duoc file backup'});
  var last = bsh.getLastRow();
  if (last < 2) return json({ok:true, count:0});

  var values = bsh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var kept = [];
  var removedCount = 0;
  for (var i = 0; i < values.length; i++){
    var d = fmtDate(values[i][1]); // cot 2 = Date
    if (d && d >= from && d <= to) removedCount++;
    else kept.push(values[i]);
  }
  if (removedCount === 0) return json({ok:true, count:0});

  bsh.getRange(2, 1, values.length, HEADERS.length).clearContent();
  if (kept.length){
    bsh.getRange(2, 1, kept.length, HEADERS.length).setValues(kept);
    styleBlock(bsh, 2, kept.length);
  }
  SpreadsheetApp.flush();
  return json({ok:true, count:removedCount});
}

/* Tra 1 phiếu theo No — CHỈ đọc đúng 1 dòng (không quét toàn bộ dữ liệu ra
   mạng), dùng để app kiểm tra XUNG ĐỘT ngay trước khi lưu sửa: nếu editCount
   phiếu này trên Sheet đã khác với lúc người dùng mở form sửa (tức có người
   khác vừa sửa xong trong lúc mình đang sửa), app sẽ cảnh báo trước khi ghi
   đè — tránh 2 thiết bị cùng sửa 1 phiếu làm mất nội dung của nhau. */
function handleGetOne(p){
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay phieu'});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(p.no)){
      var r = sh.getRange(i + 2, 1, 1, HEADERS.length).getValues()[0];
      return json({ok:true, data:{
        no:r[0], date:fmtDate(r[1]), customer:r[2], system:r[3], issue:r[4],
        priority:r[5], engineer:r[6], support:r[7], status:r[8], remark:r[9],
        editCount:Number(r[10])||0, workType:r[11]||''
      }});
    }
  }
  return json({ok:false, error:'Khong tim thay phieu'});
}

function nextTicketNo(sh){
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  var maxNo = 0;
  for (var i = 0; i < col1.length; i++){
    var n = Number(col1[i][0]) || 0;
    if (n > maxNo) maxNo = n;
  }
  return maxNo + 1;
}

/* ================= Sheet dữ liệu: tạo + định dạng ================= */
/* Sheet có thể đang để múi giờ mặc định (vd GMT/US) chứ không phải Việt
   Nam — khi đó ngày chọn "3" bị Sheets lưu lùi lại thành "2" (chọn 00:00
   giờ VN = 17:00 hôm trước giờ GMT, sang ngày khác). Ép về đúng giờ VN mỗi
   lần chạy (rẻ, chỉ set property nếu khác) để KHÔNG bao giờ bị lệch ngày. */
function ensureVietnamTimeZone(ss){
  try{
    if (ss.getSpreadsheetTimeZone() !== 'Asia/Ho_Chi_Minh'){
      ss.setSpreadsheetTimeZone('Asia/Ho_Chi_Minh');
    }
  }catch(err){ /* không chặn thao tác chính nếu vì lý do gì đó không đổi được */ }
}

function getSheet(){
  var ss = getMainSpreadsheet_();
  ensureVietnamTimeZone(ss);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh){
    // Dự phòng: lấy sheet đầu tiên KHÔNG PHẢI Dashboard/Ky Su (loại trừ theo
    // TÊN, không theo vị trí — vì các tab phụ có thể bị kéo lên đứng trước
    // tab dữ liệu chính, ví dụ thứ tự Dashboard, Ky Su, Report).
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++){
      var nm = all[i].getName();
      if (nm !== DASH_SHEET_NAME && nm !== ENGINEER_SHEET_NAME){ sh = all[i]; break; }
    }
    if (!sh) sh = all[0];
  }
  if (sh.getLastRow() === 0){
    sh.appendRow(HEADERS);
    styleHeader(sh);
  }
  ensureAllColumns(sh);
  return sh;
}

/* Sheet cũ (tạo trước khi có tính năng nào đó, vd Sửa/EditCount hoặc Loại
   công việc/WorkType) có thể thiếu 1 hay nhiều cột cuối so với HEADERS hiện
   tại — tự thêm từng cột còn thiếu, điền giá trị mặc định phù hợp cho các
   dòng dữ liệu cũ (EditCount mặc định 0, còn lại để trống ''). */
function ensureAllColumns(sh){
  var lastCol = sh.getLastColumn();
  if (lastCol >= HEADERS.length) return;
  for (var c = lastCol + 1; c <= HEADERS.length; c++){
    var headerCell = sh.getRange(1, c);
    headerCell.setValue(HEADERS[c - 1]);
    headerCell.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold')
      .setFontFamily('Times New Roman').setFontSize(12)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    var last = sh.getLastRow();
    if (last >= 2){
      var col = sh.getRange(2, c, last - 1, 1);
      var vals = col.getValues();
      var defVal = (HEADERS[c - 1] === 'EditCount') ? 0 : '';
      for (var i = 0; i < vals.length; i++){ if (vals[i][0] === '' || vals[i][0] == null) vals[i][0] = defVal; }
      col.setValues(vals);
      if (defVal === 0) col.setHorizontalAlignment('center');
    }
  }
}

/* Sửa toàn bộ nội dung 1 phiếu đã tồn tại (khi người dùng nhập sai) — theo số No.
   Field nào không gửi lên (undefined) thì giữ nguyên giá trị cũ. */
function handleEdit(data){
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so phieu'});
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay phieu #'+no});

  var isAdmin = !!(getAdminPassword() && data.adminPassword === getAdminPassword());
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){
      var row = i + 2;
      var editCount = Number(sh.getRange(row, 11).getValue()) || 0;
      if (!isAdmin && editCount >= EDIT_LIMIT){
        return json({ok:false, error:'Phieu #'+no+' da duoc sua toi da '+EDIT_LIMIT+' lan. Lien he quan tri vien de sua them.'});
      }
      if (data.date){
        sh.getRange(row, 2).setValue(new Date(data.date + 'T00:00:00'));
        sh.getRange(row, 2).setNumberFormat('yyyy-mm-dd');
      }
      if (data.customer != null) sh.getRange(row, 3).setValue(data.customer);
      if (data.system != null)   sh.getRange(row, 4).setValue(data.system);
      if (data.issue != null)    sh.getRange(row, 5).setValue(data.issue);
      if (data.priority != null) sh.getRange(row, 6).setValue(data.priority);
      if (data.engineer != null) sh.getRange(row, 7).setValue(data.engineer);
      if (data.support != null)  sh.getRange(row, 8).setValue(data.support);
      if (data.status != null)   sh.getRange(row, 9).setValue(data.status);
      if (data.remark != null)   sh.getRange(row, 10).setValue(data.remark);
      if (data.workType != null) sh.getRange(row, 12).setValue(data.workType);
      if (!isAdmin) sh.getRange(row, 11).setValue(editCount + 1);
      styleDataRow(sh, row);
      SpreadsheetApp.flush();
      try{ ensureDashboard(); }catch(dashErr){}
      // Không tự đồng bộ backup — xem chú thích ở doPost (nhánh gửi phiếu mới).
      return json({ok:true, no:no});
    }
  }
  return json({ok:false, error:'Khong tim thay phieu #'+no});
}

/* Xóa hẳn 1 phiếu (theo số No) khỏi Sheet chính — KHÔNG thể hoàn tác. Backup
   KHÔNG tự xóa theo — nếu lỡ xóa nhầm, backup (từ lần "Đồng bộ" gần nhất)
   vẫn còn phiếu đó để xem/khôi phục lại tay. CHỈ admin (đúng mật khẩu quản
   trị) mới xóa được — người dùng thường không được. */
function handleDelete(data){
  if (!(getAdminPassword() && data.adminPassword === getAdminPassword())){
    return json({ok:false, error:'Chi quan tri vien moi duoc xoa phieu'});
  }
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so phieu'});
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay phieu #'+no});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  var found = false;
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){
      sh.deleteRow(i + 2);
      found = true;
      break;
    }
  }
  if (!found) return json({ok:false, error:'Khong tim thay phieu #'+no});
  renumberSheetNos(sh);
  SpreadsheetApp.flush();
  try{ ensureDashboard(); }catch(dashErr){}
  return json({ok:true, no:no});
}

/* Dồn lại STT (cột No) liên tục 1,2,3... sau khi xóa 1 phiếu — không để trống số.
   ⚠️ Vì thế "No" chỉ ổn định trong 1 phiên xem — sau khi ai đó xóa 1 phiếu, số No
   của các phiếu phía sau sẽ lùi lại 1. App luôn tải lại danh sách mới nhất trước
   khi sửa/xóa nên không ảnh hưởng, chỉ cần tránh giữ số No cũ quá lâu rồi mới dùng. */
function renumberSheetNos(sh){
  var last = sh.getLastRow();
  if (last < 2) return;
  var n = last - 1;
  var nums = [];
  for (var i = 1; i <= n; i++) nums.push([i]);
  sh.getRange(2, 1, n, 1).setValues(nums);
}

/* Cập nhật trạng thái (và remark, nếu có) của 1 phiếu đã tồn tại, theo số No */
function handleUpdate(data){
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so phieu'});
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay phieu #'+no});

  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){
      var row = i + 2;
      if (data.status) sh.getRange(row, 9).setValue(data.status);
      if (typeof data.remark === 'string') sh.getRange(row, 10).setValue(data.remark);
      styleDataRow(sh, row);
      SpreadsheetApp.flush();
      try{ ensureDashboard(); }catch(dashErr){}
      // Không tự đồng bộ backup — xem chú thích ở doPost (nhánh gửi phiếu mới).
      return json({ok:true, no:no});
    }
  }
  return json({ok:false, error:'Khong tim thay phieu #'+no});
}

function styleHeader(sh){
  COL_WIDTHS.forEach(function(w,i){ sh.setColumnWidth(i+1, w); });

  var header = sh.getRange(1,1,1,HEADERS.length);
  header.setBackground(HEADER_BG).setFontColor(HEADER_FG)
        .setFontWeight('bold').setFontFamily('Times New Roman').setFontSize(12)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
  header.setBorder(true,true,true,true,true,true,'#FFFFFF',SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(1, 26);
  sh.setFrozenRows(1);
  try{ sh.setTabColor('#FFFF00'); }catch(err){}
}

function styleDataRow(sh, row){
  // Gộp lại còn ~5 lệnh Range thay vì ~12 lệnh riêng lẻ trước đây (7 lệnh
  // setHorizontalAlignment + 2 lệnh setWrap từng cột) — mỗi lệnh Range trong
  // Apps Script đều tốn thời gian thực thi, gộp giúp gửi phiếu nhanh hơn.
  var rng = sh.getRange(row,1,1,HEADERS.length);
  rng.setBackground('#FFFFFF').setFontFamily('Times New Roman').setFontSize(12).setFontWeight('normal');
  rng.setBorder(true,true,true,true,true,true,'#D9D9D9',SpreadsheetApp.BorderStyle.SOLID);
  rng.setVerticalAlignment('middle');
  var aligns = [], wraps = [];
  for (var c = 1; c <= HEADERS.length; c++){
    aligns.push(CENTER_COLS.indexOf(c) > -1 ? 'center' : 'left');
    wraps.push(c === 5 || c === 10); // Issue, Remark
  }
  rng.setHorizontalAlignments([aligns]);
  rng.setWraps([wraps]);
}

/* ================= Dashboard biểu đồ ================= */
function ensureDashboard(){
  var ss = getMainSpreadsheet_();
  // Lấy TÊN THẬT của sheet dữ liệu (có thể không phải "Ticket Database",
  // ví dụ tab đang tên "Report") để công thức COUNTIF luôn trỏ đúng sheet.
  var ticketSheetName = getSheet().getName();
  var dash = ss.getSheetByName(DASH_SHEET_NAME);
  var firstTime = !dash;
  if (!dash) dash = ss.insertSheet(DASH_SHEET_NAME); // chèn cuối, không chèn ở vị trí 0

  // Dashboard đã dựng xong từ trước (tiêu đề + đủ 3 biểu đồ) VÀ công thức
  // đang trỏ ĐÚNG sheet dữ liệu hiện tại → công thức COUNTIF tự tính lại
  // theo dữ liệu mới, KHÔNG cần ghi lại toàn bộ định dạng/công thức mỗi lần
  // có phiếu mới — chỉ cập nhật giờ "cập nhật lần cuối" rồi thoát sớm (đây
  // là phần ngốn thời gian nhất mỗi lần Gửi phiếu nên bỏ qua giúp nhanh hơn
  // hẳn). Kiểm tra thêm formula ở B5 tham chiếu đúng tên sheet — phòng
  // trường hợp sheet dữ liệu từng bị đổi tên/đổi vị trí khiến công thức cũ
  // trỏ sai (đã từng xảy ra: trỏ nhầm sang sheet "Ky Su") — nếu phát hiện
  // sai thì TỰ ĐỘNG dựng lại toàn bộ công thức bên dưới thay vì thoát sớm.
  var formulaOk = false;
  if (!firstTime && dash.getRange('A1').getValue() === 'SUPPORT TICKET SUMMARY' && dash.getCharts().length >= 3){
    var b5 = dash.getRange('B5').getFormula();
    formulaOk = b5.indexOf("'" + ticketSheetName + "'!") !== -1;
  }
  if (formulaOk){
    dash.getRange('A2').setValue('Cập nhật lần cuối: ' +
        Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT+7','dd/MM/yyyy HH:mm'));
    return;
  }

  dash.getRange('A1:J20').setFontFamily('Times New Roman');
  dash.getRange('A1:C1').merge();
  dash.getRange('A1').setValue('SUPPORT TICKET SUMMARY')
      .setFontWeight('bold').setFontSize(16).setFontFamily('Arial')
      .setBackground(DASH_TITLE_BG).setFontColor('#FFFFFF')
      .setVerticalAlignment('middle');
  dash.setRowHeight(1, 26);
  dash.getRange('A2').setValue('Cập nhật lần cuối: ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT+7','dd/MM/yyyy HH:mm'))
      .setFontColor('#FF0000').setFontSize(11);

  // Bảng 1: Hình thức hỗ trợ
  // LƯU Ý: Sheet đang ở locale vi_VN nên công thức phải dùng dấu ";"
  // để ngăn cách tham số (không dùng dấu ",").
  dash.getRange('A4:C4').setValues([['Ticket Type','Qty','%']])
      .setFontWeight('bold').setFontFamily('Arial').setBackground(DASH_SUBHEAD_BG).setFontColor('#000000');
  dash.getRange('A5').setValue('Online');
  dash.getRange('B5').setFormula("=COUNTIF('"+ticketSheetName+"'!H2:H;\"Online\")");
  dash.getRange('A6').setValue('On-Site');
  dash.getRange('B6').setFormula("=COUNTIF('"+ticketSheetName+"'!H2:H;\"On-Site\")");
  dash.getRange('A7').setValue('Tổng').setFontWeight('bold');
  dash.getRange('B7').setFormula('=SUM(B5:B6)').setFontWeight('bold');
  dash.getRange('C5').setFormula('=IF(B$7=0;0;B5/B$7)');
  dash.getRange('C6').setFormula('=IF(B$7=0;0;B6/B$7)');
  dash.getRange('C5:C6').setNumberFormat('0%');
  dash.getRange('A4:C7').setBorder(true,true,true,true,true,true,'#D9D9D9',SpreadsheetApp.BorderStyle.SOLID);

  // Bảng 2: Mức ưu tiên
  dash.getRange('A9:B9').setValues([['Mức ưu tiên','Số lượng']])
      .setFontWeight('bold').setFontFamily('Arial').setBackground(DASH_SUBHEAD_BG).setFontColor('#000000');
  dash.getRange('A10').setValue('High');
  dash.getRange('B10').setFormula("=COUNTIF('"+ticketSheetName+"'!F2:F;\"High\")");
  dash.getRange('A11').setValue('Medium');
  dash.getRange('B11').setFormula("=COUNTIF('"+ticketSheetName+"'!F2:F;\"Medium\")");
  dash.getRange('A12').setValue('Low');
  dash.getRange('B12').setFormula("=COUNTIF('"+ticketSheetName+"'!F2:F;\"Low\")");
  dash.getRange('A9:B12').setBorder(true,true,true,true,true,true,'#D9D9D9',SpreadsheetApp.BorderStyle.SOLID);

  // Bảng 3: Trạng thái
  dash.getRange('A14:B14').setValues([['Trạng thái','Số lượng']])
      .setFontWeight('bold').setFontFamily('Arial').setBackground(DASH_SUBHEAD_BG).setFontColor('#000000');
  dash.getRange('A15').setValue('Done');
  dash.getRange('B15').setFormula("=COUNTIF('"+ticketSheetName+"'!I2:I;\"Done\")");
  dash.getRange('A16').setValue('Đang xử lý');
  dash.getRange('B16').setFormula("=COUNTIF('"+ticketSheetName+"'!I2:I;\"In Progress\")");
  dash.getRange('A17').setValue('Chờ');
  dash.getRange('B17').setFormula("=COUNTIF('"+ticketSheetName+"'!I2:I;\"Pending\")");
  dash.getRange('A14:B17').setBorder(true,true,true,true,true,true,'#D9D9D9',SpreadsheetApp.BorderStyle.SOLID);

  // dọn ô test còn sót lại (nếu có) từ lúc gỡ lỗi
  dash.getRange('Z1:Z2').clearContent();

  dash.setColumnWidth(1, 150);
  dash.setColumnWidth(2, 100);
  dash.setColumnWidth(3, 80);
  try{ dash.setTabColor(DASH_TITLE_BG); }catch(err){}

  // Biểu đồ — chỉ tạo 1 lần, sau đó tự cập nhật theo công thức
  if (firstTime || dash.getCharts().length === 0){
    var pie = dash.newChart().asPieChart()
      .addRange(dash.getRange('A5:B6'))
      .setPosition(4, 5, 0, 0)
      .setOption('title', 'Tỷ lệ Online / On-Site')
      .setOption('pieHole', 0.4)
      .setOption('width', 420).setOption('height', 260)
      .build();
    dash.insertChart(pie);

    var bar = dash.newChart().asColumnChart()
      .addRange(dash.getRange('A10:B12'))
      .setPosition(20, 5, 0, 0)
      .setOption('title', 'Phân bố mức ưu tiên')
      .setOption('width', 420).setOption('height', 260)
      .setOption('colors', ['#d63535'])
      .build();
    dash.insertChart(bar);

    var statusBar = dash.newChart().asColumnChart()
      .addRange(dash.getRange('A15:B17'))
      .setPosition(36, 5, 0, 0)
      .setOption('title', 'Trạng thái xử lý')
      .setOption('width', 420).setOption('height', 260)
      .setOption('colors', ['#1F4E78'])
      .build();
    dash.insertChart(statusBar);
  }
}

/* ================= CHẤM CÔNG & CÔNG TÁC PHÍ (chỉ admin) =================
   2 sheet mới, độc lập hoàn toàn với Sheet phiếu kỹ thuật ở trên — chỉ admin
   (đúng mật khẩu quản trị) mới đọc/ghi được, vì đây là dữ liệu công/lương
   riêng tư. Tái dùng nextTicketNo()/renumberSheetNos() ở trên (đều chỉ thao
   tác cột No, không phụ thuộc gì vào cấu trúc Sheet phiếu kỹ thuật, nên dùng
   chung được cho sheet nào cũng vậy). */
// Chấm công + Công tác phí sống ở 1 file Google Sheet RIÊNG (không chung với
// Sheet phiếu kỹ thuật ở trên) — theo yêu cầu tách 2 khu dữ liệu rõ ràng ra
// 2 thư mục Drive khác nhau. File này: "Report Chấm Công", trong thư mục
// Drive cùng tên (My Drive/Report Chấm Công).
var CHAMCONG_CTP_SPREADSHEET_ID = '1i-Gdh0CUpimH48XfU6L9BB1lRE2JQaecaAoUjQbHYJk';
function getChamCongCtpSpreadsheet(){
  return SpreadsheetApp.openById(CHAMCONG_CTP_SPREADSHEET_ID);
}

// Khớp ĐÚNG bố cục file mẫu "Chấm công Tech...xlsx" (giữ nguyên, không đổi):
// STT|TÊN DỰ ÁN|MÃ DỰ ÁN|ĐỊA CHỈ LÀM VIỆC|TÊN NHÂN VIÊN|IN|OUT|SỐ CÔNG|NỘI
// DUNG CV|SALE PHỤ TRÁCH|GHI CHÚ (THỨ tự tính lại từ Date lúc xuất Excel,
// không cần lưu riêng). Cột tăng ca (K/L/M trong mẫu gốc) vẫn XUẤT RA để
// đúng bố cục mẫu, nhưng luôn để trống — không tính tăng ca theo yêu cầu.
var CHAMCONG_HEADERS = ['No','Date','ProjectContent','ProjectCode','WorkAddress','Employee',
                         'TimeIn','TimeOut','WorkDays','WorkContent','SalePhuTrach','Note'];
var CTP_SHEET_NAME = 'CongTacPhi';
// Khớp ĐÚNG bố cục file mẫu "Mau_Cong Tac Phi_Chung.xlsx" sheet "Chi tiết"
// (cột A-O, phần "người đề nghị" tự nhập — cột P trở đi là phần kế toán
// kiểm, không thuộc app này). TripFromDate/TripToDate = dòng "Thời gian
// công tác" ở đầu phiếu; LineFromDate/LineToDate = cột Từ ngày/Đến ngày
// TRONG bảng chi tiết (mỗi dòng chi phí có thể khác ngày nhau).
var CTP_HEADERS = ['No','TripId','RequestDate','RequesterName','Dept','WorkingPlace','TripFromDate','TripToDate',
                    'ExpenseType','Description','LineFromDate','LineToDate','Km','Quantity','Rate','Amount',
                    'ServiceType','ProjectCode','ProjectName','Note','MapImage'];

/* Tên tab hợp lệ trên Google Sheets — bỏ các ký tự Sheets không cho phép
   trong tên tab ( [ ] * / \ ? : ), giới hạn độ dài. */
function sanitizeSheetName_(name){
  var s = String(name || '').replace(/[\[\]\*\/\\\?:]/g, '').trim();
  return (s || 'KhongTen').slice(0, 90);
}

/* MỖI KỸ SƯ 1 TAB CHẤM CÔNG RIÊNG (theo yêu cầu) — tên tab = tên kỹ sư.
   Tự tạo tab mới (kèm header đúng mẫu) nếu kỹ sư đó chưa có tab nào. */
function getChamCongSheet(employeeName){
  var ss = getChamCongCtpSpreadsheet();
  var name = sanitizeSheetName_(employeeName);
  var sh = ss.getSheetByName(name);
  if (!sh){
    sh = ss.insertSheet(name);
    var header = sh.getRange(1, 1, 1, CHAMCONG_HEADERS.length).setValues([CHAMCONG_HEADERS]);
    header.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold')
      .setFontFamily('Times New Roman').setFontSize(12)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    [50,90,200,110,140,140,60,60,70,200,110,200].forEach(function(w,i){ sh.setColumnWidth(i+1, w); });
    try{ sh.setTabColor('#e07a1f'); }catch(err){}
  }
  return sh;
}

/* Toàn bộ tab chấm công hiện có (mỗi tab = 1 kỹ sư) — loại trừ tab
   "CongTacPhi" (không phải tab kỹ sư). Dùng khi cần xem/gộp TẤT CẢ mọi
   người (không lọc theo 1 kỹ sư cụ thể). */
function getAllChamCongSheets_(){
  var ss = getChamCongCtpSpreadsheet();
  return ss.getSheets().filter(function(sh){ return sh.getName() !== CTP_SHEET_NAME; });
}

function getCongTacPhiSheet(){
  var ss = getChamCongCtpSpreadsheet();
  var sh = ss.getSheetByName(CTP_SHEET_NAME);
  if (!sh){
    sh = ss.insertSheet(CTP_SHEET_NAME);
    var header = sh.getRange(1, 1, 1, CTP_HEADERS.length).setValues([CTP_HEADERS]);
    header.setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold')
      .setFontFamily('Times New Roman').setFontSize(12)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    [50,110,90,140,80,140,90,90,180,220,90,90,60,80,90,100,110,110,160,180,140].forEach(function(w,i){ sh.setColumnWidth(i+1, w); });
    try{ sh.setTabColor('#7a1fe0'); }catch(err){}
  }
  return sh;
}

function isValidAdmin(data){
  return !!(getAdminPassword() && data.adminPassword === getAdminPassword());
}

/* ---- Chấm công (mỗi kỹ sư 1 tab riêng — xem getChamCongSheet ở trên) ---- */
function readAttendanceSheet_(sh){
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, CHAMCONG_HEADERS.length).getValues();
  return values.map(function(r){
    return {
      no:r[0], date:fmtDate(r[1]), projectContent:r[2], projectCode:r[3], workAddress:r[4], employee:r[5],
      timeIn:r[6], timeOut:r[7], workDays:Number(r[8])||0, workContent:r[9], salePhuTrach:r[10], note:r[11]
    };
  }).filter(function(x){ return x.no !== '' && x.no != null; });
}

/* employeeName truyền lên → chỉ đọc đúng tab người đó (nhanh); để trống →
   gộp TẤT CẢ tab (mọi kỹ sư), dùng cho màn "xem tất cả". */
function listAttendance(employeeName, year, month){
  var sheets = employeeName ? [getChamCongSheet(employeeName)] : getAllChamCongSheets_();
  var rows = [];
  sheets.forEach(function(sh){ rows = rows.concat(readAttendanceSheet_(sh)); });
  if (year) rows = rows.filter(function(x){ return x.date && x.date.slice(0,4) === String(year); });
  if (month) rows = rows.filter(function(x){ return x.date && x.date.slice(5,7) === String(month).padStart(2,'0'); });
  rows.sort(function(a,b){ return (a.date||'').localeCompare(b.date||'') || (a.employee||'').localeCompare(b.employee||'') || (Number(a.no)-Number(b.no)); });
  return rows;
}

function handleAddAttendance(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  if (!data.date) return json({ok:false, error:'Thieu ngay'});
  if (!data.employee) return json({ok:false, error:'Thieu nhan vien'});
  var sh = getChamCongSheet(data.employee);
  var no = nextTicketNo(sh);
  sh.appendRow([
    no, new Date(data.date + 'T00:00:00'), data.projectContent||'', data.projectCode||'', data.workAddress||'',
    data.employee||'', data.timeIn||'', data.timeOut||'', Number(data.workDays)||0,
    data.workContent||'', data.salePhuTrach||'', data.note||''
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 2).setNumberFormat('yyyy-mm-dd');
  // Cột "trông giống số/giờ" (Mã dự án, IN, OUT) — Google Sheets tự động
  // hiểu "08:00" thành giờ thật, "0000" thành số 0... nếu ghi thẳng qua
  // appendRow(). Ép định dạng "@" (văn bản thuần) rồi GHI LẠI giá trị mới
  // giữ đúng nguyên văn những gì app gửi lên, không bị Sheets "hiểu nhầm".
  sh.getRange(row, 4).setNumberFormat('@').setValue(data.projectCode||'');
  sh.getRange(row, 7, 1, 2).setNumberFormat('@').setValues([[data.timeIn||'', data.timeOut||'']]);
  return json({ok:true, no:no});
}

/* Cần data.employee để biết đúng TAB nào chứa dòng #no (mỗi kỹ sư đánh số
   No độc lập trong tab riêng của mình) — KHÔNG cho đổi employee ở đây (đổi
   người phải xoá dòng cũ + thêm dòng mới ở đúng tab người đó). */
function handleUpdateAttendance(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so dong'});
  if (!data.employee) return json({ok:false, error:'Thieu nhan vien'});
  var sh = getChamCongSheet(data.employee);
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay dong #'+no});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){
      var row = i + 2;
      if (data.date) sh.getRange(row, 2).setValue(new Date(data.date + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.projectContent != null) sh.getRange(row, 3).setValue(data.projectContent);
      if (data.projectCode != null) sh.getRange(row, 4).setNumberFormat('@').setValue(data.projectCode);
      if (data.workAddress != null) sh.getRange(row, 5).setValue(data.workAddress);
      if (data.timeIn != null) sh.getRange(row, 7).setNumberFormat('@').setValue(data.timeIn);
      if (data.timeOut != null) sh.getRange(row, 8).setNumberFormat('@').setValue(data.timeOut);
      if (data.workDays != null) sh.getRange(row, 9).setValue(Number(data.workDays)||0);
      if (data.workContent != null) sh.getRange(row, 10).setValue(data.workContent);
      if (data.salePhuTrach != null) sh.getRange(row, 11).setValue(data.salePhuTrach);
      if (data.note != null) sh.getRange(row, 12).setValue(data.note);
      return json({ok:true, no:no});
    }
  }
  return json({ok:false, error:'Khong tim thay dong #'+no});
}

function handleDeleteAttendance(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so dong'});
  if (!data.employee) return json({ok:false, error:'Thieu nhan vien'});
  var sh = getChamCongSheet(data.employee);
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay dong #'+no});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  var found = false;
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){ sh.deleteRow(i + 2); found = true; break; }
  }
  if (!found) return json({ok:false, error:'Khong tim thay dong #'+no});
  renumberSheetNos(sh);
  return json({ok:true});
}

/* Xoá toàn bộ chấm công của 1 THÁNG cụ thể — để "làm lại tháng mới" sau khi
   đã xuất Excel xong. Chỉ xoá đúng tháng/năm truyền lên, không đụng tháng
   khác. Lặp qua TẤT CẢ tab kỹ sư (mọi người), an toàn hơn xoá sạch cả tab. */
function handleClearAttendanceMonth(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var year = String(data.year||''), month = String(data.month||'').padStart(2,'0');
  if (!year || !month || month==='00') return json({ok:false, error:'Thieu thang/nam'});
  var totalRemoved = 0;
  getAllChamCongSheets_().forEach(function(sh){
    var last = sh.getLastRow();
    if (last < 2) return;
    var values = sh.getRange(2, 1, last - 1, CHAMCONG_HEADERS.length).getValues();
    var kept = [], removedCount = 0;
    for (var i = 0; i < values.length; i++){
      var d = fmtDate(values[i][1]);
      if (d && d.slice(0,4)===year && d.slice(5,7)===month) removedCount++;
      else kept.push(values[i]);
    }
    if (removedCount === 0) return;
    sh.getRange(2, 1, values.length, CHAMCONG_HEADERS.length).clearContent();
    if (kept.length) sh.getRange(2, 1, kept.length, CHAMCONG_HEADERS.length).setValues(kept);
    renumberSheetNos(sh);
    totalRemoved += removedCount;
  });
  return json({ok:true, count:totalRemoved});
}

/* ---- Công tác phí ---- */
function listExpenses(){
  var sh = getCongTacPhiSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, CTP_HEADERS.length).getValues();
  var rows = values.map(function(r){
    return {
      no:r[0], tripId:r[1], requestDate:fmtDate(r[2]), requesterName:r[3], dept:r[4], workingPlace:r[5],
      fromDate:fmtDate(r[6]), toDate:fmtDate(r[7]), expenseType:r[8], description:r[9],
      lineFromDate:fmtDate(r[10]), lineToDate:fmtDate(r[11]), km:Number(r[12])||0,
      quantity:Number(r[13])||0, rate:Number(r[14])||0, amount:Number(r[15])||0, serviceType:r[16],
      projectCode:r[17], projectName:r[18], note:r[19], mapImage:r[20]
    };
  }).filter(function(x){ return x.no !== '' && x.no != null; });
  rows.sort(function(a,b){ return (b.requestDate||'').localeCompare(a.requestDate||'') || (Number(a.no)-Number(b.no)); });
  return rows;
}

/* Thêm 1 DÒNG chi phí. Nếu data.tripId trống — tức đây là dòng ĐẦU TIÊN của
   1 đợt công tác mới — server tự sinh tripId mới rồi trả về, app lưu lại để
   dùng cho các dòng tiếp theo CÙNG đợt (gộp chung khi in). */
function handleAddExpense(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  if (!data.requestDate) return json({ok:false, error:'Thieu ngay de nghi'});
  var sh = getCongTacPhiSheet();
  var no = nextTicketNo(sh);
  var tripId = data.tripId || Utilities.getUuid();
  sh.appendRow([
    no, tripId, new Date(data.requestDate + 'T00:00:00'), data.requesterName||'', data.dept||'', data.workingPlace||'',
    data.fromDate ? new Date(data.fromDate + 'T00:00:00') : '', data.toDate ? new Date(data.toDate + 'T00:00:00') : '',
    data.expenseType||'', data.description||'',
    data.lineFromDate ? new Date(data.lineFromDate + 'T00:00:00') : '', data.lineToDate ? new Date(data.lineToDate + 'T00:00:00') : '',
    Number(data.km)||0, Number(data.quantity)||0, Number(data.rate)||0, Number(data.amount)||0, data.serviceType||'',
    data.projectCode||'', data.projectName||'', data.note||'', data.mapImage||''
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 3).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, 7, 1, 2).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, 11, 1, 2).setNumberFormat('yyyy-mm-dd');
  // Mã vụ việc có thể toàn số (vd "0000") — ép văn bản thuần rồi ghi lại,
  // tránh Sheets tự hiểu thành số và mất số 0 ở đầu.
  sh.getRange(row, 18).setNumberFormat('@').setValue(data.projectCode||'');
  return json({ok:true, no:no, tripId:tripId});
}

function handleUpdateExpense(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so dong'});
  var sh = getCongTacPhiSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay dong #'+no});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){
      var row = i + 2;
      if (data.requestDate) sh.getRange(row, 3).setValue(new Date(data.requestDate + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.requesterName != null) sh.getRange(row, 4).setValue(data.requesterName);
      if (data.dept != null) sh.getRange(row, 5).setValue(data.dept);
      if (data.workingPlace != null) sh.getRange(row, 6).setValue(data.workingPlace);
      if (data.fromDate) sh.getRange(row, 7).setValue(new Date(data.fromDate + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.toDate) sh.getRange(row, 8).setValue(new Date(data.toDate + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.expenseType != null) sh.getRange(row, 9).setValue(data.expenseType);
      if (data.description != null) sh.getRange(row, 10).setValue(data.description);
      if (data.lineFromDate) sh.getRange(row, 11).setValue(new Date(data.lineFromDate + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.lineToDate) sh.getRange(row, 12).setValue(new Date(data.lineToDate + 'T00:00:00')).setNumberFormat('yyyy-mm-dd');
      if (data.km != null) sh.getRange(row, 13).setValue(Number(data.km)||0);
      if (data.quantity != null) sh.getRange(row, 14).setValue(Number(data.quantity)||0);
      if (data.rate != null) sh.getRange(row, 15).setValue(Number(data.rate)||0);
      if (data.amount != null) sh.getRange(row, 16).setValue(Number(data.amount)||0);
      if (data.serviceType != null) sh.getRange(row, 17).setValue(data.serviceType);
      if (data.projectCode != null) sh.getRange(row, 18).setNumberFormat('@').setValue(data.projectCode);
      if (data.projectName != null) sh.getRange(row, 19).setValue(data.projectName);
      if (data.note != null) sh.getRange(row, 20).setValue(data.note);
      if (data.mapImage != null) sh.getRange(row, 21).setValue(data.mapImage);
      return json({ok:true, no:no});
    }
  }
  return json({ok:false, error:'Khong tim thay dong #'+no});
}

function handleDeleteExpense(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var no = data.no;
  if (no == null || no === '') return json({ok:false, error:'Thieu so dong'});
  var sh = getCongTacPhiSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:false, error:'Khong tim thay dong #'+no});
  var col1 = sh.getRange(2, 1, last - 1, 1).getValues();
  var found = false;
  for (var i = 0; i < col1.length; i++){
    if (String(col1[i][0]) === String(no)){ sh.deleteRow(i + 2); found = true; break; }
  }
  if (!found) return json({ok:false, error:'Khong tim thay dong #'+no});
  renumberSheetNos(sh);
  return json({ok:true});
}

/* Xoá HẾT các dòng thuộc 1 đợt công tác (cùng tripId) — dùng khi muốn bỏ hẳn
   cả đợt (nhập nhầm, huỷ chuyến...) thay vì xoá từng dòng lẻ. */
function handleDeleteExpenseTrip(data){
  if (!isValidAdmin(data)) return json({ok:false, error:'Sai mat khau quan tri'});
  var tripId = data.tripId;
  if (!tripId) return json({ok:false, error:'Thieu tripId'});
  var sh = getCongTacPhiSheet();
  var last = sh.getLastRow();
  if (last < 2) return json({ok:true, count:0});
  var values = sh.getRange(2, 1, last - 1, CTP_HEADERS.length).getValues();
  var kept = [], removedCount = 0;
  for (var i = 0; i < values.length; i++){
    if (String(values[i][1]) === String(tripId)) removedCount++;
    else kept.push(values[i]);
  }
  if (removedCount === 0) return json({ok:true, count:0});
  sh.getRange(2, 1, values.length, CTP_HEADERS.length).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, CTP_HEADERS.length).setValues(kept);
  renumberSheetNos(sh);
  return json({ok:true, count:removedCount});
}

/* ================= Tiện ích ================= */
function fmtDate(v){
  if (!v) return '';
  // Dùng duck-typing (không dùng instanceof) + tự ghép chuỗi ngày —
  // tránh phụ thuộc Utilities.formatDate/timezone, vốn có thể trả về
  // nguyên object Date khiến app không lọc được theo Ngày/Tuần/Tháng.
  var d = (typeof v.getFullYear === 'function') ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function json(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Menu tiện lợi khi mở Sheet: chủ động cập nhật Dashboard */
function onOpen(){
  SpreadsheetApp.getUi().createMenu('Report ELV')
    .addItem('Cập nhật Dashboard', 'ensureDashboard')
    .addItem('Định dạng lại toàn bộ Sheet', 'restyleAll')
    .addToUi();
}

function restyleAll(){
  var sh = getSheet();
  styleHeader(sh);
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) styleDataRow(sh, r);
  ensureDashboard();
}
