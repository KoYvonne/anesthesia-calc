/**
 * 麻醉計算 App — 插管紀錄回饋接收端（Google Apps Script）
 *
 * 部署步驟：
 * 1. 建立一個新的 Google 試算表 → 擴充功能 → Apps Script
 * 2. 將本檔內容貼上取代 Code.gs，儲存
 * 3. 部署 → 新增部署作業 → 類型選「網頁應用程式」
 *    - 執行身分：我
 *    - 誰可以存取：任何人
 * 4. 複製產生的 .../exec 網址，貼到 App「4. 實際插管紀錄回饋」右上角 ⚙️
 * 之後若修改程式，需「管理部署作業 → 編輯 → 新版本」才會生效。
 */
const SHEET_NAME = 'Feedback';
const COLUMNS = [
  'timestamp', 'sex', 'age', 'height_cm', 'weight_kg', 'bmi', 'ibw_kg', 'adjbw_kg',
  'suggested_ett_id_mm', 'suggested_ett_depth_cm', 'suggested_dlt_fr', 'suggested_dlt_depth_cm',
  'actual_tube_type', 'actual_size', 'actual_depth_cm', 'cormack_lehane', 'notes',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(COLUMNS.concat(['received_at']));
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(COLUMNS.map((k) => (data[k] === undefined ? '' : data[k])).concat([new Date()]));
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
