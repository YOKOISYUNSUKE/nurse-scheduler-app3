
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
  const btnFullCancelAll = $('#btnFullCancelAll'); // ★完全キャンセル（全体）
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

    // ★追加：ログイン時に最新SWへ即時アップグレード
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          let reloaded = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) return;
            reloaded = true;
            location.reload(); // 新SWが制御を握ったら一度だけリロード
          });
          await reg.update(); // 新しいSWがあれば取得
          const sw = reg.waiting || reg.installing;
          if (sw && typeof sw.postMessage === 'function') {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        }
      } catch (e) {
        console.warn('SW update on login failed:', e);
      }
    }

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
    holidaySet: new Set(),      // Set<dateStr>
    offRequests: new Map(),     // Map<empIndex, Set<dateStr>>
    leaveRequests: new Map(),   // Map<empIndex, Map<dateStr, '祝'|'代'|'年'|'リ'>>
    assignments: new Map(),     // Map<empIndex, Map<dateStr, mark>>
    range4wStart: 0,            // 0..3（31-28=3）
    lastSaved: null,            // スナップショット
    mode: 'off',                // 'off' | 'assign' | 'cellCancel'
    leaveMode: null,            // null | '祝'|'代'|'年'|'リ'
    manualOverride: false,      // 手動割当（上書き）トグル
    lockedCells: new Set(),     // Set<"row|YYYY-MM-DD">：自動割当の上書き対象外
    lockMode: null,             // 'lock' | 'unlock' | null（範囲選択モード）
    lockStart: null,            // { r, d }（開始セル）
    fullCancelCellMode: false,  // ★セルキャンセルモード

  };


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
  function setLocked(r, ds, on){
    const k = lockKey(r, ds);
    if (on) State.lockedCells.add(k);
    else    State.lockedCells.delete(k);
  }


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

    btnJumpMonth.addEventListener('click', ()=> monthPicker.showPicker ? monthPicker.showPicker() : monthPicker.click());
    monthPicker.addEventListener('change', ()=>{
      const [y,m] = monthPicker.value.split('-').map(Number);
      if(!y || !m) return;
      switchAnchor(new Date(y, m-1, 1)); // 月初にジャンプ → ドラッグで微調整
    });

    btnPrevDay.addEventListener('click', ()=> shiftDays(-1)); // 1日戻る
    btnNextDay.addEventListener('click', ()=> shiftDays(+1)); // 1日進む
    if (btnHolidayAuto) btnHolidayAuto.addEventListener('click', autoLoadJapanHolidays);
    if (btnExportExcel) btnExportExcel.addEventListener('click', exportExcelCsv);
    if (btnUndo) btnUndo.disabled = true; // ★初期は無効化

    // 範囲ロック/解除：開始セル→終了セルの順にクリック
    if (btnLockRange) btnLockRange.addEventListener('click', ()=>{
      State.lockMode = 'lock'; State.lockStart = null;
      showToast('範囲ロック：開始セルをクリックしてください');
    });
    if (btnUnlockRange) btnUnlockRange.addEventListener('click', ()=>{
      State.lockMode = 'unlock'; State.lockStart = null;
      showToast('範囲ロック解除：開始セルをクリックしてください');
    });


    // 自動割り当てボタン：毎回ちがうパターンを生成
    btnAutoAssign.addEventListener('click', ()=>{
      const start = State.range4wStart;
      const end   = State.range4wStart + 27;

      // アンドゥ用バックアップを確保
      UndoBuf = makeCancelBackup();

      // いったん4週間ぶんをクリア（希望休は維持）＋「祝/代」を一括消去（ロックは保持）
      cancelChanges(true, true);

    // 乱数シード更新（クリック毎に変化）
    if (window.NightBand && typeof NightBand.setSeed === 'function') {
      NightBand.setSeed(((Date.now() ^ Math.floor(Math.random()*1e9)) >>> 0));
    }
    // ランダム性の強度（例：1.50に上げる。必要に応じて 0.49〜2.0 程度で調整）
    if (window.NightBand && typeof NightBand.setRandAmp === 'function') {
      NightBand.setRandAmp(1.8);
    }

    // 再自動割当（別パターン）
    autoAssignRange(start, end);


      // 祝日自動付与（休→祝 / 祝日勤務者に代休を自動設定）
      applyHolidayLeaveFlags(start, end);

      renderGrid();
      paintRange4w();

      const s = State.windowDates[start], e = State.windowDates[end];
      showToast(`4週間の自動割り当て完了：${s.getMonth()+1}/${s.getDate()}〜${e.getMonth()+1}/${e.getDate()}（別パターン／保存は別）`);

      // 直前状態に戻せるようアンドゥを有効化
      if (btnUndo) btnUndo.disabled = false;
    });


// === ここから追記：自動割り当て本体 ===




// ある日の集計は NightBand に委譲
function countDayStats(dayIdx){
  return (window.NightBand && NightBand.countDayStats)
    ? NightBand.countDayStats(nbCtx(), dayIdx)
    : { day:0, nf:0, ns:0, hasADay:false, hasANf:false, hasANs:false };
}

// 候補従業員は NightBand に委譲
function candidatesFor(dayIdx, mark){
  let out = (window.NightBand && NightBand.candidatesFor)
    ? NightBand.candidatesFor(nbCtx(), dayIdx, mark)
    : [];

  const ds = dateStr(State.windowDates[dayIdx]);
  // ロックセルは候補から除外。☆は翌日の★も必要なので翌日がロックなら除外
  out = out.filter(r=>{
    if (isLocked(r, ds)) return false;
    if (mark === '☆'){
      const n = dayIdx + 1;
      if (n >= State.windowDates.length) return false;
      const nds = dateStr(State.windowDates[n]);
      if (isLocked(r, nds)) return false;

      // ★追加：逆順抑止（夜専を除く）— 前日が「★」なら候補から外す
      const p = dayIdx - 1;
      if (p >= 0){
        const pds = dateStr(State.windowDates[p]);
        const wt  = (State.employeesAttr[r]?.workType) || 'three';
        if (wt !== 'night' && getAssign(r, pds) === '★') return false;
      }
    }
    return true;
  });


  // NightBand 側で勤務形態優先/公平ローテ済み。フィルタのみ適用して返す。
  return out;
}

function tryPlace(dayIdx, r, mark){
  const ds = dateStr(State.windowDates[dayIdx]);
  if (isLocked(r, ds)) return false;
  if (mark === '☆'){
    const n = dayIdx + 1;
    if (n >= State.windowDates.length) return false;
    const nds = dateStr(State.windowDates[n]);
    if (isLocked(r, nds)) return false; // 翌日の★位置がロックなら不可
  }

  const pre = window.AssignRules?.precheckPlace?.({
    rowIndex:r, dayIndex:dayIdx, mark,

    dates:State.windowDates, employeeCount:State.employeeCount,
    getAssign, hasOffByDate:(i,ds)=>isRestByDate(i, ds),

    getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
    getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
  }) || { ok:true };
  if (!pre.ok) return false;

  // ここで「祝/代」ならクリアしてから上書き（自動割当のみ）
  clearSoftLeaveIfAny(r, ds);

  setAssign(r, ds, mark);
  // ☆は翌日の★を自動付与（既存ルールに委ね）
  if (mark === '☆' && window.Rules?.applyAfterAssign){

const res = window.Rules.applyAfterAssign({
  rowIndex:r, dayIndex:dayIdx, mark,
  getAssign, setAssign, clearAssign, hasOffByDate,
  // ★ 追加：次日の「祝/代」も消せるように渡す
  getLeaveType, clearLeaveType,
  // 夜専判定のため勤務形態を渡す
  getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
  gridEl:null, dates:State.windowDates
});


    if (!res.ok){
      clearAssign(r, ds);
      return false;
    } else {
      // ★追加：28日目☆の翌日★は自動ロック（自動割当）
      const nextIdx = dayIdx + 1;
      if (dayIdx === State.range4wStart + 27 && nextIdx < State.windowDates.length){
        const nds = dateStr(State.windowDates[nextIdx]);
        setLocked(r, nds, true);
        const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIdx}"]`);
        if (nextCell) nextCell.classList.add('locked');
      }
    }
  }
  return true;
}


