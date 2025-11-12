// storage.js
// ストレージ関連機能（localStorage & クラウド同期）

/**
 * ストレージモジュール
 * app.jsから抽出したローカルストレージとクラウド同期の管理機能を提供
 */
;(function(global) {

// ===== localStorage & クラウド同期の管理 =====

/**
 * ユーザー別のストレージキーを生成
 * @param {string} k - キー名
 * @returns {string} ユーザーIDを含むストレージキー
 */
function storageKey(k){
  const uid = sessionStorage.getItem('sched:userId') || 'user';
  return `sched:${uid}:${k}`;
}

/**
 * クラウド同期用のキー群を取得
 * @returns {string[]} クラウドキーの配列
 */
function cloudKeys(){
  const keys = [];
  const main = sessionStorage.getItem('sched:cloudKey');
  const sha  = sessionStorage.getItem('sched:cloudKeySha');
  const b64  = sessionStorage.getItem('sched:cloudKeyCompat');
  [main, sha, b64].forEach(v => { if (v && !keys.includes(v)) keys.push(v); });
  return keys;
}

/**
 * メタデータを読み込み
 * @returns {Object} メタデータオブジェクト
 */
function readMeta(){
  try{ return JSON.parse(localStorage.getItem(storageKey('meta'))||'{}'); }catch{ return {}; }
}

/**
 * メタデータを保存
 * @param {Object} meta - メタデータオブジェクト
 */
function writeMeta(meta){
  localStorage.setItem(storageKey('meta'), JSON.stringify(meta));
}

/**
 * 日付ストアを読み込み
 * @returns {Object} 日付ストアオブジェクト
 */
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

/**
 * 日付ストアを保存
 * @param {Object} store - 日付ストアオブジェクト
 */
function writeDatesStore(store){
  localStorage.setItem(storageKey('dates'), JSON.stringify(store));

  // 追加：クラウドへ非同期送信（失敗は無視）
  pushToRemote();
}

// ===== クラウド接続層 =====

/**
 * クラウドからデータを取得
 * @param {string} k - キー名
 * @returns {Promise<any>} 取得したデータ
 */
async function remoteGet(k){ 
  return (window.GAS ? GAS.get(k) : null); 
}

/**
 * クラウドへデータを送信
 * @param {string} k - キー名
 * @param {any} data - 送信するデータ
 * @returns {Promise<any>} 送信結果
 */
async function remotePut(k, data){ 
  return (window.GAS ? GAS.put(k, data) : null); 
}

/**
 * クラウド→ローカル同期
 * ログイン直後にクラウドから最新データを取り込む
 */
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

/**
 * ローカル→クラウド送信
 * 保存のたびにクラウドへ送信（失敗は無視）
 */
async function pushToRemote(){
  const keys = cloudKeys(); if(!keys.length) return;
  try{
    const meta  = readMeta();
    const dates = readDatesStore();
    for (const ck of keys){
      await remotePut(`${ck}:meta`,  meta);
      await remotePut(`${ck}:dates`, dates);
    }
  }catch(_){}
}

// ===== ローカルストレージのメモリキャッシュ =====

let _winDateSet = null;
let _storeCache = null;

/**
 * ウィンドウ日付セットを初期化
 * @param {Date[]} windowDates - ウィンドウ内の日付配列
 * @param {Function} dateStr - 日付を文字列に変換する関数
 */
function _ensureWinDateSet(windowDates, dateStr){
  _winDateSet = new Set(windowDates.map(dateStr));
}

/**
 * 日付がウィンドウ内にあるか確認
 * @param {string} ds - 日付文字列
 * @returns {boolean} ウィンドウ内の場合true
 */
function _inWindow(ds){ 
  if(!_winDateSet) throw new Error('_winDateSet not initialized'); 
  return _winDateSet.has(ds); 
}

/**
 * ストアキャッシュを取得
 * @returns {Object} 日付ストア
 */
function _store(){ 
  if(!_storeCache) _storeCache = readDatesStore(); 
  return _storeCache; 
}

/**
 * キャッシュをクリア
 */
function clearCache(){
  _winDateSet = null;
  _storeCache = null;
}

// ===== 便利関数 =====

/**
 * ロックキーを生成
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @returns {string} ロックキー
 */
function lockKey(r, ds){ 
  return `${r}|${ds}`; 
}

/**
 * セルがロックされているか確認
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @param {Set} lockedCells - ロック済みセルのSet
 * @returns {boolean} ロックされている場合true
 */
function isLocked(r, ds, lockedCells){ 
  return lockedCells.has(lockKey(r, ds)); 
}

/**
 * セルのロック状態を設定
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @param {boolean} on - ロックする場合true
 * @param {Set} lockedCells - ロック済みセルのSet
 */
function setLocked(r, ds, on, lockedCells){
  const k = lockKey(r, ds);
  if (on) lockedCells.add(k);
  else    lockedCells.delete(k);
}

/**
 * 全期間から割当を取得（ウィンドウ外も含む）
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @param {Function} getAssign - State内の割当取得関数
 * @returns {string|undefined} 割当マーク
 */
function globalGetAssign(r, ds, getAssign){
  if (_inWindow(ds)) return getAssign(r, ds);
  const st = _store();
  let mk = st.assign?.[r]?.[ds];
  if (window.normalizeMark) mk = window.normalizeMark(mk);
  return mk;
}

/**
 * 全期間から希望休を確認（ウィンドウ外も含む）
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @param {Function} hasOffByDate - State内の希望休確認関数
 * @returns {boolean} 希望休がある場合true
 */
function globalHasOffByDate(r, ds, hasOffByDate){
  if (_inWindow(ds)) return hasOffByDate(r, ds);
  const st = _store();
  return !!(st.off?.[r]?.[ds]);
}

/**
 * 全期間から特別休暇を確認（ウィンドウ外も含む）
 * @param {number} r - 行インデックス
 * @param {string} ds - 日付文字列
 * @param {Function} getLeaveType - State内の特別休暇取得関数
 * @returns {boolean} 特別休暇がある場合true
 */
function globalHasLeave(r, ds, getLeaveType){
  if (_inWindow(ds)) return !!getLeaveType(r, ds);
  const st = _store();
  return !!(st.leave?.[r]?.[ds]);
}

// ===== 初期化 =====

/**
 * メタデータのみを保存
 * @param {Object} State - アプリケーションState
 */
function saveMetaOnly(State){
  const meta = readMeta();
  meta.employeeCount = State.employeeCount;
  meta.employees     = State.employees;
  meta.employeesAttr = State.employeesAttr;
  meta.range4wStart  = State.range4wStart;
  writeMeta(meta);
  // 追加：クラウドへ非同期送信（失敗は無視）
  pushToRemote();
}

/**
 * ウィンドウデータを読み込み
 * @param {Object} State - アプリケーションState
 * @param {Date} anchorDate - アンカー日付
 * @param {Function} buildWindowDates - ウィンドウ日付を構築する関数
 * @param {Function} dateStr - 日付を文字列に変換する関数
 * @param {Function} pad2 - 2桁にパディングする関数
 * @param {Function} ensureEmployees - 従業員を確保する関数
 * @param {Function} snapshot - スナップショットを作成する関数
 */
function loadWindow(State, anchorDate, buildWindowDates, dateStr, pad2, ensureEmployees, snapshot){
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
    State.employeeCount = Number.isInteger(meta.employeeCount) ? meta.employeeCount : State.employees.length;
    State.range4wStart  = meta.range4wStart ?? State.range4wStart;

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

  State.lastSaved = snapshot();
}

/**
 * ウィンドウデータを保存
 * @param {Object} State - アプリケーションState
 * @param {Function} dateStr - 日付を文字列に変換する関数
 * @param {Function} hasOffByDate - 希望休確認関数
 * @param {Function} getLeaveType - 特別休暇取得関数
 * @param {Function} getAssign - 割当取得関数
 * @param {Function} snapshot - スナップショットを作成する関数
 */
function saveWindow(State, dateStr, hasOffByDate, getLeaveType, getAssign, snapshot){
  // メタ情報は別途保存
  saveMetaOnly(State);

  // 既存ストアを読み込み（窓外のデータは維持）
  const store = readDatesStore();
  if (!store.holidays) store.holidays = {};
  if (!store.off)      store.off      = {};
  if (!store.assign)   store.assign   = {};
  if (!store.lock)     store.lock     = {};
  if (!store.leave)    store.leave    = {};

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
      if (isLocked(r, ds, State.lockedCells)) lockObj[ds] = 1;
      else                 delete lockObj[ds];

    }
  }

  // 書き戻し＆スナップショット更新
  writeDatesStore(store);
  State.lastSaved = snapshot();
}

// ===== エクスポート =====

// グローバルに公開（app.jsで使用するため）
window.Storage = {
  // localStorage & クラウド同期
  storageKey,
  cloudKeys,
  readMeta,
  writeMeta,
  readDatesStore,
  writeDatesStore,
  remoteGet,
  remotePut,
  syncFromRemote,
  pushToRemote,
  
  // メモリキャッシュ
  _ensureWinDateSet,
  clearCache,
  
  // 便利関数
  lockKey,
  isLocked,
  setLocked,
  globalGetAssign,
  globalHasOffByDate,
  globalHasLeave,
  
  // 初期化
  loadWindow,
  saveWindow,
  saveMetaOnly
};

})(window);
