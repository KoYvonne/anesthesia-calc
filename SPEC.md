# 麻醉科「臨床插管、藥物與升降壓劑量計算輔助 App」規格書（含兒童劑量與院內泡法）

> 版本：2026-10-07 ｜ 對應程式：`anesthesia-calc/app.jsx`
> 技術：React 18 + Tailwind CSS，PWA（可離線、可加入主畫面），手機優先 Card 佈局
> ⚠️ 警語：本工具僅供臨床輔助參考，實際處置與劑量仍須由醫療人員依據病人即時狀況專業判斷。

---

## 0. 全域規則

* **兒童模式：** 年齡 < 12 歲自動啟用（標題列變藍色、藥名旁標「兒童劑量」）。
  * 所有藥物改用兒童劑量，**一律依實際體重 (ABW)**，並套用單次最大劑量上限。
  * 嬰兒（< 12 個月）、新生兒（< 1 個月）部分藥物另有劑量。
* **成人給藥體重基準：** 可切換「自動 / ABW / IBW / AdjBW」。
  * 自動＝依各藥物建議（見下表「成人體重」欄）。
  * IBW / AdjBW 大於實際體重時，改用實際體重。
  * 連續滴注一律用 ABW。
* **所有濃度、泡法皆可在畫面上修改**，以符合院內品項。
* **安全提醒：**
  * 抽取體積 < 0.3 ml → 提醒先稀釋。
  * 兒童幫浦速率 < 0.5 ml/hr → 建議改用較稀濃度（Rule of 6）。
  * 超過單次上限 → 顯示「已套用單次上限」。
  * 劑量超出建議範圍 → 紅字提醒。

---

## 1. 病人基本資料

* **輸入：** 性別、年齡（可切換「歲 / 月」）、實際體重 (kg)、身高 (cm；兒童選填)。
* **成人顯示：** BMI、IBW（Devine）、AdjBW（IBW + 0.4 × (ABW − IBW)）。
  * 身高 < 152 cm 提醒 Devine 準確度下降。
* **兒童顯示：**
  * 維持輸液 4-2-1（ml/hr）。
  * 估計血量 EBV：新生兒 85、嬰兒 80、兒童 75 ml/kg（成人男 75、女 65）。
  * APLS 依年齡估算體重（體重未知時，可一鍵帶入）：
    * < 12 個月：0.5 × 月齡 + 4
    * 1–5 歲：2 × 年齡 + 8
    * 6–12 歲：3 × 年齡 + 7

---

## 2. 氣管內管與深度

### A. 成人單腔 ETT
* ID：男 7.5–8.0 mm、女 7.0–7.5 mm。
* 深度：Height / 7，或 ID × 3（帶入回饋時預設 ID × 3，較保守）。
* LMA 依體重。

### B. 兒童單腔 ETT（依年齡分段）

| 年齡 | Uncuffed ID | Cuffed ID | 深度 |
|---|---|---|---|
| 新生兒 < 1 個月 | < 1 kg：2.5；1–3 kg：3.0；≥ 3 kg：3.5 | ≥ 3 kg：3.0（< 3 kg 不建議） | 體重 (kg) + 6 cm（經口） |
| 1–6 個月 | 3.5–4.0 | 3.0–3.5 | ID × 3（uncuffed） |
| 6–12 個月 | 4.0 | 3.5 | ID × 3（uncuffed） |
| 1–2 歲 | 4.0–4.5 | 3.5–4.0 | Age/2 + 12 |
| 2–12 歲 | Age/4 + 4 | Age/4 + 3.5 | Age/2 + 12 或 ID × 3 |

* ID 向下取至 0.5 mm；備妥上下各半號。
* 另顯示：
  * 喉頭鏡 blade：Miller 0（早產 < 2.5 kg）／Miller 1（< 1 歲）／Miller 1 或 Mac 1（1–2 歲）／Mac 2 或 Miller 2（2–8 歲）／Mac 2–3（> 8 歲）
  * 抽痰管：ID × 2 Fr
  * LMA 依體重：< 5 kg #1、5–10 #1.5、10–20 #2、20–30 #2.5、30–50 #3、50–70 #4、70–100 #5、> 100 #6

### C. 雙腔 DLT（Left，僅成人）
* 女：< 150 cm → 32 Fr；150–160 → 35 Fr；> 160 → 37 Fr
* 男：< 160 cm → 37 Fr；160–170 → 39 Fr；> 170 → 41 Fr
* 深度：29 + (Height − 170) / 10 cm
* ⚠️ 插管後須以纖維支氣管鏡 (FOB) 定位確認。
* 兒童：不顯示建議值，請依專科判斷（bronchial blocker / Univent）。

