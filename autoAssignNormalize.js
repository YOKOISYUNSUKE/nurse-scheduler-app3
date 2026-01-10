// autoAssignNormalize.js
// 休日数を調整して全員が基準に近づくようにするための正規化処理を提供します。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * 4 週間の範囲で「4 週 8 休」に近づくように休みを埋め戻す処理です。
   * startDayIdx から endDayIdx までの各従業員の休日数をチェックし、
   * 上限を超えている従業員について勤務を割り当てます。
   */
  function normalizeOffToEight(startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const getLeaveType = A.getLeaveType;
    const hasOffByDate = A.hasOffByDate;
    const tryPlace = A.tryPlace;
    // 従業員順序をランダム化
    let empOrder = [];
    for (let r = 0; r < State.employeeCount; r++) empOrder.push(r);
    empOrder = A.shuffleArray(empOrder);
    // 休日超過の従業員を優先処理
    const getOffCount = (r) => {
      let off = 0;
      for (let d = startDayIdx; d <= endDayIdx; d++){
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
    empOrder.sort((a, b) => getOffCount(b) - getOffCount(a));
    for (const r of empOrder){
      let off = 0;
      const blanks = [];
      for (let d = startDayIdx; d <= endDayIdx; d++){
        const ds = dateStr(State.windowDates[d]);
        const mk = getAssign(r, ds);
        const hasLv = !!getLeaveType(r, ds);
        if (hasOffByDate(r, ds)){
          off++;
        } else if (!mk && !hasLv){
          off++; blanks.push(d);
        }
      }
      // オフ必要数を取得
      const offReq = (() => {
        const sDt = State.windowDates[startDayIdx];
        const eDt = State.windowDates[endDayIdx];
        if (typeof A.requiredOffFor28 === 'function'){
          return A.requiredOffFor28(r, sDt, eDt);
        }
        if (typeof window.requiredOffFor28 === 'function'){
          return window.requiredOffFor28(r, sDt, eDt);
        }
        return { base: 8, max: 9 }; // フォールバック: 4週8休
      })();
      if (off > offReq.max){
        let need = off - offReq.base;
        const shuffledBlanks = A.shuffleArray(blanks.slice());
        for (const d of shuffledBlanks){
          if (need <= 0) break;
          const dt = State.windowDates[d];
          const { day } = A.countDayStats(d);
          if (A.isWeekendOrHoliday(dt)){
            const capWkHol = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY))
              ? window.Counts.DAY_TARGET_WEEKEND_HOLIDAY : 6;
            if (day >= capWkHol) continue;
          } else {
            const capWeekday = (window.Counts && Number.isInteger(window.Counts.DAY_TARGET_WEEKDAY))
              ? window.Counts.DAY_TARGET_WEEKDAY : 16;
            if (day >= capWeekday) continue;
          }
          const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
          const ok1 = window.AssignRules?.canAssign?.({ empAttr, mark:'〇' }) || { ok:true };
          if (!ok1.ok) continue;
          const pre = window.AssignRules?.precheckPlace?.({
            rowIndex: r, dayIndex: d, mark: '〇',
            dates: State.windowDates, employeeCount: State.employeeCount,
            getAssign,
            hasOffByDate: (i, ds0) => hasOffByDate(i, ds0)
          }) || { ok:true };
          if (!pre.ok) continue;
          if (tryPlace(d, r, '〇')){
            need--;
          }
        }
        if (need > 0){
          for (const d of shuffledBlanks){
            if (need <= 0) break;
            const ds0 = dateStr(State.windowDates[d]);
            if (getAssign(r, ds0)) continue;
            if (A.canAssignEarlyShiftForNormalize(r, d)){
              if (tryPlace(d, r, '早')){
                need--; continue;
              }
            }
            if (A.canAssignLateShiftForNormalize(r, d)){
              if (tryPlace(d, r, '遅')){
                need--; continue;
              }
            }
          }
        }
      }
    }
  }
  // === 公開API ===
  A.normalizeOffToEight = normalizeOffToEight;
})();
