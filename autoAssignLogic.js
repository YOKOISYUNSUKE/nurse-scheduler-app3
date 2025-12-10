// ====== 自動割り当てアルゴリズム ======
// app.jsから切り出した自動割り当てロジック

(function(){
  'use strict';

  // app.jsのグローバル変数・関数への参照
  let State, grid;
  let dateStr, addDays;
  let getAssign, setAssign, clearAssign;
  let hasOffByDate, getLeaveType, setLeaveType, clearLeaveType;
  let isLocked, setLocked;
  let showToast, updateFooterCounts;
  let isRestByDate;

  // 初期化関数（app.jsから呼ばれる）
  window.AutoAssignLogic = {
    init: function() {
      // グローバル変数・関数の取得
      State = window.State;
      grid = document.getElementById('grid');
      dateStr = window.App?.Dates?.dateStr;
      addDays = window.App?.Dates?.addDays;
      getAssign = window.getAssign;
      setAssign = window.setAssign;
      clearAssign = window.clearAssign;
      hasOffByDate = window.hasOffByDate;
      getLeaveType = window.getLeaveType;
      setLeaveType = window.setLeaveType;
      clearLeaveType = window.clearLeaveType;
      isLocked = window.isLocked;
      setLocked = window.setLocked;
      showToast = window.showToast;
      updateFooterCounts = window.updateFooterCounts;
      isRestByDate = window.isRestByDate;
    },

    // 公開関数
    autoAssignRange: autoAssignRange,
    applyHolidayLeaveFlags: applyHolidayLeaveFlags,
    isWeekendOrHoliday: isWeekendOrHoliday,
    targetDayForIndex: targetDayForIndex
  };

  // === ユーティリティ ===
  function nbCtx(){
    return {
      dates: State.windowDates,
      employeeCount: State.employeeCount,
      range4wStart: State.range4wStart,
      getAssign,
      hasOffByDate: (r, ds)=> hasOffByDate(r, ds),
      getEmpAttr: (r)=> State.employeesAttr[r] || { level:'B', workType:'three' },
      isHolidayDs: (ds)=> State.holidaySet.has(ds)
    };
  }

  function countDayStats(dayIdx){
    if (window.NightBand && window.NightBand.countDayStats){
      return window.NightBand.countDayStats(nbCtx(), dayIdx);
    }
    // フォールバック：自前でカウント（遅も日勤としてカウント）
    const ds = dateStr(State.windowDates[dayIdx]);
    let day = 0, nf = 0, ns = 0;
    let hasADay = false, hasANf = false, hasANs = false;
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      const lvl = (State.employeesAttr[r]?.level) || 'B';
      if (mk === '〇' || mk ==='早' || mk === '遅'){
        day++;
        if (lvl === 'A') hasADay = true;
      }
      if (mk === '☆' || mk === '◆'){
        nf++;
        if (lvl === 'A') hasANf = true;
      }
      if (mk === '★' || mk === '●'){
        ns++;
        if (lvl === 'A') hasANs = true;
      }
    }
    return { day, nf, ns, hasADay, hasANf, hasANs };
  }

  function candidatesFor(dayIdx, mark){
    let out = (window.NightBand && window.NightBand.candidatesFor)
      ? window.NightBand.candidatesFor(nbCtx(), dayIdx, mark)
      : [];

    const ds = dateStr(State.windowDates[dayIdx]);
    out = out.filter(r=>{
      if (isLocked(r, ds)) return false;
      if (mark === '☆'){
        const n = dayIdx + 1;
        if (n >= State.windowDates.length) return false;
        const nds = dateStr(State.windowDates[n]);
        if (isLocked(r, nds)) return false;

        const p = dayIdx - 1;
        if (p >= 0){
          const pds = dateStr(State.windowDates[p]);
          const wt  = (State.employeesAttr[r]?.workType) || 'three';
          if (wt !== 'night' && getAssign(r, pds) === '★') return false;
        }
      }
      return true;
    });

    return out;
  }

  function clearSoftLeaveIfAny(empIdx, ds){
    const lv = getLeaveType(empIdx, ds);
    const isSoftLeave = (code)=> code === '祝' || code === '代';
    if (lv && isSoftLeave(lv)) clearLeaveType(empIdx, ds);
  }

  function tryPlace(dayIdx, r, mark){
    const ds = dateStr(State.windowDates[dayIdx]);
    if (isLocked(r, ds)) return false;
    if (mark === '☆'){
      const n = dayIdx + 1;
      if (n >= State.windowDates.length) return false;
      const nds = dateStr(State.windowDates[n]);
      if (isLocked(r, nds)) return false;
    }


    const pre = window.AssignRules?.precheckPlace?.({
      rowIndex:r, dayIndex:dayIdx, mark,
      dates:State.windowDates, employeeCount:State.employeeCount,
      getAssign, hasOffByDate:(i,ds)=>isRestByDate(i, ds),
      getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
      getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B',
      getForbiddenPairs: (i)=> State.forbiddenPairs.get(i) || new Set() // ★追加
    }) || { ok:true };
    if (!pre.ok) return false;

    clearSoftLeaveIfAny(r, ds);
    setAssign(r, ds, mark);

    if (mark === '☆' && window.Rules?.applyAfterAssign){
      const res = window.Rules.applyAfterAssign({
        rowIndex:r, dayIndex:dayIdx, mark,
        getAssign, setAssign, clearAssign, hasOffByDate,
        getLeaveType, clearLeaveType,
        getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
        gridEl:null, dates:State.windowDates
      });

      if (!res.ok){
        clearAssign(r, ds);
        return false;
      }
    }
    return true;
  }


  // 配列をシャッフルする関数（Fisher-Yatesアルゴリズム）
  // ---- ヘルパー：配列シャッフル ----
  function shuffleArray(arr){
    // 元配列を壊さないようにコピー
    const result = Array.isArray(arr) ? arr.slice() : [];
    // Fisher–Yates 方式でシャッフル
    for (let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  // （このあとで shuffleArray を使って日勤候補や削除候補をシャッフルしています）


  function fillWith(dayIdx, deficit, marks, preferA){
    let placed = 0;
    for (const mark of marks){
      if (deficit <= 0) break;
      let cand = candidatesFor(dayIdx, mark);

      if (mark === '☆' || mark === '◆' || mark === '★' || mark === '●') {
        const ds = dateStr(State.windowDates[dayIdx]);
        const band = (mark === '☆' || mark === '◆') ? 'NF' : 'NS';
        
        // 現在の夜勤専従人数をカウント
        let nightOnlyCount = 0;
        for(let r = 0; r < State.employeeCount; r++){
          const wt = (State.employeesAttr[r]?.workType) || 'three';
          if (wt !== 'night') continue;
          
          const mk = getAssign(r, ds);
          if (band === 'NF' && (mk === '☆' || mk === '◆')) nightOnlyCount++;
          if (band === 'NS' && (mk === '★' || mk === '●')) nightOnlyCount++;
        }
        
        // 既に2名いる場合は夜勤専従を候補から除外
        if (nightOnlyCount >= 2) {
          cand = cand.filter(r => {
            const wt = (State.employeesAttr[r]?.workType) || 'three';
            return wt !== 'night';
          });
        }
      }

      if (mark === '☆' || mark === '★'){
        const night = [], others = [];
        cand.forEach(r => (((State.employeesAttr[r]?.workType)||'three') === 'night' ? night : others).push(r));

        const applyAHead = (arr) => {
          if (!preferA) return arr;
          const a = [], non = [];
          arr.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? a : non).push(r));
          // ★追加：A・非Aそれぞれをシャッフル
          return shuffleArray(a).concat(shuffleArray(non));
        };

        if (preferA){
          const nightA = [], nightNon = [], othersA = [], othersNon = [];
          night.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? nightA : nightNon).push(r));
          others.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? othersA : othersNon).push(r));
          // ★追加：各グループをシャッフル
          cand = shuffleArray(nightA).concat(shuffleArray(othersA), shuffleArray(nightNon), shuffleArray(othersNon));
        } else {
          cand = applyAHead(night).concat(applyAHead(others));
        }
      } else if (preferA){
        const a = [], non = [];
        cand.forEach(r => (((State.employeesAttr[r]?.level)==='A') ? a : non).push(r));
        // ★追加：A・非Aそれぞれをシャッフル
        cand = shuffleArray(a).concat(shuffleArray(non));
      } else {
        // ★追加：preferAがfalseの場合もシャッフル
        cand = shuffleArray(cand);
      }

      for (const r of cand){
        if (deficit <= 0) break;

        if (tryPlace(dayIdx, r, mark)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level)==='A') preferA = false;
          continue;
        }

        if (mark === '★' && placePrevStar(dayIdx, r)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level)==='A') preferA = false;
        }
      }
    }
    return placed;
  }

  function placePrevStar(dayIdx, r){
    const prevIdx = dayIdx - 1;
    if (prevIdx < 0) return false;

    const dsPrev = dateStr(State.windowDates[prevIdx]);
    if (isRestByDate(r, dsPrev)) return false;
    if (isLocked(r, dsPrev)) return false;
    if (getAssign(r, dsPrev)) return false;

    const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
    const ok1 = window.AssignRules?.canAssign?.({ empAttr, mark:'☆' }) || { ok:true };
    if (!ok1.ok) return false;

    const pre = window.AssignRules?.precheckPlace?.({
      rowIndex:r, dayIndex:prevIdx, mark:'☆',
      dates:State.windowDates, employeeCount:State.employeeCount,
      getAssign, hasOffByDate:(i,ds)=>hasOffByDate(i, ds),
      getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
      getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
    }) || { ok:true };
    if (!pre.ok) return false;

    if (tryPlace(prevIdx, r, '☆')){
      const dsToday = dateStr(State.windowDates[dayIdx]);
      return getAssign(r, dsToday) === '★';
    }
    return false;
  }

  function fillDayShift(dayIdx){
    const ds = dateStr(State.windowDates[dayIdx]);
    let cand = [];
    for(let r=0; r<State.employeeCount; r++){
      if (getAssign(r, ds)) continue;
      if (isRestByDate(r, ds)) continue;
      if (isLocked(r, ds)) continue;
      const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
      const ok = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
      if (ok.ok) cand.push(r);
    }


    // 直近4週間の〇+早+遅回数（職員ごと）：早・遅も日勤カウント
    const dayCount4w = (r)=>{
      let c = 0;
      const startIdx = State.range4wStart;
      const endIdx   = State.range4wStart + 27;
      for (let i = startIdx; i <= endIdx && i < State.windowDates.length; i++){
        const ds2 = dateStr(State.windowDates[i]);
        const mk2 = getAssign(r, ds2);
        if (mk2 === '〇' || mk2 === '早' || mk2 === '遅') c++;
      }
      return c;
    };

    // 直近の〇/早/遅からの経過日数（2部制/3部制は〇/早/遅のみで計算）
    const daysSinceLastDay4w = (r)=>{
      const startIdx = State.range4wStart;
      const attr = State.employeesAttr[r] || { workType:'three' };
      const wt = attr.workType || 'three';
      const useDayOnly = (wt === 'two' || wt === 'three');
      let lastIdx = -1;
      for (let i = startIdx; i < dayIdx; i++){
        const ds2 = dateStr(State.windowDates[i]);
        const mk2 = getAssign(r, ds2);
        if (useDayOnly){
          if (mk2 === '〇' || mk2 === '早' || mk2 === '遅') lastIdx = i;
        } else {
          if (mk2 === '〇' || mk2 === '早' || mk2 === '遅' || mk2 === '☆' || mk2 === '★' || mk2 === '◆' || mk2 === '●') {
            lastIdx = i;
          }
        }
      }
      return lastIdx === -1 ? 9999 : (dayIdx - lastIdx);
    };


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
          if (mk2==='〇' || mk2==='早' || mk2==='遅' || mk2==='☆' || mk2==='★' || mk2==='◆' || mk2==='●') c++;
        }
        return c;
      };

      // --- 公平化ソート（追加） ---
      // グループ（候補の中）ごとの勤務形態別平均を先に計算し、各人の「勤務形態内での偏差」を用いる
      const avgByWorkType = {};
      ['two','three'].forEach(wt=>{
        let sum=0, n=0;
        for(const r of cand){
          if (((State.employeesAttr[r]?.workType) || 'three') === wt){
            sum += dayCount4w(r);
            n++;
          }
        }
        avgByWorkType[wt] = n ? (sum / n) : 0;
      });
      const relativeDay = (r)=>{
        const wt = (State.employeesAttr[r]?.workType) || 'three';
        return dayCount4w(r) - (avgByWorkType[wt] || 0);
      };

      cand.sort((a, b) => {
        const diffWh = whCount(a) - whCount(b);
        if (diffWh !== 0) return diffWh;
        // (1) 勤務形態内での「直近4週〇回数の偏差」を小さい方を優先（偏りが大きい人は後回し）
        const relA = relativeDay(a), relB = relativeDay(b);
        if (relA !== relB) return relA - relB;
        // (2) それでも同等なら最近の〇から遠い人を優先（間隔の均等化）
        const gap = daysSinceLastDay4w(a) - daysSinceLastDay4w(b);
        if (gap !== 0) return gap;
        return 0;
      });



      // ★追加：同じカウントの人たちをシャッフル（公平性を保ちつつランダム性向上）
      let i = 0;
      while (i < cand.length) {
        const count = whCount(cand[i]);
        const gap   = daysSinceLastDay4w(cand[i]);
        let j = i;
        while (j < cand.length &&
               whCount(cand[j]) === count &&
               daysSinceLastDay4w(cand[j]) === gap) {
          j++;
        }
        const sameCountGroup = cand.slice(i, j);
        const shuffled = shuffleArray(sameCountGroup);
        for (let k = 0; k < shuffled.length; k++) {
          cand[i + k] = shuffled[k];
        }
        i = j;
      }

    } else {
      // ★修正：平日も配置回数と位置の分散を考慮
      const dayCount = (r)=> dayCount4w(r);
      
      // ★追加：最後に配置された日勤（〇）からの経過日数を優先（2部制/3部制では〇間隔を重視）
      const daysSinceLastAssign = (r)=> daysSinceLastDay4w(r);
      
      // ★ソート：配置回数が少ない順、同数なら最後の配置から遠い順
      cand.sort((a, b) => {
        const countDiff = dayCount(a) - dayCount(b);
        if (countDiff !== 0) return countDiff;
        return daysSinceLastAssign(b) - daysSinceLastAssign(a);
      });

      
      // ★ソート：配置回数が少ない順、同数なら最後の配置から遠い順
      cand.sort((a, b) => {
        const countDiff = dayCount(a) - dayCount(b);
        if (countDiff !== 0) return countDiff;
        return daysSinceLastAssign(b) - daysSinceLastAssign(a);
      });
      
      // ★同じ条件の人たちをシャッフル（さらなる公平性）
      let i = 0;
      while (i < cand.length) {
        const countA = dayCount(cand[i]);
        const daysA = daysSinceLastAssign(cand[i]);
        let j = i;
        while (j < cand.length && 
               dayCount(cand[j]) === countA && 
               daysSinceLastAssign(cand[j]) === daysA) {
          j++;
        }
        const sameConditionGroup = cand.slice(i, j);
        const shuffled = shuffleArray(sameConditionGroup);
        for (let k = 0; k < shuffled.length; k++) {
          cand[i + k] = shuffled[k];
        }
        i = j;
      }
    }

    // 早出（早）・遅出（遅）対象者を分離
    const earlyShiftCand = cand.filter(r => canAssignEarlyShift(r, dayIdx));
    const lateShiftCand  = cand.filter(r => canAssignLateShift(r, dayIdx));
    
