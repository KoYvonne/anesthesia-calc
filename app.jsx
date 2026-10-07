const { useState, useMemo, useEffect, useCallback } = React;

/* ============================================================
 * 設定：Google Apps Script Web App URL
 * 可直接填在這裡，或在 App 內「⚙️ 回饋設定」輸入（存在該裝置）
 * ============================================================ */
const DEFAULT_WEBHOOK_URL = '';
const LS_URL = 'anes_webhook_url';
const LS_QUEUE = 'anes_feedback_queue';

const DISCLAIMER = '警語：本工具僅供臨床輔助參考，實際處置與劑量仍須由醫療人員依據病人即時狀況專業判斷。';

/* ---------------- 工具函式 ---------------- */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return String(+v.toFixed(d));
};
const floorHalf = (v) => Math.floor(v * 2) / 2;
const roundHalf = (v) => Math.round(v * 2) / 2;
const range = (lo, hi, unit) => (lo === hi ? `${fmt(lo)} ${unit}` : `${fmt(lo)} – ${fmt(hi)} ${unit}`);
const sizeRange = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]} – ${r[1]}`);
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const ageLabel = (pt) => (pt.ageMonths < 24 ? `${fmt(pt.ageMonths)} 個月` : `${fmt(pt.age)} 歲`);

/* ---------------- 病人計算 ----------------
 * 兒童（< 12 歲）身高可不填；成人需身高計算 IBW / AdjBW / DLT */
function calcPatient(p) {
  const h = num(p.height), w = num(p.weight), ageRaw = num(p.age);
  const age = p.ageUnit === 'm' ? ageRaw / 12 : ageRaw;
  const hasH = h > 0;
  if (!(w > 0) || !(age >= 0)) return { valid: false, age };
  const peds = age < 12;
  if (!peds && !hasH) return { valid: false, age, needHeight: true };
  const ageMonths = age * 12;
  const bmi = hasH ? w / (h / 100) ** 2 : NaN;
  const ibw = hasH ? (p.sex === 'M' ? 50 : 45.5) + 2.3 * (h / 2.54 - 60) : NaN;
  const adjbw = w > ibw ? ibw + 0.4 * (w - ibw) : w;
  // 4-2-1 維持輸液
  const maint = w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20);
  // 估計血量 EBV (ml/kg)
  const ebvPerKg = ageMonths < 1 ? 85 : ageMonths < 12 ? 80 : peds ? 75 : p.sex === 'M' ? 75 : 65;
  return {
    valid: true, h, hasH, w, age, ageMonths, bmi, ibw, adjbw, peds,
    infant: ageMonths < 12, neonate: ageMonths < 1,
    maint, ebv: ebvPerKg * w, ebvPerKg,
    shortStature: hasH && h < 152.4,
  };
}

// APLS 依年齡估算體重（僅供體重未知時參考）
function estimateWeight(age) {
  if (!(age >= 0) || age >= 13) return NaN;
  const m = age * 12;
  if (m < 12) return 0.5 * m + 4;
  if (age <= 5) return 2 * age + 8;
  return 3 * age + 7;
}

// 給藥體重：IBW / AdjBW 若大於實際體重則改用 ABW；兒童一律用 ABW
function dosingWeight(basis, pt) {
  if (!pt.valid) return NaN;
  if (pt.peds || !(pt.ibw > 0)) return pt.w;
  if (basis === 'IBW') return Math.min(pt.ibw, pt.w);
  if (basis === 'AdjBW') return Math.min(pt.adjbw, pt.w);
  return pt.w;
}

/* ---------------- 呼吸道計算 ---------------- */
function lmaSize(w) {
  if (w < 5) return '1';
  if (w < 10) return '1.5';
  if (w < 20) return '2';
  if (w < 30) return '2.5';
  if (w < 50) return '3';
  if (w < 70) return '4';
  if (w <= 100) return '5';
  return '6';
}

function pedsBlade(pt) {
  if (pt.neonate && pt.w < 2.5) return 'Miller 0';
  if (pt.infant) return 'Miller 1';
  if (pt.age < 2) return 'Miller 1 / Mac 1';
  if (pt.age < 8) return 'Mac 2 / Miller 2';
  return 'Mac 2 – 3';
}

function calcPedsEtt(pt) {
  const { ageMonths: m, age, w } = pt;
  let uncuffed, cuffed, depths, note;
  if (m < 1) {
    // 新生兒依體重
    const u = w < 1 ? 2.5 : w < 3 ? 3.0 : 3.5;
    uncuffed = [u, u];
    cuffed = w >= 3 ? [3.0, 3.0] : null;
    depths = [{ label: '體重 (kg) + 6（經口）', cm: w + 6 }];
    note = w < 3 ? '< 3 kg 一般不建議使用 cuffed tube。' : null;
  } else if (m < 6) {
    uncuffed = [3.5, 4.0]; cuffed = [3.0, 3.5];
    depths = [{ label: 'ID × 3（uncuffed）', cm: 3.5 * 3 }];
  } else if (m < 12) {
    uncuffed = [4.0, 4.0]; cuffed = [3.5, 3.5];
    depths = [{ label: 'ID × 3（uncuffed）', cm: 4.0 * 3 }];
  } else if (age < 2) {
    uncuffed = [4.0, 4.5]; cuffed = [3.5, 4.0];
    depths = [{ label: 'Age/2 + 12', cm: age / 2 + 12 }, { label: 'ID × 3（cuffed）', cm: 3.5 * 3 }];
  } else {
    const u = floorHalf(age / 4 + 4), c = floorHalf(age / 4 + 3.5);
    uncuffed = [u, u]; cuffed = [c, c];
    depths = [{ label: 'Age/2 + 12', cm: age / 2 + 12 }, { label: 'ID × 3（cuffed）', cm: c * 3 }];
  }
  const suggestId = cuffed ? cuffed[0] : uncuffed[0];
  return {
    peds: true,
    method: m < 1 ? '新生兒依體重' : age < 2 ? '嬰幼兒對照表' : '年齡公式（Age/4 + 4 / + 3.5）',
    uncuffed, cuffed, depths, note,
    suggestId,
    suggestDepth: roundHalf(depths[0].cm),
    suction: suggestId * 2,
    blade: pedsBlade(pt),
  };
}

function calcAirway(p, pt) {
  if (!pt.valid) return null;
  const out = { lma: lmaSize(pt.w) };
  if (pt.peds) {
    out.ett = calcPedsEtt(pt);
  } else {
    const [lo, hi] = p.sex === 'M' ? [7.5, 8.0] : [7.0, 7.5];
    out.ett = {
      peds: false,
      lo, hi,
      depthHeight: pt.h / 7,
      depthIdLo: lo * 3,
      depthIdHi: hi * 3,
      suggestId: lo,
      suggestDepth: roundHalf(lo * 3),
    };
  }
  if (pt.peds) {
    out.dlt = { notForPeds: true };
  } else {
    const fr = p.sex === 'F' ? (pt.h < 150 ? 32 : pt.h <= 160 ? 35 : 37) : pt.h < 160 ? 37 : pt.h <= 170 ? 39 : 41;
    const depth = 29 + (pt.h - 170) / 10;
    out.dlt = { fr, depth, suggestDepth: roundHalf(depth) };
  }
  return out;
}

/* ---------------- 藥物資料 ----------------
 * kind: perkg（依體重）| fixed（固定劑量）
 * conc: 與 unit 相同單位 / ml；basis: 成人建議給藥體重
 * peds: 兒童劑量（覆寫 kind/lo/hi/max/note）；peds: null = 兒童無標準推注劑量
 * infant: < 12 個月時再覆寫
 */
const BOLUS_GROUPS = [
  {
    key: 'A', title: 'A. Induction Agents 誘導劑', items: [
      { id: 'propofol', name: 'Propofol', kind: 'perkg', lo: 1.5, hi: 2.5, unit: 'mg', conc: 10, basis: 'IBW', note: '肥胖者誘導建議以瘦體重估算（此以 IBW 近似）；高齡、血行動力不穩者減量。',
        peds: { lo: 2.5, hi: 3.5, note: '兒童需要量較成人高；嬰兒可達 3–4 mg/kg。' }, infant: { lo: 3, hi: 4 } },
      { id: 'etomidate', name: 'Etomidate', kind: 'perkg', lo: 0.2, hi: 0.3, unit: 'mg', conc: 2, basis: 'IBW', note: '血行動力學較穩定；可能短暫抑制腎上腺皮質功能。',
        peds: { lo: 0.2, hi: 0.3, note: '仿單核准 > 10 歲；較小兒童屬 off-label。' } },
      { id: 'ketamine', name: 'Ketamine (IV)', kind: 'perkg', lo: 1.0, hi: 2.0, unit: 'mg', conc: 50, basis: 'IBW', note: '原液 50 mg/ml 體積很小，常稀釋為 10 mg/ml 以利精準推注。',
        peds: { lo: 1, hi: 2, note: '兒童常稀釋為 10 mg/ml；可增加分泌物，可併用 Atropine / Glycopyrrolate。' } },
      { id: 'ketamine_im', name: 'Ketamine (IM)', kind: 'perkg', lo: 4, hi: 5, unit: 'mg', conc: 50, basis: 'IBW', note: '無 IV 管路時 IM 誘導 / 鎮靜，起效約 3–5 分鐘。',
        peds: { lo: 4, hi: 5, note: '無 IV 管路時 IM 誘導（如不合作兒童），起效約 3–5 分鐘；使用原液 50 mg/ml 以減少注射體積。' } },
    ],
  },
  {
    key: 'B', title: 'B. Local Anesthetic / Blunting Response', items: [
      { id: 'lidocaine', name: 'Lidocaine (IV)', kind: 'perkg', lo: 1.0, hi: 1.5, unit: 'mg', conc: 20, basis: 'IBW', note: '2% = 20 mg/ml；減少插管嗆咳反射與心律不整。',
        peds: { lo: 1, hi: 1.5, max: 100, note: '2% = 20 mg/ml；小體重可用 1% (10 mg/ml)。' } },
    ],
  },
  {
    key: 'C', title: 'C. Neuromuscular Blocking Agents 肌肉鬆弛劑', items: [
      { id: 'rocuronium', name: 'Rocuronium', kind: 'perkg', lo: 0.6, hi: 1.2, unit: 'mg', conc: 10, basis: 'IBW', note: '1.0–1.2 mg/kg 為 RSI 劑量；可由 Sugammadex 反轉。',
        peds: { lo: 0.6, hi: 1.2, note: '1.0–1.2 mg/kg 為 RSI 劑量；嬰兒作用時間較長。' } },
      { id: 'cisatracurium', name: 'Cisatracurium', kind: 'perkg', lo: 0.15, hi: 0.2, unit: 'mg', conc: 2, basis: 'IBW', note: 'Hofmann 降解，適合肝腎功能不全；起效較慢。',
        peds: { lo: 0.1, hi: 0.15, note: '2–12 歲 0.1–0.15 mg/kg；1–23 個月 0.15 mg/kg。' }, infant: { lo: 0.15, hi: 0.15 } },
      { id: 'succinylcholine', name: 'Succinylcholine', kind: 'perkg', lo: 1.0, hi: 1.5, unit: 'mg', conc: 50, basis: 'ABW', note: '依實際體重。禁忌：高血鉀、惡性高熱病史/家族史、大面積燒燙傷或神經損傷後期等。濃度依院內品項確認。',
        peds: { lo: 1, hi: 2, max: 150, note: '兒童 1–2 mg/kg（嬰兒 2–3 mg/kg）；IM 4 mg/kg（max 150 mg）。建議先給 Atropine 預防心跳過慢。未診斷之肌肉病變有高血鉀心跳停止風險，兒童僅建議用於緊急呼吸道處置。' },
        infant: { lo: 2, hi: 3 } },
    ],
  },
  {
    key: 'D', title: 'D. Analgesics / Opioids 鎮痛藥', items: [
      { id: 'fentanyl', name: 'Fentanyl', kind: 'perkg', lo: 1, hi: 2, unit: 'mcg', conc: 50, basis: 'IBW', note: '快速推注可能造成胸壁僵直；高齡者減量。',
        peds: { lo: 1, hi: 2, note: '體積小時建議稀釋為 10 mcg/ml；新生兒/嬰兒對呼吸抑制較敏感。' } },
    ],
  },
  {
    key: 'E', title: 'E. Anticholinergics 抑制唾液 / 升心跳', items: [
      { id: 'glycopyrrolate', name: 'Glycopyrrolate', kind: 'perkg', lo: 0.004, hi: 0.008, unit: 'mg', conc: 0.2, basis: 'ABW', note: '抑制口水作用強，升心跳較溫和；不通過血腦屏障。',
        peds: { lo: 0.004, hi: 0.01, max: 0.2, note: '兒童 0.004–0.01 mg/kg（單次 max 0.2 mg）。' } },
      { id: 'atropine', name: 'Atropine', kind: 'perkg', lo: 0.01, hi: 0.02, unit: 'mg', conc: 1, basis: 'ABW', note: '快速升心跳；成人單次常用 0.4–1 mg。',
        peds: { lo: 0.01, hi: 0.02, max: 0.5, note: 'PALS：0.02 mg/kg（單次 max 0.5 mg）。可稀釋為 0.1 mg/ml 以利抽取。' } },
    ],
  },
  {
    key: 'F', title: 'F. Steroids 類固醇', items: [
      { id: 'dexamethasone', name: 'Dexamethasone', kind: 'fixed', lo: 4, hi: 8, unit: 'mg', conc: 5, note: '成人固定劑量；PONV 預防常用 4 mg。',
        peds: { kind: 'perkg', lo: 0.1, hi: 0.15, max: 8, note: 'PONV：0.1–0.15 mg/kg（max 4–8 mg）。拔管後呼吸道水腫 / Croup：0.5 mg/kg（max 10 mg）。' } },
      { id: 'hydrocortisone', name: 'Hydrocortisone (Solu-Cortef)', kind: 'fixed', lo: 100, hi: 200, unit: 'mg', conc: 50, note: '成人固定劑量。濃度依品項（例：100 mg/2 ml = 50 mg/ml）。',
        peds: { kind: 'perkg', lo: 1, hi: 2, max: 100, note: '壓力劑量 2 mg/kg（max 100 mg），或 50–100 mg/m²。' } },
      { id: 'methylpred', name: 'Methylprednisolone (Solu-Medrol)', kind: 'perkg', lo: 1, hi: 2, unit: 'mg', conc: 40, basis: 'ABW', note: '濃度依品項（例：40 mg/ml、125 mg/2 ml），請修改濃度欄。',
        peds: { lo: 1, hi: 2, max: 60, note: '氣喘 / 過敏：1–2 mg/kg（max 60 mg）。' } },
    ],
  },
  {
    key: 'H', title: 'H. Vasopressors 升壓藥（單次推注）', items: [
      { id: 'ephedrine', name: 'Ephedrine', kind: 'fixed', lo: 5, hi: 10, unit: 'mg', conc: 5, note: '原液 40 mg/ml；常稀釋至 5 mg/ml（40 mg 加 NS 至 8 ml）。',
        peds: { kind: 'perkg', lo: 0.1, hi: 0.2, max: 10, note: '兒童 0.1–0.2 mg/kg；小體重可再稀釋至 1 mg/ml。' } },
      { id: 'phenylephrine', name: 'Phenylephrine (Bolus)', kind: 'fixed', lo: 50, hi: 100, unit: 'mcg', conc: 100, note: '稀釋液 100 mcg/ml（例：10 mg in 100 ml）；可能引起反射性心跳變慢。',
        peds: { kind: 'perkg', lo: 1, hi: 2, max: 100, note: '兒童 1–2 mcg/kg；可稀釋為 10 mcg/ml。嬰幼兒心輸出依賴心跳，注意反射性心跳變慢。' } },
      { id: 'ne_bolus', name: 'Norepinephrine (Bolus)', kind: 'fixed', lo: 4, hi: 10, unit: 'mcg', conc: 10, note: '急救/急升壓用。預設 10 mcg/ml（同院內滴注泡法 4 mg in D5W 400 ml）— 請務必核對實際濃度。',
        peds: null, pedsNote: '兒童無標準單次推注劑量，請改用連續滴注。' },
    ],
  },
  {
    key: 'I', title: 'I. Antihypertensives 降壓 / 心律（單次推注）', items: [
      { id: 'labetalol', name: 'Labetalol', kind: 'fixed', lo: 5, hi: 20, unit: 'mg', conc: 5, note: 'IV slow push；氣喘、心衰竭、傳導阻滯者慎用。',
        peds: { kind: 'perkg', lo: 0.2, hi: 1, max: 20, note: '兒童 0.2–1 mg/kg/dose（max 20 mg），slow push。' } },
      { id: 'nicardipine_bolus', name: 'Nicardipine (Cardene) Bolus', kind: 'fixed', lo: 0.5, hi: 2, unit: 'mg', conc: 1, note: '可稀釋為 0.1 mg/ml 以利小劑量推注（請修改濃度欄）。',
        peds: null, pedsNote: '兒童一般不單次推注，請改用連續滴注（0.5–3 mcg/kg/min）。' },
      { id: 'hydralazine', name: 'Hydralazine', kind: 'fixed', lo: 5, hi: 10, unit: 'mg', conc: 20, note: 'IV slow push；起效 10–20 分鐘，避免短時間內重複追加。',
        peds: { kind: 'perkg', lo: 0.1, hi: 0.2, max: 20, note: '兒童 0.1–0.2 mg/kg（max 20 mg）；起效 10–20 分鐘。' } },
      { id: 'esmolol', name: 'Esmolol (Brevibloc)', kind: 'perkg', lo: 0.5, hi: 0.5, unit: 'mg', conc: 10, basis: 'ABW', note: '0.5 mg/kg over 1 min；之後可接 50–300 mcg/kg/min 滴注。',
        peds: { lo: 0.1, hi: 0.5, note: '兒童 0.1–0.5 mg/kg over 1 min；之後可接 50–300 mcg/kg/min。' } },
    ],
  },
  {
    key: 'J', title: 'J. Resuscitation 急救', items: [
      { id: 'epi_arrest', name: 'Epinephrine (Cardiac arrest)', kind: 'fixed', lo: 1, hi: 1, unit: 'mg', conc: 0.1, note: 'ACLS：1 mg IV/IO q3–5 min（0.1 mg/ml = 1 mg/10 ml）。',
        peds: { kind: 'perkg', lo: 0.01, hi: 0.01, max: 1, note: 'PALS：0.01 mg/kg IV/IO（= 0.1 ml/kg of 0.1 mg/ml），q3–5 min，max 1 mg。' } },
      { id: 'amiodarone', name: 'Amiodarone (VF / pVT)', kind: 'fixed', lo: 300, hi: 300, unit: 'mg', conc: 50, note: 'ACLS：首劑 300 mg，第二劑 150 mg。',
        peds: { kind: 'perkg', lo: 5, hi: 5, max: 300, note: 'PALS：5 mg/kg（max 300 mg），可重複至總量 15 mg/kg。' } },
    ],
  },
];

/* 連續滴注：mixAmount + mixUnit / mixVolume ml → 濃度
 * doseUnit: 'mcg/kg/min' | 'mcg/min' | 'mg/hr'
 * peds: 兒童劑量範圍 / 單位；rule6: Rule of 6 係數（6 或 0.6） */
const INFUSION_GROUPS = [
  {
    key: 'H2', title: 'H. Vasopressors & Inotropes（連續滴注）', items: [
      { id: 'ne_inf', name: 'Norepinephrine (Levophed)', lo: 0.02, hi: 0.2, doseUnit: 'mcg/kg/min', mixAmount: 4, mixUnit: 'mg', mixVolume: 400, note: '院內泡法（藥師配製）：1 mg/ml × 4 ml/amp，1 支加入 D5W 400 ml ≈ 10 mcg/ml（0.01 mg/ml）；建議中心靜脈給予。',
        peds: { lo: 0.05, hi: 1, rule6: 0.6, note: '兒童常用 0.05–1 mcg/kg/min（最高可至 2）。' } },
      { id: 'dopamine', name: 'Dopamine', lo: 2, hi: 20, doseUnit: 'mcg/kg/min', mixAmount: 200, mixUnit: 'mg', mixVolume: 100, note: '院內泡法：200 mg/5 ml + 95 ml = 200 mg/100 ml（2000 mcg/ml）。',
        peds: { lo: 2, hi: 20, rule6: 6, note: '兒童 2–20 mcg/kg/min。' } },
      { id: 'dobutamine', name: 'Dobutamine', lo: 2, hi: 20, doseUnit: 'mcg/kg/min', mixAmount: 250, mixUnit: 'mg', mixVolume: 100, note: '院內泡法：250 mg/20 ml + NS 80 ml = 250 mg/100 ml（2500 mcg/ml）。',
        peds: { lo: 2, hi: 20, rule6: 6, note: '兒童 2–20 mcg/kg/min。' } },
      { id: 'epi_inf', name: 'Epinephrine (Infusion)', lo: 0.01, hi: 0.1, doseUnit: 'mcg/kg/min', mixAmount: 1, mixUnit: 'mg', mixVolume: 250, note: '常見泡法 1 mg in 250 ml = 4 mcg/ml。',
        peds: { lo: 0.02, hi: 1, rule6: 0.6, note: 'PALS 0.1–1 mcg/kg/min；低劑量強心 0.02–0.1。' } },
    ],
  },
  {
    key: 'I2', title: 'I. Antihypertensives（連續滴注）', items: [
      { id: 'ntg', name: 'NTG (Nitroglycerin)', lo: 5, hi: 100, doseUnit: 'mcg/min', mixAmount: 50, mixUnit: 'mg', mixVolume: 100, note: '院內泡法：5 mg/amp × 10 支原液 = 50 mg/100 ml（500 mcg/ml）；不依體重。',
        peds: { lo: 0.25, hi: 5, doseUnit: 'mcg/kg/min', rule6: 6, note: '兒童依體重：0.25–0.5 起始，max 5（–10）mcg/kg/min。' } },
      { id: 'nicardipine_inf', name: 'Nicardipine (Infusion)', lo: 2.5, hi: 15, doseUnit: 'mg/hr', mixAmount: 10, mixUnit: 'mg', mixVolume: 100, note: '常見泡法 10 mg in 100 ml NS = 0.1 mg/ml；不依體重。',
        peds: { lo: 0.5, hi: 3, doseUnit: 'mcg/kg/min', note: '兒童 0.5–3 mcg/kg/min（max 5）。濃度勿過高（周邊 ≤ 0.1–0.2 mg/ml），故不套用 Rule of 6。' } },
    ],
  },
];

// 依病人年齡取得實際使用的藥物設定
function resolveBolus(d, pt) {
  if (!pt.valid || !pt.peds) return { ...d, isPeds: false };
  if (d.peds === null) return { ...d, isPeds: true, unavailable: true, note: d.pedsNote };
  if (!d.peds) return { ...d, isPeds: true };
  const s = { ...d, ...d.peds, isPeds: true };
  if (pt.infant && d.infant) Object.assign(s, d.infant);
  return s;
}
function resolveInfusion(d, pt) {
  if (!pt.valid || !pt.peds || !d.peds) return { ...d, isPeds: false };
  return { ...d, ...d.peds, doseUnit: d.peds.doseUnit || d.doseUnit, isPeds: true };
}

/* ml/hr 計算（內部濃度一律換成 mcg/ml） */
function infusionRate(doseUnit, dose, wt, concMcgPerMl) {
  if (!(concMcgPerMl > 0) || !Number.isFinite(dose)) return NaN;
  if (doseUnit === 'mcg/kg/min') return (dose * wt * 60) / concMcgPerMl;
  if (doseUnit === 'mcg/min') return (dose * 60) / concMcgPerMl;
  if (doseUnit === 'mg/hr') return (dose * 1000) / concMcgPerMl;
  return NaN;
}

/* ============================================================
 * 回饋送出
 * 以 text/plain 傳 JSON，避免 CORS preflight（Apps Script 不支援 OPTIONS）
 * mode: 'no-cors' 拿不到回應內容，只要沒有網路錯誤就視為成功
 * ============================================================ */
async function postToWebhook(url, payload) {
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
}

function readQueue() {
  try { return JSON.parse(lsGet(LS_QUEUE, '[]')) || []; } catch { return []; }
}
function writeQueue(q) { lsSet(LS_QUEUE, JSON.stringify(q)); }

async function submitFeedback({ url, patient, pt, airway, actual }) {
  if (!url) throw new Error('NO_URL');
  const r1 = (v) => (Number.isFinite(v) ? +v.toFixed(1) : '');
  const payload = {
    timestamp: new Date().toISOString(),
    sex: patient.sex,
    age: +pt.age.toFixed(2),
    height_cm: pt.hasH ? pt.h : '',
    weight_kg: pt.w,
    bmi: r1(pt.bmi),
    ibw_kg: pt.peds ? '' : r1(pt.ibw),
    adjbw_kg: pt.peds ? '' : r1(pt.adjbw),
    suggested_ett_id_mm: airway?.ett?.suggestId ?? '',
    suggested_ett_depth_cm: airway?.ett?.suggestDepth ?? '',
    suggested_dlt_fr: airway?.dlt?.notForPeds ? '' : airway?.dlt?.fr ?? '',
    suggested_dlt_depth_cm: airway?.dlt?.notForPeds ? '' : airway?.dlt?.suggestDepth ?? '',
    actual_tube_type: actual.tubeType,
    actual_size: actual.size,
    actual_depth_cm: actual.depth,
    cormack_lehane: actual.cl,
    notes: actual.notes,
  };
  try {
    await postToWebhook(url, payload);
    return { queued: false };
  } catch {
    const q = readQueue();
    q.push({ url, payload });
    writeQueue(q);
    return { queued: true };
  }
}

async function flushQueue() {
  const q = readQueue();
  if (!q.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of q) {
    try { await postToWebhook(item.url, item.payload); sent++; } catch { left.push(item); }
  }
  writeQueue(left);
  return sent;
}

/* ============================================================
 * UI 元件
 * ============================================================ */
function Disclaimer() {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
      ⚠️ {DISCLAIMER}
    </div>
  );
}

function Card({ id, title, subtitle, children, right }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200';

function Segmented({ value, onChange, options, small }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2 ${small ? 'py-0.5 text-xs' : 'py-1.5 text-sm'} font-medium transition ${value === o.value ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, unit, hint }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums text-slate-900">
        {value}<span className="ml-0.5 text-xs font-normal text-slate-500">{unit}</span>
      </div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Big({ children }) {
  return <span className="text-2xl font-bold tabular-nums text-teal-700">{children}</span>;
}

function PedsPill() {
  return <span className="ml-1 rounded-full bg-sky-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-sky-700">兒童劑量</span>;
}

/* ---------------- 病人資料 ---------------- */
function PatientCard({ patient, setPatient, pt }) {
  const set = (k) => (e) => setPatient({ ...patient, [k]: e.target.value });
  const bmiTag = !pt.valid || pt.peds || !pt.hasH ? '' : pt.bmi < 18.5 ? '過輕' : pt.bmi < 24 ? '正常' : pt.bmi < 27 ? '過重' : pt.bmi < 35 ? '肥胖' : '重度肥胖';
  const isPedsAge = pt.age >= 0 && pt.age < 12;
  const estW = isPedsAge ? estimateWeight(pt.age) : NaN;
  return (
    <Card id="patient" title="1. 病人基本資料" subtitle="輸入後下方所有計算即時更新">
      <div className="space-y-3">
        <Segmented
          value={patient.sex}
          onChange={(v) => setPatient({ ...patient, sex: v })}
          options={[{ value: 'M', label: '♂ Male' }, { value: 'F', label: '♀ Female' }]}
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">年齡</span>
            </div>
            <input className={inputCls} inputMode="decimal" type="number" value={patient.age} onChange={set('age')} placeholder={patient.ageUnit === 'm' ? '6' : '50'} />
            <div className="mt-1">
              <Segmented small value={patient.ageUnit} onChange={(v) => setPatient({ ...patient, ageUnit: v })} options={[{ value: 'y', label: '歲' }, { value: 'm', label: '月' }]} />
            </div>
          </div>
          <Field label="實際體重 (kg)"><input className={inputCls} inputMode="decimal" type="number" value={patient.weight} onChange={set('weight')} placeholder="70" /></Field>
          <Field label={isPedsAge ? '身高 (cm，選填)' : '身高 (cm)'}><input className={inputCls} inputMode="decimal" type="number" value={patient.height} onChange={set('height')} placeholder="170" /></Field>
        </div>
        {Number.isFinite(estW) && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            <span>APLS 依年齡估算體重 ≈ <b>{fmt(estW)} kg</b>（體重未知時參考）</span>
            <button type="button" onClick={() => setPatient({ ...patient, weight: String(+estW.toFixed(1)) })} className="shrink-0 rounded-md bg-sky-600 px-2 py-1 font-medium text-white">帶入</button>
          </div>
        )}
        {pt.valid ? (
          <>
            {pt.peds ? (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="維持輸液 4-2-1" value={fmt(pt.maint)} unit="ml/hr" />
                <Stat label="估計血量 EBV" value={fmt(pt.ebv)} unit="ml" hint={`${pt.ebvPerKg} ml/kg`} />
                <Stat label="BMI" value={pt.hasH ? fmt(pt.bmi) : '—'} unit="" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Stat label="BMI" value={fmt(pt.bmi)} unit="" hint={bmiTag} />
                <Stat label="IBW (Devine)" value={fmt(pt.ibw)} unit="kg" />
                <Stat label="AdjBW (40%)" value={fmt(pt.adjbw)} unit="kg" />
              </div>
            )}
            {pt.peds && (
              <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-800">
                👶 兒童模式（{ageLabel(pt)}{pt.neonate ? '，新生兒' : pt.infant ? '，嬰兒' : ''}）：所有藥物改用兒童劑量並依實際體重計算，已套用單次最大劑量上限。
              </p>
            )}
            {!pt.peds && pt.shortStature && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">身高 &lt; 152 cm 時 Devine IBW 準確度下降，請留意。</p>
            )}
          </>
        ) : pt.needHeight ? (
          <p className="text-sm text-amber-700">成人請輸入身高（計算 IBW、DLT）。</p>
        ) : (
          <p className="text-sm text-slate-400">請輸入年齡與體重（成人另需身高）。嬰兒可切換「月」輸入。</p>
        )}
      </div>
    </Card>
  );
}

/* ---------------- 呼吸道 ---------------- */
function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 py-1 text-sm first:border-0">
      <span className="text-slate-600">{label}</span>
      <b className="tabular-nums">{value}</b>
    </div>
  );
}

function PedsEtt({ ett, lma }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-xl p-3 ring-1 ${ett.cuffed ? 'bg-teal-50 ring-teal-200' : 'bg-slate-50 ring-slate-200'}`}>
          <div className="text-xs text-teal-800">Cuffed ID</div>
          <Big>{ett.cuffed ? `${sizeRange(ett.cuffed)} mm` : '不建議'}</Big>
        </div>
        <div className={`rounded-xl p-3 ring-1 ${ett.cuffed ? 'bg-slate-50 ring-slate-200' : 'bg-teal-50 ring-teal-200'}`}>
          <div className="text-xs text-slate-600">Uncuffed ID</div>
          <Big>{sizeRange(ett.uncuffed)} mm</Big>
        </div>
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <div className="text-xs font-medium text-slate-500">固定深度（門齒 / 嘴角）</div>
        {ett.depths.map((d) => <InfoRow key={d.label} label={d.label} value={`${fmt(d.cm)} cm`} />)}
      </div>
      <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <InfoRow label="喉頭鏡 Blade" value={ett.blade} />
        <InfoRow label="LMA（依體重）" value={`#${lma}`} />
        <InfoRow label="抽痰管（ID × 2）" value={`${fmt(ett.suction)} Fr`} />
      </div>
      <p className="text-xs text-slate-500">依據：{ett.method}。ID 已向下取至 0.5 mm；請備妥上下各半號。</p>
      {ett.note && <p className="rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-800">{ett.note}</p>}
    </div>
  );
}