// （_reorderByWorkType は削除）


  // 指定マーク列で不足数を埋める（☆/★は夜専を最優先、その内側でA先頭）
  function fillWith(dayIdx, deficit, marks, preferA){
    let placed = 0;
    for (const mark of marks){
      if (deficit <= 0) break;
      let cand = candidatesFor(dayIdx, mark);

      // ☆/★は NightBand の夜勤優先を尊重し、night→others の二段構成に分解
      if (mark === '☆' || mark === '★'){
        const night = [], others = [];
        cand.forEach(r => (((State.employeesAttr[r]?.workType)||'three') === 'night' ? night : others).push(r));

// グループ内だけ A 先頭を適用（Aが1名入ったらpreferAは解除：既存仕様）
const applyAHead = (arr) => {
  if (!preferA) return arr;
  const a = [], non = [];
  arr.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? a : non).push(r));
  return a.concat(non);
};

// ★修正：preferAがtrueの場合、グループ間でもA優先を適用
if (preferA){
  const nightA = [], nightNon = [], othersA = [], othersNon = [];
  night.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? nightA : nightNon).push(r));
  others.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? othersA : othersNon).push(r));
  // A属性を全て先頭に(night A → others A → night非A → others非A)
  cand = nightA.concat(othersA, nightNon, othersNon);
} else {
  cand = applyAHead(night).concat(applyAHead(others));
}
      } else if (preferA){
        const a = [], non = [];
        cand.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? a : non).push(r));
        cand = a.concat(non);
      }

      for (const r of cand){
        if (deficit <= 0) break;

        if (tryPlace(dayIdx, r, mark)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level)==='A') preferA = false;
          continue;
        }

        // ★が置けず、前日に同一者の☆が無いのが理由なら自動補完
        if (mark === '★' && placePrevStar(dayIdx, r)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level)==='A') preferA = false;
        }
      }
    }
    return placed;
  }


// === ここから挿入：★のための前日☆自動補完 ===
function placePrevStar(dayIdx, r){
  const prevIdx = dayIdx - 1;
  if (prevIdx < 0) return false;

  const dsPrev = dateStr(State.windowDates[prevIdx]);
  // 希望休や既割当・ロックの禁止
  if (isRestByDate(r, dsPrev)) return false;
  if (isLocked(r, dsPrev)) return false;

  if (getAssign(r, dsPrev))    return false;

  // 勤務形態 OK?
  const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
  const ok1 = window.AssignRules?.canAssign?.({ empAttr, mark:'☆' }) || { ok:true };
  if (!ok1.ok) return false;

  // その日の組合せや翌日NS過剰（☆→★）まで事前チェック
  const pre = window.AssignRules?.precheckPlace?.({
    rowIndex:r, dayIndex:prevIdx, mark:'☆',
    dates:State.windowDates, employeeCount:State.employeeCount,
    getAssign, hasOffByDate:(i,ds)=>hasOffByDate(i, ds),
    getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
    getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
  }) || { ok:true };
  if (!pre.ok) return false;

  // 前日に☆を置く（連鎖で当日に★が付く）
  if (tryPlace(prevIdx, r, '☆')){
    const dsToday = dateStr(State.windowDates[dayIdx]);
    return getAssign(r, dsToday) === '★';
  }
  return false;
}

// 日勤（〇）を最低10にする
function fillDayShift(dayIdx){
  const ds = dateStr(State.windowDates[dayIdx]);
  // 〇を置ける候補（two/three/day かつ空き・希望休なし）※ロックは除外
  const cand = [];
  for(let r=0; r<State.employeeCount; r++){
    if (getAssign(r, ds)) continue;
    if (isRestByDate(r, ds)) continue;
    if (isLocked(r, ds)) continue;
    const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
    const ok = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
    if (ok.ok) cand.push(r);
  }

  // ★追加：土日祈日の場合、直近4週間の土日祈日勤務が少ない人を優先
  const dt = State.windowDates[dayIdx];
  const isWH = isWeekendOrHoliday(dt);
  if (isWH){
    const startIdx = State.range4wStart;
    const endIdx = State.range4wStart + 27;
    const whCount = (r)=>{
      let c=0;
      for(let i=startIdx; i<=endIdx && i<State.windowDates.length; i++){
        const dt2 = State.windowDates[i];
        if (!isWeekendOrHoliday(dt2)) continue;
        const ds2 = dateStr(dt2);
        const mk2 = getAssign(r, ds2);
        if (mk2==='〇' || mk2==='☆' || mk2==='★' || mk2==='◆' || mk2==='●') c++;
      }
      return c;
    };
    // 勤務回数が少ない順にソート
    cand.sort((a, b) => whCount(a) - whCount(b));
  }
  return (need)=>{
    let placed=0;

    for(const r of cand){
      if (placed>=need) break;
      if (tryPlace(dayIdx, r, '〇')) placed++;
    }
    return placed;
  };
}

  // 追加：4週間の休日数（休＋未割り当）を8日に近づける（「〇」を増やすのみ）
  function normalizeOffToEight(startDayIdx, endDayIdx){
    // 各職員について、境界補正後の必要休日日数を上回る分だけ『〇』で縮減
    for(let r=0; r<State.employeeCount; r++){
      // 休＋未割り当のカウント
      let off=0;
      const blanks = []; // 候補：空白セル（日付インデックス）
      for(let d=startDayIdx; d<=endDayIdx; d++){
        const ds = dateStr(State.windowDates[d]);
        const mk = getAssign(r, ds);
        const hasLv = !!getLeaveType(r, ds);
        if (hasOffByDate(r, ds)){
          off++; // 希望休は休日
        } else if (!mk && !hasLv){
          off++; blanks.push(d); // 未割当のみ（特別休暇は勤務扱いとして除外）
        }
      }

      // 〈追加〉この4週に必要な休日日数（★始まり/☆終わり 補正）
      const needOff = (function(){
        const sDt = State.windowDates[startDayIdx];
        const eDt = State.windowDates[endDayIdx];
        return requiredOffFor28(r, sDt, eDt);
      })();

      if (off > needOff){
        let need = off - needOff; // これだけ『〇』で埋めれば要件に到達
        for(const d of blanks){

          if (need<=0) break;

          // ★追加：土日祝の上限（〇≤6）を厳守
          const dt = State.windowDates[d];
          if (isWeekendOrHoliday(dt)) {
            const { day } = countDayStats(d);
            const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
              ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
            if (day >= capWkHol) continue;   // 目標値までに限定
          }


          // 置けるか事前チェック（勤務形態・同日組合せ）
          const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
          const ok1 = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
          if (!ok1.ok) continue;
          // 希望休はすでに除外済み。precheckPlaceで日内制約を確認してから割当
          const pre = window.AssignRules?.precheckPlace?.({
            rowIndex:r, dayIndex:d, mark:'〇',
            dates:State.windowDates, employeeCount:State.employeeCount,
            getAssign, hasOffByDate:(i,ds)=>hasOffByDate(i, ds)
          }) || { ok:true };
          if (!pre.ok) continue;
          if (tryPlace(d, r, '〇')){
            need--;
          }
        }
        // 希望休が多すぎる等でneed>0が残る場合はここでは触れず、保存時検証に任せる
      }
    }
  }