// autoAssignLogic.js 約310行目〜370行目付近を修正

    return (need)=>{
      let placed = 0;
      
      let earlyPlaced = 0;
      let latePlaced  = 0;
      
// 1日あたりの早出・遅出「固定人数」を取得（平日・土日祝で区別）
const dt = State.windowDates[dayIdx];

// 早出：counts.config.js の固定値をそのまま採用
const earlyTarget = (window.Counts && typeof window.Counts.getEarlyShiftTarget === 'function')
  ? window.Counts.getEarlyShiftTarget(dt, (ds)=> State.holidaySet.has(ds))  // ← 固定値
  : 0;

// 遅出：counts.config.js の固定値をそのまま採用
const lateTarget = (window.Counts && typeof window.Counts.getLateShiftTarget === 'function')
  ? window.Counts.getLateShiftTarget(dt, (ds)=> State.holidaySet.has(ds))  // ← 固定値
  : 0;


// 早出・遅出は「固定人数」に達するまで優先的に割り当てる
      // 早出候補をシャッフルして順に処理
      const shuffledEarlyCand = shuffleArray(earlyShiftCand.slice());
      for (const r of shuffledEarlyCand){
        if (placed >= need) break;
        if (earlyPlaced >= earlyTarget) break;
        if (tryPlace(dayIdx, r, '早')){
          placed++;
          earlyPlaced++;
        }
      }

      // 遅出候補をシャッフルして順に処理
      const shuffledLateCand = shuffleArray(lateShiftCand.slice());
      for (const r of shuffledLateCand){
        if (placed >= need) break;
        if (latePlaced >= lateTarget) break;
        if (tryPlace(dayIdx, r, '遅')){
          placed++;
          latePlaced++;
        }
      }


      // ★ Phase 2: 目標人数に達していない場合、残りの候補から埋める
      // 早出が目標に達していない場合
      if (earlyPlaced < earlyTarget){
        for (const r of shuffledEarlyCand){
          if (placed >= need) break;
          if (earlyPlaced >= earlyTarget) break;
          const ds = dateStr(State.windowDates[dayIdx]);
          if (getAssign(r, ds)) continue; // 既に割り当て済みならスキップ
          if (tryPlace(dayIdx, r, '早')){
            placed++;
            earlyPlaced++;
          }
        }
      }

      // 遅出が目標に達していない場合
      if (latePlaced < lateTarget){
        for (const r of shuffledLateCand){
          if (placed >= need) break;
          if (latePlaced >= lateTarget) break;
          const ds = dateStr(State.windowDates[dayIdx]);
          if (getAssign(r, ds)) continue; // 既に割り当て済みならスキップ
          if (tryPlace(dayIdx, r, '遅')){
            placed++;
            latePlaced++;
          }
        }
      }

      // ★ Phase 3: 残りの日勤（〇）を割り当て
      for (const r of cand){
        if (placed >= need) break;
        const ds = dateStr(State.windowDates[dayIdx]);
        if (getAssign(r, ds)) continue; // 既に割り当て済みならスキップ
        if (tryPlace(dayIdx, r, '〇')) placed++;
      }

      return placed;
    };
  }


  // 遅出（遅）対象者かチェック（fillDayShift用のローカル関数）
  function canAssignLateShift(r, dayIdx){
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasLateShift) return false;
    
    const dt = State.windowDates[dayIdx];
    const lateType = empAttr.lateShiftType || 'all';
    
    if (lateType === 'all') return true;
    
    const isWH = isWeekendOrHoliday(dt);
    if (lateType === 'weekday') return !isWH;
    if (lateType === 'holiday') return isWH;
    
    return false;
  }

  //  早出（早）対象者かチェック（fillDayShift用のローカル関数）
  function canAssignEarlyShift(r, dayIdx){
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasEarlyShift) return false;

    const dt = State.windowDates[dayIdx];
    const earlyType = empAttr.earlyShiftType || 'all';

    if (earlyType === 'all') return true;

    const isWH = isWeekendOrHoliday(dt);
    if (earlyType === 'weekday') return !isWH;
    if (earlyType === 'holiday') return isWH;

    return false;
  }

