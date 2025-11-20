// ====== グローバルAPI公開（auto-assign.js / employee-dialog.js 用） ======
window.SchedulerState = null; // 後で State を代入
window.getAssign = null;
window.setAssign = null;
window.clearAssign = null;
window.hasOffByDate = null;
window.getLeaveType = null;
window.setLeaveType = null;
window.clearLeaveType = null;
window.isLocked = null;
window.setLocked = null;
window.renderGrid = null;
window.showToast = null;
window.saveMetaOnly = null;
// 追加：勤務時間定義ファイル（shiftDurations.js）を参照するエイリアス（ファイルが読み込まれていることが前提）
window.ShiftDurations = window.ShiftDurations || null; // shiftDurations.js を index.html で先に読み込む想定
// 例： window.ShiftDurations.getOptionsForMark('〇') などで利用
window.updateFooterCounts = null;

// ====== UIロジック：連続31日ウィンドウ & 日単位スクロール対応 ======
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ---- 要素 ----
  const loginView = $('#loginView');
  const appView   = $('#appView');
  const loginForm = $('#loginForm');
  const loginId   = $('#loginId');
  const loginPw   = $('#loginPw');
  const loginError= $('#loginError');
  const btnJumpMonth = $('#btnJumpMonth');
  const monthPicker  = $('#monthPicker');
  const periodText   = $('#periodText');
  const btnAutoAssign= $('#btnAutoAssign');
  const btnCancel    = $('#btnCancel');
  const btnFullCancel= $('#btnFullCancel'); // ★追加：完全キャンセル
  const btnUndo      = $('#btnUndo');       // ★追加：アンドゥ
  const btnSave      = $('#btnSave');
  const btnExportExcel = $('#btnExportExcel');
  const btnLogout    = $('#btnLogout');
  const btnPrevDay  = $('#btnPrevDay');
  const btnNextDay  = $('#btnNextDay');
  const btnAttrOpen = $('#btnAttrOpen');
  const btnHolidayAuto = $('#btnHolidayAuto'); 
  const btnLockRange   = $('#btnLockRange');
  const btnUnlockRange = $('#btnUnlockRange');

  // 完全キャンセル用ダイアログ要素
  const fullCancelDlg      = $('#fullCancelDlg');
  const fullCancelAllBtn   = $('#fullCancelAll');
  const fullCancelCellBtn  = $('#fullCancelCell');
  const fullCancelCloseBtn = $('#fullCancelClose');

  // 特別休暇ボタン
  const btnLeaveHoliday = $('#btnLeaveHoliday');
  const btnLeaveSub     = $('#btnLeaveSub');
  const btnLeavePaid    = $('#btnLeavePaid');
  const btnLeaveRefresh = $('#btnLeaveRefresh');
  const attrDlg = $('#attrDlg');
  const attrContent = $('#attrContent');
  const attrSave = $('#attrSave');
  const attrClose = $('#attrClose');
  const employeeCountSel = $('#employeeCount');
  const range4w = $('#range4w');
  const range4wLabel = $('#range4wLabel');
  const gridWrap = $('#gridWrap');
  const grid     = $('#grid');
  const toast    = $('#toast');

  const modeRadios = $$('input[name="mode"]');
  // auth.js からのログイン完了通知（クラウド→ローカル同期を先に）
document.addEventListener('auth:logged-in', async (ev)=>{
  State.userId = (ev?.detail?.userId) || 'user';
  
  // 接続テストを実行
  const testResult = await testRemoteConnection();
  if (!testResult.success) {
    console.warn('Cloud connection test failed:', testResult.message);
    // ユーザーに通知（オプション）
    // showToast(testResult.message);
  }
  
  // クラウドからデータを同期
  try { 
    await syncFromRemote(); 
  } catch(error) {
    console.error('Sync from remote failed:', error);
  }
  
  enterApp();
});



  // ---- 状態 ----
  const today = new Date();
  const State = {
    userId: null,
    // 連続31日ウィンドウの開始日（任意の日付）
    anchor: new Date(today.getFullYear(), today.getMonth(), 1),
    windowDates: [],            // [Date x31]
    employees: [],
    employeeCount: 20,
    employeesAttr: [],          // [{level:'A'|'B'|'C', workType:'two'|'three'|'day'|'night'}]
    // 永続化は日付キー（YYYY-MM-DD）で行う
    forbiddenPairs: new Map(), // Map<empIndex, Set<empIndex>>：禁忌ペア
  // 例：0番目の職員が2番・5番と禁忌 → forbiddenPairs.get(0) = Set([2, 5])

    holidaySet: new Set(),      // Set<dateStr>
    offRequests: new Map(),     // Map<empIndex, Set<dateStr>>
    leaveRequests: new Map(),   // Map<empIndex, Map<dateStr, '祝'|'代'|'年'|'リ'>>
    assignments: new Map(),     // Map<empIndex, Map<dateStr, mark>>
    range4wStart: 0,            // 0..3（31-28=3）
    lastSaved: null,            // スナップショット
    mode: null,                 // null | 'off' | 'assign'
    leaveMode: null,            // null | '祝'|'代'|'年'|'リ'
    manualOverride: false,      // 手動割当（上書き）トグル
    lockedCells: new Set(),     // Set<"row|YYYY-MM-DD">：自動割当の上書き対象外
    lockMode: null,             // 'lock' | 'unlock' | null（範囲選択モード）
    lockStart: null,            // { r, d }（開始セル）
    fullCancelCellMode: false,  // ★追加：完全キャンセル（1セル）モード

  };
 // ★追加：グローバル公開
  window.SchedulerState = State;

  // ---- 起動 ----
  // ★ 自動ログインはIIFE全体の初期化完了後に再試行（描画準備が整ってから）
  if (window.Auth && typeof window.Auth.tryAutoLogin === 'function') {
    setTimeout(() => window.Auth.tryAutoLogin(), 0);
  }

  // ---- Util ----
  // ★追加：手動割り当てはルール無視で通す（canAssign / precheckPlace / applyAfterAssign をスキップ）
  const IGNORE_RULES_ON_MANUAL = true;

  // ★追加：ユーザー別localStorageキーとクラウドキー群
  function storageKey(k){
    const uid = sessionStorage.getItem('sched:userId') || 'user';
    return `sched:${uid}:${k}`;
  }
  function cloudKeys(){
    const keys = [];
    const main = sessionStorage.getItem('sched:cloudKey');
    const sha  = sessionStorage.getItem('sched:cloudKeySha');
    const b64  = sessionStorage.getItem('sched:cloudKeyCompat');
    [main, sha, b64].forEach(v => { if (v && !keys.includes(v)) keys.push(v); });
    return keys;
  }



  const { pad2, dateStr, addDays, isToday } = (window.App && App.Dates) || {};

  // 自動割当の上書き保護（ロック）管理
  function lockKey(r, ds){ return `${r}|${ds}`; }
  function isLocked(r, ds){ return State.lockedCells.has(lockKey(r, ds)); }
window.isLocked = isLocked; // ★追加
  function setLocked(r, ds, on){
    const k = lockKey(r, ds);
    if (on) State.lockedCells.add(k);
    else    State.lockedCells.delete(k);
  }
