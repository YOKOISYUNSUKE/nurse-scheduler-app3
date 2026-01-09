/* app-init.js : イベントリスナー初期化 */
function initControls(){
  // 従業員数 1〜60（削除で人数を減らせるよう下限撤廃）
  const maxOpt = Math.max(60, State.employeeCount);
  employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i)=>{
    const v = i + 1; return `<option value="${v}">${v}</option>`;
  }).join('');
  // 既存メタがあればそれを、なければデフォルト値のまま
  employeeCountSel.value = String(State.employeeCount);
  employeeCountSel.disabled = false;
  const empTool = employeeCountSel.closest('.tool');
  if (empTool) empTool.style.display = ''; // 表示
  // 変更を反映
  employeeCountSel.addEventListener('change', ()=>{
    State.employeeCount = parseInt(employeeCountSel.value,10);
    ensureEmployees();
    renderGrid();
    saveMetaOnly();
  });

  // ボタンイベントハンドラーは buttonHandlers.js で初期化
  if (window.ButtonHandlers && typeof window.ButtonHandlers.init === 'function') {
    window.ButtonHandlers.init();
  }

  // セル操作の初期化
  if (window.CellOperations && typeof window.CellOperations.init === 'function') {
    window.CellOperations.init();
  }

  // ドラッグスクロールの初期化
  if (gridWrap) {
    dragDayNavigation(gridWrap);
 }

  // 自動割当ロジックの初期化
  if (window.AutoAssignLogic && typeof window.AutoAssignLogic.init === 'function') {
    window.AutoAssignLogic.init();
  }
}
   

// ==============================
// ★クラウド同期：meta（従業員設定）と counts（人数設定）のみ対象
// ★割り当てデータ（dates）はローカル保存のみ
// ==============================

// 接続層はgasClient.jsに委譲
function setCloudStatus(state, message){ 
  if (window.GAS && typeof window.GAS.setCloudStatus === 'function') {
    window.GAS.setCloudStatus(state, message);
  }
}

async function remoteGet(k){ 
  return (window.GAS && typeof window.GAS.get === 'function') ? window.GAS.get(k) : null; 
}

async function remotePut(k, data){ 
  return (window.GAS && typeof window.GAS.put === 'function') ? window.GAS.put(k, data) : null; 
}

// ログイン時：meta/countsのみ取得（datesは取得しない）
async function syncFromRemote(){
  const ck = cloudKey();
  if (!ck) {
    console.warn('[syncFromRemote] cloudKey is not set');
    return;
  }

  console.log('[syncFromRemote] Fetching meta/counts from cloud...');
  
  const [remoteMeta, remoteCounts] = await Promise.all([
    remoteGet(`${ck}:meta`).catch((e) => { console.error('[syncFromRemote] meta fetch error:', e); return null; }),
    remoteGet(`${ck}:counts`).catch((e) => { console.error('[syncFromRemote] counts fetch error:', e); return null; })
  ]);

  // meta の反映（従業員情報）
  if (remoteMeta && typeof remoteMeta === 'object') {
    console.log('[syncFromRemote] Applying remote meta:', remoteMeta);
    
    // 従業員数
    if (typeof remoteMeta.employeeCount === 'number' && remoteMeta.employeeCount > 0) {
      State.employeeCount = remoteMeta.employeeCount;
    }
    
    // 従業員名
    if (Array.isArray(remoteMeta.employees) && remoteMeta.employees.length > 0) {
      State.employees = remoteMeta.employees.slice();
    }
    
    // 従業員属性
    if (Array.isArray(remoteMeta.employeesAttr) && remoteMeta.employeesAttr.length > 0) {
      State.employeesAttr = remoteMeta.employeesAttr.map(attr => normalizeEmployeeAttrByWorkType({
        level: attr.level || 'B',
        workType: attr.workType || 'three',
        nightQuota: attr.nightQuota,
        twoShiftQuota: attr.twoShiftQuota,
        threeShiftNfQuota: attr.threeShiftNfQuota,
        threeShiftNsQuota: attr.threeShiftNsQuota,
        shiftDurations: attr.shiftDurations ? {...attr.shiftDurations} : {},
        hasEarlyShift: attr.hasEarlyShift || false,
        earlyShiftType: attr.earlyShiftType || 'all',
        hasLateShift: attr.hasLateShift || false,
        lateShiftType: attr.lateShiftType || 'all'
      }));
    }
    
    // 禁忌ペア
    if (Array.isArray(remoteMeta.forbiddenPairs)) {
      State.forbiddenPairs = new Map(
        remoteMeta.forbiddenPairs.map(([k, arr]) => [k, new Set(arr)])
      );
    }
    
    // 4週間範囲の開始位置
    if (typeof remoteMeta.range4wStart === 'number') {
      State.range4wStart = remoteMeta.range4wStart;
    }

    // ShiftDurations のグローバル既定を復元
    if (remoteMeta.shiftDurationsDefaults && window.ShiftDurations && typeof window.ShiftDurations.setAllGlobalDefaults === 'function') {
      window.ShiftDurations.setAllGlobalDefaults(remoteMeta.shiftDurationsDefaults);
    }

    // ローカルストレージにも保存（同期）
    writeMeta(remoteMeta);
    console.log('[syncFromRemote] Meta synced to localStorage');
  }

  // counts の反映（人数設定 - Countsモジュールで使用）
  if (remoteCounts && typeof remoteCounts === 'object') {
    console.log('[syncFromRemote] Applying remote counts:', remoteCounts);
    
    // Counts モジュールが存在すれば設定を適用
    if (window.Counts && typeof window.Counts.save === 'function') {
      // Counts.save() はローカルストレージにも保存するため、先に直接適用
      const keys = [
        'DAY_TARGET_WEEKDAY','DAY_TARGET_WEEKEND_HOLIDAY',
        'EARLY_TARGET_WEEKDAY','EARLY_TARGET_WEEKEND_HOLIDAY',
        'LATE_TARGET_WEEKDAY','LATE_TARGET_WEEKEND_HOLIDAY',
        'FIXED_NF','FIXED_NS',
        'FIXED_NF_WEEKEND_HOLIDAY','FIXED_NS_WEEKEND_HOLIDAY',
        'FIXED_BY_DATE'
      ];
      for (const k of keys) {
        if (k in remoteCounts) {
          window.Counts[k] = remoteCounts[k];
        }
      }
      // ローカルストレージに保存（クラウドへの再送信を避けるため直接保存）
      try {
        localStorage.setItem(storageKey('counts'), JSON.stringify(remoteCounts));
      } catch (e) {
        console.error('[syncFromRemote] Failed to save counts to localStorage:', e);
      }
      console.log('[syncFromRemote] Counts applied to Counts module');
    } else {
      // Countsモジュールがない場合はローカルストレージにのみ保存
      try {
        localStorage.setItem(storageKey('counts'), JSON.stringify(remoteCounts));
        console.log('[syncFromRemote] Counts synced to localStorage');
      } catch (e) {
        console.error('[syncFromRemote] Failed to save counts to localStorage:', e);
      }
    }
  }

  console.log('[syncFromRemote] Sync completed');
}

