# 麻醉插管・藥物・升降壓劑量計算輔助 App（PWA）

React 18 + Tailwind CSS，免建置（CDN + 瀏覽器內 Babel），可安裝到手機主畫面並離線使用。

> ⚠️ 本工具僅供臨床輔助參考，實際處置與劑量仍須由醫療人員依據病人即時狀況專業判斷。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 入口，載入 React / Tailwind / Babel |
| `app.jsx` | 全部計算邏輯與 UI（藥物資料在 `BOLUS_GROUPS`、`INFUSION_GROUPS`） |
| `sw.js` | Service Worker：離線快取（改程式後把 `CACHE` 版本號 +1） |
| `manifest.webmanifest`、`icon-*.png` | PWA 安裝資訊 |
| `apps-script/Code.gs` | Google Sheets 回饋接收端，部署步驟寫在檔頭 |

## 本機預覽

```bash
cd anesthesia-calc && python3 -m http.server 8080
```

開 http://localhost:8080 。手機要「安裝為 App」及離線運作，需放在 HTTPS 網址（GitHub Pages、Netlify、Cloudflare Pages 皆可，直接上傳整個資料夾）。

## 回饋機制

`submitFeedback()` 以 `text/plain` POST JSON 到 Apps Script（避免 CORS preflight）。因 `no-cors` 無法讀回應，只要網路送出成功即視為成功；網址錯誤時 App 端不會報錯，請到試算表確認是否有新列。離線時紀錄暫存在裝置，恢復連線後自動補送。

不送出任何可識別資訊（無姓名、病歷號），只有性別、年齡、身高、體重與管路資料。