window.setLocked = setLocked; // ★追加

  // NightBand に渡す文脈
  function nbCtx(){

    return {
      dates: State.windowDates,
      employeeCount: State.employeeCount,
      range4wStart: State.range4wStart,
      getAssign,
      hasOffByDate: (r, ds)=> hasOffByDate(r, ds),
      getEmpAttr: (r)=> State.employeesAttr[r] || { level:'B', workType:'three' },
      // 土日祝公平化用：祝日フラグ（当月ウィンドウ内の State.holidaySet）
      isHolidayDs: (ds)=> State.holidaySet.has(ds)
    };
  }


  // === 履歴参照ユーティリティ（ローリング4週間検証用） ===

  let _winDateSet = null;
  let _storeCache = null;
  function _ensureWinDateSet(){
    _winDateSet = new Set(State.windowDates.map(dateStr));
  }
  function _inWindow(ds){ if(!_winDateSet) _ensureWinDateSet(); return _winDateSet.has(ds); }
  function _store(){ if(!_storeCache) _storeCache = readDatesStore(); return _storeCache; }

  // 窓外はローカル保存の全期間ストアから読む（窓内はState優先）
  function globalGetAssign(r, ds){
    if (_inWindow(ds)) return getAssign(r, ds);
    const st = _store();
    let mk = st.assign?.[r]?.[ds];
    if (window.normalizeMark) mk = window.normalizeMark(mk);
    return mk;
  }
  function globalHasOffByDate(r, ds){
    if (_inWindow(ds)) return hasOffByDate(r, ds);
    const st = _store();
    return !!(st.off?.[r]?.[ds]);
  }
  function globalHasLeave(r, ds){
    if (_inWindow(ds)) return !!getLeaveType(r, ds);
    const st = _store();
    return !!(st.leave?.[r]?.[ds]);
  }


  // 指定日の「直近28日（当日を含む）」集計
  function countLast28Days(r, endDt){
    const start = addDays(endDt, -27);
    let star=0, half=0, off=0;
    for (let i=0;i<28;i++){
      const dt = addDays(start, i);
      const ds = dateStr(dt);
      const mk = globalGetAssign(r, ds);
      const hasLv = globalHasLeave(r, ds); // 特別休暇
      const isOff = (globalHasOffByDate(r, ds) || !mk) && !hasLv; // 特別休暇日は“勤務扱い”
      if (mk === '☆') star++;
      if (mk === '◆' || mk === '●') half++;
      if (isOff) off++;
    }
    return { star, half, off, start, end:endDt };
  }

  // 〈新規〉28日窓の休日日数の必要量（★始まり/☆終わり 補正）
  function requiredOffFor28(r, startDt, endDt){
    const dsStart = dateStr(startDt);
    const dsEnd   = dateStr(endDt);
    const mkStart = globalGetAssign(r, dsStart);
    const mkEnd   = globalGetAssign(r, dsEnd);
    const starStart = (mkStart === '★'); // ★始まり→7休
    const starEnd   = (mkEnd   === '☆'); // ☆終わり→9休
    if (starStart && !starEnd) return 7;
    if (!starStart && starEnd) return 9;
    return 8; // 両方 or どちらでもない → 8休
  }

  // ★ローリング4週間（過去を含む）検証：違反があればエラーメッセージ文字列を返す
  function validateRollingFourWeeksWithHistory(startIdx, endIdx){

    _ensureWinDateSet(); _storeCache = null; // 最新窓を反映
    for (let r=0; r<State.employeeCount; r++){
      const wt = (State.employeesAttr[r]?.workType) || 'three';
      const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
      for (let d=startIdx; d<=endIdx; d++){
        const endDt = State.windowDates[d];
        const { star, half, off, start } = countLast28Days(r, endDt);
        const rng = `${start.getMonth()+1}/${start.getDate()}〜${endDt.getMonth()+1}/${endDt.getDate()}`;

    if (wt === 'night'){
      if (star !== 10) return `${name} のローリング4週間（${rng}）の「☆」は10件ちょうどが必要：${star}/10`;
    } else if (wt === 'two'){
      if (star !== 4) return `${name} のローリング4週間（${rng}）の「☆」は4件必要：${star}/4`;
    } else if (wt === 'three'){
      if (half < 8 || half > 10) return `${name} のローリング4週間（${rng}）の（◆＋●）は8〜10件を許容（原則10件を目指す）：${half}/8〜10`;
    }

      }
    }
    return null; // OK
  }

  function countForDayLocal(dayIndex){
    let day=0, nf=0, ns=0;
    const ds = dateStr(State.windowDates[dayIndex]);
    const prevDs = dateStr(addDays(State.windowDates[dayIndex], -1));
    for(let r=0; r<State.employeeCount; r++){
      const mk = getAssign(r, ds);
      if (mk === '〇') day++;
      if (mk === '☆' || mk === '◆') nf++;

      // NS＝当日の「★ or ●」。★未反映の旧データ対策として前日の☆もフォールバック
      const prevMk = getAssign(r, prevDs);
      if (mk === '★' || mk === '●' || prevMk === '☆') ns++;
    }
    return { day, nf, ns };
  }


  function buildWindowDates(anchor){
    const arr = [];
    for(let i=0;i<31;i++) arr.push(addDays(anchor, i));
    return arr;
  }

  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(()=> toast.classList.remove('show'), 1600);
  }
 window.showToast = showToast; // ★追加
  function addRipple(e){
    const btn = e.currentTarget;
    const r = document.createElement('span');
    r.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = size+'px';
    r.style.left = (e.clientX - rect.left - size/2)+'px';
    r.style.top  = (e.clientY - rect.top  - size/2)+'px';
    btn.appendChild(r);
    setTimeout(()=> r.remove(), 600);
  }
  $$('.btn').forEach(b=> b.addEventListener('click', addRipple));

// 修正後（initControls の前に初期化）
async function enterApp(){
    loginView.classList.remove('active');
    appView.classList.add('active');

    const loginLoading = document.getElementById('loginLoading');
    if (loginLoading) loginLoading.classList.add('hidden');

    // 従業員ダイアログを先に初期化（DOM要素が必要）
    if (window.EmployeeDialog && typeof window.EmployeeDialog.init === 'function') {
      window.EmployeeDialog.init();
    } else {
      console.warn('EmployeeDialog が読み込まれていません');
    }

    initControls();
    loadWindow(State.anchor);
    renderAll();
  }



  // ---- コントロール初期化 ----
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

  // ★追加：セル操作の初期化
  if (window.CellOperations && typeof window.CellOperations.init === 'function') {
    window.CellOperations.init();
  }

  // ★追加：ドラッグスクロールの初期化
  if (gridWrap) {
    dragDayNavigation(gridWrap);
 }

  // ★追加：自動割当ロジックの初期化
  if (window.AutoAssignLogic && typeof window.AutoAssignLogic.init === 'function') {
    window.AutoAssignLogic.init();
  }
}
   



/* 重複していた storageKey / cloudKeys の後段定義は削除（先頭側を正とする） */