function AirwayCard({ airway, pt, tab, setTab }) {
  return (
    <Card id="airway" title="2. 氣管內管與深度" subtitle="建議值，實際以臨床評估為準">
      <div className="mb-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'ETT', label: '單腔 ETT' }, { value: 'DLT', label: '雙腔 DLT (Left)' }]} />
      </div>
      {!airway ? (
        <p className="text-sm text-slate-400">請先輸入病人資料。</p>
      ) : tab === 'ETT' ? (
        airway.ett.peds ? (
          <PedsEtt ett={airway.ett} lma={airway.lma} />
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-teal-50 p-3 ring-1 ring-teal-200">
              <div className="text-xs text-teal-800">建議內徑 ID（{airway.ett.lo === 7.5 ? '男性' : '女性'}）</div>
              <Big>{airway.ett.lo} – {airway.ett.hi} mm</Big>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <div className="text-xs font-medium text-slate-500">固定深度（門齒）</div>
              <InfoRow label="Height / 7" value={`${fmt(airway.ett.depthHeight)} cm`} />
              <InfoRow label="ID × 3" value={`${fmt(airway.ett.depthIdLo)} – ${fmt(airway.ett.depthIdHi)} cm`} />
              <InfoRow label="LMA（依體重）" value={`#${airway.lma}`} />
            </div>
            <p className="text-xs text-slate-500">插管後以 EtCO₂ 與雙側聽診確認位置。</p>
          </div>
        )
      ) : airway.dlt.notForPeds ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">兒童（&lt; 12 歲）不適用此成人 DLT 對照表，請依專科判斷（如 bronchial blocker / Univent）。</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-teal-50 p-3 ring-1 ring-teal-200">
              <div className="text-xs text-teal-800">管徑</div>
              <Big>{airway.dlt.fr} Fr</Big>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-600">深度 29 + (H−170)/10</div>
              <Big>{fmt(airway.dlt.depth)} cm</Big>
            </div>
          </div>
          <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700">⚠️ 插管後須以纖維支氣管鏡 (FOB) 定位確認</p>
          <p className="text-xs text-slate-500">對照：女 &lt;150 → 32、150–160 → 35、&gt;160 → 37 Fr；男 &lt;160 → 37、160–170 → 39、&gt;170 → 41 Fr。</p>
        </div>
      )}
    </Card>
  );
}