// autoAssignLogic.js 約470行目付近（normalizeOffToEight関数）

  function normalizeOffToEight(startDayIdx, endDayIdx){

    // ★従業員順序をランダム化
    let empOrder = [];
    for(let r=0; r<State.employeeCount; r++) empOrder.push(r);
    empOrder = shuffleArray(empOrder);
    
    // ★追加：休日超過の従業員を優先的に処理（休日が多い順にソート）
    const getOffCount = (r) => {
      let off = 0;
      for(let d = startDayIdx; d <= endDayIdx; d++){
        const ds = dateStr(State.windowDates[d]);
        const mk = getAssign(r, ds);
        const hasLv = !!getLeaveType(r, ds);
        if (hasOffByDate(r, ds)){
          off++;
        } else if (!mk && !hasLv){
          off++;
        }
      }
      return off;
    };
    
    // 休日が多い順にソート（厳格化のため超過者を先に処理）
    empOrder.sort((a, b) => getOffCount(b) - getOffCount(a));
    
    for(const r of empOrder){
      let off=0;
      const blanks = [];
      for(let d=startDayIdx; d<=endDayIdx; d++){
        const ds = dateStr(State.windowDates[d]);
        const mk = getAssign(r, ds);
        const hasLv = !!getLeaveType(r, ds);
        if (hasOffByDate(r, ds)){
          off++;
        } else if (!mk && !hasLv){
          off++; blanks.push(d);
        }
      }

      const offReq = (function(){
        const sDt = State.windowDates[startDayIdx];
        const eDt = State.windowDates[endDayIdx];
        return window.requiredOffFor28(r, sDt, eDt);
      })();

      // ±1許容: 最大許容値を超えている場合のみ削減
      if (off > offReq.max){
        let need = off - offReq.base; // 基準値まで戻す
        
        // 空白日を日付順にシャッフルしてから処理（偏り防止）
        const shuffledBlanks = shuffleArray(blanks.slice());
        
        for(const d of shuffledBlanks){
          if (need<=0) break;

          const dt = State.windowDates[d];
          const { day } = countDayStats(d);
          
          if (isWeekendOrHoliday(dt)) {
            const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
              ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
            if (day >= capWkHol) continue;
          } else {
            // 平日の上限チェック
            const capWeekday = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKDAY))
              ? window.Counts.DAY_TARGET_WEEKDAY : 16;
            if (day >= capWeekday) continue;
          }

          const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
          const ok1 = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
          if (!ok1.ok) continue;
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
        
        // ★追加：それでも超過している場合は早出・遅出も試す
        if (need > 0){
          for(const d of shuffledBlanks){
            if (need <= 0) break;
            const ds = dateStr(State.windowDates[d]);
            if (getAssign(r, ds)) continue; // 既に割当済みならスキップ
            
            // 早出を試す
            if (canAssignEarlyShiftForNormalize(r, d)){
              if (tryPlace(d, r, '早')){
                need--;
                continue;
              }
            }
            
            // 遅出を試す
            if (canAssignLateShiftForNormalize(r, d)){
              if (tryPlace(d, r, '遅')){
                need--;
                continue;
              }
            }
          }
        }
      }
    }
  }
  
  // ★追加：normalizeOffToEight用の早出チェック
  function canAssignEarlyShiftForNormalize(r, dayIdx){
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasEarlyShift) return false;
    
    const dt = State.windowDates[dayIdx];
    const earlyType = empAttr.earlyShiftType || 'all';
    
    if (earlyType === 'all') return true;
    
    const isWH = isWeekendOrHoliday(dt);
    if (earlyType === 'weekday') return !isWH;
    if (earlyType === 'holiday') return isWH;
    
    return false;
  }
  
  // ★追加：normalizeOffToEight用の遅出チェック
  function canAssignLateShiftForNormalize(r, dayIdx){
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasLateShift) return false;
    
    const dt = State.windowDates[dayIdx];
    const lateType = empAttr.lateShiftType || 'all';
    
    if (lateType === 'all') return true;
    
    const isWH = isWeekendOrHoliday(dt);
    if (lateType === 'weekday') return !isWH;
    if (lateType === 'holiday') return isWH;
    
    return false;
  }


  function isWeekendOrHoliday(dt){
    if (window.HolidayRules && typeof window.HolidayRules.minDayFor === 'function'){
      const md = window.HolidayRules.minDayFor(dt, (ds)=> State.holidaySet.has(ds));
      return md === 5;
    }
    const w = dt.getDay();
    const ds = dateStr(dt);
    return (w===0 || w===6) || State.holidaySet.has(ds);
  }