// 接続層は gasClient.js に委譲（薄いラッパ）
function setCloudStatus(state, message){ if (window.GAS) GAS.setCloudStatus(state, message); }
async function remoteGet(k){ return (window.GAS ? GAS.get(k) : null); }
async function remotePut(k, data){ return (window.GAS ? GAS.put(k, data) : null); }
async function testRemoteConnection(){ return (window.GAS ? GAS.testConnection() : { success:false, message:'gasClient未読込' }); }





// 追加：ログイン直後にクラウド→ローカルへ取り込み
async function syncFromRemote(){
  const keys = cloudKeys(); 
  if (!keys.length) {
    console.warn('Cloud keys not found. Skipping remote sync.');
    return;
  }
  
  console.log('Syncing from remote with keys:', keys);
  let metaBest = null, datesBest = null;

  for (const ck of keys){
    console.log('Fetching data for key:', ck);
    const m = await remoteGet(`${ck}:meta`);
    const d = await remoteGet(`${ck}:dates`);
    
    if (m) {
      console.log('Meta data received:', Object.keys(m));
    }
    if (d) {
      console.log('Dates data received:', Object.keys(d));
    }
    
    // どちらか取れた時点で採用（先勝ち）。次鍵により良いものがあれば上書き。
    if (m && !metaBest)  metaBest  = m;
    if (d){
      const score = (obj)=> {
        try{
          const asg = obj?.assign || {};
          return Object.values(asg).reduce((s,day)=> s + Object.keys(day||{}).length, 0);
        }catch(_){ return 0; }
      };
      if (!datesBest || score(d) > score(datesBest)) datesBest = d;
    }
  }
  
  if (metaBest) {
    localStorage.setItem(storageKey('meta'),  JSON.stringify(metaBest));
    console.log('Meta data synced to local storage');
  }
  if (datesBest) {
    localStorage.setItem(storageKey('dates'), JSON.stringify(datesBest));
    console.log('Dates data synced to local storage');
  }
  
  if (!metaBest && !datesBest) {
    console.log('No remote data found. Using local data only.');
  }
}



// 追加：保存のたびにクラウドへ送信（失敗は無視）
async function pushToRemote(){
  const keys = cloudKeys(); if(!keys.length) return;
  try{
    const meta  = readMeta();
    const dates = readDatesStore();
    for (const ck of keys){
      remotePut(`${ck}:meta`,  meta);
      remotePut(`${ck}:dates`, dates);
    }
  }catch(_){}
}




  // ---- 永続化（メタ／日付データ） ----

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
        shiftDurations: attr.shiftDurations ? {...attr.shiftDurations} : {}
      }));
      meta.range4wStart  = State.range4wStart;
      meta.forbiddenPairs = Array.from(State.forbiddenPairs.entries()).map(([k, set]) => [k, Array.from(set)]);
      // ★追加：ShiftDurations のグローバル既定を保存（存在すれば）
      if (window.ShiftDurations && typeof window.ShiftDurations.getAllGlobalDefaults === 'function') {
        meta.shiftDurationsDefaults = window.ShiftDurations.getAllGlobalDefaults();
      }
      writeMeta(meta);
      // 追加：クラウドへ非同期送信（失敗は無視）
      pushToRemote();
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
    localStorage.setItem(storageKey('dates'), JSON.stringify(store));

    // 追加：クラウドへ非同期送信（失敗は無視）
    pushToRemote();
  }



  // ---- データロード/保存 ----
  function ensureEmployees(){
    const need = State.employeeCount;
    const cur = State.employees.length;
    if(cur < need){
      for(let i=cur;i<need;i++){
        State.employees.push(`職員${pad2(i+1)}`);
        State.employeesAttr.push({ level:'B', workType:'three' });
      }
    } else if(cur > need){
      State.employees.length = need;
      State.employeesAttr.length = need;
    }
    // off/assignも範囲内に丸める
    [...State.offRequests.keys()].forEach(idx=>{ if(idx >= need) State.offRequests.delete(idx); });
    [...State.assignments.keys()].forEach(idx=>{ if(idx >= need) State.assignments.delete(idx); });
  }

  function loadWindow(anchorDate){
    State.anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    State.windowDates = buildWindowDates(State.anchor);

 // メタ（従業員・スライダ位置・属性）
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
      shiftDurations: attr.shiftDurations ? {...attr.shiftDurations} : {}
    }));
   } else {
     State.employeesAttr = State.employees.map(()=> ({ level:'B', workType:'three', shiftDurations:{} }));
   }
   // employeeCount は保存値があれば優先、なければ配列長
  State.employeeCount = Number.isInteger(meta.employeeCount) ? meta.employeeCount :              State.employees.length;
  State.range4wStart  = meta.range4wStart ?? State.range4wStart;
  if (Array.isArray(meta.forbiddenPairs)){
    State.forbiddenPairs = new Map(meta.forbiddenPairs.map(([k, arr]) => [k, new Set(arr)]));
  } else {
    State.forbiddenPairs = new Map();
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

  // ★追加：完全キャンセル（全体）— 4週間の割当・希望休・特別休暇・ロックを全消去
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

  // ★追加：完全キャンセル（1セル）
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

    // ☆だった場合のみ：翌日の★も削除（既存の挙動と整合）
    if (mk === '☆'){
      const nextIndex = dayIdx + 1;
      if (nextIndex < State.windowDates.length){
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
      }
    }

  State.fullCancelCellMode = false;
  showToast('1セルを完全キャンセルしました');
}

// ★追加：セルクリア処理（希望休・割り当て・特別休暇を一括消去）
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

  // ☆だった場合のみ：翌日の★も削除
  if (mk === '☆') {
    const nextIndex = dayIdx + 1;
    if (nextIndex < State.windowDates.length) {
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
    }
  }

  showToast('セルをクリアしました');
}

// ★追加：直前キャンセルのための一時バッファ


  // ★追加：直前キャンセルのための一時バッファ

  let UndoBuf = null;

  // ★追加：4週間ぶんの割当バックアップを作成
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


  // ---- レンダリング ----
  function renderAll(){
    updatePeriodText();
    updateRange4wLabel();
    renderGrid();
  }

// ★追加：最下段の合計3行を描画
  function renderFooterCounts(){
    // 既存があれば作り直す
    const old = grid.querySelector('tfoot');
    if (old) old.remove();

    const tfoot = document.createElement('tfoot');
    const rows = [
      { label: '〇 合計',     key: 'day' },
      { label: '（☆＋◆）合計', key: 'nf'  },
      { label: '（★＋●）合計', key: 'ns'  },
    ];

    rows.forEach(row=>{
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'col-emp';
      th.textContent = row.label;
      tr.appendChild(th);

      for(let d=0; d<31; d++){
        const td = document.createElement('td');
        td.dataset.day = String(d);
        td.dataset.sum = row.key;
        const c = countForDayLocal(d);
        td.textContent = String(c[row.key]);
        tr.appendChild(td);
      }
      tfoot.appendChild(tr);
    });

    grid.appendChild(tfoot);
  }

  // ★追加：合計セルだけ更新（高速）
  function updateFooterCounts(){
    const tfoot = grid.querySelector('tfoot');
    if (!tfoot){ renderFooterCounts(); return; }
    for(let d=0; d<31; d++){
      const c = countForDayLocal(d);
      const tdDay = tfoot.querySelector(`td[data-day="${d}"][data-sum="day"]`);
      const tdNf  = tfoot.querySelector(`td[data-day="${d}"][data-sum="nf"]`);
      const tdNs  = tfoot.querySelector(`td[data-day="${d}"][data-sum="ns"]`);
      if (tdDay) tdDay.textContent = String(c.day);
      if (tdNf)  tdNf.textContent  = String(c.nf);
      if (tdNs)  tdNs.textContent  = String(c.ns);
    }
  }