/* ---------------- 藥物卡 ---------------- */
const BASIS_LABEL = { ABW: '實際體重', IBW: 'IBW', AdjBW: 'AdjBW' };

function ConcInput({ value, onChange, unit }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      濃度
      <input
        type="number"
        inputMode="decimal"
        className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm text-slate-800"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit}/ml
    </label>
  );
}

function BolusDrug({ d: raw, pt, weightMode, conc, setConc }) {
  const d = resolveBolus(raw, pt);
  const c = num(conc);
  if (d.unavailable) {
    return (
      <div className="rounded-xl border border-slate-200 p-3 opacity-80">
        <h4 className="font-bold text-slate-900">{d.name}<PedsPill /></h4>
        <p className="mt-1 text-sm font-medium text-slate-600">— {d.note}</p>
      </div>
    );
  }
  const basis = weightMode === 'auto' ? d.basis : weightMode;
  const wt = d.kind === 'perkg' ? dosingWeight(basis, pt) : NaN;
  let lo = d.kind === 'perkg' ? d.lo * wt : d.lo;
  let hi = d.kind === 'perkg' ? d.hi * wt : d.hi;
  let capped = false;
  if (d.max && hi > d.max) { hi = d.max; lo = Math.min(lo, d.max); capped = true; }
  const ok = d.kind === 'fixed' || pt.valid;
  const volLo = lo / c, volHi = hi / c;
  const tinyVol = ok && c > 0 && volLo < 0.3;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="font-bold text-slate-900">{d.name}{d.isPeds && <PedsPill />}</h4>
        <span className="text-xs text-slate-500">
          {d.kind === 'perkg' ? range(d.lo, d.hi, d.unit + '/kg') : `固定 ${range(d.lo, d.hi, d.unit)}`}
          {d.max ? `（max ${d.max} ${d.unit}）` : ''}
        </span>
      </div>
      {ok ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-teal-50 px-2 py-1.5">
            <div className="text-[11px] text-teal-800">計算總量</div>
            <div className="text-lg font-bold tabular-nums text-teal-800">{range(lo, hi, d.unit)}</div>
          </div>
          <div className="rounded-lg bg-indigo-50 px-2 py-1.5">
            <div className="text-[11px] text-indigo-800">給藥體積</div>
            <div className="text-lg font-bold tabular-nums text-indigo-800">{c > 0 ? range(volLo, volHi, 'ml') : '—'}</div>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">需病人資料</p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ConcInput value={conc} onChange={setConc} unit={d.unit} />
        {d.kind === 'perkg' && pt.valid && (
          <span className="text-[11px] text-slate-500">依 {pt.peds ? '實際體重' : BASIS_LABEL[basis]} {fmt(wt)} kg</span>
        )}
      </div>
      {capped && <p className="mt-1 text-xs font-medium text-red-600">已套用單次上限 {d.max} {d.unit}</p>}
      {tinyVol && <p className="mt-1 text-xs font-medium text-amber-700">⚠️ 體積 &lt; 0.3 ml，建議先稀釋（例如稀釋 10 倍後修改濃度欄）以利精準抽取。</p>}
      {d.note && <p className="mt-1 text-xs text-slate-500">💡 {d.note}</p>}
    </div>
  );
}