---

## 3. 單次推注藥物（Bolus）

每張卡片顯示：建議劑量、計算總量、給藥體積 (ml)、可修改濃度、備註。

| 類別 | 藥物 | 成人劑量 | 成人體重 | 兒童劑量（上限） | 預設濃度 |
|---|---|---|---|---|---|
| A 誘導 | Propofol | 1.5–2.5 mg/kg | IBW | 2.5–3.5 mg/kg；嬰兒 3–4 | 10 mg/ml |
| | Etomidate | 0.2–0.3 mg/kg | IBW | 0.2–0.3 mg/kg（> 10 歲核准） | 2 mg/ml |
| | Ketamine IV | 1–2 mg/kg | IBW | 1–2 mg/kg | 50 mg/ml |
| | Ketamine IM | 4–5 mg/kg | IBW | 4–5 mg/kg | 50 mg/ml |
| B | Lidocaine IV | 1–1.5 mg/kg | IBW | 1–1.5 mg/kg（max 100 mg） | 20 mg/ml |
| C 肌鬆 | Rocuronium | 0.6–1.2 mg/kg | IBW | 0.6–1.2 mg/kg | 10 mg/ml |
| | Cisatracurium | 0.15–0.2 mg/kg | IBW | 0.1–0.15；嬰兒 0.15 | 2 mg/ml |
| | Succinylcholine | 1–1.5 mg/kg | ABW | 1–2；嬰兒 2–3（max 150 mg） | 50 mg/ml |
| D 鎮痛 | Fentanyl | 1–2 mcg/kg | IBW | 1–2 mcg/kg | 50 mcg/ml |
| E 抗膽鹼 | Glycopyrrolate | 0.004–0.008 mg/kg | ABW | 0.004–0.01（max 0.2 mg） | 0.2 mg/ml |
| | Atropine | 0.01–0.02 mg/kg | ABW | 0.01–0.02（max 0.5 mg） | 1 mg/ml |
| F 類固醇 | Dexamethasone | 固定 4–8 mg | — | 0.1–0.15 mg/kg（max 8 mg） | 5 mg/ml |
| | Hydrocortisone | 固定 100–200 mg | — | 1–2 mg/kg（max 100 mg） | 50 mg/ml |
| | Methylprednisolone | 1–2 mg/kg | ABW | 1–2 mg/kg（max 60 mg） | 40 mg/ml |
| H 升壓 | Ephedrine | 固定 5–10 mg | — | 0.1–0.2 mg/kg（max 10 mg） | 5 mg/ml（40 mg 稀釋至 8 ml） |
| | Phenylephrine | 固定 50–100 mcg | — | 1–2 mcg/kg（max 100 mcg） | 100 mcg/ml |
| | Norepinephrine bolus | 固定 4–10 mcg | — | 兒童無標準劑量，不顯示 | 10 mcg/ml |
| I 降壓 | Labetalol | 固定 5–20 mg | — | 0.2–1 mg/kg（max 20 mg） | 5 mg/ml |
| | Nicardipine bolus | 固定 0.5–2 mg | — | 兒童不推注，改用滴注 | 1 mg/ml |
| | Hydralazine | 固定 5–10 mg | — | 0.1–0.2 mg/kg（max 20 mg） | 20 mg/ml |
| | Esmolol | 0.5 mg/kg over 1 min | ABW | 0.1–0.5 mg/kg | 10 mg/ml |
| J 急救 | Epinephrine（arrest） | 固定 1 mg q3–5 min | — | 0.01 mg/kg（max 1 mg） | 0.1 mg/ml |
| | Amiodarone（VF/pVT） | 固定 300 mg（第二劑 150） | — | 5 mg/kg（max 300 mg） | 50 mg/ml |

### G. 反轉劑
* **健保 / 傳統版：**
  * Neostigmine 0.04–0.07 mg/kg（上限 5 mg），預設 0.5 mg/ml，依 ABW。
  * Glycopyrrolate：每 1 mg Neostigmine 搭配 0.2 mg，預設 0.2 mg/ml。
  * 兒童可用 Atropine 0.02 mg/kg 取代 Glycopyrrolate。
* **高級 / 自費版 Sugammadex**（100 mg/ml，依 ABW）：
  * 常規反轉 Moderate（TOF ≥ 2）：2 mg/kg
  * 深層反轉 Deep（PTC 1–2）：4 mg/kg
  * 急救極速反轉 Immediate：16 mg/kg（兒童資料有限）
  * < 2 歲提醒 off-label。