window.updateFooterCounts = updateFooterCounts; // ★追加

  function updatePeriodText(){
    const s = State.windowDates[0];
    const e = State.windowDates[30];
    periodText.textContent = `${s.getFullYear()}年${s.getMonth()+1}月${s.getDate()}日 〜 ${e.getFullYear()}年${e.getMonth()+1}月${e.getDate()}日`;
  }

function updateRange4wLabel(){
  if (!range4wLabel) return;
  const s = State.windowDates[State.range4wStart];
  range4wLabel.textContent = `開始日：${s.getMonth()+1}/${s.getDate()}（28日間）`;
}


     // 追加：表示月（年月区切りのカレンダー月）をExcelで開けるCSVとして保存（UTF-8 BOM付き）
    function exportExcelCsv(){
      const rows = [];

      // カレンダー月の範囲を決定（表示ウィンドウの先頭日を基準に、その月の1日〜末日）
      const anchor = State.windowDates[0];
      const year = anchor.getFullYear();
      const month = anchor.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0); // 月末日
      // 日リスト
      const days = [];
      for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) days.push(new Date(d));

      // ヘッダ
      const header = ['従業員'];
      days.forEach(dt => {
        const w  = '日月火水木金土'[dt.getDay()];
        header.push(`${dt.getMonth()+1}/${dt.getDate()}(${w})`);
      });
      // 末尾はカレンダー月ではなく「指定4週間(網掛け)」の勤務時間合計
      header.push('4週時間');
      rows.push(header);


      // 本体（カレンダー月の各日を globalGetAssign / globalHasOffByDate / globalHasLeave で参照）
      for (let r = 0; r < State.employeeCount; r++){
        const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
        const line = [name];

        // まずはカレンダー月ぶんの日セルをそのまま出力（表示内容は従来どおり）
        for (const dt of days){
          const ds = dateStr(dt);
          const isOff = globalHasOffByDate(r, ds);
          const lv = globalHasLeave(r, ds) ? (getLeaveType(r, ds) || '') : undefined;
          const mk = globalGetAssign(r, ds);

          const cell = lv ? lv : (isOff ? '休' : (mk || ''));
          line.push(cell);
        }

        // 続いて、指定4週間（網掛け範囲）の勤務時間合計を算出
        let totalMin = 0;
        let start4w = (typeof State.range4wStart === 'number') ? State.range4wStart : 0;
        if (start4w < 0) start4w = 0;
        let end4w = start4w + 27;
        const maxDayIdx4w = State.windowDates.length - 1;
        if (end4w > maxDayIdx4w) end4w = maxDayIdx4w;

        if (end4w >= start4w){
          for (let d4 = start4w; d4 <= end4w; d4++){
            const dt4 = State.windowDates[d4];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);

            const isOff4 = globalHasOffByDate(r, ds4);
            const lv4 = globalHasLeave(r, ds4) ? (getLeaveType(r, ds4) || '') : undefined;
            const mk4 = globalGetAssign(r, ds4);
            if (!mk4) continue;
            if (isOff4 || lv4) continue;

            let minutes = 0;
            if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
              minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk4) || 0);
            } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
              minutes = Number(window.ShiftDurations.getDefaultForMark(mk4) || 0);
            } else {
              const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240};
              minutes = fallback[mk4] || 0;
            }
            totalMin += minutes;
          }
        }

        // 4週間勤務時間合計を H:MM 形式で末尾に追加
        const fmt = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(totalMin)
          : `${Math.floor(totalMin/60)}:${String(totalMin%60).padStart(2,'0')}`;
        line.push(fmt);

        rows.push(line);
      }


      // CSV化（必要なセルはクオート、Excel互換のCRLF、BOM付き）
      const csv = rows.map(cols => cols.map(v => {
        let s = String(v ?? '');
        const needQuote = /[",\r\n]/.test(s);
        if (needQuote) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',')).join('\r\n');

      const bom = '\uFEFF'; // ExcelでUTF-8を正しく認識させる
      const blob = new Blob([bom, csv], { type: 'text/csv' });

      const s = monthStart;
      const e = monthEnd;
      const fname = `勤務表_${s.getFullYear()}${pad2(s.getMonth()+1)}${pad2(s.getDate())}_${e.getFullYear()}${pad2(e.getMonth()+1)}${pad2(e.getDate())}.csv`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);

      if (typeof showToast === 'function') showToast('CSV（Excel対応）をダウンロードしました');
    }
    function renderGrid(){
      grid.innerHTML = '';

      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      

      // 左端：従業員列
      const thEmp = document.createElement('th');
      thEmp.className = 'col-emp';
      thEmp.textContent = '従業員';
      trh.appendChild(thEmp);

      // 日付ヘッダ（0〜30日ぶん）
      for (let d = 0; d < 31; d++){
        const th = document.createElement('th');
        const dt = State.windowDates[d];
        if (dt){
          const ds = dateStr(dt);
          const w = '日月火水木金土'[dt.getDay()];
          th.dataset.day = String(d);
          th.innerHTML = `${dt.getMonth()+1}/${dt.getDate()}<span class="dow">${w}</span>`;
          const wd = dt.getDay();
          if (wd === 0) th.classList.add('sun');
          else if (wd === 6) th.classList.add('sat');
          if (State.holidaySet.has(ds)) th.classList.add('holiday');
        } else {
          th.dataset.day = String(d);
        }
        trh.appendChild(th);
      }

      // 右端：マーク集計と4週間勤務時間ヘッダを追加
      const thMarks = document.createElement('th');
      thMarks.className = 'col-month-marks';
      thMarks.textContent = '4週マーク';
      trh.appendChild(thMarks);

      const thTotal = document.createElement('th');
      thTotal.className = 'col-month-total';
      thTotal.textContent = '4週時間';
      trh.appendChild(thTotal);



      thead.appendChild(trh);





      const tbody = document.createElement('tbody');
      State.employees.forEach((name, r)=>{
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = 'col-emp';
        // 属性チップ
        tdName.appendChild(renderNameCell(r, name));
        tr.appendChild(tdName);

        // 各日セル
        for(let d=0; d<31; d++){
          const dt = State.windowDates[d];
          const ds = dateStr(dt);
          const td = document.createElement('td');
          td.dataset.row = String(r);
          td.dataset.day = String(d);
          // 週末クラス付与（列全体を帯状に）
          const w = dt.getDay();
          if (w === 0) td.classList.add('sun');      // 日曜（赤帯） 
          else if (w === 6) td.classList.add('sat'); // 土曜（青帯）

          if(State.holidaySet.has(ds)) td.classList.add('holiday');

          // 中身：特別休暇 → 希望休 → 割当マーク
          const lv = getLeaveType(r, ds);
          if (lv){
            td.classList.add('off');
            const sp = document.createElement('span');
            sp.className = `leave ${leaveClassOf(lv)}`;
            sp.textContent = lv;
            td.appendChild(sp);
          } else if(hasOffByDate(r, ds)){
            td.classList.add('off');
            td.textContent = '休';
          } else {
            const mk = getAssign(r, ds);
            if(mk){
              const span = document.createElement('span');
              span.className = 'mark ' + markToClass(mk);
              span.textContent = mk;
              td.appendChild(span);
            }
          }

          if (isLocked(r, ds)) {
            td.classList.add('locked');
          }

          td.addEventListener('click', () => {
            // 範囲ロックモードが有効なら先に処理
            if (maybeHandleRangeLock(r, d)) return;

            // ★追加：クリアモード
            if (State.mode === 'clear') {
              handleClearCell(r, d, td);
              return;
            }

            // cellOperations.js に委譲
            if (State.leaveMode) {
              window.CellOperations.toggleLeave(r, d, td);
              return;
            }

            if (State.mode === 'off') {
              window.CellOperations.toggleOff(r, d, td);
              return;
            }

            window.CellOperations.cycleAssign(r, d, td);
          });

          td.addEventListener('contextmenu', (e) => {  
            e.preventDefault();
            const nowLocked = isLocked(r, ds);
            setLocked(r, ds, !nowLocked);
            td.classList.toggle('locked', !nowLocked);
            showToast(!nowLocked
              ? 'セルをロックしました（自動割当の対象外）'
              : 'セルのロックを解除しました');
          });

          tr.appendChild(td);
        }
        // 4週間（網掛け範囲）のマーク集計を算出して行末に追加（労働時間の左隣）
        let start4w = (typeof State.range4wStart === 'number') ? State.range4wStart : 0;
        if (start4w < 0) start4w = 0;
        let end4w = start4w + 27;
        const maxDayIdx4w = State.windowDates.length - 1;
        if (end4w > maxDayIdx4w) end4w = maxDayIdx4w;

        let cntO = 0, cntNightPair = 0, cntNF = 0, cntNS = 0;
        if (end4w >= start4w){
          for (let d = start4w; d <= end4w; d++){
            const dt4 = State.windowDates[d];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);
            const mk4 = globalGetAssign(r, ds4);
            if (!mk4) continue;
            if (mk4 === '〇'){
              cntO++;
            } else if (mk4 === '☆'){
              cntNightPair++;
            } else if (mk4 === '★'){
              const prevIdx = d - 1;
              let countedWithPrev = false;
              if (prevIdx >= start4w && prevIdx >= 0){
                const prevDt = State.windowDates[prevIdx];
                if (prevDt){
                  const prevMk = globalGetAssign(r, dateStr(prevDt));
                  if (prevMk === '☆') countedWithPrev = true;
                }
              }
              if (!countedWithPrev) cntNightPair++;
            } else if (mk4 === '◆'){
              cntNF++;
            } else if (mk4 === '●'){
              cntNS++;
            }
          }
        }

        const tdMarks = document.createElement('td');
        tdMarks.className = 'month-marks';
        tdMarks.dataset.row = String(r);
        tdMarks.innerHTML = `
          <div class="mm-row">
            <span>〇${cntO}</span><span>☆★${cntNightPair}</span>
          </div>
          <div class="mm-row">
            <span>◆${cntNF}</span><span>●${cntNS}</span>
          </div>
        `.trim();
        tr.appendChild(tdMarks);

        // 労働時間セル
        const tdTime = document.createElement('td');
        tdTime.className = 'month-total';
        tdTime.dataset.row = String(r);



        // === ここで各従業員の4週間（網掛け範囲）の勤務時間合計を算出して行の末尾に追加 ===

        let totalMin = 0;
        if (typeof start4w === 'number' && end4w >= start4w){
          for (let d4 = start4w; d4 <= end4w; d4++){
            const dt4 = State.windowDates[d4];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);

            // 4週内の日付について、休・特別休は除外して勤務時間のみ加算
            const isOff4 = globalHasOffByDate(r, ds4);
            const lv4 = globalHasLeave(r, ds4) ? (getLeaveType(r, ds4) || '') : undefined;
            const mk4 = globalGetAssign(r, ds4);
            if (!mk4) continue;
            if (isOff4 || lv4) continue;

            let minutes = 0;
            if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
              minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk4) || 0);
            } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
              minutes = Number(window.ShiftDurations.getDefaultForMark(mk4) || 0);
            } else {
              const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240};
              minutes = fallback[mk4] || 0;
            }
            totalMin += minutes;
          }
        }

        const tdTotal = document.createElement('td');
        tdTotal.className = 'month-total';
        tdTotal.dataset.row = String(r);
        tdTotal.textContent = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(totalMin)
          : `${Math.floor(totalMin/60)}:${String(totalMin%60).padStart(2,'0')}`;
        tr.appendChild(tdTotal);
        // === 4週間勤務時間セルの追加ここまで ===

        tbody.appendChild(tr);

      });

      grid.appendChild(thead);
      grid.appendChild(tbody);

      renderFooterCounts();
      paintRange4w();
    }


 window.renderGrid = renderGrid; // ★追加

