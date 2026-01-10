// autoAssignLeave.js
// 祝日や代休の自動付与を行うモジュール。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * 祝日または土日といった休日に対して自動的に休暇フラグを付与します。
   * 平日の祝日は「祝」、勤務が入っている場合は代休先を探して「代」を付与します。
   */
  function applyHolidayLeaveFlags(startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const addDays = A.addDays;
    const getAssign = A.getAssign;
    const getLeaveType = A.getLeaveType;
    const setLeaveType = A.setLeaveType;
    const hasOffByDate = A.hasOffByDate;
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const dt = State.windowDates[d];
      const ds = dateStr(dt);
      if (!State.holidaySet || !State.holidaySet.has(ds)) continue;
      let empOrder = [];
      for (let r = 0; r < State.employeeCount; r++) empOrder.push(r);
      empOrder = A.shuffleArray(empOrder);
      for (const r of empOrder){
        const wt = (State.employeesAttr[r]?.workType) || 'three';
        if (wt === 'night') continue;
        if (getLeaveType(r, ds)) continue;
        const mk = getAssign(r, ds);
        if (!mk){
          const w = dt.getDay();
          if (w !== 0 && w !== 6){
            setLeaveType(r, ds, '祝');
          }
        } else {
          const w = dt.getDay();
          if (w === 0 || w === 6) continue;
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
  /**
   * 過去 28 日間の祝日勤務に対して代休が付与されていないケースを補完します。
   */
  function applyBackfillSubstituteFromPastHolidays(startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const addDays = A.addDays;
    const getAssign = A.getAssign;
    const getLeaveType = A.getLeaveType;
    const setLeaveType = A.setLeaveType;
    const hasOffByDate = A.hasOffByDate;
    const startDate = State.windowDates[startDayIdx];
    const fromDate = addDays(startDate, -28);
    const store = window.readDatesStore ? window.readDatesStore() : null;
    if (!store) return;
    const holMap = (store && store.holidays) || {};
    function isHolidayDsGlobal(ds){
      const inWindow = (ds0) => {
        return State.windowDates.some(dt => dateStr(dt) === ds0);
      };
      return inWindow(ds) ? (State.holidaySet && State.holidaySet.has(ds)) : !!holMap[ds];
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
  /**
   * 祝日勤務がある従業員に対して代休候補となる日を探します。
   * 現在の日付の前後を検索し、休暇・勤務・別の休暇が無い日を返します。
   */
  function findSubstituteDayFor(r, holidayDayIdx, startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const getLeaveType = A.getLeaveType;
    const hasOffByDate = A.hasOffByDate;
    const ok = (idx) => {
      const ds = dateStr(State.windowDates[idx]);
      if (State.holidaySet && State.holidaySet.has(ds)) return false;
      if (hasOffByDate(r, ds)) return false;
      if (getLeaveType(r, ds)) return false;
      if (getAssign(r, ds)) return false;
      return true;
    };
    for (let i = holidayDayIdx + 1; i <= endDayIdx; i++){ if (ok(i)) return i; }
    for (let i = holidayDayIdx - 1; i >= startDayIdx; i--){ if (ok(i)) return i; }
    return null;
  }
  // === 公開API ===
  A.applyHolidayLeaveFlags = applyHolidayLeaveFlags;
  A.applyBackfillSubstituteFromPastHolidays = applyBackfillSubstituteFromPastHolidays;
  A.findSubstituteDayFor = findSubstituteDayFor;
})();
