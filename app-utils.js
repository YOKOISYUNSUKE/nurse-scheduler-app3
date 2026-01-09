/* app-utils.js : ユーティリティ関数 */
  window.SchedulerState = State;

  // ---- Util ----
  // 手動割り当てはルール無視で通す（canAssign / precheckPlace / applyAfterAssign をスキップ）
  const IGNORE_RULES_ON_MANUAL = true;

  // 勤務形態に応じて属性を正規化（不整合な値の残留を防止）
  function normalizeEmployeeAttrByWorkType(attr){
    if (!attr || typeof attr !== 'object') attr = { level:'B', workType:'three' };

    // 既定値（未定義を補完）
    if (typeof attr.hasEarlyShift !== 'boolean') attr.hasEarlyShift = false;
    if (!attr.earlyShiftType) attr.earlyShiftType = 'all';
    if (typeof attr.hasLateShift !== 'boolean') attr.hasLateShift = false;
    if (!attr.lateShiftType) attr.lateShiftType = 'all';
    if (!attr.shiftDurations || typeof attr.shiftDurations !== 'object') attr.shiftDurations = {};

    // 夜勤専従は「早出/遅出」概念を持たないため常に無効化
    if (attr.workType === 'night'){
      attr.hasEarlyShift = false;
      attr.hasLateShift  = false;
      attr.earlyShiftType = 'all';
      attr.lateShiftType  = 'all';
    }

    return attr;
  }

  // ユーザー別localStorageキーとクラウドキー群
  function storageKey(k){
    const uid = sessionStorage.getItem('sched:userId') || 'user';
    return `sched:${uid}:${k}`;
  }

  function cloudKey(){
    return sessionStorage.getItem('sched:cloudKey');
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
    let workMinutes = 0;
    for (let i=0;i<28;i++){
      const dt = addDays(start, i);
      const ds = dateStr(dt);
      const mk = globalGetAssign(r, ds);
      const hasLv = globalHasLeave(r, ds);
      const isOff = (globalHasOffByDate(r, ds) || !mk) && !hasLv; // 特別休暇日は“勤務扱い”
      if (mk === '☆') star++;
      if (mk === '◆' || mk === '●') half++;
      if (isOff) {
        off++;
      } else if (mk && !hasLv){
        // ★追加：実労働時間（勤務マークがあり、公休・特別休暇でない日）を積算
        let minutes = 0;
        if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
          minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk) || 0);
        } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
          minutes = Number(window.ShiftDurations.getDefaultForMark(mk) || 0);
        } else {
          const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240,'□':540};
          minutes = fallback[mk] || 0;
        }
        workMinutes += minutes;
      }
    }
    return { star, half, off, workMinutes, start, end:endDt };
  }

  // 〈新規〉28日窓の休日日数の必要量（★始まり/☆終わり 補正）
  // ★全従業員に適用（夜勤専従含む）
  // 戻り値: { base: 基準値(7/8/9), min: 最小許容, max: 最大許容 }
  function requiredOffFor28(r, startDt, endDt){
    const dsStart = dateStr(startDt);
    const dsEnd   = dateStr(endDt);
    const mkStart = globalGetAssign(r, dsStart);
    const mkEnd   = globalGetAssign(r, dsEnd);
    const starStart = (mkStart === '★'); // ★始まり→7休基準
    const starEnd   = (mkEnd   === '☆'); // ☆終わり→9休基準

    let base;
    if (starStart && !starEnd) {
      base = 7;
    } else if (!starStart && starEnd) {
      base = 9;
    } else {
      base = 8;
    }

    // 全従業員（二部制・三部制・日勤のみ・夜勤専従）に ±1 許容（7〜9日の範囲）
    return {
      base: base,
      min: Math.max(7, base - 1),  // 最小7日
      max: Math.min(9, base + 1)   // 最大9日
    };
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
          const quota = (State.employeesAttr[r]?.nightQuota) || 10;
          if (star !== quota) return `${name} のローリング4週間（${rng}）の「☆」は${quota}件ちょうどが必要：${star}/${quota}`;
        } else if (wt === 'two'){
          // 二部制も個別の☆回数を参照（未設定なら4）
          const quota = (State.employeesAttr[r]?.twoShiftQuota) || 4;
          if (star !== quota) return `${name} のローリング4週間（${rng}）の「☆」は${quota}件必要：${star}/${quota}`;
      } else if (wt === 'three'){
        // 三部制も個別の◆/●回数を参照
        const nfQuota = (State.employeesAttr[r]?.threeShiftNfQuota ?? 5);
        const nsQuota = (State.employeesAttr[r]?.threeShiftNsQuota ?? 5);
        const totalQuota = nfQuota + nsQuota;
        if (half < totalQuota - 2 || half > totalQuota + 2) {
          return `${name} のローリング4週間（${rng}）の（◆＋●）は${totalQuota-2}〜${totalQuota+2}件を許容：${half}件`;
        }
      }

        // 4週間の休日日数（希望休＋空白）を ±1許容（7〜9日）で厳格化
        const offReq = requiredOffFor28(r, start, endDt);
        if (off < offReq.min || off > offReq.max){
          return `${name} のローリング4週間（${rng}）の休日は${offReq.min}〜${offReq.max}日必要：${off}日`;
        }
      }
    }
    return null; // OK
  }

function countForDayLocal(dayIndex){
  let day=0, nf=0, ns=0, early=0, late=0;
  const ds = dateStr(State.windowDates[dayIndex]);
  const prevDs = dateStr(addDays(State.windowDates[dayIndex], -1));
  for(let r=0; r<State.employeeCount; r++){
    const mk = getAssign(r, ds);

    // 日勤
    if (mk === '〇') day++;

    // 早出
    if (mk === '早') {
      early++;
    }

    // 遅出
    if (mk === '遅') {
      late++;
    }

    // 夜勤前半
    if (mk === '☆' || mk === '◆') nf++;

    // 夜勤後半（前日☆フォールバック）
    const prevMk = getAssign(r, prevDs);
    if (mk === '★' || mk === '●' || prevMk === '☆') ns++;
  }
  return { day, nf, ns, early, late };
}

  function buildWindowDates(anchor){
    const arr = [];
    for(let i=0;i<28;i++) arr.push(addDays(anchor, i));
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

async function enterApp(){
    loginView.classList.remove('active');
    appView.classList.add('active');

    const loginLoading = document.getElementById('loginLoading');
    if (loginLoading) loginLoading.classList.add('hidden');

    // まず画面の初期化を完了させる
    initControls();
    loadWindow(State.anchor);
    renderAll();
    
    // 従業員ダイアログは最後に初期化（DOM要素が完全に準備された後）
    setTimeout(() => {
      if (window.EmployeeDialog && typeof window.EmployeeDialog.init === 'function') {
        window.EmployeeDialog.init();
      } else {
        console.warn('EmployeeDialog が読み込まれていません');
      }
    }, 100);
}