function markToClass(mk){
  if (window.MARK_MAP && window.MARK_MAP[mk]) return window.MARK_MAP[mk].className;
  return '';
}


  
    function renderNameCell(idx, name){
    const wrap = document.createElement('div');
    wrap.className = 'emp-wrap';

    const span = document.createElement('span');
    span.textContent = name;
    wrap.appendChild(span);

    // Level select (A/B/C)
    const selLv = document.createElement('select');
    selLv.className = 'mini-select level';
    ['A','B','C'].forEach(v=>{
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      selLv.appendChild(o);
    });
    selLv.value = (State.employeesAttr[idx]?.level)||'B';
    selLv.title = 'レベル（A/B/C）';
    selLv.addEventListener('change', ()=>{
      const a = State.employeesAttr[idx] || (State.employeesAttr[idx]={level:'B', workType:'three'});
      a.level = selLv.value;
      saveMetaOnly(); // ← 即時保存
    });

    // UIに反映（レベル選択を先に配置）
    wrap.appendChild(selLv);

    // WorkType select（二部/三部/日/夜）
    const selWk = document.createElement('select');
    selWk.className = 'mini-select work';
    ['two','three','day','night'].forEach(key=>{
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol}`;
      selWk.appendChild(o);
    });
    selWk.value = (State.employeesAttr[idx]?.workType)||'three';
    selWk.title = '勤務形態';

    selWk.addEventListener('change', ()=>{
      const a = State.employeesAttr[idx] || (State.employeesAttr[idx]={level:'B', workType:'three'});
      a.workType = selWk.value;
      saveMetaOnly(); // ← 即時保存
    });


    wrap.appendChild(selWk);

    return wrap;
  }


  function paintRange4w(){
    $$('.range4w', grid).forEach(c=> c.classList.remove('range4w'));
    const s = State.range4wStart;
    const e = s + 27;
    for(let d=s; d<=e; d++){
      $$(`[data-day="${d}"]`, grid).forEach(cell=> cell.classList.add('range4w'));
    }
  }

  // 範囲ロック/解除：開始→終了セルの2クリックで矩形適用
  function maybeHandleRangeLock(r, d){
    if (!State.lockMode) return false;
    if (!State.lockStart){
      State.lockStart = { r, d };
      showToast('終了セルをクリックしてください');
      return true;
    }
    const r0 = Math.min(State.lockStart.r, r);
    const r1 = Math.max(State.lockStart.r, r);
    const d0 = Math.min(State.lockStart.d, d);
    const d1 = Math.max(State.lockStart.d, d);
    for (let rr=r0; rr<=r1; rr++){
      for (let dd=d0; dd<=d1; dd++){
        const ds2 = dateStr(State.windowDates[dd]);
        setLocked(rr, ds2, State.lockMode === 'lock');
      }
    }
    renderGrid();
    showToast(State.lockMode==='lock' ? '範囲をロックしました（自動割当の対象外）' : '範囲のロックを解除しました');
    State.lockMode = null;
    State.lockStart = null;
    return true;
  }



  function hasOffByDate(empIdx, ds){
    const s = State.offRequests.get(empIdx);
    return s ? s.has(ds) : false;
  }
  window.hasOffByDate = hasOffByDate; // ★追加
  // 特別休暇の取得/設定
  function getLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    return m ? m.get(ds) : undefined;
  }
window.getLeaveType = getLeaveType; // ★追加
function isWeekendByDs(ds){
  const dt = State.windowDates.find(dt => dateStr(dt) === ds);
  const w  = dt ? dt.getDay() : (new Date(ds)).getDay();
  return w === 0 || w === 6;
}
  // ★追加：翌日の★を日付文字列ベースで消去（cellOperations.jsと共通利用）
  function removeNextStarByDs(r, ds){
    const idx = State.windowDates.findIndex(dt => dateStr(dt) === ds);
    if (idx < 0) return;
    const nextIndex = idx + 1;
    if (nextIndex >= State.windowDates.length) return;
    const nds = dateStr(State.windowDates[nextIndex]);
    if (getAssign(r, nds) === '★'){
      clearAssign(r, nds);
      setLocked(r, nds, false);
      const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
      if (nextCell){
        nextCell.classList.remove('locked');
        nextCell.textContent = '';
      }
      if (typeof updateFooterCounts === 'function') updateFooterCounts();
    }
  }

function setLeaveType(empIdx, ds, code){
  // 夜勤専従には「祝」「代」を割り当て不可
  const wt = (State.employeesAttr[empIdx]?.workType) || 'three';
  if ((code === '祝' || code === '代') && wt === 'night'){
    if (typeof showToast === 'function'){
      showToast('夜勤専従には「祝」「代」を設定できません');
    }
    return false;
  }
  // 「祝」は土日には付与禁止
  if (code === '祝' && isWeekendByDs(ds)){
    if (typeof showToast === 'function'){
      showToast('土日には「祝」を設定できません（振替休日を平日に設定してください）');
    }
    return false;
  }
  let m = State.leaveRequests.get(empIdx);

  if(!m){ m = new Map(); State.leaveRequests.set(empIdx, m); }
  m.set(ds, code);

  // ★追加：自動付与（祝/代 等）でも翌日の「★」を強制消去
  removeNextStarByDs(empIdx, ds);
  return true;
}
window.setLeaveType = setLeaveType; // ★追加

  function clearLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    if(m){ m.delete(ds); if(m.size===0) State.leaveRequests.delete(empIdx); }
  }
  window.clearLeaveType = clearLeaveType; // ★追加
  // 追加：自動割当で上書き可能な“ソフト休暇”（祝/代）
  function isSoftLeave(code){ return code === '祝' || code === '代'; }
  function clearSoftLeaveIfAny(empIdx, ds){
    const lv = getLeaveType(empIdx, ds);
    if (lv && isSoftLeave(lv)) clearLeaveType(empIdx, ds);
  }

  // “休息”の判定（希望休 or 特別休暇）
  function isRestByDate(empIdx, ds){
    return hasOffByDate(empIdx, ds) || !!getLeaveType(empIdx, ds);
  }
  function leaveClassOf(code){
    if (code === '祝') return 'lv-hol';
    if (code === '代') return 'lv-sub';
    if (code === '年') return 'lv-ann';
    if (code === 'リ') return 'lv-rs';
    return '';
  }



  function getAssign(r, ds){
    const m = State.assignments.get(r);
    return m ? m.get(ds) : undefined;
  }
 window.getAssign = getAssign; // ★追加
function setAssign(r, ds, mk){
  let m = State.assignments.get(r);
  if(!m){ m = new Map(); State.assignments.set(r,m); }
  if(mk) m.set(ds, mk);

  // ★追加：当日が「〇」になったら、翌日の「★」（ロック含む）を強制消去
  if (mk === '〇') removeNextStarByDs(r, ds);
}
window.setAssign = setAssign; // ★追加
  function clearAssign(r, ds){
    const m = State.assignments.get(r);
    if(m){ m.delete(ds); if(m.size===0) State.assignments.delete(r); }
  }
window.clearAssign = clearAssign; // ★追加
//  isToday は core.dates.js（App.Dates.isToday）へ移動

  // ---- アンカー移動 ----
  function switchAnchor(newAnchor){

    // ★移動前に保存
    saveWindow();
    // ★アンドゥは別ウィンドウに持ち越さない
    UndoBuf = null;
    if (btnUndo) btnUndo.disabled = true;

    saveScroll();
    loadWindow(newAnchor);
    renderAll();
    restoreScroll();
  }


  function shiftDays(n){
    switchAnchor(addDays(State.anchor, n));
  }


  // ---- ドラッグで日単位スクロール ----
  function dragDayNavigation(el){
    let down = false, sx = 0, moved = false, downTarget = null;
    let lastShiftedDays = 0; // ドラッグ中に既に移動した日数を記録

    el.addEventListener('pointerdown', (e)=>{
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true;
      sx = e.clientX;
      moved = false;
      downTarget = e.target;
      lastShiftedDays = 0; // リセット
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e)=>{
      if (!down) return;
      const dx = e.clientX - sx;
      
      // 一定以上動いたらmovedフラグを立てる
      if (Math.abs(dx) > 6) moved = true;
      
      // リアルタイムスクロール：一定距離ごとに日付を移動
      const firstTh = grid.querySelector('thead th[data-day="0"]');
      const cellW = firstTh ? firstTh.getBoundingClientRect().width : 56;
      const days = -Math.round(dx / (cellW * 0.7));
      
      // 前回の移動から変化があれば日付を変更
      if (days !== 0 && days !== lastShiftedDays) {
        const deltaDays = days - lastShiftedDays;
        shiftDays(deltaDays);
        lastShiftedDays = days;
        // 基準点を更新（連続ドラッグに対応）
        sx = e.clientX;
        lastShiftedDays = 0;
      }
    });

    el.addEventListener('pointerup', (e)=>{
      if (!down) return;
      el.releasePointerCapture(e.pointerId);

      if (!moved){
        if (downTarget && downTarget !== el){
          downTarget.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
        }
        down = false;
        downTarget = null;
        return;
      }

      // pointerup時の追加移動は不要（pointermoveで処理済み）
      down = false;
      downTarget = null;
      lastShiftedDays = 0;
    });
  }

  // スクロール位置保持（横スクロールの感覚維持）
  let lastScroll = 0;
  function saveScroll(){ lastScroll = gridWrap.scrollLeft; }
  function restoreScroll(){ gridWrap.scrollLeft = lastScroll; }

  // ---- 属性ダイアログ ----
  function openAttrDialog(){
    buildAttrDialog();
    if(typeof attrDlg.showModal === 'function') attrDlg.showModal();
    else attrDlg.show(); // fallback
  }

function buildAttrDialog(){
  attrContent.innerHTML = '';
  for(let i=0;i<State.employeeCount;i++){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.idx = String(i);
    row.dataset.role = 'row';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'txt';
    name.value = State.employees[i] || `職員${pad2(i+1)}`;
    name.placeholder = `職員名（例：${State.employees[i] || `職員${pad2(i+1)}`}）`;
    name.maxLength = 32;
    name.setAttribute('aria-label','従業員名');
    name.dataset.role = 'name';

    const selLv = document.createElement('select');
    selLv.className = 'select';
    ['A','B','C'].forEach(v=>{
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if((State.employeesAttr[i]?.level||'B')===v) o.selected = true;
      selLv.appendChild(o);
    });

    const selWt = document.createElement('select');
    selWt.className = 'select';
    WorkOrder.forEach(key=>{
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol} ${WorkMap[key].label}`;
      if((State.employeesAttr[i]?.workType||'three')===key) o.selected = true;
      selWt.appendChild(o);
    });

  
    // ★追加：夜勤ノルマ入力欄（夜勤専従のみ表示）
    const quotaWrap = document.createElement('div');
    quotaWrap.className = 'quota-wrap';
    quotaWrap.style.display = (State.employeesAttr[i]?.workType||'three') === 'night' ? 'flex' : 'none';
    quotaWrap.style.alignItems = 'center';
    quotaWrap.style.gap = '4px';

    const quotaLabel = document.createElement('span');
    quotaLabel.textContent = '☆ノルマ:';
    quotaLabel.style.fontSize = '0.9em';

    const quotaInput = document.createElement('input');
    quotaInput.type = 'number';
    quotaInput.className = 'quota-input';
    quotaInput.style.width = '50px';
    quotaInput.min = '0';
    quotaInput.max = '15';
    quotaInput.value = State.employeesAttr[i]?.nightQuota || 10;
    quotaInput.title = '夜勤専従の4週間あたりの☆の目標回数';

    quotaWrap.appendChild(quotaLabel);
    quotaWrap.appendChild(quotaInput);