function isWeekendOrHoliday(dt){
  if (window.HolidayRules && typeof window.HolidayRules.minDayFor === 'function'){
    // minDayFor が 5 なら祝日/週末扱い
    const md = window.HolidayRules.minDayFor(dt, (ds)=> State.holidaySet.has(ds));
    return md === 5;
  }
  const w = dt.getDay();
  const ds = dateStr(dt);
  return (w===0 || w===6) || State.holidaySet.has(ds);
}
// 追加：表示中31日ウィンドウの年をまとめて取得→祝日APIから取り込み
function targetDayForIndex(dayIdx){
  const dt = State.windowDates[dayIdx];
  if (window.Counts && typeof window.Counts.getDayTarget === 'function'){
    return window.Counts.getDayTarget(dt, (ds)=> State.holidaySet.has(ds));
  }
  return isWeekendOrHoliday(dt) ? 6 : 10;
}




// 追加：固定に合わせて『〇』を削減（Aが唯一のAなら残す）
function reduceDayShiftTo(dayIdx, target){
  const ds = dateStr(State.windowDates[dayIdx]);
  // 現在『〇』の従業員を列挙（非A→Aの順で削る）
  const dayRows = [];
  let hasA = false;
  for(let r=0;r<State.employeeCount;r++){
    if (getAssign(r, ds) === '〇'){
      const isA = (State.employeesAttr[r]?.level) === 'A';
      dayRows.push({ r, isA });
      if (isA) hasA = true;
    }
  }
  let day = dayRows.length;
  const nonA = dayRows.filter(x=>!x.isA).map(x=>x.r);
  const onlyA = dayRows.filter(x=>x.isA).map(x=>x.r);

  for(const r of nonA){
    if (day <= target) break;
    clearAssign(r, ds);
    day--;
  }
  // Aが居る日は最低1人のAを維持
  for(const r of onlyA){
    if (day <= target) break;
    if (hasA && onlyA.length === 1) break; // 最後のAは残す
    clearAssign(r, ds);
    day--;
  }
  if (typeof updateFooterCounts==='function') updateFooterCounts();
}



// 祝日APIから現在の31日ウィンドウの年をまとめて取得して反映
async function autoLoadJapanHolidays(){
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
    renderGrid(); // ヘッダ・セルに祝日表示（赤帯）が反映される
    showToast(`祝日を反映しました：${count}日`);
  }catch(e){
    console.error(e);
    showToast('祝日の取得に失敗しました（ネットワークやCORSをご確認ください）');
  }
}

// === 追加：4週間の夜勤ノルマ（勤務形態別）充足判定 ===
function nightQuotasOK(startIdx, endIdx){
  return (window.NightBand && NightBand.nightQuotasOK)
    ? NightBand.nightQuotasOK(nbCtx(), startIdx, endIdx)
    : true;
}

