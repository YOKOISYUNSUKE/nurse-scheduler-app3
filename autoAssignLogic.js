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
    return (window.NightBand && window.NightBand.countDayStats)
      ? window.NightBand.countDayStats(nbCtx(), dayIdx)
      : { day:0, nf:0, ns:0, hasADay:false, hasANf:false, hasANs:false };
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
      getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
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
      } else {
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

  // ★追加：配列をシャッフルする関数（Fisher-Yatesアルゴリズム）
  function shuffleArray(arr){
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

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
      cand.sort((a, b) => whCount(a) - whCount(b));
      // ★追加：同じカウントの人たちをシャッフル（公平性を保ちつつランダム性向上）
      let i = 0;
      while (i < cand.length) {
        const count = whCount(cand[i]);
        let j = i;
        while (j < cand.length && whCount(cand[j]) === count) j++;
        const sameCountGroup = cand.slice(i, j);
        const shuffled = shuffleArray(sameCountGroup);
        for (let k = 0; k < shuffled.length; k++) {
          cand[i + k] = shuffled[k];
        }
        i = j;
      }
    } else {
      cand = shuffleArray(cand);
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

  function normalizeOffToEight(startDayIdx, endDayIdx){
    for(let r=0; r<State.employeeCount; r++){
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

      const needOff = (function(){
        const sDt = State.windowDates[startDayIdx];
        const eDt = State.windowDates[endDayIdx];
        return window.requiredOffFor28(r, sDt, eDt);
      })();

      if (off > needOff){
        let need = off - needOff;
        for(const d of blanks){
          if (need<=0) break;

          const dt = State.windowDates[d];
          if (isWeekendOrHoliday(dt)) {
            const { day } = countDayStats(d);
            const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
              ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
            if (day >= capWkHol) continue;
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
      }
    }
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
    if (window.Counts && typeof window.Counts.getDayTarget === 'function'){
      return window.Counts.getDayTarget(dt, (ds)=> State.holidaySet.has(ds));
    }
    return isWeekendOrHoliday(dt) ? 6 : 10;
  }

  function reduceDayShiftTo(dayIdx, target){
    const ds = dateStr(State.windowDates[dayIdx]);
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
    for(const r of onlyA){
      if (day <= target) break;
      if (hasA && onlyA.length === 1) break;
      clearAssign(r, ds);
      day--;
    }
    if (typeof updateFooterCounts==='function') updateFooterCounts();
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
          isLocked: isLocked(r, ds),
          hasNextLock: (mk === '☆' && dayIdx + 1 < State.windowDates.length) 
            ? isLocked(r, dateStr(State.windowDates[dayIdx + 1])) 
            : false
        });
      }
    }
    
    // NF帯の超過分を削除（ロックされていない非Aから優先）
    while (nfRows.length > targetNF) {
      let removed = false;
      
      // 1. ロックされていない非Aの◆から削除
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && !nfRows[i].isA && nfRows[i].mark === '◆') {
          clearAssign(nfRows[i].r, ds);
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 2. ロックされていない非Aの☆から削除（翌日も削除）
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && !nfRows[i].hasNextLock && !nfRows[i].isA && nfRows[i].mark === '☆') {
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
      
      // 3. A職員も含めて削除（最低1名のAは残す）
      const aCount = nfRows.filter(x => x.isA).length;
      for (let i = nfRows.length - 1; i >= 0; i--) {
        if (!nfRows[i].isLocked && (!nfRows[i].isA || aCount > 1)) {
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
          isLocked: isLocked(r, ds),
          hasPrevStar: (mk === '★' && dayIdx > 0) 
            ? getAssign(r, dateStr(State.windowDates[dayIdx - 1])) === '☆' 
            : false
        });
      }
    }
    
    // NS帯の超過分を削除
    while (nsRows.length > targetNS) {
      let removed = false;
      
      // 1. ロックされていない非Aの●から削除
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && !nsRows[i].isA && nsRows[i].mark === '●') {
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 2. ロックされていない非Aの★から削除（前日の☆も確認）
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && !nsRows[i].isA && nsRows[i].mark === '★' && !nsRows[i].hasPrevStar) {
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      
      // 3. A職員も含めて削除（最低1名のAは残す）
      const aCount = nsRows.filter(x => x.isA).length;
      for (let i = nsRows.length - 1; i >= 0; i--) {
        if (!nsRows[i].isLocked && (!nsRows[i].isA || aCount > 1)) {
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
      const minDay = isWeekendOrHoliday(State.windowDates[dayIdx]) ? 5 : 10;
      if (day < minDay || !hasADay){
        const need = Math.max(1, minDay - day);
        fillWith(dayIdx, need, ['〇'], !hasADay);
        ({ day, hasADay } = countDayStats(dayIdx));
        if (day < minDay || !hasADay){
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

    for (let r = 0; r < State.employeeCount; r++){
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
  const FIXED_NF = (window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3;
  const FIXED_NS = (window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3;
    for (let sweep=0; sweep<3; sweep++){
      let changed = false;
      for(let d=startDayIdx; d<=endDayIdx; d++){
        let { nf, ns, hasANf, hasANs } = countDayStats(d);

        if (nf < FIXED_NF){
          const before = nf;
          fillWith(d, FIXED_NF - nf, ['☆','◆'], !hasANf);
          nf = countDayStats(d).nf;
          
          // ★追加：超過分を厳格に削除
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
          
          // ★追加：超過分を厳格に削除
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
      for(let d=startDayIdx; d<=endDayIdx; d++){
        let { nf, ns } = countDayStats(d);
               if (nf < FIXED_NF) fillWith(d, FIXED_NF - nf, ['☆','◆'], true);
        if (ns < FIXED_NS) fillWith(d, FIXED_NS - ns, ['★','●'], true);
        enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    }

// 修正後（5行前後を含む）
    (function ensureNightToTen(){
      for (let r = 0; r < State.employeeCount; r++){
        if ((State.employeesAttr[r]?.workType) !== 'night') continue;
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
      enforceExactCount(d, FIXED_NF, FIXED_NS);
    }

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
          const cand = shuffleArray(candidatesFor(d, mark).filter(r => getLv(r) === 'A'));
          for (const r of cand){
            if (tryPlace(d, r, mark)) return r;
            if (mark === '★' && placePrevStar(d, r)) return r;
          }
          return null;
        };

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
              fillWith(d, 1, ['★'], true);
              const after = countDayStats(d);
              if (after.hasANs){ placed2 = true; break; }
              setAssign(r, ds, '★');
              if (hadPrev) setAssign(r, prevDs, '☆');
            }
          }
        }
        enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    })();

    // ★その他の夜勤配置（不足分を補填）
    (function fillRemainingNightShifts(){
      for(let d=startDayIdx; d<=endDayIdx; d++){
        let { nf, ns } = countDayStats(d);
        if (nf < FIXED_NF) fillWith(d, FIXED_NF - nf, ['☆','◆'], false);
        if (ns < FIXED_NS) fillWith(d, FIXED_NS - ns, ['★','●'], false);
        enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    })();

    // ★最後に日勤を配置
    for(let d=startDayIdx; d<=endDayIdx; d++){
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

      const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
        ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
      if (isWeekendOrHoliday(State.windowDates[d]) && day > capWkHol){
        reduceDayShiftTo(d, capWkHol);
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
       enforceExactCount(d, FIXED_NF, FIXED_NS);


    }
  }

  // === 祝日・代休の自動付与 ===
  function applyHolidayLeaveFlags(startDayIdx, endDayIdx){
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const dt = State.windowDates[d];
      const ds = dateStr(dt);
      if (!State.holidaySet.has(ds)) continue;

      for (let r = 0; r < State.employeeCount; r++){
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