// ★修正：禁忌ペア選択（複数選択可能）
const forbidWrap = document.createElement('div');
forbidWrap.className = 'forbid-wrap';
forbidWrap.style.display = 'flex';
forbidWrap.style.alignItems = 'center';
forbidWrap.style.gap = '4px';

const forbidLabel = document.createElement('span');
forbidLabel.textContent = '禁忌ペア:';
forbidLabel.style.fontSize = '0.9em';

const forbidSelect = document.createElement('select');
forbidSelect.className = 'forbid-select';
forbidSelect.multiple = true;
forbidSelect.style.minWidth = '100px';
forbidSelect.style.maxWidth = '200px';
forbidSelect.size = 3;
for (let j = 0; j < State.employeeCount; j++) {
  if (j === i) continue;
  const opt = document.createElement('option');
  opt.value = String(j);
  opt.textContent = State.employees[j] || `職員${pad2(j+1)}`;
  const current = State.forbiddenPairs.get(i);
  if (current && current.has(j)) opt.selected = true;
  forbidSelect.appendChild(opt);
}

// 左クリックだけで禁忌ペアをトグル選択できるようにする
forbidSelect.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return; // 左クリック以外は無視
  const target = ev.target;
  if (!target || target.tagName !== 'OPTION') return;
  ev.preventDefault();          // ブラウザ標準の選択挙動を抑止
  target.selected = !target.selected;
});