function autoAssignRange(startDayIdx, endDayIdx){
  // フェーズ1：夜勤帯（☆/◆/★/●）を最優先で充足
  //             → 3回までスイープしてNF=3 / NS=3を満たす（A不足帯はA優先）
  for (let sweep=0; sweep<3; sweep++){
    let changed = false;
    for(let d=startDayIdx; d<=endDayIdx; d++){
      let { nf, ns, hasANf, hasANs } = countDayStats(d);

      const FIXED_NF = (window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3;
      const FIXED_NS = (window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3;

      if (nf < FIXED_NF){
        const before = nf;
        fillWith(d, FIXED_NF - nf, ['☆','◆'], !hasANf);
        nf = countDayStats(d).nf;
        if (nf !== before) changed = true;
      }

        if (ns < FIXED_NS){
        const before = ns;
        fillWith(d, FIXED_NS - ns, ['★','●'], !hasANs);// ☆→★の連鎖も活用
        ns = countDayStats(d).ns;
        if (ns !== before) changed = true;
      }
    }
    if (!changed) break;
  }

  // 夜勤ノルマがまだ不足している場合、夜勤のみを再度押し込む（A強優先）
  if (!nightQuotasOK(startDayIdx, endDayIdx)){
    for(let d=startDayIdx; d<=endDayIdx; d++){
      let { nf, ns } = countDayStats(d);
      const FIXED_NF = (window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3;
      const FIXED_NS = (window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3;
      if (nf < FIXED_NF) fillWith(d, FIXED_NF - nf, ['☆','◆'], true);
      if (ns < FIXED_NS) fillWith(d, FIXED_NS - ns, ['★','●'], true);
    }
  }
  // ★新規：夜勤専従ごとに☆が10件に到達するまで増やす最終パス
  (function ensureNightToTen(){

  // 置ける日を“前日空き＆翌日空き”で走査し、tryPlaceで☆→★を連鎖付与
  for (let r = 0; r < State.employeeCount; r++){
    if ((State.employeesAttr[r]?.workType) !== 'night') continue;
    // 現在の☆件数
    const now = countLast28Days(r, State.windowDates[State.range4wStart+27]).star;
    // ★修正：個別の夜勤ノルマを参照（未設定なら10）
    const quota = State.employeesAttr[r]?.nightQuota || 10;
    let need = Math.max(0, quota - now);
    if (need === 0) continue;

    // 左から右へスイープし、ペアが成立するところにだけ追加
    for (let d = startDayIdx; d <= endDayIdx - 1 && need > 0; d++){
      const ds = dateStr(State.windowDates[d]);
      const dsNext = dateStr(State.windowDates[d+1]);
      if (getAssign(r, ds) || getAssign(r, dsNext)) continue;
      if (isRestByDate(r, ds) || isRestByDate(r, dsNext)) continue;
      if (tryPlace(d, r, '☆')) need--;
    }
  }
})();

  // ★追加：NF/NSにA最低1人を強制するポストパス（帯が充足済みでも実施）
  (function enforceANightBands(){
    for (let d = startDayIdx; d <= endDayIdx; d++){
      let { hasANf, hasANs } = countDayStats(d);
      if (hasANf && hasANs) continue;
      const ds = dateStr(State.windowDates[d]);
      const prevDs = (d > 0) ? dateStr(State.windowDates[d-1]) : null;
      const nextDs = (d+1 < State.windowDates.length) ? dateStr(State.windowDates[d+1]) : null;
      const getLv = (i)=> (State.employeesAttr[i]?.level) || 'B';

      const nonArows = (marks)=>{
        const rows = [];
        for (let r = 0; r < State.employeeCount; r++){
          const mk = getAssign(r, ds);
          if (!mk) continue;
          if (marks.includes(mk) && getLv(r) !== 'A'){
            if (!isLocked(r, ds)) rows.push(r);
          }
        }
        return rows;
      };

      const findAFor = (mark)=>{
        const cand = candidatesFor(d, mark).filter(r => getLv(r) === 'A');
        for (const r of cand){
          if (tryPlace(d, r, mark)) return r;
          if (mark === '★' && placePrevStar(d, r)) return r;
        }
        return null;
      };

      // NF（☆/◆）にAがいない → ◆優先、無理なら☆（翌日の★も同期）
      if (!hasANf){
        let placed = false;
        for (const r of nonArows(['◆'])){
          const keep = '◆';
          clearAssign(r, ds);
          const rA = findAFor('◆');
          if (rA !== null){ placed = true; break; }
          setAssign(r, ds, keep);
        }
        if (!placed){
          for (const r of nonArows(['☆'])){
            if (nextDs && isLocked(r, nextDs)) continue;
            const hadNext = nextDs && getAssign(r, nextDs) === '★';
            clearAssign(r, ds);
            if (hadNext) clearAssign(r, nextDs);
            const rA = findAFor('☆');
            if (rA !== null){ placed = true; break; }
            setAssign(r, ds, '☆');
            if (hadNext) setAssign(r, nextDs, '★');
          }
        }
      }

      // NS（★/●）にAがいない → ●優先、無理なら★を空けてA優先で投入
      ({ hasANf, hasANs } = countDayStats(d));
      if (!hasANs){
        let placed2 = false;
        for (const r of nonArows(['●'])){
          const keep = '●';
          clearAssign(r, ds);
          const rA = findAFor('●');
          if (rA !== null){ placed2 = true; break; }
          setAssign(r, ds, keep);
        }
        if (!placed2){
          for (const r of nonArows(['★'])){
            if (isLocked(r, ds)) continue;
            const hadPrev = prevDs && getAssign(r, prevDs) === '☆';
            if (hadPrev && isLocked(r, prevDs)) continue;
            clearAssign(r, ds);
            if (hadPrev) clearAssign(r, prevDs);
            fillWith(d, 1, ['★'], true); // A優先（必要なら前日の☆を自動補完）
            const after = countDayStats(d);
            if (after.hasANs){ placed2 = true; break; }
            setAssign(r, ds, '★');
            if (hadPrev) setAssign(r, prevDs, '☆');
          }
        }
      }
    }
  })();

  // フェーズ2：『〇』のターゲット（固定があれば最優先）を満たす
  for(let d=startDayIdx; d<=endDayIdx; d++){
    let { day, hasADay } = countDayStats(d);

    const target = targetDayForIndex(d); // 追加：固定≡n / それ以外 5 or 10

    if (!hasADay){
      // まずAの〇を1つ確保（可能なら）
      fillWith(d, 1, ['〇'], true);
      ({ day, hasADay } = countDayStats(d));
    }
    if (day < target){
      const pushDay = fillDayShift(d);
      pushDay(target - day);
      ({ day } = countDayStats(d));
    }

    // 追加：土日祝は『〇』の上限≦設定目標に丸める（過剰分を削減）
    const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
      ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
    if (isWeekendOrHoliday(State.windowDates[d]) && day > capWkHol){
      reduceDayShiftTo(d, capWkHol);
    }
  }





  // フェーズ3：4週間の休日（休＋未割当）を8日に収束（希望休は尊重）
  if (typeof normalizeOffToEight === 'function'){
    normalizeOffToEight(startDayIdx, endDayIdx);
  }

  // ★フェーズ3b：連休（2日以上）を月2回以上に整形（〇→休へ、他職員の〇で補填）
  if (typeof ensureRenkyuMin2 === 'function'){
    ensureRenkyuMin2(startDayIdx, endDayIdx);
  }
}


// ★新規：連休（2日以上）を各職員で月2回以上に整形（〇→休に変換し、他職員の〇で補填）
function ensureRenkyuMin2(startDayIdx, endDayIdx){
  const isOffAt = (r, idx)=>{
    const ds = dateStr(State.windowDates[idx]);
    const mk = getAssign(r, ds);
    return hasOffByDate(r, ds) || !mk;
  };
  const countBlocks = (r)=>{
    const blocks = [];
    let i = startDayIdx;
    while (i <= endDayIdx){
      if (!isOffAt(r, i)) { i++; continue; }
      let s = i, len = 0;
      while (i <= endDayIdx && isOffAt(r, i)) { len++; i++; }
      if (len >= 2) blocks.push([s, i-1]);
    }
    return blocks;
  };
  const clearAndBackfill = (r, dayIdx)=>{
    const ds = dateStr(State.windowDates[dayIdx]);
    if (getAssign(r, ds) !== '〇') return false;
    if (isLocked(r, ds)) return false; // 保護セルは変更しない
    // その職員の「〇」を休化（未割当にする）
    clearAssign(r, ds);


    // 日勤下限とAカバーを維持
    let { day, hasADay } = countDayStats(dayIdx);
    const minDay = isWeekendOrHoliday(State.windowDates[dayIdx]) ? 5 : 10;
    if (day < minDay || !hasADay){
      const need = Math.max(1, minDay - day);
      // AがいなければA優先で補填
      fillWith(dayIdx, need, ['〇'], !hasADay);
      ({ day, hasADay } = countDayStats(dayIdx));
      if (day < minDay || !hasADay){
        // 補填失敗 → 元に戻す
        setAssign(r, ds, '〇');
        return false;
      }
    }
    return true;
  };
  const tryExpandSingle = (r)=>{
    let i = startDayIdx;
    while (i <= endDayIdx){
      if (!isOffAt(r, i)) { i++; continue; }
      let s = i, len = 0;
      while (i <= endDayIdx && isOffAt(r, i)) { len++; i++; }
      if (len === 1){
        const left = s - 1, right = s + 1;
        const order = [];
        if (left  >= startDayIdx) order.push(left);
        if (right <= endDayIdx)   order.push(right);
        for (const d of order){
          const ds = dateStr(State.windowDates[d]);
          if (getAssign(r, ds) === '〇'){
            if (clearAndBackfill(r, d)) return true;
          }
        }
      }
    }
    return false;
  };
  const tryMakeFromDoubleDay = (r)=>{
    for (let d = startDayIdx; d < endDayIdx; d++){
      const ds1 = dateStr(State.windowDates[d]);
      const ds2 = dateStr(State.windowDates[d+1]);
      if (isOffAt(r, d) || isOffAt(r, d+1)) continue;
      if (getAssign(r, ds1) === '〇' && getAssign(r, ds2) === '〇'){
        if (clearAndBackfill(r, d) && clearAndBackfill(r, d+1)) return true;
        // 2日目で失敗した場合は1日目を戻す
        if (!isOffAt(r, d)) setAssign(r, ds1, '〇');
      }
    }
    return false;
  };

  for (let r = 0; r < State.employeeCount; r++){
    let attempts = 0;
    while (countBlocks(r).length < 2 && attempts < 50){
      if (tryExpandSingle(r))         { attempts++; continue; }
      if (tryMakeFromDoubleDay(r))    { attempts++; continue; }
      break; // これ以上拡充できない
    }
  }
}

// === ここから挿入：祝日「祝」/ 代休「代」の自動付与 ===
function applyHolidayLeaveFlags(startDayIdx, endDayIdx){
  for (let d = startDayIdx; d <= endDayIdx; d++){
    const dt = State.windowDates[d];
    const ds = dateStr(dt);
    if (!State.holidaySet.has(ds)) continue; // 祝日のみ対象

    for (let r = 0; r < State.employeeCount; r++){
      const wt = (State.employeesAttr[r]?.workType) || 'three';
      if (wt === 'night') continue;           // 夜勤専従は「祝」「代」を付与しない
      if (getLeaveType(r, ds)) continue;      // 既存の特別休暇は尊重
      const mk  = getAssign(r, ds);
      const off = hasOffByDate(r, ds);

      if (!mk){
        // 「祝」は土日は付与しない（たとえその日が祝日でも土日ならスキップ）
        const w = dt.getDay();
        if (w !== 0 && w !== 6){
          setLeaveType(r, ds, '祝');
        }
      } else {
        // 祝日勤務（ただし土日祝日の場合は代休なし：振替休日が月曜に来る前提）
        const w = dt.getDay();
        if (w === 0 || w === 6){
          continue; // 土日祝日の勤務でも「代」は付与しない
        }
        // 平日の祝日勤務のみ → 最寄りの非祝日に『代』
        const subIdx = findSubstituteDayFor(r, d, startDayIdx, endDayIdx);
        if (subIdx != null){
          const sds = dateStr(State.windowDates[subIdx]);
          if (!getLeaveType(r, sds)) setLeaveType(r, sds, '代');
        }
      }
    }
  }

  // 追加：前4週間で未振り分けの『代』を、今回の4週間に後追い付与（祝日勤務→8週間以内）
  applyBackfillSubstituteFromPastHolidays(startDayIdx, endDayIdx);
}
/**
 * 前の4週間に発生した「平日の祝日勤務」で、祝日勤務日から8週間以内に『代』が未付与の分を、
 * 今回の4週間（startDayIdx..endDayIdx）に後追いで振り分ける。
 * - 付与先は「非祝日」かつ「未割当」かつ「希望休・他の特別休暇なし」の最も早い日
 * - 8週間（56日）を超える場合は付与しない
 */
function applyBackfillSubstituteFromPastHolidays(startDayIdx, endDayIdx){
  const startDate = State.windowDates[startDayIdx];
  const endDate   = State.windowDates[endDayIdx];
  const fromDate  = addDays(startDate, -28); // 前の4週間のみ探索

  const store = readDatesStore();
  const holMap = (store && store.holidays) || {};

  // ウィンドウ判定と、祝日フラグの全期間参照
  function isHolidayDsGlobal(ds){
    return _inWindow(ds) ? State.holidaySet.has(ds) : !!holMap[ds];
  }

  for (let r = 0; r < State.employeeCount; r++){
    for (let dt = new Date(fromDate); dt < startDate; dt = addDays(dt, 1)){
      const ds = dateStr(dt);
      if (!isHolidayDsGlobal(ds)) continue;

      // 土日祝（週末）の祝日は『代』付与対象外（従来仕様に合わせる）
      const w = dt.getDay();
      if (w === 0 || w === 6) continue;

      // 「祝日勤務」＝ その日に何かしらの勤務マークがある
      const mk = globalGetAssign(r, ds);
      if (!mk) continue;

      // 既に祝日勤務から56日以内に『代』が1つでもあればスキップ
      const leaveObj = (store.leave && store.leave[r]) || {};
      let hasSub = false;
      for (let i = 1; i <= 56; i++){
        const ds2 = dateStr(addDays(dt, i));
        if (leaveObj[ds2] === '代'){ hasSub = true; break; }
      }
      if (hasSub) continue;

      // 後追い付与先：今回の4週間の範囲かつ、祝日勤務日から56日以内の最も早い非祝日・未割当・休でない日
      const deadline = addDays(dt, 56);
      for (let d = startDayIdx; d <= endDayIdx; d++){
        const cur = State.windowDates[d];
        if (cur > deadline) break;

        const sds = dateStr(cur);
        if (isHolidayDsGlobal(sds)) continue;       // 非祝日
        if (hasOffByDate(r, sds)) continue;         // 希望休を尊重
        if (getLeaveType(r, sds)) continue;         // 既存の特別休暇を尊重
        if (getAssign(r, sds)) continue;            // 未割当に限定

        // 夜勤専従は setLeaveType 側で拒否される（従来仕様を踏襲）
        const ok = setLeaveType(r, sds, '代');
        if (ok) break; // 1件付与したら次の祝日勤務へ
      }
    }
  }
}



function findSubstituteDayFor(r, holidayDayIdx, startDayIdx, endDayIdx){
  const ok = (idx)=>{
    const ds = dateStr(State.windowDates[idx]);
    if (State.holidaySet.has(ds)) return false; // 代休は非祝日に限定
    if (hasOffByDate(r, ds)) return false;      // 希望休は尊重
    if (getLeaveType(r, ds)) return false;      // 既存の特別休暇は尊重
    if (getAssign(r, ds))    return false;      // 未割当のみ対象
    return true;
  };
  for (let i = holidayDayIdx + 1; i <= endDayIdx; i++){ if (ok(i)) return i; }
  for (let i = holidayDayIdx - 1; i >= startDayIdx; i--){ if (ok(i)) return i; }
  return null;
}
// === ここまで挿入 ===

// 土日祝判定（HolidayRules を優先使用）
    if (btnSave) btnSave.addEventListener('click', ()=>{

      if (window.AssignRules && typeof window.AssignRules.validateWindow === 'function'){
        const res = window.AssignRules.validateWindow({
          dates: State.windowDates,

          employeeCount: State.employeeCount,
          getAssign: getAssign,
          isHoliday: (ds)=> State.holidaySet.has(ds),
          getLevel:  (r)=> (State.employeesAttr[r]?.level)||'B',
          hasOffByDate: (r, ds)=> hasOffByDate(r, ds),
          getWorkType: (r)=> (State.employeesAttr[r]?.workType) || 'three',
          // 固定機能廃止：常に未指定（null）
          getFixedDayCount: (_ds)=> null
        });


        if (!res.ok){
          const e = res.errors[0];
          const dt = State.windowDates[e.dayIndex];
          const md = (dt.getMonth()+1)+'/'+dt.getDate();
          const label =
  e.type==='NF'                 ? '（☆＋◆）' :
  e.type==='NS'                 ? '（★＋●）' :
  e.type==='DAY_MIN'            ? '〇' :
  e.type==='DAY_WKD_ALLOWED'    ? '〇（土日祝の許容数）' :
  e.type==='DAY_EQ'             ? '〇（固定）' :
  e.type==='A_DAY'              ? '〇のA' :
  e.type==='A_NF'               ? '（☆＋◆）のA' :
  e.type==='A_NS'               ? '（★＋●）のA' :
  e.type==='WT_DAY_ONLY'        ? '日勤専従の勤務形態違反' :
  e.type==='WT_NIGHT_ONLY'      ? '夜勤専従の勤務形態違反' :
  e.type==='DAY_STREAK_GT5'     ? '〇連続' :
  e.type==='DAY_REST_AFTER5'    ? '「〇×5」の直後休' :
  e.type==='SEQ_NF_DAY'         ? '「◆→〇」禁止' :
  e.type==='SEQ_NF_NS'          ? '「◆→●」禁止' :
  e.type==='SEQ_NS_NF_MAX2'     ? '「●→◆」上限' :
  e.type==='SEQ_NS_NF_GAP'      ? '「●→◆」間隔' :
  e.type==='PAIR_GAP_GE3'       ? '「☆★」間隔' :
  e.type==='SEQ_STAR_AFTER_REST2'? '「☆★」後の休休' :   // ★追加
  e.type==='OFF_SINGLE_STREAK_GT2' ? '単一休み連続' :
  e.type==='WORK_STREAK_GT5'    ? '休間隔（6連勤禁止）' :
  e.type==='RENKYU_GAP_LEQ13'   ? '連休間の間隔' :
  e.type==='RENKYU_MIN2'        ? '連休（2日以上）回数' :
  e.type==='BAND_AC_NIGHT'      ? `夜勤帯A+C+夜専の同席${e.band==='NS'?'（NS）':'（NF）'}` :
                                  '〇';

          const expect =
            e.type==='DAY_MIN' ? String(e.expected) :
            (e.expected ?? '');
          showToast(`${md} の ${label} が未充足：${e.actual}${expect?` / ${expect}`:''}`);
          return; // 保存中止
        }
      }

      // ===== 追加ルール：4週間の休日（休＋未割り当）＝ 境界補正後の必要日数以上 =====
      {
        const start = State.range4wStart;
        const end   = State.range4wStart + 27; // 28日間
        for (let r = 0; r < State.employeeCount; r++){
          let off = 0;
          for (let d = start; d <= end; d++){
            const ds = dateStr(State.windowDates[d]);
            const mk = getAssign(r, ds);
            const hasLv = !!getLeaveType(r, ds);
            if ((hasOffByDate(r, ds) || !mk) && !hasLv) off++; // 特別休暇は休日に含めない
          }
          const needOff = (function(){
            const sDt = State.windowDates[start];
            const eDt = State.windowDates[end];
            return requiredOffFor28(r, sDt, eDt);
          })();

          if (off < needOff){
            const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
            showToast(`${name} の4週間の休日が不足：${off}/${needOff}（希望休・未割当ベース。特別休暇は勤務扱い）`);
            return; // 保存中止
          }
        }
      }

// ===== 新ルール：勤務形態ごとの夜勤数チェック =====
{
  const start = State.range4wStart;
  const end   = State.range4wStart + 27; // 28日間
  for (let r = 0; r < State.employeeCount; r++){
    const wt = (State.employeesAttr[r]?.workType) || 'three';
    let starCount = 0;  // ☆の数（＝☆★ペア数）
    let half = 0;       // ◆＋●カウント
    for (let d = start; d <= end; d++){
      const ds = dateStr(State.windowDates[d]);
      const mk = getAssign(r, ds);
      if (mk === '☆') starCount++;          // 正しくカウントのみ
      if (mk === '◆' || mk === '●') half++;
    }

    const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
    if (wt === 'night'){
      if (starCount < 8 || starCount > 10){

        showToast(`${name}（夜勤専従）の「☆」が${starCount}件です（許容8〜10）。`);
        return; // 保存中止
      }
    } else if (wt === 'two'){
      if (starCount !== 4){
        showToast(`${name}（二部制）の「☆」は4件必要：${starCount}/4`);
        return; // 保存中止
      }
    } else if (wt === 'three'){
      if (half < 8 || half > 10){
        showToast(`${name}（三部制）の（◆＋●）は8〜10件を許容（原則10件を目指す）：${half}/8〜10`);
        return; // 保存中止
      }
    }
  }
}

// ★新規：どこの4週間をみても成立（過去分を含むローリング28日検証）
{
  const start = State.range4wStart;
  const end   = State.range4wStart + 27;
  const err = validateRollingFourWeeksWithHistory(start, end);
  if (err){ showToast(err); return; } // 保存中止
}

    saveWindow(); 
    showToast('保存しました'); 
   });

    // 指定4週間を、希望休日だけ残して未割当にする（確認ダイアログ＋アンドゥ対応）
    btnCancel.addEventListener('click', ()=>{

      const sIdx = State.range4wStart;
      const eIdx = sIdx + 27;
      const s = State.windowDates[sIdx], e = State.windowDates[eIdx];
      const msg = `開始：${s.getMonth()+1}/${s.getDate()} 〜 終了：${e.getMonth()+1}/${e.getDate()}\n` +
                  `の28日間で、希望休を除き割り当てを未割当に戻します。\n` +
                  `※ ロック済みセルは保持し、「祝」「代」は消去します。よろしいですか？`;
      if (!confirm(msg)) return;

      UndoBuf = makeCancelBackup();

      // ロック尊重 + 祝/代 クリア
      cancelChanges(true, true);
      showToast('指定4週間をクリア：「割当」消去／「祝・代」消去／ロック保持（希望休は維持）');

      if (btnUndo) btnUndo.disabled = false;
    });

    // ★完全キャンセル（全体）
if (btnFullCancelAll) btnFullCancelAll.addEventListener('click', ()=>{
  if (confirm('4週間の割当・希望休・特別休暇・ロックをすべて消去します。よろしいですか？')) {
    completeCancelAll();
  }
});




    // ★追加:Escでセルキャンセルを終了
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && State.fullCancelCellMode){
        State.fullCancelCellMode = false;
        State.mode = 'off';
        // ラジオボタンを希望休に戻す
        const offRadio = modeRadios.find(r => r.value === 'off');
        if (offRadio) offRadio.checked = true;
        showToast('セルキャンセルを終了しました');
      }
    });



    // ★追加：アンドゥ（直前の4週間クリアを1回だけ元に戻す）
    if (btnUndo) btnUndo.addEventListener('click', ()=>{
      const ok = undoCancelRange();
      if (ok) {
        showToast('元に戻しました（必要なら保存してください）');
      }
    });

    btnLogout.addEventListener('click', ()=>{
      // ログアウト時は自動保存
      saveWindow();
      // 追加：保存後にクラウドへも送信
      pushToRemote();

      try{ sessionStorage.removeItem('sched:loggedIn'); }catch(_){}
      try{ sessionStorage.removeItem('sched:userId'); }catch(_){}
      appView.classList.remove('active');
      loginView.classList.add('active');
      loginForm.reset();
      showToast('保存してログアウトしました');
    });


    // 左右ドラッグで日単位スクロール
    dragDayNavigation(gridWrap);

    // モード
    modeRadios.forEach(r=> r.addEventListener('change', ()=>{
      State.mode = modeRadios.find(x=>x.checked).value;
      State.leaveMode = null; // 特別休暇モード解除
      
      // セルキャンセルモードの制御
      if (State.mode === 'cellCancel') {
        State.fullCancelCellMode = true;
        showToast('セルキャンセルモード:対象セルをクリック');
      } else {
        State.fullCancelCellMode = false;
        showToast(State.mode==='off' ? '希望休モード' : '割当モード');
      }
    }));

    // 特別休暇ボタン：押すとモード切替（再押しで解除）
    function bindLeaveBtn(btn, code){
      if (!btn) return;
      btn.addEventListener('click', ()=>{
        State.leaveMode = (State.leaveMode===code ? null : code);
        const label = State.leaveMode ? `${State.leaveMode}モード` : '特別休暇モード解除';
        showToast(label);
      });
    }
    bindLeaveBtn(btnLeaveHoliday, '祝');
    bindLeaveBtn(btnLeaveSub,     '代');
    bindLeaveBtn(btnLeavePaid,    '年');
    bindLeaveBtn(btnLeaveRefresh, 'リ');

    // 従業員編集ダイアログ
if (btnAttrOpen) btnAttrOpen.addEventListener('click', openAttrDialog);
attrSave.addEventListener('click', ()=>{
  readAttrDialogToState();
  saveMetaOnly();   // ← 保存ボタンによりローカル保存
  renderGrid();
  attrDlg.close();
  showToast('従業員属性を保存しました');
});
attrClose.addEventListener('click', ()=> attrDlg.close());
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
    meta.employeesAttr = State.employeesAttr; // ← 追加：属性も保存
    meta.range4wStart  = State.range4wStart;
    writeMeta(meta);
    // 追加：クラウドへ非同期送信（失敗は無視）
    pushToRemote();
  }


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
    State.employeesAttr = meta.employeesAttr.slice();
   } else {
     State.employeesAttr = State.employees.map(()=> ({ level:'B', workType:'three' }));
   }
   // employeeCount は保存値があれば優先、なければ配列長
  State.employeeCount = Number.isInteger(meta.employeeCount) ? meta.employeeCount :              State.employees.length;
  State.range4wStart  = meta.range4wStart ?? State.range4wStart;

  // 従業員数の下限は設けない（削除を正しく反映）

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
    showToast('4週間を完全クリアしました');
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

    // セルキャンセルモードを維持（モードを戻さない）
    showToast('1セルをキャンセルしました（モード継続中）');
  }



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


  // 追加：表示中31日ウィンドウをExcelで開けるCSVとして保存（UTF-8 BOM付き）
  function exportExcelCsv(){
    const rows = [];

    // ヘッダ
    const header = ['従業員'];
    for (let d = 0; d < 31; d++){
      const dt = State.windowDates[d];
      const w  = '日月火水木金土'[dt.getDay()];
      header.push(`${dt.getMonth()+1}/${dt.getDate()}(${w})`);
    }
    rows.push(header);

    // 本体
    for (let r = 0; r < State.employeeCount; r++){
      const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
      const line = [name];
      for (let d = 0; d < 31; d++){
        const ds = dateStr(State.windowDates[d]);
        const cell = hasOffByDate(r, ds) ? '休' : (getAssign(r, ds) || '');
        line.push(cell);
      }
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

    const s = State.windowDates[0];
    const e = State.windowDates[30];
    const fname = `勤務表_${s.getFullYear()}${pad2(s.getMonth()+1)}....getFullYear()}${pad2(e.getMonth()+1)}${pad2(e.getDate())}.csv`;

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
    // 左端：従業員名
    const thName = document.createElement('th');
    thName.className = 'col-emp';
    thName.textContent = '従業員';
    trh.appendChild(thName);

    // 31日ヘッダー
    for(let d=0; d<31; d++){
      const dt = State.windowDates[d];
      const th = document.createElement('th');
      th.dataset.day = String(d);
      const md = `${dt.getMonth()+1}/${dt.getDate()}`;
      const dow = '日月火水木金土'[dt.getDay()];
      th.innerHTML = `${md}<span class="dow">(${dow})</span>`;


      // 週末クラス付与（ヘッダー）
      const w = dt.getDay();
      if (w === 0) th.classList.add('sun');      // 日曜
      else if (w === 6) th.classList.add('sat'); // 土曜
      if(isToday(dt)) th.classList.add('today');
      if(State.holidaySet.has(dateStr(dt))) th.classList.add('holiday');
      th.addEventListener('click', ()=> toggleHoliday(d)); // ← 日付クリックで祝日トグル
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    const tbody = document.createElement('tbody');
    State.employees.forEach((name, r)=>{
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.className = 'col-emp';
      // 属性チップ
      tdName.appendChild(renderNameCell(r, name));
      tr.appendChild(tdName);

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
          // ★セルキャンセルモード優先
          if (State.fullCancelCellMode){
            completeCancelOneCell(r, d, td);
            return;
          }

          // 範囲ロックモードが有効なら先に処理
          if (maybeHandleRangeLock(r, d)) return;

          // 特別休暇モード（祝/代/年/リ）が有効なとき最優先
          if (State.leaveMode) {
            toggleLeave(r, d, td);
            return;
          }


          // 希望休モード
          if (State.mode === 'off') {
            toggleOff(r, d, td);
            return;
          }

          // 割当モード
          cycleAssign(r, d, td);
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

      tbody.appendChild(tr);
    });

    grid.appendChild(thead);
    grid.appendChild(tbody);

    renderFooterCounts();
    paintRange4w();
  }

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


// ---- トグル ----
// 勤務形態別クリックサイクル
function cycleOrderFor(r){
  const wt = (State.employeesAttr[r]?.workType) || 'three';
  switch (wt){
    case 'two':   return ['', '〇', '☆', ''];                // 二部制：空→〇→☆(翌日★)→空
    case 'three': return ['', '〇', '◆', '●', ''];           // 三部制：空→〇→◆→●→空
    case 'day':   return ['', '〇', '☆', '◆', '●', ''];      // 日勤専従でもお試しで全マーク
    case 'night': return ['', '☆', ''];                      // 夜勤専従：空→☆(翌日★)→空
    default:      return ['', '〇', '◆', '●', ''];           // 既定＝三部制相当
  }
}

function nextCycleMark(cur, order){
  const idx = order.indexOf(cur || '');
  return order[(idx + 1) % order.length];
}

// ★追加：手動割り当て専用の軽量連鎖「☆→翌日★」
//  - 希望休は上書きしない
//  - 既に他マークが入っている場合も上書きしない（★は何もしない）
function forceNextDayStar(r, dayIdx){
  const nextIndex = dayIdx + 1;
  if (nextIndex >= State.windowDates.length) return;
  const dsNext = dateStr(State.windowDates[nextIndex]);
  // 希望休には置かない
  if (hasOffByDate(r, dsNext)) return;
  const cur = getAssign(r, dsNext);
  // 既に★なら何もしない／他記号があれば上書きしない
  if (cur === '★' || (cur && cur !== '')) return;

  setAssign(r, dsNext, '★');
  const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
  if (nextCell){
    nextCell.textContent = '';
    const sp = document.createElement('span');
    sp.className = 'mark ' + markToClass('★');
    sp.textContent = '★';
    nextCell.appendChild(sp);
  }

  // ★追加：28日目（4週の最終日）の翌日★は自動ロック
  if (dayIdx === State.range4wStart + 27){
    setLocked(r, dsNext, true);
    const nc = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
    if (nc) nc.classList.add('locked');
  }

  // 合計行を即時更新
  if (typeof updateFooterCounts === 'function') updateFooterCounts();
}

// ★追加：前日に「〇」または“休（希望休/特別休暇）”を置いたら、翌日の「★」をロック状態でも強制消去
function removeNextDayStarIfAny(r, dayIdx){
  const nextIndex = dayIdx + 1;
  if (nextIndex >= State.windowDates.length) return;
  const nds = dateStr(State.windowDates[nextIndex]);
  if (getAssign(r, nds) === '★'){
    clearAssign(r, nds);
    setLocked(r, nds, false); // ロック解除
    const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
    if (nextCell){
      nextCell.classList.remove('locked');
      nextCell.textContent = '';
    }
    if (typeof updateFooterCounts === 'function') updateFooterCounts();
  }
}
function removeNextStarByDs(r, ds){
  const idx = State.windowDates.findIndex(dt => dateStr(dt) === ds);
  if (idx >= 0) removeNextDayStarIfAny(r, idx);
}

function cycleAssign(r, d, td){
  const ds = dateStr(State.windowDates[d]);
  // ★追加：ロックセルは手動でも変更不可

  if (isLocked(r, ds)){ showToast('ロック中のセルは変更できません'); return; }
  const lvHere = getLeaveType(r, ds);
  if (lvHere && lvHere !== '代'){ showToast('特別休暇のため変更不可（祝/年/リ）'); return; }
  if (lvHere === '代'){
    clearLeaveType(r, ds);           // 「代」は固定扱いにしない（上書き許可）
    td.textContent = '';
    td.classList.remove('off');
  }

  // 希望休は上書き不可
  if (hasOffByDate(r, ds)) { 
    if (typeof showToast === 'function') showToast('希望休のため割当不可');
    return; 
  }

  const current = getAssign(r, ds) || '';
  const order = cycleOrderFor(r);                  // ← 勤務形態別サイクル
  const next = nextCycleMark(current, order);
  const wasNightThrough = (current === '☆');       // ☆からの変更かを保持

  // 反映（空→消去）
if (next === '') {
  clearAssign(r, ds);
  td.textContent = '';
  // ☆を外したら翌日の★を“解除つきで”消す（ロックも外す）
  if (wasNightThrough) {
    removeNextDayStarIfAny(r, d);
  }
  updateFooterCounts();
  return;
}


  // 勤務形態チェック（★手動はスキップ）
  if (!IGNORE_RULES_ON_MANUAL && window.AssignRules && typeof window.AssignRules.canAssign === 'function') {
    const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
    const ok1 = window.AssignRules.canAssign({ empAttr, mark: next });
    if (!ok1.ok){ if (typeof showToast==='function') showToast(ok1.message||'勤務形態に合いません'); return; }
  }
  // 日内組合せ・翌日NS過剰チェック（☆の場合の仮★含む）→ ★手動はスキップ
  if (!IGNORE_RULES_ON_MANUAL && window.AssignRules && typeof window.AssignRules.precheckPlace === 'function') {
    const ok2 = window.AssignRules.precheckPlace({
      rowIndex:r, dayIndex:d, mark:next,
      dates:State.windowDates, employeeCount:State.employeeCount,
      getAssign, hasOffByDate:(i,ds2)=>hasOffByDate(i, ds2),
      getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
      getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
    });
    if (!ok2.ok){ if (typeof showToast==='function') showToast(ok2.message||'組合せ上限を超えます'); return; }
  }

  // 当日セル反映
  setAssign(r, ds, next);
  td.textContent = '';
  const span = document.createElement('span');
  span.className = 'mark ' + markToClass(next);
  span.textContent = next;
  td.appendChild(span);
  updateFooterCounts();

  // ★追加：手動時でも「☆の翌日は★」だけは軽量連鎖で反映
  if (next === '☆') {
    forceNextDayStar(r, d);
  }

  // 連鎖ルール適用（☆なら翌日★）→ ★手動はスキップ
  if (!IGNORE_RULES_ON_MANUAL && window.Rules && typeof window.Rules.applyAfterAssign === 'function') {
      const result = window.Rules.applyAfterAssign({
        rowIndex: r,
        dayIndex: d,
        mark: next,
        getAssign, setAssign, clearAssign, hasOffByDate: (i,ds)=>isRestByDate(i, ds),
        // 追加（将来互換）：次日の祝/代を消せるように
        getLeaveType, clearLeaveType,

        gridEl: grid,
        dates: State.windowDates
    });


    if (!result.ok) {
      clearAssign(r, ds);
      td.textContent = '';
      updateFooterCounts(); 
      if (typeof showToast === 'function') showToast(result.message || 'ルール違反です');
      return;
    } else {
      updateFooterCounts();
    }
  }


// ☆を別記号に変更したら翌日の★を“解除つきで”消す（ロックも外す）
if (wasNightThrough && next !== '☆') {
  removeNextDayStarIfAny(r, d);
}

}


  function toggleHoliday(dayIdx){
    const ds = dateStr(State.windowDates[dayIdx]);
    if(State.holidaySet.has(ds)) State.holidaySet.delete(ds);
    else State.holidaySet.add(ds);
    renderGrid();
  }

  function hasOffByDate(empIdx, ds){
    const s = State.offRequests.get(empIdx);
    return s ? s.has(ds) : false;
  }
  // 特別休暇の取得/設定
  function getLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    return m ? m.get(ds) : undefined;
  }
function isWeekendByDs(ds){
  const dt = State.windowDates.find(dt => dateStr(dt) === ds);
  const w  = dt ? dt.getDay() : (new Date(ds)).getDay();
  return w === 0 || w === 6;
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


  function clearLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    if(m){ m.delete(ds); if(m.size===0) State.leaveRequests.delete(empIdx); }
  }

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

  // 希望休セルのトグル：renderGrid 外で一度だけ定義
  function toggleLeave(r, d, td){
    const ds   = dateStr(State.windowDates[d]);
    const code = State.leaveMode; // null | '祝'|'代'|'年'|'リ'
    if (!code && !hasOffByDate(r, ds)) return; // 変更不要

    // モード未選択時は「オフ → クリア」のみ
    if (!code && hasOffByDate(r, ds)) {
      clearLeaveType(r, ds);
      td.textContent = '';
      td.classList.remove('off');
      updateFooterCounts(d);
      showToast('希望休を解除しました');
      return;
    }

    // 通常：指定コードでトグル
    if (hasOffByDate(r, ds)) {
      // 既存オフ → 指定コードで上書き表示だけ更新
      clearLeaveType(r, ds);
    }
const ok = setLeaveType(r, ds, code);
if (!ok) return; // たとえば土日の「祝」はここで終了

// DOMを刷新
td.textContent = '';
td.classList.add('off');
const sp = document.createElement('span');
sp.className = `leave ${leaveClassOf(code)}`;
sp.textContent = code;
td.appendChild(sp);

// ★追加：前日が特別休暇になったら翌日の「★」を強制消去
removeNextDayStarIfAny(r, d);

updateFooterCounts(d);
showToast('希望休を更新しました');


  }



function toggleOff(r,d,td){
  const ds = dateStr(State.windowDates[d]);
  const lvHere = getLeaveType(r, ds);
  if (lvHere && lvHere !== '代'){ showToast('特別休暇のため変更不可（祝/年/リ）'); return; }
  if (lvHere === '代'){
    clearLeaveType(r, ds);           // 「代」は固定扱いにしない（休へ置換可）
    td.textContent = '';
    td.classList.remove('off');
  }
  let s = State.offRequests.get(r);


  if(!s){ s = new Set(); State.offRequests.set(r,s); }

  // 解除は常にOK
  if(s.has(ds)){
    s.delete(ds);
    td.classList.remove('off');
    td.textContent = '';
    updateFooterCounts();
    return;
  }

  // ここから「休」にする前の事前チェック（単一休み3連続を禁止）
  const wouldViolate = (()=>{
    // “その日を休にした”想定で31日窓を評価
    const isOffAt = (idx)=>{
      const dsi = dateStr(State.windowDates[idx]);
      const mk  = getAssign(r, dsi);
      const off = (hasOffByDate(r, dsi) || dsi === ds); // 当日を強制的に休とみなす
      return off || !mk;
    };
    let consecSingles = 0;
    let i = 0;
    while (i < State.windowDates.length){
      if (!isOffAt(i)) { i++; continue; }
      let len = 0;
      while (i < State.windowDates.length && isOffAt(i)) { len++; i++; }
      if (len === 1){
        consecSingles++;
        if (consecSingles > 2) return true;
      } else {
        consecSingles = 0;
      }
    }
    return false;
  })();
  if (wouldViolate){
    if (typeof showToast==='function'){
      showToast('単一休みは連続2回までです（例：〇〇休〇休〇〇休〇→NG）');
    }
    return; // 状態は変更しない
  }

  // 事前検査クリア → 実際に「休」を反映
  s.add(ds);
  td.classList.add('off');
  td.textContent = '休';
  clearAssign(r, ds); // 希望休にしたら割当は消す

  // ★追加：前日休→翌日の「★」を強制消去（ロック含む）
  removeNextDayStarIfAny(r, d);

  updateFooterCounts();
}



  function getAssign(r, ds){
    const m = State.assignments.get(r);
    return m ? m.get(ds) : undefined;
  }
function setAssign(r, ds, mk){
  let m = State.assignments.get(r);
  if(!m){ m = new Map(); State.assignments.set(r,m); }
  if(mk) m.set(ds, mk);

  // ★追加：当日が「〇」になったら、翌日の「★」（ロック含む）を強制消去
  if (mk === '〇') removeNextStarByDs(r, ds);
}

  function clearAssign(r, ds){
    const m = State.assignments.get(r);
    if(m){ m.delete(ds); if(m.size===0) State.assignments.delete(r); }
  }

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

    el.addEventListener('pointerdown', (e)=>{
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true;
      sx = e.clientX;
      moved = false;
      downTarget = e.target;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e)=>{
      if (!down) return;
      if (Math.abs(e.clientX - sx) > 6) moved = true;
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

      const dx = e.clientX - sx;
      const firstTh = grid.querySelector('thead th[data-day="0"]');
      const cellW = firstTh ? firstTh.getBoundingClientRect().width : 56;
      const days = -Math.round(dx / (cellW * 0.7));
      if (days !== 0) shiftDays(days);

      down = false;
      downTarget = null;
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
    row.appendChild(quotaWrap); // ★追加
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
    const quotaInput = row.querySelector('.quota-input'); // ★追加
    const nm = (nameInput?.value || '').trim();
    State.employees[i] = nm || `職員${pad2(i+1)}`;
    // ★修正：夜勤ノルマを追加
    const nightQuota = quotaInput ? parseInt(quotaInput.value, 10) : undefined;
    State.employeesAttr[i] = { 
      level: selLv.value, 
      workType: selWt.value,
      nightQuota: (selWt.value === 'night' && Number.isInteger(nightQuota)) ? nightQuota : undefined
    };
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


// ---- 起動 ----
// （ログイン開始は auth.js 側で行う）

// PWA: Service Worker（Project Pages配下にも確実に効かせる）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.error('SW register failed:', err);
    });
  });
}

// PWA: Install（beforeinstallprompt）
let _deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'inline-flex';
});
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    installBtn.style.display = 'none';
    console.log('PWA install:', outcome);
  });
}

// ネット状態を表示（既存のクラウド状態と連動）
window.addEventListener('online',  () => { if (window.GAS) GAS.setCloudStatus('ok'); });
window.addEventListener('offline', () => { if (window.GAS) GAS.setCloudStatus('offline'); });

})();

