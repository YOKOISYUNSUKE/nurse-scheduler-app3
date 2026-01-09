/* app-storage.js : データ永続化とロード/保存 */

  function readMeta(){
  try{ return JSON.parse(localStorage.getItem(storageKey('meta'))||'{}'); }catch{ return {}; }
  }
  function writeMeta(meta){
    localStorage.setItem(storageKey('meta'), JSON.stringify(meta));
  }
function saveMetaOnly(){
  const meta = readMeta();
  meta.employeeCount = State.employeeCount;
  meta.employees     = State.employees;
  // 勤務時間を含む完全な属性を保存
  meta.employeesAttr = State.employeesAttr.map(attr => ({
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
  }));

  meta.range4wStart  = State.range4wStart;
  meta.forbiddenPairs = Array.from(State.forbiddenPairs.entries()).map(([k, set]) => [k, Array.from(set)]);
  // ★追加：ShiftDurations のグローバル既定を保存（存在すれば）
  if (window.ShiftDurations && typeof window.ShiftDurations.getAllGlobalDefaults === 'function') {
    meta.shiftDurationsDefaults = window.ShiftDurations.getAllGlobalDefaults();
  }
  writeMeta(meta);
  // 追加：クラウドへ非同期送信（エラーハンドリング付き）
  pushToRemote()
    .catch(e => {
      console.error('[saveMetaOnly] Failed to push to remote:', e);
      setCloudStatus('offline', 'クラウド同期エラー');
    });
}
window.saveMetaOnly = saveMetaOnly; // ★追加

  function readDatesStore(){
    try{
      const d = JSON.parse(localStorage.getItem(storageKey('dates'))||'{}');
      return {
        holidays: d.holidays || {},
        off: d.off || {},
        leave: d.leave || {},
        assign: d.assign || {},
        lock: d.lock || {}
      };
    }catch{
      return { holidays:{}, off:{}, leave:{}, assign:{}, lock:{} };
    }
  }
function writeDatesStore(store){
  try {
    localStorage.setItem(storageKey('dates'), JSON.stringify(store));
    console.log('[writeDatesStore] Data saved to localStorage');
  } catch (e) {
    console.error('[writeDatesStore] Failed to save to localStorage:', e);
 
  }

}

  // ---- データロード/保存 ----