forbidWrap.appendChild(forbidLabel);
forbidWrap.appendChild(forbidSelect);


    // 勤務形態変更時にノルマ入力欄の表示/非表示を切り替え
    selWt.addEventListener('change', ()=>{
      quotaWrap.style.display = selWt.value === 'night' ? 'flex' : 'none';
    });

  // 追加：並び替え＆削除ボタン列
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn btn-outline';
    btnUp.textContent = '▲上へ';
    btnUp.disabled = (i === 0);
    btnUp.addEventListener('click', ()=> moveEmployee(i, i-1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'btn btn-outline';
    btnDown.textContent = '▼下へ';
    btnDown.disabled = (i === State.employeeCount - 1);
    btnDown.addEventListener('click', ()=> moveEmployee(i, i+1));

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-danger';
    btnDel.textContent = '削除';
    btnDel.addEventListener('click', ()=> deleteEmployee(i));

    ctrls.appendChild(btnUp);
    ctrls.appendChild(btnDown);
    ctrls.appendChild(btnDel);

    row.appendChild(name);
    row.appendChild(selLv);
    row.appendChild(selWt);
    row.appendChild(quotaWrap); 
    row.appendChild(forbidWrap);
    row.appendChild(ctrls);
    attrContent.appendChild(row);
  }
}


function readAttrDialogToState(){

  const rows = $$('.row', attrContent);
  rows.forEach(row=>{
    const i = Number(row.dataset.idx);
    const [selLv, selWt] = row.querySelectorAll('select');
    const nameInput = row.querySelector('input[data-role="name"]');
    const quotaInput = row.querySelector('.quota-input');
    const forbidSelect = row.querySelector('.forbid-select'); // ★追加
    const nm = (nameInput?.value || '').trim();
    State.employees[i] = nm || `職員${pad2(i+1)}`;
    // ★修正：夜勤ノルマを追加
    const nightQuota = quotaInput ? parseInt(quotaInput.value, 10) : undefined;
    State.employeesAttr[i] = { 
      level: selLv.value, 
      workType: selWt.value,
      nightQuota: (selWt.value === 'night' && Number.isInteger(nightQuota)) ? nightQuota : undefined
    };
    
    // ★追加：禁忌ペアの保存（複数選択対応）
    if (forbidSelect) {
      const selected = Array.from(forbidSelect.selectedOptions).map(opt => Number(opt.value));
      if (selected.length > 0) State.forbiddenPairs.set(i, new Set(selected));
      else State.forbiddenPairs.delete(i);
    }
  });
}

// === ここから追加：従業員の並び替え＆削除（シフト・希望休も紐付けて移動/除去） ===

// Map<index, ...> のキーを入れ替える（存在しないキーは消去）
function swapMapKey(map, a, b){
  const hasA = map.has(a), hasB = map.has(b);
  const vA = hasA ? map.get(a) : undefined;
  const vB = hasB ? map.get(b) : undefined;
  if (hasA) map.set(b, vA); else map.delete(b);
  if (hasB) map.set(a, vB); else map.delete(a);
}

// dates ストア（全期間）内の「配列風オブジェクト」バケツを入れ替え
function swapStoreBuckets(obj, i, j){
  const tmp = obj[i];
  obj[i] = obj[j];
  obj[j] = tmp;
}