function ReversalCard({ pt, weightMode, concs, setConc }) {
  const neoConc = num(concs.neostigmine ?? 0.5);
  const glyConc = num(concs.rev_glyco ?? 0.2);
  const sgxConc = num(concs.sugammadex ?? 100);
  const neoBasis = weightMode === 'auto' ? 'ABW' : weightMode;
  const wNeo = dosingWeight(neoBasis, pt);
  const wSgx = dosingWeight(weightMode === 'auto' ? 'ABW' : weightMode, pt);
  const MAX = 5;
  const neoLoRaw = 0.04 * wNeo, neoHiRaw = 0.07 * wNeo;
  const neoLo = Math.min(neoLoRaw, MAX), neoHi = Math.min(neoHiRaw, MAX);
  const capped = neoHiRaw > MAX;
  const glyLo = neoLo * 0.2, glyHi = neoHi * 0.2;
  const sgx = [
    { label: '常規反轉 Moderate（TOF ≥ 2）', perkg: 2 },
    { label: '深層反轉 Deep（PTC 1–2）', perkg: 4 },
    { label: '急救極速反轉 Immediate', perkg: 16 },
  ];
  if (!pt.valid) return <p className="text-sm text-slate-400">需病人資料</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 p-3">
        <h4 className="font-bold">健保 / 傳統版：Neostigmine + Glycopyrrolate{pt.peds && <PedsPill />}</h4>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-teal-50 px-2 py-1.5">
            <div className="text-[11px] text-teal-800">Neostigmine 0.04–0.07 mg/kg</div>
            <div className="text-lg font-bold tabular-nums text-teal-800">{range(neoLo, neoHi, 'mg')}</div>
            <div className="text-xs text-teal-700">{neoConc > 0 ? range(neoLo / neoConc, neoHi / neoConc, 'ml') : '—'}</div>
          </div>
          <div className="rounded-lg bg-indigo-50 px-2 py-1.5">
            <div className="text-[11px] text-indigo-800">Glycopyrrolate（0.2 mg / 1 mg Neo）</div>
            <div className="text-lg font-bold tabular-nums text-indigo-800">{range(glyLo, glyHi, 'mg')}</div>
            <div className="text-xs text-indigo-700">{glyConc > 0 ? range(glyLo / glyConc, glyHi / glyConc, 'ml') : '—'}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          <ConcInput value={concs.neostigmine ?? 0.5} onChange={(v) => setConc('neostigmine', v)} unit="Neo mg" />
          <ConcInput value={concs.rev_glyco ?? 0.2} onChange={(v) => setConc('rev_glyco', v)} unit="Gly mg" />
        </div>
        {capped && <p className="mt-1 text-xs font-medium text-red-600">Neostigmine 已套用上限 5 mg</p>}
        <p className="mt-1 text-xs text-slate-500">💡 依 {pt.peds ? '實際體重' : BASIS_LABEL[neoBasis]} {fmt(wNeo)} kg；建議 TOF 有恢復（≥ 2–4 twitch）後再給予。{pt.peds && '兒童可用 Atropine 0.02 mg/kg 取代 Glycopyrrolate。'}</p>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <h4 className="font-bold">高級 / 自費版：Sugammadex (Bridion)</h4>
        <div className="mt-2 space-y-1.5">
          {sgx.map((s) => {
            const mg = s.perkg * wSgx;
            return (
              <div key={s.perkg} className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${s.perkg === 16 ? 'bg-red-50' : 'bg-teal-50'}`}>
                <div className="text-xs">
                  <div className="font-medium text-slate-800">{s.label}</div>
                  <div className="text-slate-500">{s.perkg} mg/kg{pt.peds && s.perkg === 16 ? '（兒童資料有限）' : ''}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{fmt(mg)} mg</div>
                  <div className="text-xs tabular-nums text-slate-600">{sgxConc > 0 ? fmt(mg / sgxConc) : '—'} ml</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <ConcInput value={concs.sugammadex ?? 100} onChange={(v) => setConc('sugammadex', v)} unit="mg" />
          <span className="text-[11px] text-slate-500">依 {pt.peds ? '實際體重' : BASIS_LABEL[weightMode === 'auto' ? 'ABW' : weightMode]} {fmt(wSgx)} kg</span>
        </div>
        {pt.peds && pt.age < 2 && <p className="mt-1 text-xs font-medium text-amber-700">⚠️ Sugammadex 核准用於 ≥ 2 歲；&lt; 2 歲屬 off-label，資料有限。</p>}
        {pt.peds && <p className="mt-1 text-xs text-slate-500">💡 兒童體積小，可先稀釋為 10 mg/ml（修改濃度欄）。</p>}
        <p className="mt-1 text-xs text-slate-500">💡 僅反轉 Rocuronium / Vecuronium；200 mg/2 ml 一支，注意可能影響荷爾蒙避孕藥效。</p>
      </div>
    </div>
  );
}

function InfusionDrug({ d: raw, pt, state, setState }) {
  const d = resolveInfusion(raw, pt);
  const mixAmt = num(state.mixAmount), mixVol = num(state.mixVolume);
  const concMcg = (d.mixUnit === 'mg' ? mixAmt * 1000 : mixAmt) / mixVol;
  const weightBased = d.doseUnit === 'mcg/kg/min';
  const wt = pt.valid ? pt.w : NaN;
  const dose = num(state.dose);
  const rate = weightBased && !pt.valid ? NaN : infusionRate(d.doseUnit, dose, wt, concMcg);
  const steps = 5;
  const table = Array.from({ length: steps }, (_, i) => {
    const v = d.lo + ((d.hi - d.lo) * i) / (steps - 1);
    return { dose: v, rate: weightBased && !pt.valid ? NaN : infusionRate(d.doseUnit, v, wt, concMcg) };
  });
  const concLabel = concMcg >= 1000 ? `${fmt(concMcg / 1000)} mg/ml` : `${fmt(concMcg)} mcg/ml`;
  const outOfRange = Number.isFinite(dose) && (dose < d.lo || dose > d.hi);
  const applyRule6 = () => setState({ ...state, mixAmount: String(+(d.rule6 * pt.w).toFixed(2)), mixVolume: '100' });
  const resetMix = () => setState({ ...state, mixAmount: String(raw.mixAmount), mixVolume: String(raw.mixVolume) });
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="font-bold text-slate-900">{d.name}{d.isPeds && <PedsPill />}</h4>
        <span className="text-xs text-slate-500">{range(d.lo, d.hi, d.doseUnit)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-600">
        泡法
        <input type="number" inputMode="decimal" className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm" value={state.mixAmount} onChange={(e) => setState({ ...state, mixAmount: e.target.value })} />
        {d.mixUnit} in
        <input type="number" inputMode="decimal" className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm" value={state.mixVolume} onChange={(e) => setState({ ...state, mixVolume: e.target.value })} />
        ml ＝ <b className="text-slate-800">{Number.isFinite(concMcg) ? concLabel : '—'}</b>
      </div>
      {d.isPeds && pt.valid && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {d.rule6 && (
            <button type="button" onClick={applyRule6} className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white active:bg-sky-700">
              套用 Rule of {d.rule6 === 6 ? '6' : '0.6'}：{fmt(d.rule6 * pt.w)} mg / 100 ml
            </button>
          )}
          <button type="button" onClick={resetMix} className="rounded-md bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">院內成人泡法</button>
        </div>
      )}
      {d.isPeds && d.rule6 && (
        <p className="mt-1 text-[11px] text-sky-700">Rule of {d.rule6 === 6 ? '6：1 ml/hr = 1' : '0.6：1 ml/hr = 0.1'} mcg/kg/min</p>
      )}
      <div className="mt-2 grid grid-cols-2 items-end gap-2">
        <Field label={`目標劑量 (${d.doseUnit})`}>
          <input type="number" inputMode="decimal" step="any" className={inputCls} value={state.dose} onChange={(e) => setState({ ...state, dose: e.target.value })} />
        </Field>
        <div className="rounded-lg bg-teal-600 px-2 py-1.5 text-center text-white">
          <div className="text-[11px] opacity-90">幫浦速率</div>
          <div className="text-2xl font-bold tabular-nums">{fmt(rate)}<span className="ml-1 text-sm font-normal">ml/hr</span></div>
        </div>
      </div>
      {outOfRange && <p className="mt-1 text-xs font-medium text-red-600">超出建議範圍 {range(d.lo, d.hi, d.doseUnit)}</p>}
      {pt.peds && Number.isFinite(rate) && rate > 0 && rate < 0.5 && <p className="mt-1 text-xs font-medium text-amber-700">⚠️ 速率 &lt; 0.5 ml/hr，建議改用較稀濃度（如 Rule of 6）以提高幫浦精確度。</p>}
      {weightBased && !pt.valid && <p className="mt-1 text-xs text-slate-400">需病人體重</p>}
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead><tr className="text-slate-500"><th className="text-left font-normal">劑量 ({d.doseUnit})</th><th className="text-right font-normal">ml/hr</th></tr></thead>
        <tbody>
          {table.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-0.5">{fmt(r.dose)}</td>
              <td className="py-0.5 text-right font-medium">{fmt(r.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-500">
        公式：{weightBased ? `劑量 × ${pt.valid ? fmt(wt) : 'kg'} kg (ABW) × 60 ÷ 濃度(mcg/ml)` : d.doseUnit === 'mcg/min' ? '劑量 × 60 ÷ 濃度(mcg/ml)' : '劑量(mg/hr) ÷ 濃度(mg/ml)'}
      </p>
      {d.note && <p className="mt-1 text-xs text-slate-500">💡 {d.note}</p>}
    </div>
  );
}

function Group({ title, children, defaultOpen }) {
  return (
    <details open={defaultOpen} className="group rounded-xl bg-slate-50 ring-1 ring-slate-200">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-semibold text-slate-800">
        {title}
        <span className="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-2 px-2 pb-2">{children}</div>
    </details>
  );
}

const byKey = (groups, k) => groups.find((g) => g.key === k);

function MedicationCard({ pt, weightMode, setWeightMode, concs, setConc, infusions, setInfusion }) {
  const renderItem = (d) =>
    d.doseUnit ? (
      <InfusionDrug key={d.id} d={d} pt={pt} state={infusions[pt.peds ? `${d.id}_p` : d.id]} setState={(s) => setInfusion(pt.peds ? `${d.id}_p` : d.id, s)} />
    ) : (
      <BolusDrug key={d.id} d={d} pt={pt} weightMode={weightMode} conc={concs[d.id] ?? d.conc} setConc={(v) => setConc(d.id, v)} />
    );
  const order = [
    byKey(BOLUS_GROUPS, 'A'), byKey(BOLUS_GROUPS, 'B'), byKey(BOLUS_GROUPS, 'C'), byKey(BOLUS_GROUPS, 'D'),
    byKey(BOLUS_GROUPS, 'E'), byKey(BOLUS_GROUPS, 'F'), 'REVERSAL',
    byKey(BOLUS_GROUPS, 'H'), byKey(INFUSION_GROUPS, 'H2'), byKey(BOLUS_GROUPS, 'I'), byKey(INFUSION_GROUPS, 'I2'),
    byKey(BOLUS_GROUPS, 'J'),
  ];
  return (
    <Card id="meds" title="3. 藥物劑量估算" subtitle="可修改各藥物濃度以符合院內品項">
      {pt.valid && pt.peds ? (
        <p className="mb-3 rounded-lg bg-sky-50 p-2 text-xs text-sky-800">👶 兒童模式：全部依實際體重 {fmt(pt.w)} kg 計算，並套用兒童劑量與單次上限。</p>
      ) : (
        <div className="mb-3 space-y-1">
          <span className="text-xs font-medium text-slate-600">給藥體重基準（依體重藥物）</span>
          <Segmented
            value={weightMode}
            onChange={setWeightMode}
            options={[{ value: 'auto', label: '自動' }, { value: 'ABW', label: 'ABW' }, { value: 'IBW', label: 'IBW' }, { value: 'AdjBW', label: 'AdjBW' }]}
          />
          <p className="text-[11px] text-slate-500">自動：依各藥物建議（例如 Rocuronium 用 IBW、Succinylcholine / Sugammadex 用 ABW）。IBW/AdjBW 大於實際體重時改用實際體重；連續滴注一律用 ABW。</p>
        </div>
      )}
      <div className="space-y-2">
        {order.map((g, i) =>
          g === 'REVERSAL' ? (
            <Group key="G" title="G. Neuromuscular Reversal 反轉劑">
              <ReversalCard pt={pt} weightMode={weightMode} concs={concs} setConc={setConc} />
            </Group>
          ) : (
            <Group key={g.key} title={g.title} defaultOpen={i < 3}>
              {g.items.map(renderItem)}
            </Group>
          )
        )}
      </div>
    </Card>
  );
}

/* ---------------- 回饋 ---------------- */
const EMPTY_FB = { tubeType: 'ETT', size: '', depth: '', cl: '', notes: '' };

function FeedbackCard({ patient, pt, airway, airwayTab, webhookUrl, setWebhookUrl, toast }) {
  const [fb, setFb] = useState(EMPTY_FB);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(!webhookUrl);
  const [urlDraft, setUrlDraft] = useState(webhookUrl);
  const set = (k) => (e) => setFb({ ...fb, [k]: e.target.value });

  const fillSuggested = () => {
    if (!airway) return toast('請先輸入病人資料', 'error');
    if (airwayTab === 'DLT' && !airway.dlt.notForPeds) {
      setFb({ ...fb, tubeType: 'DLT', size: String(airway.dlt.fr), depth: String(airway.dlt.suggestDepth) });
    } else {
      setFb({ ...fb, tubeType: 'ETT', size: String(airway.ett.suggestId), depth: String(airway.ett.suggestDepth) });
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!pt.valid) return toast('請先完成病人基本資料', 'error');
    if (!fb.size || !fb.depth) return toast('請填寫實際管徑與深度', 'error');
    if (!webhookUrl) { setShowSettings(true); return toast('請先設定 Google Apps Script URL', 'error'); }
    setSending(true);
    try {
      const { queued } = await submitFeedback({ url: webhookUrl, patient, pt, airway, actual: fb });
      toast(queued ? '目前離線，已暫存，連線後自動補送' : '✅ 已送出插管紀錄，感謝回饋！', queued ? 'warn' : 'success');
      setFb(EMPTY_FB);
    } finally {
      setSending(false);
    }
  };

  const saveUrl = () => {
    const u = urlDraft.trim();
    if (u && !/^https:\/\//.test(u)) return toast('URL 必須以 https:// 開頭', 'error');
    setWebhookUrl(u);
    lsSet(LS_URL, u);
    setShowSettings(false);
    toast(u ? '已儲存回饋網址' : '已清除回饋網址', 'success');
  };

  return (
    <Card
      id="feedback"
      title="4. 實際插管紀錄回饋"
      subtitle="協助驗證並改進建議公式（勿填寫病歷號、姓名等可識別資訊）"
      right={<button type="button" onClick={() => setShowSettings((s) => !s)} className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">⚙️</button>}
    >
      {showSettings && (
        <div className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <Field label="Google Apps Script Web App URL">
            <input className={inputCls} value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
          </Field>
          <button type="button" onClick={saveUrl} className="w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white">儲存網址</button>
          <p className="text-[11px] text-slate-500">網址僅存在此裝置。部署方式見 apps-script/Code.gs。</p>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <button type="button" onClick={fillSuggested} className="w-full rounded-lg border-2 border-dashed border-teal-400 py-2 text-sm font-semibold text-teal-700 active:bg-teal-50">
          ⬇️ 一鍵帶入建議值（{airwayTab === 'DLT' && !pt.peds ? '雙腔 DLT' : '單腔 ETT'}）
        </button>
        <Segmented value={fb.tubeType} onChange={(v) => setFb({ ...fb, tubeType: v })} options={[{ value: 'ETT', label: '單腔 ETT' }, { value: 'DLT', label: '雙腔 DLT' }]} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={fb.tubeType === 'ETT' ? '實際管徑 (ID mm)' : '實際管徑 (Fr)'}>
            <input className={inputCls} type="number" inputMode="decimal" step="any" value={fb.size} onChange={set('size')} />
          </Field>
          <Field label="門齒固定深度 (cm)">
            <input className={inputCls} type="number" inputMode="decimal" step="any" value={fb.depth} onChange={set('depth')} />
          </Field>
        </div>
        <Field label="Cormack-Lehane 分級（選填）">
          <div className="flex gap-1">
            {['', '1', '2a', '2b', '3', '4'].map((g) => (
              <button
                key={g || 'none'}
                type="button"
                onClick={() => setFb({ ...fb, cl: g })}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium ring-1 ${fb.cl === g ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-slate-600 ring-slate-300'}`}
              >
                {g || '—'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="備註（選填）">
          <textarea className={inputCls} rows={2} value={fb.notes} onChange={set('notes')} placeholder="例：困難插管、使用 Video laryngoscope、cuffed/uncuffed、FOB 調整 +1 cm…" />
        </Field>
        <button disabled={sending} className="w-full rounded-xl bg-teal-600 py-3 text-base font-bold text-white shadow active:bg-teal-700 disabled:opacity-50">
          {sending ? '送出中…' : '送出紀錄'}
        </button>
      </form>
    </Card>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const color = toast.type === 'error' ? 'bg-red-600' : toast.type === 'warn' ? 'bg-amber-600' : 'bg-emerald-600';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className={`${color} max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg`}>{toast.msg}</div>
    </div>
  );
}

/* ============================================================
 * App
 * ============================================================ */
// 成人與兒童各自保留一組滴注設定（id 與 id_p）
function initialInfusions() {
  const o = {};
  INFUSION_GROUPS.forEach((g) => g.items.forEach((d) => {
    const base = { mixAmount: String(d.mixAmount), mixVolume: String(d.mixVolume) };
    o[d.id] = { ...base, dose: String(d.lo) };
    o[`${d.id}_p`] = { ...base, dose: String(d.peds ? d.peds.lo : d.lo) };
  }));
  return o;
}

const EMPTY_PATIENT = { sex: 'M', height: '', weight: '', age: '', ageUnit: 'y' };

function App() {
  const [patient, setPatient] = useState(EMPTY_PATIENT);
  const [airwayTab, setAirwayTab] = useState('ETT');
  const [weightMode, setWeightMode] = useState('auto');
  const [concs, setConcs] = useState({});
  const [infusions, setInfusions] = useState(initialInfusions);
  const [webhookUrl, setWebhookUrl] = useState(() => lsGet(LS_URL, '') || DEFAULT_WEBHOOK_URL);
  const [toastState, setToastState] = useState(null);

  const pt = useMemo(() => calcPatient(patient), [patient]);
  const airway = useMemo(() => calcAirway(patient, pt), [patient, pt]);

  const toast = useCallback((msg, type = 'success') => {
    setToastState({ msg, type });
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => setToastState(null), 3000);
  }, []);

  useEffect(() => {
    const tryFlush = () => flushQueue().then((n) => n && toast(`已補送 ${n} 筆暫存紀錄`, 'success'));
    tryFlush();
    window.addEventListener('online', tryFlush);
    return () => window.removeEventListener('online', tryFlush);
  }, [toast]);

  const reset = () => {
    setPatient(EMPTY_PATIENT);
    setConcs({});
    setInfusions(initialInfusions());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const nav = [['patient', '病人'], ['airway', '管路'], ['meds', '藥物'], ['feedback', '回饋']];

  return (
    <div className="mx-auto max-w-md pb-10">
      <header className={`sticky top-0 z-40 px-4 pb-2 text-white shadow ${pt.valid && pt.peds ? 'bg-sky-700' : 'bg-teal-700'}`} style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold">💉 麻醉插管・藥物計算</h1>
          <button onClick={reset} className="rounded-md bg-white/15 px-2 py-1 text-xs font-medium active:bg-white/25">清除病人</button>
        </div>
        {pt.valid && (
          <div className="mt-1 text-xs tabular-nums opacity-90">
            {pt.peds && '👶 '}{patient.sex === 'M' ? '♂' : '♀'} {ageLabel(pt)} · {pt.w}kg{pt.hasH && ` · ${pt.h}cm`}{!pt.peds && ` · BMI ${fmt(pt.bmi)} · IBW ${fmt(pt.ibw)}`}
          </div>
        )}
        <nav className="mt-2 flex gap-1">
          {nav.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="flex-1 rounded-md bg-white/10 py-1 text-center text-xs font-medium active:bg-white/25">{label}</a>
          ))}
        </nav>
      </header>

      <main className="space-y-4 px-4 pt-4">
        <Disclaimer />
        <PatientCard patient={patient} setPatient={setPatient} pt={pt} />
        <AirwayCard airway={airway} pt={pt} tab={airwayTab} setTab={setAirwayTab} />
        <MedicationCard
          pt={pt}
          weightMode={weightMode}
          setWeightMode={setWeightMode}
          concs={concs}
          setConc={(id, v) => setConcs((c) => ({ ...c, [id]: v }))}
          infusions={infusions}
          setInfusion={(id, s) => setInfusions((o) => ({ ...o, [id]: s }))}
        />
        <FeedbackCard patient={patient} pt={pt} airway={airway} airwayTab={airwayTab} webhookUrl={webhookUrl} setWebhookUrl={setWebhookUrl} toast={toast} />
        <Disclaimer />
        <p className="text-center text-[11px] text-slate-400">病人資料不會儲存於裝置；重新整理即清除。</p>
      </main>
      <Toast toast={toastState} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
