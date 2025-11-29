// score-utils.js
// スコア計算用の共通ユーティリティ（バリデーション & 単位変換）

const RANGE_PRESETS = {
  AGE: { min: 0, max: 120 },
  HR: { min: 20, max: 250 },
  SBP: { min: 40, max: 260 },
  DBP: { min: 20, max: 160 },
  CREATININE: { min: 0, max: 20 },
  URINE_ML_KG_H: { min: 0, max: 20 },// 尿量（mL/kg/h）
  GLUCOSE: { min: 20, max: 2000 },
  WEIGHT: { min: 1, max: 400 },
  HEIGHT: { min: 30, max: 250 },
  BUN: { min: 1, max: 200 },              // BUN (mg/dL)
  DIALYSIS_TIME_H: { min: 0.5, max: 8 },  // 透析時間 (h)
  UF_VOLUME_L: { min: 0, max: 10 },       // 除水量 (L)
  UACR:          { min: 0,  max: 5000 }, // 尿アルブミン/Cr 比 (mg/gCr)
  TBIL: { min: 0, max: 30 },      // 総ビリルビン (mg/dL)
  ALBUMIN: { min: 1, max: 6 },    // アルブミン (g/dL)
  INR: { min: 0.8, max: 12 },      // PT-INR
  WBC:     { min: 0,   max: 200 },  // 白血球 (×10^3/μL)
  PAO2:    { min: 20,  max: 200 },  // PaO₂ (mmHg)
  CALCIUM: { min: 4,   max: 15 },   // Ca (mg/dL)
  LDH:     { min: 0,   max: 5000 }, // LDH (IU/L)
  AST:     { min: 0,   max: 5000 }, // AST/ALT (IU/L)
  ESR:     { min: 0,   max: 150 }, 
  CRP:     { min: 0,   max: 50 },   
  SODIUM:        { min: 80, max: 200 },  // Na (mEq/L)
  POTASSIUM:     { min: 1,  max: 10 },   // K (mEq/L)
  CHLORIDE:      { min: 50, max: 150 },  // Cl (mEq/L)
  HCO3:          { min: 5,  max: 45 },   // HCO₃⁻ (mEq/L)
  OSMOLALITY:    { min: 200,max: 400 },  // 浸透圧 (mOsm/kg)
  LACTATE:       { min: 0,  max: 20 },   // 乳酸 (mmol/L)
  DURATION_MIN:  { min: 0,  max: 1440 }, // 発症からの時間など（分）
  GCS_TOTAL:     { min: 3,  max: 15 },   // GCS 合計
  ICH_VOLUME_ML: { min: 0,  max: 200 },  // ICH 体積 (mL)
  MRSS: { min: 0, max: 51 },          // modified Rodnan Skin Score (0–51)
  SYNTAX_SCORE: { min: 0, max: 60 },  // SYNTAXスコア（0–60）簡易版リスク分類用
  CERVICAL_ROTATION_DEG:       { min: 0,   max: 120 }, // BASMI 頚椎回旋 (°)
  TRAGUS_TO_WALL_CM:           { min: 0,   max: 50 },  // BASMI Tragus–Wall (cm)
  LUMBAR_SIDE_FLEXION_CM:      { min: 0,   max: 30 },  // BASMI 腰椎側屈 (cm)
  MOD_SCHOBER_CM:              { min: 0,   max: 10 },  // BASMI 修正 Schober 増加距離 (cm)
  INTERMALLEOLAR_DISTANCE_CM:  { min: 0,   max: 150 }, // BASMI 内果間距離 (cm)
};

/**
 * 数値入力をパースして検証するヘルパー
 * @param {HTMLInputElement} input - <input type="number"> など
 * @param {Object} options
 *   @property {number} [min] - 許容最小値（指定しない場合は制限なし）
 *   @property {number} [max] - 許容最大値（指定しない場合は制限なし）
 *   @property {boolean} [allowEmpty=false] - 空値を許容するか
 * @returns {{ value: number|null, error: string|null }}
 */