function updateLocksAfterSwap(a, b){
  const next = new Set();
  for (const k of State.lockedCells){
    const [rs, ds] = k.split('|');
    let r = Number(rs);
    if (r === a) r = b; else if (r === b) r = a;
    next.add(`${r}|${ds}`);
  }
  State.lockedCells = next;
}

function updateLocksAfterDelete(idx){
  const next = new Set();
  for (const k of State.lockedCells){
    const [rs, ds] = k.split('|');
    const r = Number(rs);
    if (r < idx) next.add(`${r}|${ds}`);
    else if (r > idx) next.add(`${r-1}|${ds}`);
    // 等しい（削除対象）は落とす
  }
  State.lockedCells = next;
}


// dates ストア（全期間）内の「配列風オブジェクト」を idx で詰め直す
function remapStoreAfterDelete(obj, idx){
  const out = {};
  Object.keys(obj || {}).forEach(k=>{
    const n = Number(k);
    if (Number.isNaN(n)) return;
    if (n < idx) out[n] = obj[n];
    else if (n > idx) out[n-1] = obj[n];
  });
  return out;
}

// 表示用ダイアログとグリッドを再描画＆メタ保存
function refreshAfterChange(msg){
  buildAttrDialog();
  renderGrid();
  saveMetaOnly();
  if (typeof showToast === 'function') showToast(msg);
}

// 並び替え：from → to へ（シフト/希望休を人に紐付けて丸ごと移動）
function moveEmployee(from, to){
  if (to < 0 || to >= State.employeeCount || from === to) return;

  // 1) 表示配列の入替
  [State.employees[from],     State.employees[to]    ] = [State.employees[to],     State.employees[from]    ];
  [State.employeesAttr[from], State.employeesAttr[to]] = [State.employeesAttr[to], State.employeesAttr[from]];

  // 2) 31日窓内データ（Map）入替
  swapMapKey(State.offRequests, from, to);
  swapMapKey(State.assignments, from, to);

  // 3) 全期間ストアも入替（過去/未来のズレ防止）
  const store = readDatesStore();
  if (!store.off)    store.off    = {};
  if (!store.assign) store.assign = {};
  swapStoreBuckets(store.off,    from, to);
  swapStoreBuckets(store.assign, from, to);
  if (!store.lock) store.lock = {};
  swapStoreBuckets(store.lock,   from, to);
  writeDatesStore(store);

  updateLocksAfterSwap(from, to);
  refreshAfterChange('並び替えました');

}

// 削除：idx の従業員を完全削除（行を詰める／最小人数は維持）
function deleteEmployee(idx){
  if (!confirm('この従業員を削除します。現在の割当と希望休も削除されます。よろしいですか？')) return;

  // 1) 表示配列から除去
  State.employees.splice(idx, 1);
  State.employeesAttr.splice(idx, 1);

  // 1.5) 従業員数を減算し、セレクトを現在値に再構築
  State.employeeCount = Math.max(1, State.employeeCount - 1);
  if (employeeCountSel){
    const maxOpt = Math.max(60, State.employeeCount);
    employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i)=> {
      const v = i + 1; return `<option value="${v}">${v}</option>`;
    }).join('');
    employeeCountSel.value = String(State.employeeCount);
  }

  // 2) 31日窓内データ（Map）を詰め直し
  const remap = (map)=>{
    const out = new Map();
    for (const [k, v] of map.entries()){
      const n = Number(k);
      if (n < idx) out.set(n, v);
      else if (n > idx) out.set(n-1, v);
    }
    return out;
  };
  State.offRequests = remap(State.offRequests);
  State.assignments = remap(State.assignments);

  // 3) 全期間ストアも詰め直し（過去/未来のズレ防止）
  const store = readDatesStore();
  store.off    = remapStoreAfterDelete(store.off    || {}, idx);
  store.assign = remapStoreAfterDelete(store.assign || {}, idx);
  store.lock   = remapStoreAfterDelete(store.lock   || {}, idx);
  writeDatesStore(store);

  updateLocksAfterDelete(idx);

  // 4) 整合性維持（現状の employeeCount に合わせるだけ）
  ensureEmployees();

  refreshAfterChange('従業員を削除しました');

}
// === ここまで追加 ===


  
  // ---- 従業員属性（別ファイルJSON） ----
  const WorkMap = {
    two:   { symbol:'②', label:'二部制'                 },
    three: { symbol:'③', label:'三部制'                 },
    day:   { symbol:'日', label:'日勤のみ（平日・土日祝OK）' },
    night: { symbol:'夜', label:'夜勤のみ'               },
  };
  const WorkOrder = ['two','three','day','night'];

    // === グローバル公開（buttonHandlers.js / autoAssignLogic.js 用） ===
  window.switchAnchor = switchAnchor;
  window.shiftDays = shiftDays;
  window.paintRange4w = paintRange4w;
  window.exportExcelCsv = exportExcelCsv;
  window.cancelChanges = cancelChanges;
  window.makeCancelBackup = makeCancelBackup;
  window.undoCancelRange = undoCancelRange;
  
  // ★autoAssignLogic.js から参照される関数（委譲）
  window.autoAssignRange = function(s, e){ 
    if(window.AutoAssignLogic) return window.AutoAssignLogic.autoAssignRange(s, e); 
  };
  window.applyHolidayLeaveFlags = function(s, e){ 
    if(window.AutoAssignLogic) return window.AutoAssignLogic.applyHolidayLeaveFlags(s, e); 
  };
  
  // ★追加：祝日自動取得関数
  window.autoLoadJapanHolidays = async function(){
    try{
      if (!window.HolidayRules || typeof window.HolidayRules.fetchJapanHolidays !== 'function'){
        showToast('祝日API機能が読み込まれていません');
        return;
      }
      const years = [...new Set(State.windowDates.map(d => d.getFullYear()))];
      const hol = await window.HolidayRules.fetchJapanHolidays(years);
      let count = 0;
      for (const d of State.windowDates){
        const ds = dateStr(d);
        if (hol.has(ds)){
          if (!State.holidaySet.has(ds)) count++;
          State.holidaySet.add(ds);
        }
      }
      renderGrid();
      showToast(`祝日を反映しました：${count}日`);
    }catch(e){
      console.error(e);
      showToast('祝日の取得に失敗しました（ネットワークやCORSをご確認ください）');
    }
  };
  
  window.completeCancelAll = completeCancelAll;
  window.completeCancelOneCell = completeCancelOneCell;
  window.handleClearCell = handleClearCell; // ★追加
  window.saveWindow = saveWindow;
  window.pushToRemote = pushToRemote;
  window.openAttrDialog = openAttrDialog;
  window.readAttrDialogToState = readAttrDialogToState;
  window.requiredOffFor28 = requiredOffFor28;
  window.validateRollingFourWeeksWithHistory = validateRollingFourWeeksWithHistory;
  window.State = State;

  // === グローバル公開（cellOperations.js / autoAssignLogic.js 用） ===
  window.isRestByDate = isRestByDate;
  window.markToClass = markToClass;
  window.leaveClassOf = leaveClassOf;
  window.readDatesStore = readDatesStore;
  window.globalGetAssign = globalGetAssign;

})();