function targetDayForIndex(dayIdx){
  const dt = State.windowDates[dayIdx];

  // 1) カスタム関数があれば優先して利用
  if (window.Counts && typeof window.Counts.getDayTarget === 'function'){
    return window.Counts.getDayTarget(dt, (ds)=> State.holidaySet.has(ds));
  }

  // 2) カウント設定オブジェクトに明示的なターゲットがあれば利用（ここを追加）
  if (window.Counts){
    const isWH = isWeekendOrHoliday(dt);
    if (isWH && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY)){
      return window.Counts.DAY_TARGET_WEEKEND_HOLIDAY;
    }
    if (!isWH && Number.isInteger(window.Counts.DAY_TARGET_WEEKDAY)){
      return window.Counts.DAY_TARGET_WEEKDAY;
    }
  }

  // 3) 最終フォールバック（既存の既定値）
  return isWeekendOrHoliday(dt) ? 6 : 10;
}

function reduceDayShiftTo(dayIdx, target) { // target は土日祝/特定日用として引き続き受け取る
    const ds = dateStr(State.windowDates[dayIdx]);
    const dt = State.windowDates[dayIdx];
    const isWH = isWeekendOrHoliday(dt);

    // target が引数で渡されなかった場合（平日の呼び出し）、許容リストから上限値を動的に取得する
    if (target === undefined && !isWH) {
      const allowed = (window.Counts && Array.isArray(window.Counts.DAY_ALLOWED_WEEKDAY))
          ? window.Counts.DAY_ALLOWED_WEEKDAY
          : [15, 16, 17]; // 安全のためのフォールバック

      // 許容リストに有効な数値があればその最大値を上限とし、なければデフォルト値を使う
      const validAllowed = allowed.map(n => parseInt(n, 10)).filter(Number.isFinite);
      target = validAllowed.length > 0 ? Math.max(...validAllowed) : 17;
    }

    // target が未定義（＝呼び出し元も上限を把握できない）なら何もしない
    if (target === undefined) return;

    // 当日〇が入っている職員一覧を取得
    const info = [];
    for (let r = 0; r < State.employeeCount; r++){
      if (getAssign(r, ds) === '〇'){
        const lv = (State.employeesAttr[r]?.level) || 'B';
        info.push({ r, level: lv, isA: lv === 'A', isB: lv === 'B' });
      }
    }

    let day = info.length;
    // 計算または引数で得られた上限値 `target` を使って判定
    if (day <= target) return;

    // Aがいれば「直近4週間で〇が最も少ないA」を1人保護（Aゼロ日防止＋A内の公平化）
    let protectA = null;
    const aInfo = info.filter(x => x.isA);
    if (aInfo.length > 0){
      let best = aInfo[0];
      let bestCount = dayCount4w(best.r);
      for (let i = 1; i < aInfo.length; i++){
        const c = dayCount4w(aInfo[i].r);
        if (c < bestCount){
          best = aInfo[i];
          bestCount = c;
        }
      }
      protectA = best.r;
    }

    // 削除候補を作成（保護したA以外）
    let removal = info
      .filter(x => x.r !== protectA)
      .map(x => ({
        r: x.r,
        isB: x.isB,
        dayCount: dayCount4w(x.r)
      }));

    if (removal.length === 0) return;

    // 同じ条件の中での偏りを避けるために一度シャッフル
    if (typeof shuffleArray === 'function'){
      removal = shuffleArray(removal);
    }

    // --- 勤務形態別平均を計算して「相対偏差」を用いる ---
    const avgByWorkType = {};
    ['two','three'].forEach(wt=>{
      let sum=0, n=0;
      for(const it of removal){
        if (it.workType === wt){ sum += it.dayCount; n++; }
      }
      avgByWorkType[wt] = n ? (sum / n) : 0;
    });
    const rel = (it) => it.dayCount - (avgByWorkType[it.workType] || 0);

    // 優先順位：
    // 1) Bかどうか（Bを先に削る）
    // 2) 勤務形態内での相対偏差（偏差が大きい=多めの人を先に削る）
    // 3) 直近4週間の日勤回数（多い人を先に削る）
    removal.sort((a, b) => {
      if (a.isB !== b.isB){
        return (b.isB ? 1 : 0) - (a.isB ? 1 : 0); // B=true を先に
      }
      const rdiff = rel(b) - rel(a);
      if (rdiff !== 0) return rdiff;
      const diff = b.dayCount - a.dayCount;       // 多い方を先に削る（保険）
      if (diff !== 0) return diff;
      return 0;
    });
    
    // ★追加：同じ条件のグループ内でシャッフル（公平性向上）
    let i = 0;
    while (i < removal.length) {
      const isBVal = removal[i].isB;
      const countVal = removal[i].dayCount;
      let j = i;
      while (j < removal.length && removal[j].isB === isBVal && removal[j].dayCount === countVal) {
        j++;
      }
      const sameGroup = removal.slice(i, j);
      const shuffled = shuffleArray(sameGroup);
      for (let k = 0; k < shuffled.length; k++) {
        removal[i + k] = shuffled[k];
      }
      i = j;
    }


    for (const cand of removal){
      if (day <= target) break;
      clearAssign(cand.r, ds);
      day--;
    }

    if (typeof updateFooterCounts === 'function') updateFooterCounts();
  }



  // ★★★ 人数を厳格化する関数 ★★★
  function enforceExactCount(dayIdx, targetNF, targetNS) {

    const ds = dateStr(State.windowDates[dayIdx]);
    
    // NF帯（☆＋◆）の調整
    const nfRows = [];
    for (let r = 0; r < State.employeeCount; r++) {
      const mk = getAssign(r, ds);
      if (mk === '☆' || mk === '◆') {
        nfRows.push({
          r,
          mark: mk,
          isA: (State.employeesAttr[r]?.level) === 'A',
          isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
          isLocked: isLocked(r, ds),
          hasNextLock: (mk === '☆' && dayIdx + 1 < State.windowDates.length) 
            ? isLocked(r, dateStr(State.windowDates[dayIdx + 1])) 
            : false
        });
      }
    }

    const countRemovableNF = () => nfRows.filter(x => !x.isNightOnly).length;
    
    // --- NF帯：勤務形態内の相対偏差を考慮した優先順位付け ---
    // 各候補について直近28日間の NF 回数（☆または◆）を数える
    const last28ForNF = (r) => {
      let c = 0;
      const end = State.windowDates[State.range4wStart + 27];
      for (let i = 0; i < 28; i++){
        const dt = addDays(end, -27 + i);
        const ds2 = dateStr(dt);
        const mk2 = window.globalGetAssign ? window.globalGetAssign(r, ds2) : getAssign(r, ds2);
        if (mk2 === '☆' || mk2 === '◆') c++;
      }
      return c;
    };
    // 勤務形態別平均を計算
    const avgByWorkTypeNF = {};
    ['two','three'].forEach(wt=>{
      let sum = 0, n = 0;
      for (const x of nfRows){
        const wt0 = (State.employeesAttr[x.r]?.workType) || 'three';
        if (wt0 === wt){ sum += last28ForNF(x.r); n++; }
      }
      avgByWorkTypeNF[wt] = n ? (sum / n) : 0;
    });
    // relative score
    nfRows.forEach(x => {
      const wt0 = (State.employeesAttr[x.r]?.workType) || 'three';
      x.last28nf = last28ForNF(x.r);
      x.relNF = x.last28nf - (avgByWorkTypeNF[wt0] || 0);
    });
    // 優先ソート： (1) 非A/非Night が先、(2) 勤務形態内相対偏差（大きい人=多めを先に削る）、(3) 最終的に乱択で安定化
    nfRows.sort((a,b) => {
      if (a.isNightOnly !== b.isNightOnly) return (a.isNightOnly ? 1 : -1); // 夜勤専従は後ろ
      if (a.isA !== b.isA) return (a.isA ? 1 : -1); // Aは残す→Aが true なら後ろ
      if (a.isLocked !== b.isLocked) return (a.isLocked ? 1 : -1); // ロックは後ろ
      const rdiff = b.relNF - a.relNF;
      if (rdiff !== 0) return rdiff;
      // tie-breaker: 直近NF回数が多い人を先に
      if (b.last28nf !== a.last28nf) return b.last28nf - a.last28nf;
      // 最後にランダムで安定化
      return (Math.random() > 0.5) ? 1 : -1;
    });
    
    // NF帯の超過分を削除（ロックされていない非Aから優先）
    while (nfRows.length > targetNF && countRemovableNF() > 0) {
      let removed = false;
      
      // 1. ロックされていない非Aの◆から削除（夜勤専従は除外）
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && !nfRows[i].isA && !nfRows[i].isNightOnly && nfRows[i].mark === '◆') {
          clearAssign(nfRows[i].r, ds);
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 2. ロックされていない非Aの☆から削除（翌日も削除／夜勤専従は除外）
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && !nfRows[i].hasNextLock && !nfRows[i].isA && !nfRows[i].isNightOnly && nfRows[i].mark === '☆') {
          clearAssign(nfRows[i].r, ds);
          if (dayIdx + 1 < State.windowDates.length) {
            const nextDs = dateStr(State.windowDates[dayIdx + 1]);
            if (getAssign(nfRows[i].r, nextDs) === '★') {
              clearAssign(nfRows[i].r, nextDs);
            }
          }
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 3. A職員も含めて削除（最低1名のAは残す／夜勤専従は除外）
      const aCount = nfRows.filter(x => x.isA).length;
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && !nfRows[i].isNightOnly && (!nfRows[i].isA || aCount > 1)) {
          clearAssign(nfRows[i].r, ds);
          if (nfRows[i].mark === '☆' && dayIdx + 1 < State.windowDates.length) {
            const nextDs = dateStr(State.windowDates[dayIdx + 1]);
            if (getAssign(nfRows[i].r, nextDs) === '★') {
              clearAssign(nfRows[i].r, nextDs);
            }
          }
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      
      if (!removed) break;
    }

    
    // NS帯（★＋●）の調整
    const nsRows = [];
    for (let r = 0; r < State.employeeCount; r++) {
      const mk = getAssign(r, ds);
      if (mk === '★' || mk === '●') {
        nsRows.push({
          r,
          mark: mk,
          isA: (State.employeesAttr[r]?.level) === 'A',
          isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
          isLocked: isLocked(r, ds),
          hasPrevStar: (mk === '★' && dayIdx > 0) 
            ? getAssign(r, dateStr(State.windowDates[dayIdx - 1])) === '☆' 
            : false
        });
      }
    }

    const countRemovableNS = () => nsRows.filter(x => !x.isNightOnly).length;
    
    // ★追加：NS帯の削除候補をシャッフル（偏り防止）                         ← ✓
    nsRows.sort(() => Math.random() - 0.5);

    // NS帯の超過分を削除
    while (nsRows.length > targetNS && countRemovableNS() > 0) {
      let removed = false;
      
      // 1. ロックされていない非Aの●から削除（夜勤専従は除外）
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '●') {
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 2. ロックされていない非Aの★から削除（前日の☆も確認／夜勤専従は除外）
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '★' && !nsRows[i].hasPrevStar) {
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 3. A職員も含めて削除（最低1名のAは残す／夜勤専従は除外）
      const aCount = nsRows.filter(x => x.isA).length;
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && !nsRows[i].isNightOnly && (!nsRows[i].isA || aCount > 1)) {
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      
      if (!removed) break;
    }
    
    if (typeof updateFooterCounts === 'function') updateFooterCounts();
  }


  function nightQuotasOK(startIdx, endIdx){
    return (window.NightBand && window.NightBand.nightQuotasOK)
      ? window.NightBand.nightQuotasOK(nbCtx(), startIdx, endIdx)
      : true;
  }

  function countLast28Days(r, endDt){
    const start = addDays(endDt, -27);
    let star=0;
    for (let i=0;i<28;i++){
      const dt = addDays(start, i);
      const ds = dateStr(dt);
      const mk = window.globalGetAssign ? window.globalGetAssign(r, ds) : getAssign(r, ds);
      if (mk === '☆') star++;
    }
    return { star };
  }

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
      if (isLocked(r, ds)) return false;
      clearAssign(r, ds);

      let { day, hasADay } = countDayStats(dayIdx);
      const dt = State.windowDates[dayIdx];
      const isWH = isWeekendOrHoliday(dt);
      const minDay = isWH ? 5 : 10;
      const maxDay = isWH 
        ? ((window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY)) ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6)
        : ((window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKDAY)) ? window.Counts.DAY_TARGET_WEEKDAY : 16);
      
      if (day < minDay || !hasADay){
        const need = Math.max(1, minDay - day);
        fillWith(dayIdx, need, ['〇'], !hasADay);
        ({ day, hasADay } = countDayStats(dayIdx));
        
        // 上限チェック：上限を超えた場合または最低条件を満たせない場合は元に戻す
        if (day > maxDay || day < minDay || !hasADay){
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
          if (!isOffAt(r, d)) setAssign(r, ds1, '〇');
        }
      }
      return false;
    };

    // ★従業員順序をランダム化
    let empOrder = [];
    for (let r = 0; r < State.employeeCount; r++) empOrder.push(r);
    empOrder = shuffleArray(empOrder);
    
    for (const r of empOrder){
      let attempts = 0;
      while (countBlocks(r).length < 2 && attempts < 50){
        if (tryExpandSingle(r))         { attempts++; continue; }
        if (tryMakeFromDoubleDay(r))    { attempts++; continue; }
        break;
      }
    }
  }