function ensureEmployees(){
  const need = State.employeeCount;
  const cur = State.employees.length;
  if(cur < need){
    for(let i=cur;i<need;i++){
      State.employees.push(`職員${pad2(i+1)}`);
      State.employeesAttr.push({ 
        level:'B', 
        workType:'three',
        hasLateShift: false,    // ★追加：デフォルト値
        lateShiftType: 'all'    // ★追加：デフォルト値
      });
    }
  } else if(cur > need){
    State.employees.length = need;
    State.employeesAttr.length = need;
  }
  // off/assignも範囲内に丸める
  [...State.offRequests.keys()].forEach(idx=>{ if(idx >= need) State.offRequests.delete(idx); });
  [...State.assignments.keys()].forEach(idx=>{ if(idx >= need) State.assignments.delete(idx); });
}

  // レベルA同士をすべて禁忌ペアにする初期値生成
  function buildDefaultForbiddenPairsForA(){
    const map = new Map();
    const n = State.employeeCount;
    if (!Number.isInteger(n) || n <= 1) return map;

    const aIndices = [];
    for (let i = 0; i < n; i++){
      const attr = State.employeesAttr[i] || {};
      if (attr.level === 'A') aIndices.push(i);
    }
    if (aIndices.length <= 1) return map;

    for (let x = 0; x < aIndices.length; x++){
      const i = aIndices[x];
      for (let y = 0; y < aIndices.length; y++){
        if (x === y) continue;
        const j = aIndices[y];
        let set = map.get(i);
        if (!set){
          set = new Set();
          map.set(i, set);
        }
        set.add(j);
      }
    }
    return map;
  }

  function loadWindow(anchorDate){
    State.anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    State.windowDates = buildWindowDates(State.anchor);
    // ★重要：キャッシュをクリア（月ジャンプ後に古いウィンドウ判定が残らないように）
    _winDateSet = null;
    _storeCache = null;

    const meta = readMeta();
    if (Array.isArray(meta.employees) && meta.employees.length){
     // 保存されたメタをそのまま復元
     State.employees = meta.employees.slice();
     // 属性長が合わない・未定義の場合は安全に補完
     if (Array.isArray(meta.employeesAttr) && meta.employeesAttr.length === State.employees.length){
      // 勤務時間を含む完全な属性を復元
      State.employeesAttr = meta.employeesAttr.map(attr => ({
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
     } else {
       State.employeesAttr = State.employees.map(()=> ({ 
         level:'B', 
         workType:'three', 
         shiftDurations:{},
         hasEarlyShift: false,   
         earlyShiftType: 'all',
         hasLateShift: false,  
         lateShiftType: 'all'   
       }));
     }
       // employeeCount は保存値があれば優先、なければ配列長
      State.employeeCount = Number.isInteger(meta.employeeCount) ? meta.employeeCount :              State.employees.length;
      // 4週間範囲は常にアンカー先頭から開始（保存値には依存しない）
      State.range4wStart  = 0;
      if (Array.isArray(meta.forbiddenPairs)){
        State.forbiddenPairs = new Map(meta.forbiddenPairs.map(([k, arr]) => [k, new Set(arr)]));
      } else {
        // 初期状態：レベルA同士をすべて禁忌ペアにする
        State.forbiddenPairs = buildDefaultForbiddenPairsForA();
      }
      // ★追加：ShiftDurations のグローバル既定を復元（存在すれば）
      if (meta.shiftDurationsDefaults && window.ShiftDurations && typeof window.ShiftDurations.setGlobalDefault === 'function') {
        const defs = meta.shiftDurationsDefaults;
        Object.keys(defs).forEach(mk => {
          const v = defs[mk];
          if (Number.isFinite(v)) window.ShiftDurations.setGlobalDefault(mk, Number(v));
        });
      }

    } else {
      // 新規ユーザー：デフォルト（20名）で初期化
      State.employees     = Array.from({length: State.employeeCount}, (_,i)=> `職員${pad2(i+1)}`);
      State.employeesAttr = Array.from({length: State.employeeCount}, ()=> ({ level:'B', workType:'three' }));
    }
    ensureEmployees();

    // 日付ストアから現在ウィンドウ分だけ読み込む
    const store = readDatesStore();
    State.holidaySet = new Set();
    for(const d of State.windowDates){
      const ds = dateStr(d);
      if(store.holidays[ds]) State.holidaySet.add(ds);
    }
    // 希望休
    State.offRequests = new Map();
    for(let i=0;i<State.employeeCount;i++){
      const rec = store.off[i];
      if(!rec) continue;
      const set = new Set();
      for(const d of State.windowDates){
        const ds = dateStr(d);
        if(rec[ds]) set.add(ds);
      }
      if(set.size) State.offRequests.set(i, set);
    }
    // 割当
    State.assignments = new Map();
    for(let i=0;i<State.employeeCount;i++){
      const rec = store.assign[i];
      if(!rec) continue;
      const map = new Map();
      for(const d of State.windowDates){
        const ds = dateStr(d);
        const mkRaw = rec[ds];
        const mk = window.normalizeMark ? window.normalizeMark(mkRaw) : mkRaw;
        if (mk) map.set(ds, mk);
      }
      if(map.size) State.assignments.set(i, map);
    }

    // 特別休暇
    State.leaveRequests = new Map();
    if (store.leave){
      for (let i=0;i<State.employeeCount;i++){
        const recLv = store.leave[i];
        if (!recLv) continue;
        const mp = new Map();
        for (const d of State.windowDates){
          const ds = dateStr(d);
          const code = recLv[ds];
          if (code) mp.set(ds, code);
        }
        if (mp.size) State.leaveRequests.set(i, mp);
      }
    }

    // ロック（上書き保護）
    State.lockedCells = new Set();
    if (store.lock){
      for (let i=0; i<State.employeeCount; i++){
        const rec = store.lock[i];
        if (!rec) continue;
        for (const d of State.windowDates){
          const ds = dateStr(d);
          if (rec[ds]) State.lockedCells.add(lockKey(i, ds));
        }
      }
    }

    // コントロール同期
    employeeCountSel.value = String(State.employeeCount);

    if (range4w) range4w.value = String(State.range4wStart);
    State.lastSaved = snapshot();
  }

  function saveWindow(){
    // メタ情報は別途保存
    saveMetaOnly();

    // 既存ストアを読み込み（窓外のデータは維持）
    const store = readDatesStore();
    if (!store.holidays) store.holidays = {};
    if (!store.off)      store.off      = {};
    if (!store.assign)   store.assign   = {};
    if (!store.lock)     store.lock     = {};
    if (!store.leave)    store.leave    = {};  // ← 追加

    // 祝日を反映（表示中31日分だけを同期）
    for (const d of State.windowDates){
      const ds = dateStr(d);
      if (State.holidaySet.has(ds)) store.holidays[ds] = 1;
      else                          delete store.holidays[ds];
    }

    // 希望休・割当・ロックを反映（表示中31日分）
    for (let r = 0; r < State.employeeCount; r++){
      const offObj  = store.off[r]    || (store.off[r]    = {});
      const asgObj  = store.assign[r] || (store.assign[r] = {});
      const lockObj = store.lock[r]   || (store.lock[r]   = {});

      for (const d of State.windowDates){
        const ds = dateStr(d);

        // 希望休
        if (hasOffByDate(r, ds)) offObj[ds] = 1;
        else                     delete offObj[ds];

        // 特別休暇
        const lv = getLeaveType(r, ds);
        const leaveObj = store.leave[r] || (store.leave[r] = {});
        if (lv) leaveObj[ds] = lv; else delete leaveObj[ds];

        // 割当（未割当は削除）
        const mk = getAssign(r, ds);
        if (mk) asgObj[ds] = mk;
        else    delete asgObj[ds];

        // ロック（未ロックは削除）
        if (isLocked(r, ds)) lockObj[ds] = 1;
        else                 delete lockObj[ds];

      }
    }

    // 書き戻し＆スナップショット更新
    writeDatesStore(store);
    State.lastSaved = snapshot();
  }

  // 指定4週間（range4wStart〜+27）を、希望休日だけ残して「未割当」に戻す
  // respectLock=true のとき、ロック済みセルは消さない（自動割当前の安全クリア用）
  // clearSoft = true のとき、「祝」「代」も消去（ロックは常に尊重）
  function cancelChanges(respectLock=false, clearSoft=false){

    const start = State.range4wStart;
    const end   = start + 27; // 28日間
    for (let r = 0; r < State.employeeCount; r++){
      for (let d = start; d <= end; d++){
        const ds = dateStr(State.windowDates[d]);
        if (respectLock && isLocked(r, ds)) continue;

        clearAssign(r, ds);

        if (clearSoft){
          const lv = getLeaveType(r, ds);
          if (lv && (lv === '祝' || lv === '代')) clearLeaveType(r, ds);
        }
      }
    }
    renderGrid(); // 合計行・4週ハイライトも再描画
  }

  // 完全キャンセル（全体）— 4週間の割当・希望休・特別休暇・ロックを全消去
  function completeCancelAll(){
    const start = State.range4wStart;
    const end   = start + 27;
    for (let r = 0; r < State.employeeCount; r++){
      // 希望休バケツ
      const s = State.offRequests.get(r);
      for (let d = start; d <= end; d++){
        const ds = dateStr(State.windowDates[d]);
        // 割当
        clearAssign(r, ds);
        // 特別休暇（祝/代/年/リすべて）
        clearLeaveType(r, ds);
        // 希望休
        if (s) s.delete(ds);
        // ロック
        setLocked(r, ds, false);
      }
      if (s && s.size===0) State.offRequests.delete(r);
    }
    renderGrid();
    showToast('4週間を完全キャンセルしました');
    // 完全キャンセルはアンドゥ対象外（仕様）
    if (btnUndo) btnUndo.disabled = true;
  }

  // 完全キャンセル（1セル）
function completeCancelOneCell(r, dayIdx, td){
    const ds = dateStr(State.windowDates[dayIdx]);
    // 現在のマークを把握（☆なら翌日の★を連鎖で外す）
    const mk = getAssign(r, ds);

    // 割当・特別休暇・希望休・ロックを一括クリア
    clearAssign(r, ds);
    clearLeaveType(r, ds);
    const s = State.offRequests.get(r);
    if (s){ s.delete(ds); if (s.size===0) State.offRequests.delete(r); }
    setLocked(r, ds, false);

    // 表示リフレッシュ（当日セル）
    td.classList.remove('off','locked');
    td.textContent = '';
    updateFooterCounts();

    // ☆だった場合のみ：翌日の★も削除（既存の挙動と整合＋画面外29日目対応）
    if (mk === '☆'){
      const nextIndex = dayIdx + 1;
      if (nextIndex < State.windowDates.length){
        // 通常：画面内の翌日セル
        const nds = dateStr(State.windowDates[nextIndex]);
        if (getAssign(r, nds) === '★'){
          clearAssign(r, nds);
          setLocked(r, nds, false);
          const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
          if (nextCell){
            nextCell.classList.remove('locked');
            nextCell.textContent = '';
          }
          updateFooterCounts();
        }
      } else {
        // 4週ウィンドウ最終日の☆ → 画面外29日目の★もクリア
        const baseDate = State.windowDates[dayIdx];
        const nextDate = addDays(baseDate, 1);
        const nds = dateStr(nextDate);
        if (getAssign(r, nds) === '★'){
          clearAssign(r, nds);
          setLocked(r, nds, false);
          // 画面外なのでセルは存在しないが、集計だけ更新
          updateFooterCounts();
        }
      }
    }

  State.fullCancelCellMode = false;
  showToast('1セルを完全キャンセルしました');
}

// セルクリア処理（希望休・割り当て・特別休暇を一括消去）
function handleClearCell(r, dayIdx, td){
  const ds = dateStr(State.windowDates[dayIdx]);
  
  // 現在のマークを把握（☆なら翌日の★を連鎖で外す）
  const mk = getAssign(r, ds);
  const hadOff = hasOffByDate(r, ds);
  const hadLeave = getLeaveType(r, ds);
  
  if (!mk && !hadOff && !hadLeave) {
    showToast('このセルには何も設定されていません');
    return;
  }

  // 割当・特別休暇・希望休を一括クリア
  clearAssign(r, ds);
  clearLeaveType(r, ds);
  const s = State.offRequests.get(r);
  if (s) {
    s.delete(ds);
    if (s.size === 0) State.offRequests.delete(r);
  }
  
  // ロックも解除
  setLocked(r, ds, false);

  // 表示リフレッシュ（当日セル）
  td.classList.remove('off', 'locked');
  td.textContent = '';
  updateFooterCounts();

  // ☆だった場合のみ：翌日の★も削除（画面外29日目も対象）
  if (mk === '☆') {
    const nextIndex = dayIdx + 1;
    if (nextIndex < State.windowDates.length) {
      // 通常：画面内の翌日セル
      const nds = dateStr(State.windowDates[nextIndex]);
      if (getAssign(r, nds) === '★') {
        clearAssign(r, nds);
        setLocked(r, nds, false);
        const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
        if (nextCell) {
          nextCell.classList.remove('locked');
          nextCell.textContent = '';
        }
        updateFooterCounts();
      }
    } else {
      // 4週ウィンドウ最終日の☆ → 画面外29日目の★もクリア
      const baseDate = State.windowDates[dayIdx];
      const nextDate = addDays(baseDate, 1);
      const nds = dateStr(nextDate);
      if (getAssign(r, nds) === '★') {
        clearAssign(r, nds);
        setLocked(r, nds, false);
        // 画面外なのでセルは存在しないが、集計だけ更新
        updateFooterCounts();
      }
    }
  }

  showToast('セルをクリアしました');
}

  // 直前キャンセルのための一時バッファ

  let UndoBuf = null;

  // 4週間ぶんの割当バックアップを作成
  function makeCancelBackup(){
    const start = State.range4wStart;
    const end   = start + 27;
    const buf = {
      anchor: dateStr(State.anchor), // 同一ウィンドウ判定用
      start, end,
      assigns: [] // [rowIndex, dateStr, mark] を列挙
    };
    for (let r = 0; r < State.employeeCount; r++){
      for (let d = start; d <= end; d++){
        const ds = dateStr(State.windowDates[d]);
        const mk = getAssign(r, ds);
        if (mk) buf.assigns.push([r, ds, mk]);
      }
    }
    return buf;
  }

  // ★追加：直前キャンセルのアンドゥ（1段階のみ）
  function undoCancelRange(){
    if (!UndoBuf) { showToast('元に戻すデータがありません'); return false; }

    // 表示ウィンドウが変わっていたら無効化（安全運用）
    if (dateStr(State.anchor) !== UndoBuf.anchor){
      showToast('表示範囲が変更されたためアンドゥできません（元の表示に戻してから実行）');
      return false;
    }

    // まず指定範囲を全クリア（希望休はそのまま）
    for (let r = 0; r < State.employeeCount; r++){
      for (let d = UndoBuf.start; d <= UndoBuf.end; d++){
        const ds = dateStr(State.windowDates[d]);
        clearAssign(r, ds);
      }
    }

    // バックアップから復元（希望休がある日はスキップ）
    let skipped = 0;
    for (const [r, ds, mk] of UndoBuf.assigns){
      // いまのウィンドウ内でのみ復元（通常は同一ウィンドウのため全件一致）
      if (!State.windowDates.some(dt => dateStr(dt) === ds)) continue;
      const idxEmp = Number(r);
      const off = hasOffByDate(idxEmp, ds);
      if (off) { skipped++; continue; }
      setAssign(idxEmp, ds, mk);
    }

    renderGrid();
    UndoBuf = null;
    if (btnUndo) btnUndo.disabled = true;
    if (skipped > 0) showToast(`元に戻しました（希望休のため復元しなかった日：${skipped}）`);
    return true;
  }

  function snapshot(){
    return {
      employeeCount: State.employeeCount,
      employees: State.employees.slice(),
      range4wStart: State.range4wStart,
      anchorY: State.anchor.getFullYear(),
      anchorM: State.anchor.getMonth(),
      anchorD: State.anchor.getDate(),
      holidayArr: Array.from(State.holidaySet),
      offObj: Object.fromEntries(Array.from(State.offRequests.entries()).map(([k,set]) => [k, Array.from(set)])),
    };
  }