---

## 4. 連續滴注（顯示 ml/hr 幫浦速率）

* **計算公式：**
  * mcg/kg/min：劑量 × 體重 (ABW) × 60 ÷ 濃度 (mcg/ml)
  * mcg/min：劑量 × 60 ÷ 濃度 (mcg/ml)
  * mg/hr：劑量 ÷ 濃度 (mg/ml)
* 每個藥物顯示：目標劑量輸入框、幫浦速率，以及 5 段劑量對照表。

| 藥物 | 院內泡法（預設） | 濃度 | 成人劑量 | 兒童劑量 | 兒童 Rule |
|---|---|---|---|---|---|
| Norepinephrine (Levophed) | 藥師配製：1 mg/ml × 4 ml/amp，1 支加入 D5W 400 ml | 10 mcg/ml | 0.02–0.2 mcg/kg/min | 0.05–1 mcg/kg/min | 0.6 |
| Dopamine | 200 mg/5 ml + 95 ml = 200 mg/100 ml | 2000 mcg/ml | 2–20 mcg/kg/min | 2–20 mcg/kg/min | 6 |
| Dobutamine | 250 mg/20 ml + NS 80 ml = 250 mg/100 ml | 2500 mcg/ml | 2–20 mcg/kg/min | 2–20 mcg/kg/min | 6 |
| Epinephrine | 1 mg in 250 ml | 4 mcg/ml | 0.01–0.1 mcg/kg/min | 0.02–1 mcg/kg/min | 0.6 |
| NTG | 5 mg/amp × 10 支原液 = 50 mg/100 ml | 500 mcg/ml | 5–100 mcg/min | 0.25–5 mcg/kg/min | 6 |
| Nicardipine | 10 mg in 100 ml NS | 0.1 mg/ml | 2.5–15 mg/hr | 0.5–3 mcg/kg/min | 不適用（濃度不宜過高） |

* **兒童 Rule of 6 按鈕：** 一鍵把泡法改成「係數 × 體重 (kg) mg 加至 100 ml」。
  * Rule of 6：1 ml/hr = 1 mcg/kg/min
  * Rule of 0.6：1 ml/hr = 0.1 mcg/kg/min
  * 另有按鈕可切回院內成人泡法。
* 成人與兒童的滴注設定各自保存，切換病人不互相覆蓋。

---

## 5. 臨床實際紀錄與回饋機制

* **欄位：**
  * 一鍵帶入建議值（依目前選的 ETT / DLT 分頁；兒童一律帶 ETT）
  * 管路類型（ETT / DLT）
  * 實際管徑（mm / Fr）
  * 門齒固定深度 (cm)
  * Cormack-Lehane（—、1、2a、2b、3、4，選填）
  * 備註（選填）
* **`submitFeedback()`：**
  * 以 HTTP POST（`text/plain` JSON、`no-cors`）送至 Google Apps Script Web App URL。
  * 網址在 App 內 ⚙️ 設定，只存在該裝置。
  * 送出後顯示 Toast 並清空表單。
  * 離線時暫存在裝置，恢復連線後自動補送。
* **送出欄位：**
  * 基本資料：timestamp、sex、age、height_cm、weight_kg、bmi、ibw_kg、adjbw_kg
  * 建議值：suggested_ett_id_mm、suggested_ett_depth_cm、suggested_dlt_fr、suggested_dlt_depth_cm
  * 實際值：actual_tube_type、actual_size、actual_depth_cm、cormack_lehane、notes
* **隱私：** 不送出姓名、病歷號；病人資料不存在裝置上，重新整理即清除。
* **接收端：** `apps-script/Code.gs`，自動建立 `Feedback` 工作表並逐列寫入。

---

## 6. 安全性與免責聲明

介面上方與底部皆醒目顯示：「警語：本工具僅供臨床輔助參考，實際處置與劑量仍須由醫療人員依據病人即時狀況專業判斷。」

---

## 7. 待確認事項

1. 兒童劑量依常用小兒麻醉 / PALS 標準整理，需以院內 SOP 確認。尤其是：
   * 嬰兒 Propofol、Succinylcholine
   * NE / Epi 兒童滴注上限
2. 院內兒童稀釋規範（例如 Fentanyl 10 mcg/ml、Atropine 0.1 mg/ml）確認後，可設為兒童模式預設濃度。
3. 仍為預設值、尚未依院內品項確認的濃度：
   * Epinephrine 滴注、Nicardipine
   * Succinylcholine、Solu-Medrol、Solu-Cortef
   * Neostigmine、NE bolus
