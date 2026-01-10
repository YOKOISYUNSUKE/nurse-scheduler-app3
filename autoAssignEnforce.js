// autoAssignEnforce.js
// 勤務人数の厳格化や固定人数の維持に関する関数をまとめたモジュール。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * 指定日の日勤人数が上限を超えている場合に減らします。
   * A 職員を優先的に残し、勤務形態内の偏差を考慮した削除を行います。
   */
  function reduceDayShiftTo(dayIdx, target){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const clearAssign = A.clearAssign;
    const updateFooterCounts = A.updateFooterCounts;
    const isWeekendOrHoliday = A.isWeekendOrHoliday;
    const ds = dateStr(State.windowDates[dayIdx]);
    const dt = State.windowDates[dayIdx];
    const isWH = isWeekendOrHoliday(dt);
    // target が未指定の場合、平日の DAY_ALLOWED_WEEKDAY 配列から最大値を取得
    if (target === undefined && !isWH){
      const allowed = (window.Counts && Array.isArray(window.Counts.DAY_ALLOWED_WEEKDAY))
        ? window.Counts.DAY_ALLOWED_WEEKDAY
        : [15, 16, 17];
      const validAllowed = allowed.map(n => parseInt(n, 10)).filter(Number.isFinite);
      target = validAllowed.length > 0 ? Math.max(...validAllowed) : 17;
    }
    if (target === undefined) return;
    // 当日の〇に入っている職員情報を収集
    const info = [];
    for (let r = 0; r < State.employeeCount; r++){
      if (getAssign(r, ds) === '〇'){
        const lv = (State.employeesAttr[r]?.level) || 'B';
        info.push({ r, level: lv, isA: lv === 'A', isB: lv === 'B' });
      }
    }
    let day = info.length;
    if (day <= target) return;
    // A 職員がいれば直近4週の〇回数が最も少ない A を一人保護
    let protectA = null;
    const aInfo = info.filter(x => x.isA);
    if (aInfo.length > 0){
      let best = aInfo[0];
      let bestCount = A.countDayShift4w(best.r);
      for (let i = 1; i < aInfo.length; i++){
        const c = A.countDayShift4w(aInfo[i].r);
        if (c < bestCount){
          best = aInfo[i];
          bestCount = c;
        }
      }
      protectA = best.r;
    }
    // 削除候補作成
    let removal = info.filter(x => x.r !== protectA).map(x => ({
      r: x.r,
      isB: x.isB,
      dayCount: A.countDayShift4w(x.r),
      workType: (State.employeesAttr[x.r]?.workType) || 'three'
    }));
    if (removal.length === 0) return;
    if (typeof A.shuffleArray === 'function'){
      removal = A.shuffleArray(removal);
    }
    // 勤務形態別平均を計算
    const avgByWorkType = {};
    ['two','three'].forEach(wt => {
      let sum = 0, n = 0;
      for (const it of removal){
        if (it.workType === wt){ sum += it.dayCount; n++; }
      }
      avgByWorkType[wt] = n ? (sum / n) : 0;
    });
    const rel = (it) => it.dayCount - (avgByWorkType[it.workType] || 0);
    removal.sort((a,b) => {
      if (a.isB !== b.isB){
        return (b.isB ? 1 : 0) - (a.isB ? 1 : 0);
      }
      const rdiff = rel(b) - rel(a);
      if (rdiff !== 0) return rdiff;
      const diff = b.dayCount - a.dayCount;
      if (diff !== 0) return diff;
      return 0;
    });
    // 同一条件のグループ内でシャッフル
    let i = 0;
    while (i < removal.length){
      const isBVal = removal[i].isB;
      const countVal = removal[i].dayCount;
      let j = i;
      while (j < removal.length && removal[j].isB === isBVal && removal[j].dayCount === countVal){ j++; }
      const sameGroup = removal.slice(i, j);
      const shuffled = A.shuffleArray(sameGroup);
      for (let k = 0; k < shuffled.length; k++){
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
  /**
   * 夜勤帯（NF/NS）の人数を厳格化します。
   * NF 帯（☆+◆）と NS 帯（★+●）それぞれの目標人数に合わせて削除します。
   */
  function enforceExactCount(dayIdx, targetNF, targetNS){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const clearAssign = A.clearAssign;
    const isLocked = A.isLocked;
    const updateFooterCounts = A.updateFooterCounts;
    const addDays = A.addDays;
    const ds = dateStr(State.windowDates[dayIdx]);
    // NF 帯調整
    const nfRows = [];
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      if (mk === '☆' || mk === '◆'){
        nfRows.push({
          r,
          mark: mk,
          isA: (State.employeesAttr[r]?.level) === 'A',
          isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
          isLocked: isLocked(r, ds),
          hasNextLock: (mk === '☆' && dayIdx + 1 < State.windowDates.length)
            ? isLocked(r, dateStr(State.windowDates[dayIdx + 1])) : false
        });
      }
    }
    const countRemovableNF = () => nfRows.filter(x => !x.isNightOnly).length;
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
    const avgByWorkTypeNF = {};
    ['two','three'].forEach(wt => {
      let sum = 0, n = 0;
      for (const x of nfRows){
        const wt0 = (State.employeesAttr[x.r]?.workType) || 'three';
        if (wt0 === wt){ sum += last28ForNF(x.r); n++; }
      }
      avgByWorkTypeNF[wt] = n ? (sum / n) : 0;
    });
    nfRows.forEach(x => {
      const wt0 = (State.employeesAttr[x.r]?.workType) || 'three';
      x.last28nf = last28ForNF(x.r);
      x.relNF = x.last28nf - (avgByWorkTypeNF[wt0] || 0);
    });
    nfRows.sort((a,b) => {
      if (a.isNightOnly !== b.isNightOnly) return (a.isNightOnly ? 1 : -1);
      if (a.isA !== b.isA) return (a.isA ? 1 : -1);
      if (a.isLocked !== b.isLocked) return (a.isLocked ? 1 : -1);
      const rdiff = b.relNF - a.relNF;
      if (rdiff !== 0) return rdiff;
      if (b.last28nf !== a.last28nf) return b.last28nf - a.last28nf;
      return (Math.random() > 0.5) ? 1 : -1;
    });
    while (nfRows.length > targetNF && countRemovableNF() > 0){
      let removed = false;
      for (let i = nfRows.length - 1; i >= 0; i--){
        if (!nfRows[i].isLocked && !nfRows[i].isA && !nfRows[i].isNightOnly && nfRows[i].mark === '◆'){
          clearAssign(nfRows[i].r, ds);
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      for (let i = nfRows.length - 1; i >= 0; i--){
        if (!nfRows[i].isLocked && !nfRows[i].hasNextLock && !nfRows[i].isA && !nfRows[i].isNightOnly && nfRows[i].mark === '☆'){
          clearAssign(nfRows[i].r, ds);
          if (dayIdx + 1 < State.windowDates.length){
            const nextDs = dateStr(State.windowDates[dayIdx + 1]);
            if (getAssign(nfRows[i].r, nextDs) === '★'){
              clearAssign(nfRows[i].r, nextDs);
            }
          }
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      const aCount = nfRows.filter(x => x.isA).length;
      for (let i = nfRows.length - 1; i >= 0; i--){
        if (!nfRows[i].isLocked && !nfRows[i].isNightOnly && (!nfRows[i].isA || aCount > 1)){
          clearAssign(nfRows[i].r, ds);
          if (nfRows[i].mark === '☆' && dayIdx + 1 < State.windowDates.length){
            const nextDs = dateStr(State.windowDates[dayIdx + 1]);
            if (getAssign(nfRows[i].r, nextDs) === '★'){
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
    // NS 帯調整
    const nsRows = [];
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      if (mk === '★' || mk === '●'){
        nsRows.push({
          r,
          mark: mk,
          isA: (State.employeesAttr[r]?.level) === 'A',
          isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
          isLocked: isLocked(r, ds),
          hasPrevStar: (mk === '★' && dayIdx > 0)
            ? getAssign(r, dateStr(State.windowDates[dayIdx - 1])) === '☆' : false
        });
      }
    }
    const countRemovableNS = () => nsRows.filter(x => !x.isNightOnly).length;
    nsRows.sort(() => Math.random() - 0.5);
    while (nsRows.length > targetNS && countRemovableNS() > 0){
      let removed = false;
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '●'){
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '★' && !nsRows[i].hasPrevStar){
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      const aCountNs = nsRows.filter(x => x.isA).length;
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isNightOnly && (!nsRows[i].isA || aCountNs > 1)){
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
  /**
   * 日勤人数および早出・遅出人数が固定値に達しているか確認し、超過している場合は削減します。
   */
  function enforceDayShiftFixedCounts(dayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const clearAssign = A.clearAssign;
    const isLocked = A.isLocked;
    const dt = State.windowDates[dayIdx];
    if (!dt) return;
    const ds = dateStr(dt);
    const stats = A.countDayStats(dayIdx);
    let totalDay = stats.day;
    let earlyCount = stats.early;
    let lateCount = stats.late;
    if (!Number.isInteger(earlyCount) || !Number.isInteger(lateCount)){
      earlyCount = 0;
      lateCount = 0;
      for (let r = 0; r < State.employeeCount; r++){
        const mk = getAssign(r, ds);
        if (mk === '早') earlyCount++;
        if (mk === '遅') lateCount++;
      }
    }
    let targetDay = A.targetDayForIndex(dayIdx);
    let earlyTarget = null;
    let lateTarget = null;
    if (window.Counts && typeof window.Counts.getEarlyShiftTarget === 'function'){
      earlyTarget = window.Counts.getEarlyShiftTarget(dt, d0 => State.holidaySet.has(d0));
    }
    if (window.Counts && typeof window.Counts.getLateShiftTarget === 'function'){
      lateTarget = window.Counts.getLateShiftTarget(dt, d0 => State.holidaySet.has(d0));
    }
    if (!Number.isInteger(targetDay)) targetDay = null;
    if (!Number.isInteger(earlyTarget)) earlyTarget = null;
    if (!Number.isInteger(lateTarget)) lateTarget = null;
    // 日勤全体を削減
    if (targetDay !== null && totalDay > targetDay){
      reduceDayShiftTo(dayIdx, targetDay);
      totalDay = A.countDayStats(dayIdx).day;
    }
    // 早出の削減
    if (earlyTarget !== null && earlyCount > earlyTarget){
      const rows = [];
      for (let r = 0; r < State.employeeCount; r++){
        const mk = getAssign(r, ds);
        if (mk === '早'){
          const isA = (State.employeesAttr[r]?.level) === 'A';
          const isNightOnly = (State.employeesAttr[r]?.workType) === 'night';
          const locked = isLocked(r, ds);
          rows.push({ r, isA, isNightOnly, locked });
        }
      }
      rows.sort((a,b) => {
        if (a.locked !== b.locked) return (a.locked ? 1 : -1);
        if (a.isNightOnly !== b.isNightOnly) return (a.isNightOnly ? 1 : -1);
        if (a.isA !== b.isA) return (a.isA ? 1 : -1);
        return 0;
      });
      for (const row of rows){
        if (earlyCount <= earlyTarget) break;
        if (row.locked) continue;
        clearAssign(row.r, ds);
        earlyCount--;
      }
    }
    // 遅出の削減
    if (lateTarget !== null && lateCount > lateTarget){
      const rows = [];
      for (let r = 0; r < State.employeeCount; r++){
        const mk = getAssign(r, ds);
        if (mk === '遅'){
          const isA = (State.employeesAttr[r]?.level) === 'A';
          const isNightOnly = (State.employeesAttr[r]?.workType) === 'night';
          const locked = isLocked(r, ds);
          rows.push({ r, isA, isNightOnly, locked });
        }
      }
      rows.sort((a,b) => {
        if (a.locked !== b.locked) return (a.locked ? 1 : -1);
        if (a.isNightOnly !== b.isNightOnly) return (a.isNightOnly ? 1 : -1);
        if (a.isA !== b.isA) return (a.isA ? 1 : -1);
        return 0;
      });
      for (const row of rows){
        if (lateCount <= lateTarget) break;
        if (row.locked) continue;
        clearAssign(row.r, ds);
        lateCount--;
      }
    }
  }
  // === 公開API ===
  A.reduceDayShiftTo = reduceDayShiftTo;
  A.enforceExactCount = enforceExactCount;
  A.enforceDayShiftFixedCounts = enforceDayShiftFixedCounts;
})();