// 保存時：meta/countsのみ送信（datesは送信しない）
async function pushToRemote(){
  const ck = cloudKey();
  if (!ck) {
    console.warn('[pushToRemote] cloudKey is not set');
    return;
  }

  console.log('[pushToRemote] Pushing meta/counts to cloud...');

  // meta データの構築
  const meta = {
    employeeCount: State.employeeCount,
    employees: State.employees.slice(),
    employeesAttr: State.employeesAttr.map(attr => ({
      level: attr.level,
      workType: attr.workType,
      nightQuota: attr.nightQuota,
      twoShiftQuota: attr.twoShiftQuota,
      threeShiftNfQuota: attr.threeShiftNfQuota,
      threeShiftNsQuota: attr.threeShiftNsQuota,
      shiftDurations: attr.shiftDurations ? {...attr.shiftDurations} : {},
      hasEarlyShift: attr.hasEarlyShift,
      earlyShiftType: attr.earlyShiftType,
      hasLateShift: attr.hasLateShift,
      lateShiftType: attr.lateShiftType
    })),
    range4wStart: State.range4wStart,
    forbiddenPairs: Array.from(State.forbiddenPairs.entries()).map(([k, set]) => [k, Array.from(set)])
  };

  // ShiftDurations のグローバル既定
  if (window.ShiftDurations && typeof window.ShiftDurations.getAllGlobalDefaults === 'function') {
    meta.shiftDurationsDefaults = window.ShiftDurations.getAllGlobalDefaults();
  }

  // counts データの構築（Countsモジュールの人数設定）
  let countsCfg = {};
  
  // Counts モジュールから現在の設定を取得
  if (window.Counts) {
    countsCfg = {
      DAY_TARGET_WEEKDAY: window.Counts.DAY_TARGET_WEEKDAY,
      DAY_TARGET_WEEKEND_HOLIDAY: window.Counts.DAY_TARGET_WEEKEND_HOLIDAY,
      EARLY_TARGET_WEEKDAY: window.Counts.EARLY_TARGET_WEEKDAY,
      EARLY_TARGET_WEEKEND_HOLIDAY: window.Counts.EARLY_TARGET_WEEKEND_HOLIDAY,
      LATE_TARGET_WEEKDAY: window.Counts.LATE_TARGET_WEEKDAY,
      LATE_TARGET_WEEKEND_HOLIDAY: window.Counts.LATE_TARGET_WEEKEND_HOLIDAY,
      FIXED_NF: window.Counts.FIXED_NF,
      FIXED_NS: window.Counts.FIXED_NS,
      FIXED_NF_WEEKEND_HOLIDAY: window.Counts.FIXED_NF_WEEKEND_HOLIDAY,
      FIXED_NS_WEEKEND_HOLIDAY: window.Counts.FIXED_NS_WEEKEND_HOLIDAY,
      FIXED_BY_DATE: window.Counts.FIXED_BY_DATE || {}
    };
  } else {
    // フォールバック：ローカルストレージから取得
    try {
      const stored = localStorage.getItem(storageKey('counts'));
      if (stored) {
        countsCfg = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[pushToRemote] Failed to read counts from localStorage:', e);
    }
  }

  // クラウドへ送信
  try {
    await Promise.all([
      remotePut(`${ck}:meta`, meta),
      remotePut(`${ck}:counts`, countsCfg)
    ]);
    console.log('[pushToRemote] Push completed');
    setCloudStatus('ok', '同期OK');
  } catch (e) {
    console.error('[pushToRemote] Push failed:', e);
    setCloudStatus('offline', '同期エラー');
    throw e;
  }
}