function parseNumericInput(input, options = {}) {
  const { min, max, allowEmpty = false } = options;

  const raw = input.value.trim();
  if (raw === "") {
    if (allowEmpty) {
      clearFieldError(input);
      return { value: null, error: null };
    } else {
      const msg = "値を入力してください";
      showFieldError(input, msg);
      return { value: NaN, error: msg };
    }
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    const msg = "数値で入力してください";
    showFieldError(input, msg);
    return { value: NaN, error: msg };
  }

  if (typeof min === "number" && value < min) {
    const msg = `${min}以上で入力してください`;
    showFieldError(input, msg);
    return { value, error: msg };
  }

  if (typeof max === "number" && value > max) {
    const msg = `${max}以下で入力してください`;
    showFieldError(input, msg);
    return { value, error: msg };
  }

  clearFieldError(input);
  return { value, error: null };
}
/**
 * チェックボックスを 1/0 に変換するヘルパー
 * - Yes/No の多い SLE / SSc / BILAG / SLEDAI などで使用
 */
function parseBooleanInput(input) {
  // checked → 1、unchecked → 0
  return input?.checked ? 1 : 0;
}


/**
 * 単位変換
 * ここでは代表的なものだけ定義し、必要に応じて増やしていく
 *
 * 例:
 *   convertUnit(100, "mg/dL", "mmol/L", "glucose")
 */
function convertUnit(value, fromUnit, toUnit, analyte) {
  if (value == null || Number.isNaN(value)) return NaN;
  if (fromUnit === toUnit) return value;

  // 分析項目ごとの変換係数
  const FACTORS = {
    // 血糖: mg/dL → mmol/L
    glucose: {
      "mg/dL:mmol/L": 0.0555,
      "mmol/L:mg/dL": 18.0,
    },
    // Na, K など電解質は通常 mmol/L 固定とし、変換不要にしておく
    // 必要があればここに追加
  };

  const key = `${fromUnit}:${toUnit}`;
  const analyteMap = FACTORS[analyte];

  if (!analyteMap || !analyteMap[key]) {
    console.warn("未対応の単位変換です:", analyte, key);
    return NaN;
  }

  return value * analyteMap[key];
}

// ▼ ここから追加：内分泌向け mg/dL ↔ mmol/L 入力変換ヘルパー
/**
 * input 要素の値を mg/dL ↔ mmol/L で相互変換するヘルパー
 * @param {HTMLInputElement} input
 * @param {string} fromUnit - "mg/dL" など
 * @param {string} toUnit   - "mmol/L" など
 * @param {string} analyte  - "glucose" など convertUnit で扱う分析項目
 * @param {number} [digits=1] - 小数点以下桁数（デフォルト 1 桁）
 */
function convertInputElementUnit(input, fromUnit, toUnit, analyte, digits = 1) {
  if (!input || fromUnit === toUnit) return;

  const raw = input.value.trim();
  if (!raw) return;

  const num = Number(raw);
  if (Number.isNaN(num)) return;

  const converted = convertUnit(num, fromUnit, toUnit, analyte);
  if (Number.isNaN(converted)) return;

  const factor = Math.pow(10, digits);
  const rounded = Math.round(converted * factor) / factor;
  input.value = String(rounded);
}


/**
 * 入力項目にエラーメッセージを表示する共通関数
 * - input の親要素内に .field-error 要素があればそこに表示
 * - なければ後ろに <div class="field-error"> を作成して表示
 */
function showFieldError(input, message) {
  input.classList.add("input-error");

  let errorElem = input.closest(".field-wrapper")?.querySelector(".field-error");
  if (!errorElem) {
    // なければ生成する
    errorElem = document.createElement("div");
    errorElem.className = "field-error";
    if (input.closest(".field-wrapper")) {
      input.closest(".field-wrapper").appendChild(errorElem);
    } else {
      // field-wrapper がない場合は input の直後に挿入
      input.insertAdjacentElement("afterend", errorElem);
    }
  }
  errorElem.textContent = message;
}

/**
 * エラーメッセージとエラースタイルをクリア
 */
function clearFieldError(input) {
  input.classList.remove("input-error");
  const errorElem = input.closest(".field-wrapper")?.querySelector(".field-error");
  if (errorElem) {
    errorElem.textContent = "";
  }
}
