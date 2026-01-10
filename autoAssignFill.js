// autoAssignFill.js
// 夜勤・日勤の配置および候補判定に関する関数をまとめたモジュール。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * 遅出（遅）対象者かどうか判定します。
   * 従業員属性に hasLateShift が無い場合は割り当て不可となります。
   */
  function canAssignLateShift(r, dayIdx){
    const State = A.State;
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasLateShift) return false;
    const dt = State.windowDates[dayIdx];
    const lateType = empAttr.lateShiftType || 'all';
    if (lateType === 'all') return true;
    const isWH = A.isWeekendOrHoliday(dt);
    if (lateType === 'weekday') return !isWH;
    if (lateType === 'holiday') return isWH;
    return false;
  }
  /**
   * 早出（早）対象者かどうか判定します。
   */
  function canAssignEarlyShift(r, dayIdx){
    const State = A.State;
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasEarlyShift) return false;
    const dt = State.windowDates[dayIdx];
    const earlyType = empAttr.earlyShiftType || 'all';
    if (earlyType === 'all') return true;
    const isWH = A.isWeekendOrHoliday(dt);
    if (earlyType === 'weekday') return !isWH;
    if (earlyType === 'holiday') return isWH;
    return false;
  }
  /**
   * normalizeOffToEight 用の早出チェック。
   * canAssignEarlyShift と異なりその日の目標人数に達していないかどうかも判定します。
   */
  function canAssignEarlyShiftForNormalize(r, dayIdx){
    const State = A.State;
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasEarlyShift) return false;
    const dt = State.windowDates[dayIdx];
    const ds = A.dateStr(dt);
    // その日の早出人数が固定値に達していないかを確認
    if (window.Counts && typeof window.Counts.getEarlyShiftTarget === 'function'){
      const target = window.Counts.getEarlyShiftTarget(dt, (ds0) => State.holidaySet.has(ds0));
      // 実際の早出人数を数える
      let cnt = 0;
      for (let i = 0; i < State.employeeCount; i++){
        const mk = A.getAssign(i, ds);
        if (mk === '早') cnt++;
      }
      if (cnt >= target) return false;
    }
    // 基本判定
    return canAssignEarlyShift(r, dayIdx);
  }
  /**
   * normalizeOffToEight 用の遅出チェック。
   */
  function canAssignLateShiftForNormalize(r, dayIdx){
    const State = A.State;
    const empAttr = State.employeesAttr[r] || {};
    if (!empAttr.hasLateShift) return false;
    const dt = State.windowDates[dayIdx];
    const ds = A.dateStr(dt);
    if (window.Counts && typeof window.Counts.getLateShiftTarget === 'function'){
      const target = window.Counts.getLateShiftTarget(dt, (ds0) => State.holidaySet.has(ds0));
      let cnt = 0;
      for (let i = 0; i < State.employeeCount; i++){
        const mk = A.getAssign(i, ds);
        if (mk === '遅') cnt++;
      }
      if (cnt >= target) return false;
    }
    return canAssignLateShift(r, dayIdx);
  }
  /**
   * 候補リストから指定マークを用いて不足人数を埋めます。
   * preferA が true の場合は A レベルの職員を優先的に割り当てます。
   */
  function fillWith(dayIdx, deficit, marks, preferA){
    const State = A.State;
    const getAssign = A.getAssign;
    const dateStr = A.dateStr;
    let placed = 0;
    for (const mark of marks){
      if (deficit <= 0) break;
      let cand = A.candidatesFor(dayIdx, mark);
      // 夜勤専従が 2 名までとする制限
      if (mark === '☆' || mark === '◆' || mark === '★' || mark === '●'){
        const ds = dateStr(State.windowDates[dayIdx]);
        const band = (mark === '☆' || mark === '◆') ? 'NF' : 'NS';
        let nightOnlyCount = 0;
        for (let r = 0; r < State.employeeCount; r++){
          const wt = (State.employeesAttr[r]?.workType) || 'three';
          if (wt !== 'night') continue;
          const mk = getAssign(r, ds);
          if (band === 'NF' && (mk === '☆' || mk === '◆')) nightOnlyCount++;
          if (band === 'NS' && (mk === '★' || mk === '●')) nightOnlyCount++;
        }
        if (nightOnlyCount >= 2){
          cand = cand.filter(r => {
            const wt = (State.employeesAttr[r]?.workType) || 'three';
            return wt !== 'night';
          });
        }
      }
      // A レベル優先の並び替え
      if (mark === '☆' || mark === '★'){
        const night = [], others = [];
        cand.forEach(r => (((State.employeesAttr[r]?.workType) || 'three') === 'night' ? night : others).push(r));
        const applyAHead = (arr) => {
          if (!preferA) return arr;
          const a = [], non = [];
          arr.forEach(r => (((State.employeesAttr[r]?.level) === 'A') ? a : non).push(r));
          return A.shuffleArray(a).concat(A.shuffleArray(non));
        };
        if (preferA){
          const nightA = [], nightNon = [], othersA = [], othersNon = [];
          night.forEach(r => (((State.employeesAttr[r]?.level) === 'A') ? nightA : nightNon).push(r));
          others.forEach(r => (((State.employeesAttr[r]?.level) === 'A') ? othersA : othersNon).push(r));
          cand = A.shuffleArray(nightA).concat(A.shuffleArray(othersA), A.shuffleArray(nightNon), A.shuffleArray(othersNon));
        } else {
          cand = applyAHead(night).concat(applyAHead(others));
        }
      } else if (preferA){
        const a = [], non = [];
        cand.forEach(r => (((State.employeesAttr[r]?.level) === 'A') ? a : non).push(r));
        cand = A.shuffleArray(a).concat(A.shuffleArray(non));
      } else {
        cand = A.shuffleArray(cand);
      }
      // 実際に配置を試みる
      for (const r of cand){
        if (deficit <= 0) break;
        if (A.tryPlace(dayIdx, r, mark)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level) === 'A') preferA = false;
          continue;
        }
        if (mark === '★' && placePrevStar(dayIdx, r)){
          placed++; deficit--;
          if (preferA && (State.employeesAttr[r]?.level) === 'A') preferA = false;
        }
      }
    }
    return placed;
  }
  /**
   * 指定日の前日に☆を置いて、当日★を確定させる補助関数。
   */
  function placePrevStar(dayIdx, r){
    const State = A.State;
    const dateStr = A.dateStr;
    const isRestByDate = A.isRestByDate;
    const isLocked = A.isLocked;
    const getAssign = A.getAssign;
    const tryPlace = A.tryPlace;
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
      dates: State.windowDates, employeeCount: State.employeeCount,
      getAssign,
      hasOffByDate:(i, ds) => A.hasOffByDate(i, ds),
      getWorkType:(i) => (State.employeesAttr[i]?.workType) || 'three',
      getLevel:(i) => (State.employeesAttr[i]?.level) || 'B'
    }) || { ok:true };
    if (!pre.ok) return false;
    if (tryPlace(prevIdx, r, '☆')){
      const dsToday = dateStr(State.windowDates[dayIdx]);
      return getAssign(r, dsToday) === '★';
    }
    return false;
  }
  /**
   * 指定日の日勤を必要人数だけ埋める関数を返します。
   * 呼び出しは fillDayShift(dayIdx)(need) のように二段階で行います。
   */
  function fillDayShift(dayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const isRestByDate = A.isRestByDate;
    const isLocked = A.isLocked;
    // 候補抽出
    const ds = dateStr(State.windowDates[dayIdx]);
    let cand = [];
    for (let r = 0; r < State.employeeCount; r++){
      if (getAssign(r, ds)) continue;
      if (isRestByDate(r, ds)) continue;
      if (isLocked(r, ds)) continue;
      const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
      const ok = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
      if (ok.ok) cand.push(r);
    }
    // 直近4週間の〇+早+遅回数
    const dayCount4w = (r) => {
      let c = 0;
      const startIdx = State.range4wStart;
      const endIdx = State.range4wStart + 27;
      for (let i = startIdx; i <= endIdx && i < State.windowDates.length; i++){
        const ds2 = dateStr(State.windowDates[i]);
        const mk2 = getAssign(r, ds2);
        if (mk2 === '〇' || mk2 === '早' || mk2 === '遅') c++;
      }
      return c;
    };
    // 直近の〇/早/遅からの経過日数
    const daysSinceLastDay4w = (r) => {
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
          if (mk2 === '〇' || mk2 === '早' || mk2 === '遅' || mk2 === '☆' || mk2 === '★' || mk2 === '◆' || mk2 === '●'){
            lastIdx = i;
          }
        }
      }
      return lastIdx === -1 ? 9999 : (dayIdx - lastIdx);
    };
    const dt = State.windowDates[dayIdx];
    const isWH = A.isWeekendOrHoliday(dt);
    if (isWH){
      const startIdx = State.range4wStart;
      const endIdx = State.range4wStart + 27;
      const whCount = (r) => {
        let c = 0;
        for (let i = startIdx; i <= endIdx && i < State.windowDates.length; i++){
          const dt2 = State.windowDates[i];
          if (!A.isWeekendOrHoliday(dt2)) continue;
          const ds2 = dateStr(dt2);
          const mk2 = getAssign(r, ds2);
          if (mk2 === '〇' || mk2 === '早' || mk2 === '遅' || mk2 === '☆' || mk2 === '★' || mk2 === '◆' || mk2 === '●') c++;
        }
        return c;
      };
      const avgByWorkType = {};
      ['two','three'].forEach(wt => {
        let sum = 0, n = 0;
        for (const r of cand){
          if (((State.employeesAttr[r]?.workType) || 'three') === wt){
            sum += dayCount4w(r);
            n++;
          }
        }
        avgByWorkType[wt] = n ? (sum / n) : 0;
      });
      const relativeDay = (r) => {
        const wt = (State.employeesAttr[r]?.workType) || 'three';
        return dayCount4w(r) - (avgByWorkType[wt] || 0);
      };
      cand.sort((a, b) => {
        const diffWh = whCount(a) - whCount(b);
        if (diffWh !== 0) return diffWh;
        const relA = relativeDay(a), relB = relativeDay(b);
        if (relA !== relB) return relA - relB;
        const gap = daysSinceLastDay4w(a) - daysSinceLastDay4w(b);
        if (gap !== 0) return gap;
        return 0;
      });
      let i = 0;
      while (i < cand.length){
        const count = whCount(cand[i]);
        const gap   = daysSinceLastDay4w(cand[i]);
        let j = i;
        while (j < cand.length && whCount(cand[j]) === count && daysSinceLastDay4w(cand[j]) === gap){
          j++;
        }
        const sameCountGroup = cand.slice(i, j);
        const shuffled = A.shuffleArray(sameCountGroup);
        for (let k = 0; k < shuffled.length; k++){
          cand[i + k] = shuffled[k];
        }
        i = j;
      }
    } else {
      const dayCount = (r) => dayCount4w(r);
      const daysSinceLastAssign = (r) => daysSinceLastDay4w(r);
      cand.sort((a, b) => {
        const countDiff = dayCount(a) - dayCount(b);
        if (countDiff !== 0) return countDiff;
        return daysSinceLastAssign(b) - daysSinceLastAssign(a);
      });
      let i = 0;
      while (i < cand.length){
        const countA = dayCount(cand[i]);
        const daysA = daysSinceLastAssign(cand[i]);
        let j = i;
        while (j < cand.length && dayCount(cand[j]) === countA && daysSinceLastAssign(cand[j]) === daysA){
          j++;
        }
        const sameConditionGroup = cand.slice(i, j);
        const shuffled = A.shuffleArray(sameConditionGroup);
        for (let k = 0; k < shuffled.length; k++){
          cand[i + k] = shuffled[k];
        }
        i = j;
      }
    }
    // 早出・遅出候補
    const earlyShiftCand = cand.filter(r => canAssignEarlyShift(r, dayIdx));
    const lateShiftCand  = cand.filter(r => canAssignLateShift(r, dayIdx));
    return (need) => {
      let placed = 0;
      let earlyPlaced = 0;
      let latePlaced = 0;
      const dt0 = State.windowDates[dayIdx];
      const earlyTarget = (window.Counts && typeof window.Counts.getEarlyShiftTarget === 'function')
        ? window.Counts.getEarlyShiftTarget(dt0, (ds0) => State.holidaySet.has(ds0))
        : 0;
      const lateTarget = (window.Counts && typeof window.Counts.getLateShiftTarget === 'function')
        ? window.Counts.getLateShiftTarget(dt0, (ds0) => State.holidaySet.has(ds0))
        : 0;
      const shuffledEarlyCand = A.shuffleArray(earlyShiftCand.slice());
      for (const r of shuffledEarlyCand){
        if (placed >= need) break;
        if (earlyPlaced >= earlyTarget) break;
        if (A.tryPlace(dayIdx, r, '早')){
          placed++;
          earlyPlaced++;
        }
      }
      const shuffledLateCand = A.shuffleArray(lateShiftCand.slice());
      for (const r of shuffledLateCand){
        if (placed >= need) break;
        if (latePlaced >= lateTarget) break;
        if (A.tryPlace(dayIdx, r, '遅')){
          placed++;
          latePlaced++;
        }
      }
      // 目標数に達していなければもう一度試す
      if (earlyPlaced < earlyTarget){
        for (const r of shuffledEarlyCand){
          if (placed >= need) break;
          if (earlyPlaced >= earlyTarget) break;
          const ds0 = dateStr(State.windowDates[dayIdx]);
          if (getAssign(r, ds0)) continue;
          if (A.tryPlace(dayIdx, r, '早')){
            placed++; earlyPlaced++;
          }
        }
      }
      if (latePlaced < lateTarget){
        for (const r of shuffledLateCand){
          if (placed >= need) break;
          if (latePlaced >= lateTarget) break;
          const ds0 = dateStr(State.windowDates[dayIdx]);
          if (getAssign(r, ds0)) continue;
          if (A.tryPlace(dayIdx, r, '遅')){
            placed++; latePlaced++;
          }
        }
      }
      for (const r of cand){
        if (placed >= need) break;
        const ds0 = dateStr(State.windowDates[dayIdx]);
        if (getAssign(r, ds0)) continue;
        if (A.tryPlace(dayIdx, r, '〇')) placed++;
      }
      return placed;
    };
  }
  // === 公開API ===
  A.fillWith = fillWith;
  A.placePrevStar = placePrevStar;
  A.fillDayShift = fillDayShift;
  A.canAssignLateShift = canAssignLateShift;
  A.canAssignEarlyShift = canAssignEarlyShift;
  A.canAssignEarlyShiftForNormalize = canAssignEarlyShiftForNormalize;
  A.canAssignLateShiftForNormalize = canAssignLateShiftForNormalize;
})();