// === メイン自動割当関数 ===
function autoAssignRange(startDayIdx, endDayIdx){
  function targetNFFor(ds){
    if (window.Counts && typeof window.Counts.getFixedNF === 'function'){
      return window.Counts.getFixedNF(ds);
    }
    return (window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3;
  }
  function targetNSFor(ds){
    if (window.Counts && typeof window.Counts.getFixedNS === 'function'){
      return window.Counts.getFixedNS(ds);
    }
    return (window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3;
  }

  // 遅出（遅）対象者かチェック
  function canAssignLateShift(r, dayIdx){
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasLateShift) return false;
    
    const dt = State.windowDates[dayIdx];
    const lateType = empAttr.lateShiftType || 'all';
    
    if (lateType === 'all') return true;
    
    const isWH = isWeekendOrHoliday(dt);
    if (lateType === 'weekday') return !isWH;
    if (lateType === 'holiday') return isWH;
    
    return false;
  }

    // ★日付順序をランダム化（夜勤割り当て用）
    let dayOrderForNightShift = [];
    for (let d = startDayIdx; d <= endDayIdx; d++){
      dayOrderForNightShift.push(d);
    }
  dayOrderForNightShift = shuffleArray(dayOrderForNightShift);

    for (let sweep=0; sweep<3; sweep++){
      let changed = false;
      for(const d of dayOrderForNightShift){
        const ds = dateStr(State.windowDates[d]);
        const FIXED_NF = targetNFFor(ds);
        const FIXED_NS = targetNSFor(ds);

        let { nf, ns, hasANf, hasANs } = countDayStats(d);

        if (nf < FIXED_NF){
          const before = nf;
          fillWith(d, FIXED_NF - nf, ['☆','◆'], !hasANf);
          nf = countDayStats(d).nf;
          
          // 超過分を厳格に削除
          if (nf > FIXED_NF) {
            enforceExactCount(d, FIXED_NF, FIXED_NS);
            nf = countDayStats(d).nf;
          }
          
          if (nf !== before) changed = true;
        }

        if (ns < FIXED_NS){
          const before = ns;
          fillWith(d, FIXED_NS - ns, ['★','●'], !hasANs);
          ns = countDayStats(d).ns;
          
          // 超過分を厳格に削除
          if (ns > FIXED_NS) {
            enforceExactCount(d, FIXED_NF, FIXED_NS);
            ns = countDayStats(d).ns;
          }
          
          if (ns !== before) changed = true;
        }
      }
      if (!changed) break;
    }

    if (!nightQuotasOK(startDayIdx, endDayIdx)){
      // ★日付順序をランダム化
      for(const d of shuffleArray(dayOrderForNightShift)){
        const ds = dateStr(State.windowDates[d]);
        const FIXED_NF = targetNFFor(ds);
        const FIXED_NS = targetNSFor(ds);

        let { nf, ns } = countDayStats(d);
        if (nf < FIXED_NF) fillWith(d, FIXED_NF - nf, ['☆','◆'], true);
        if (ns < FIXED_NS) fillWith(d, FIXED_NS - ns, ['★','●'], true);
        enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    }


// 修正後（5行前後を含む）
    (function ensureNightToTen(){
      // ★従業員順序をランダム化
      let nightEmpOrder = [];
      for (let r = 0; r < State.employeeCount; r++){
        if ((State.employeesAttr[r]?.workType) === 'night') nightEmpOrder.push(r);
      }
      nightEmpOrder = shuffleArray(nightEmpOrder);
      
      for (const r of nightEmpOrder){
        const now = countLast28Days(r, State.windowDates[State.range4wStart+27]).star;
        const quota = State.employeesAttr[r]?.nightQuota || 10;
        let need = Math.max(0, quota - now);
        
        if (need === 0) continue;

        for (let d = startDayIdx; d <= endDayIdx - 1 && need > 0; d++){
          const ds = dateStr(State.windowDates[d]);
          const dsNext = dateStr(State.windowDates[d+1]);
          if (getAssign(r, ds) || getAssign(r, dsNext)) continue;
          if (isRestByDate(r, ds) || isRestByDate(r, dsNext)) continue;
          if (tryPlace(d, r, '☆')) need--;
        }
      }

// 修正後
    })();

    // ★夜勤専従配置後に人数を厳格化
    for(let d=startDayIdx; d<=endDayIdx; d++){
      const ds = dateStr(State.windowDates[d]);
      const FIXED_NF = targetNFFor(ds);
      const FIXED_NS = targetNSFor(ds);
      enforceExactCount(d, FIXED_NF, FIXED_NS);
    }

// ========================================
  // ★厳格化：夜勤専従をノルマ完全達成まで繰り返し割り当て
  // ========================================
  (function ensureNightToQuotaStrict(){
    const MAX_ATTEMPTS = 100; // 無限ループ防止
    
    // 夜勤専従の従業員リスト
    let nightEmpOrder = [];
    for (let r = 0; r < State.employeeCount; r++){
      if ((State.employeesAttr[r]?.workType) === 'night') nightEmpOrder.push(r);
    }
    
    if (nightEmpOrder.length === 0) return;
    
    let attempts = 0;
    let allSatisfied = false;
    
    // 全員がノルマを満たすまで繰り返す
    while (!allSatisfied && attempts < MAX_ATTEMPTS) {
      attempts++;
      allSatisfied = true;
      nightEmpOrder = shuffleArray(nightEmpOrder);
      
      for (const r of nightEmpOrder){
        const now = countLast28Days(r, State.windowDates[State.range4wStart+27]).star;
        const quota = State.employeesAttr[r]?.nightQuota || 10;
        let need = Math.max(0, quota - now);
        
        if (need === 0) continue;
        
        allSatisfied = false; // まだ満たしていない人がいる
        
        // 日付順をシャッフルして配置を試みる
        let dayOrder = [];
        for (let d = startDayIdx; d <= endDayIdx - 1; d++) {
          dayOrder.push(d);
        }
        dayOrder = shuffleArray(dayOrder);
        
        for (const d of dayOrder) {
          if (need <= 0) break;
          
          const ds = dateStr(State.windowDates[d]);
          const dsNext = dateStr(State.windowDates[d+1]);
          
          // 既に割当がある場合はスキップ
          if (getAssign(r, ds) || getAssign(r, dsNext)) continue;
          // 希望休・特別休暇がある場合はスキップ
          if (isRestByDate(r, ds) || isRestByDate(r, dsNext)) continue;
          // ロック済みはスキップ
          if (isLocked(r, ds) || isLocked(r, dsNext)) continue;
          
          if (tryPlace(d, r, '☆')) {
            need--;
          }
        }
      }
    }
    
    // ノルマ未達の場合は警告をコンソールに出力
    const unmetList = [];
    for (const r of nightEmpOrder) {
      const now = countLast28Days(r, State.windowDates[State.range4wStart+27]).star;
      const quota = State.employeesAttr[r]?.nightQuota || 10;
      if (now < quota) {
        const name = State.employees[r] || `職員${r+1}`;
        unmetList.push(`${name}: ${now}/${quota}`);
        console.warn(`夜勤専従 ${name} のノルマ未達: ${now}/${quota}`);
      }
    }
    
    // ノルマ未達がある場合はトーストで通知
    if (unmetList.length > 0 && typeof showToast === 'function') {
      showToast(`⚠️ 夜勤専従ノルマ未達: ${unmetList.join(', ')}`);
    }
  })();

  // 夜勤専従配置後に人数を厳格化
  for(let d=startDayIdx; d<=endDayIdx; d++){
    const ds = dateStr(State.windowDates[d]);
    const FIXED_NF = targetNFFor(ds);
    const FIXED_NS = targetNSFor(ds);
    enforceExactCount(d, FIXED_NF, FIXED_NS);
  }

  // ========================================
  // ★修正：全ての日にAを割り当て
  // ========================================
  (function enforceANightBands(){
    // ★日付順序をランダム化
    const dayOrder = shuffleArray(dayOrderForNightShift.slice());
    for (const d of dayOrder){
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
        const cand = shuffleArray(candidatesFor(d, mark).filter(r => getLv(r) === 'A'));
        for (const r of cand){
          if (tryPlace(d, r, mark)) return r;
          if (mark === '★' && placePrevStar(d, r)) return r;
        }
        return null;
      };

      // NF帯のA配置
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
            if (hadNext && getAssign(r, nextDs) !== '★') setAssign(r, nextDs, '★');
          }
        }
        {
          const dsFix = dateStr(State.windowDates[d]);
          const FIXED_NF = targetNFFor(dsFix);
          const FIXED_NS = targetNSFor(dsFix);
          enforceExactCount(d, FIXED_NF, FIXED_NS);
        }
      }

      // NS帯のA配置
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
            const hadPrev = (prevDs && getAssign(r, prevDs) === '☆');
            clearAssign(r, ds);
            if (hadPrev) clearAssign(r, prevDs);
            fillWith(d, 1, ['★'], true);
            const after = countDayStats(d);
            if (after.hasANs){ placed2 = true; break; }
            if (!(prevDs && getAssign(r, prevDs) === '★')) setAssign(r, ds, '★');
            if (hadPrev) setAssign(r, prevDs, '☆');
          }
        }
        {
          const dsFix = dateStr(State.windowDates[d]);
          const FIXED_NF = targetNFFor(dsFix);
          const FIXED_NS = targetNSFor(dsFix);
          enforceExactCount(d, FIXED_NF, FIXED_NS);
        }
      }
    }
  })();

  // ========================================
  // ★修正：残り割り当て（不足分を補填）
  // ========================================
  (function fillRemainingNightShifts(){
    // ★日付順序をランダム化
    for(const d of shuffleArray(dayOrderForNightShift.slice())){
      const ds = dateStr(State.windowDates[d]);
      const FIXED_NF = targetNFFor(ds);
      const FIXED_NS = targetNSFor(ds);
      let { nf, ns } = countDayStats(d);
      if (nf < FIXED_NF) fillWith(d, FIXED_NF - nf, ['☆','◆'], false);
      if (ns < FIXED_NS) fillWith(d, FIXED_NS - ns, ['★','●'], false);
      enforceExactCount(d, FIXED_NF, FIXED_NS);
    }
  })();

    // ★最後に日勤を配置（処理順のみランダム化：NS/NFの充足ロジックには影響なし）
    let dayOrderForDayShift = [];
    for (let d = startDayIdx; d <= endDayIdx; d++){
      dayOrderForDayShift.push(d);
    }
    dayOrderForDayShift = shuffleArray(dayOrderForDayShift);

    for (const d of dayOrderForDayShift){
      let { day, hasADay } = countDayStats(d);
      const target = targetDayForIndex(d);

      if (!hasADay){
        fillWith(d, 1, ['〇'], true);
        ({ day, hasADay } = countDayStats(d));
      }
      if (day < target){
        const pushDay = fillDayShift(d);
        pushDay(target - day);
      ({ day } = countDayStats(d));

      }

      // 許容リスト（配列）があればその最大値を cap とする。なければ従来の target 値をフォールバック。
      // 土日祝の上限値取得ロジックは変更なし
      const capWkHol = (window.Counts && Array.isArray(window.Counts.DAY_ALLOWED_WEEKEND_HOLIDAY) && window.Counts.DAY_ALLOWED_WEEKEND_HOLIDAY.length > 0)
        ? Math.max(...window.Counts.DAY_ALLOWED_WEEKEND_HOLIDAY.map(n => parseInt(n, 10)).filter(Number.isFinite))
        : ((window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY)) ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6);

      if (isWeekendOrHoliday(State.windowDates[d])) {
        // 土日祝は、上限を超えている場合のみ、上限値を渡して呼び出す
        if (day > capWkHol) {
            reduceDayShiftTo(d, capWkHol);
        }
      } else {
        // 平日は、上限判定と削減を reduceDayShiftTo 関数自身に任せる
        reduceDayShiftTo(d);
      }
    }

    if (typeof normalizeOffToEight === 'function'){
      normalizeOffToEight(startDayIdx, endDayIdx);
    }

    if (typeof ensureRenkyuMin2 === 'function'){
      ensureRenkyuMin2(startDayIdx, endDayIdx);
     }
  
     // ★★★ 追加：最終チェック：全日程で厳格化を再実行 ★★★
     for(let d=startDayIdx; d<=endDayIdx; d++){
       const ds = dateStr(State.windowDates[d]);
       const FIXED_NF = targetNFFor(ds);
       const FIXED_NS = targetNSFor(ds);
       enforceExactCount(d, FIXED_NF, FIXED_NS);
       
       // 日勤の厳格化：目標人数に合わせる
       const dt = State.windowDates[d];
       const target = targetDayForIndex(d);
       let { day } = countDayStats(d);
       
       if (day > target) {
         reduceDayShiftTo(d, target);
       } else if (day < target) {
         const pushDay = fillDayShift(d);
         pushDay(target - day);
       }
     }

  }

  // === 祝日・代休の自動付与 ===
  function applyHolidayLeaveFlags(startDayIdx, endDayIdx){
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const dt = State.windowDates[d];
      const ds = dateStr(dt);
      if (!State.holidaySet.has(ds)) continue;

      // ★従業員順序をランダム化
      let empOrder = [];
      for (let r = 0; r < State.employeeCount; r++) empOrder.push(r);
      empOrder = shuffleArray(empOrder);
      
      for (const r of empOrder){
        const wt = (State.employeesAttr[r]?.workType) || 'three';
        if (wt === 'night') continue;
        if (getLeaveType(r, ds)) continue;
        const mk  = getAssign(r, ds);
        const off = hasOffByDate(r, ds);

        if (!mk){
          const w = dt.getDay();
          if (w !== 0 && w !== 6){
            setLeaveType(r, ds, '祝');
          }
        } else {
          const w = dt.getDay();
          if (w === 0 || w === 6){
            continue;
          }
          const subIdx = findSubstituteDayFor(r, d, startDayIdx, endDayIdx);
          if (subIdx != null){
            const sds = dateStr(State.windowDates[subIdx]);
            if (!getLeaveType(r, sds)) setLeaveType(r, sds, '代');
          }
        }
      }
    }

    applyBackfillSubstituteFromPastHolidays(startDayIdx, endDayIdx);
  }

  function applyBackfillSubstituteFromPastHolidays(startDayIdx, endDayIdx){
    const startDate = State.windowDates[startDayIdx];
    const fromDate  = addDays(startDate, -28);
    const store = window.readDatesStore ? window.readDatesStore() : null;
    if (!store) return;
    const holMap = (store && store.holidays) || {};

    function isHolidayDsGlobal(ds){
      const _inWindow = (ds)=>{
        return State.windowDates.some(dt => dateStr(dt) === ds);
      };
      return _inWindow(ds) ? State.holidaySet.has(ds) : !!holMap[ds];
    }

    for (let r = 0; r < State.employeeCount; r++){
      for (let dt = new Date(fromDate); dt < startDate; dt = addDays(dt, 1)){
        const ds = dateStr(dt);
        if (!isHolidayDsGlobal(ds)) continue;

        const w = dt.getDay();
        if (w === 0 || w === 6) continue;

        const mk = window.globalGetAssign ? window.globalGetAssign(r, ds) : getAssign(r, ds);
        if (!mk) continue;

        const leaveObj = (store.leave && store.leave[r]) || {};
        let hasSub = false;
        for (let i = 1; i <= 56; i++){
          const ds2 = dateStr(addDays(dt, i));
          if (leaveObj[ds2] === '代'){ hasSub = true; break; }
        }
        if (hasSub) continue;

        const deadline = addDays(dt, 56);
        for (let d = startDayIdx; d <= endDayIdx; d++){
          const cur = State.windowDates[d];
          if (cur > deadline) break;

          const sds = dateStr(cur);
          if (isHolidayDsGlobal(sds)) continue;
          if (hasOffByDate(r, sds)) continue;
          if (getLeaveType(r, sds)) continue;
          if (getAssign(r, sds)) continue;

          const ok = setLeaveType(r, sds, '代');
          if (ok) break;
        }
      }
    }
  }

  function findSubstituteDayFor(r, holidayDayIdx, startDayIdx, endDayIdx){
    const ok = (idx)=>{
      const ds = dateStr(State.windowDates[idx]);
      if (State.holidaySet.has(ds)) return false;
      if (hasOffByDate(r, ds)) return false;
      if (getLeaveType(r, ds)) return false;
      if (getAssign(r, ds))    return false;
      return true;
    };
    for (let i = holidayDayIdx + 1; i <= endDayIdx; i++){ if (ok(i)) return i; }
    for (let i = holidayDayIdx - 1; i >= startDayIdx; i--){ if (ok(i)) return i; }
    return null;
  }

})();