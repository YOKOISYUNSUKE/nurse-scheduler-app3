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
   * 指定日の NF（準夜）および NS（深夜）の人数を厳格に調整します。
   */
  function enforceExactCount(dayIdx, targetNF, targetNS){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const clearAssign = A.clearAssign;
    const addDays = A.addDays;
    const isLocked = A.isLocked;
    const ds = dateStr(State.windowDates[dayIdx]);
    // NF帯（☆＋◆）の調整
    const nfRows = [];
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      if (mk === '☆' || mk === '◆'){
        nfRows.push({
          r, mark: mk,
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
    // NF帯の削除候補をシャッフル
    nfRows.sort(() => Math.random() - 0.5);
    // NF帯の超過分を削除
    while (nfRows.length > targetNF && countRemovableNF() > 0){
      let removed = false;
      // 1. ロックされていない非Aの◆から削除（夜勤専従は除外）
      for (let i = nfRows.length - 1; i >= 0; i--){
        if (!nfRows[i].isLocked && !nfRows[i].isA && !nfRows[i].isNightOnly && nfRows[i].mark === '◆'){
          clearAssign(nfRows[i].r, ds);
          nfRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      // 2. ロックされていない非Aの☆から削除（翌日も削除／夜勤専従は除外）
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
      // 3. A職員も含めて削除（最低1名のAは残す／夜勤専従は除外）
const aCount = nfRows.filter(x => x.isA).length;
for (let i = nfRows.length - 1; i >= 0; i--){
  if (!nfRows[i].isLocked && !nfRows[i].isNightOnly){
    // A職員の場合：aCount > 1 の場合のみ削除可能（最低1名は保護）
    if (nfRows[i].isA && aCount <= 1) continue;  // ← A職員が1名の場合、スキップして保護
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
    // NS帯（★＋●）の調整
    const nsRows = [];
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      if (mk === '★' || mk === '●'){
        nsRows.push({
          r, mark: mk,
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
    nsRows.sort(() => Math.random() - 0.5);
    // NS帯の超過分を削除
    while (nsRows.length > targetNS && countRemovableNS() > 0){
      let removed = false;
      // 1. ロックされていない非Aの●から削除（夜勤専従は除外）
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '●'){
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      // 2. ロックされていない非Aの★から削除（前日の☆も確認／夜勤専従は除外）
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isA && !nsRows[i].isNightOnly && nsRows[i].mark === '★' && !nsRows[i].hasPrevStar){
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      // 3. A職員も含めて削除（最低1名のAは残す／夜勤専従は除外）
      const aCount = nsRows.filter(x => x.isA).length;
      for (let i = nsRows.length - 1; i >= 0; i--){
        if (!nsRows[i].isLocked && !nsRows[i].isNightOnly && (!nsRows[i].isA || aCount > 1)){
          clearAssign(nsRows[i].r, ds);
          nsRows.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }
  }

  /**
   * 日勤人数および早出・遅出人数が固定値に達しているか確認し、
   * 超過している場合は削減、不足している場合は〇から振り分けます。
   */
  function enforceDayShiftFixedCounts(dayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const setAssign = A.setAssign;
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

    // ===== 改善: 早・遅の回数をカウントするヘルパー関数 =====
    const countSpecificShift4w = (r, mark) => {
        let count = 0;
        const startIdx = State.range4wStart;
        const endIdx = State.range4wStart + 27;
        for (let i = startIdx; i <= endIdx && i < State.windowDates.length; i++) {
            const ds2 = dateStr(State.windowDates[i]);
            if (getAssign(r, ds2) === mark) count++;
        }
        return count;
    };

    // ===== Step1: 早・遅が多すぎる場合は〇に落として調整 =====
    if (earlyTarget !== null && earlyCount > earlyTarget){
      const rows = [];
      for (let r = 0; r < State.employeeCount; r++){
        if (getAssign(r, ds) === '早'){
          rows.push({
            r,
            isA: (State.employeesAttr[r]?.level) === 'A',
            isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
            locked: isLocked(r, ds),
            earlyCount4w: countSpecificShift4w(r, '早') // 早の回数を追加
          });
        }
      }
      // 改善: 早の回数が多い人から優先的に〇に戻す
      rows.sort((a,b) => {
        if (a.locked !== b.locked) return a.locked ? 1 : -1;
        if (a.isNightOnly !== b.isNightOnly) return a.isNightOnly ? 1 : -1;
        if (a.isA !== b.isA) return a.isA ? 1 : -1; // B優先
        return b.earlyCount4w - a.earlyCount4w; // 早が多い人優先
      });
      for (const row of rows){
        if (earlyCount <= earlyTarget) break;
        if (row.locked) continue;
        setAssign(row.r, ds, '〇');
        earlyCount--;
      }
    }
    if (lateTarget !== null && lateCount > lateTarget){
      const rows = [];
      for (let r = 0; r < State.employeeCount; r++){
        if (getAssign(r, ds) === '遅'){
           rows.push({
            r,
            isA: (State.employeesAttr[r]?.level) === 'A',
            isNightOnly: (State.employeesAttr[r]?.workType) === 'night',
            locked: isLocked(r, ds),
            lateCount4w: countSpecificShift4w(r, '遅') // 遅の回数を追加
          });
        }
      }
      // 改善: 遅の回数が多い人から優先的に〇に戻す
      rows.sort((a,b) => {
        if (a.locked !== b.locked) return a.locked ? 1 : -1;
        if (a.isNightOnly !== b.isNightOnly) return a.isNightOnly ? 1 : -1;
        if (a.isA !== b.isA) return a.isA ? 1 : -1; // B優先
        return b.lateCount4w - a.lateCount4w; // 遅が多い人優先
      });
      for (const row of rows){
        if (lateCount <= lateTarget) break;
        if (row.locked) continue;
        setAssign(row.r, ds, '〇');
        lateCount--;
      }
    }

    // ===== Step2: 早・遅が不足している場合は〇から振り分ける =====
    if (earlyTarget !== null && earlyCount < earlyTarget){
      let guard = State.employeeCount * 2;
      while (earlyCount < earlyTarget && guard-- > 0){
        let candidates = [];
        for (let r = 0; r < State.employeeCount; r++){
          if (getAssign(r, ds) !== '〇') continue;
          if (!A.canAssignEarlyShiftForNormalize(r, dayIdx)) continue;
          candidates.push({
              r,
              isA: (State.employeesAttr[r]?.level) === 'A',
              earlyCount4w: countSpecificShift4w(r, '早')
          });
        }
        if (candidates.length === 0) break;
        // 改善: 早が少ない人を優先
        candidates.sort((a, b) => {
            if (a.isA !== b.isA) return a.isA ? 1 : -1; // B優先
            return a.earlyCount4w - b.earlyCount4w; // 早が少ない人優先
        });
        const best = candidates[0];
        setAssign(best.r, ds, '早');
        earlyCount++;
      }
    }

    if (lateTarget !== null && lateCount < lateTarget){
      let guard = State.employeeCount * 2;
      while (lateCount < lateTarget && guard-- > 0){
        let candidates = [];
        for (let r = 0; r < State.employeeCount; r++){
          if (getAssign(r, ds) !== '〇') continue;
          if (!A.canAssignLateShiftForNormalize(r, dayIdx)) continue;
          candidates.push({
              r,
              isA: (State.employeesAttr[r]?.level) === 'A',
              lateCount4w: countSpecificShift4w(r, '遅')
          });
        }
        if (candidates.length === 0) break;
        // 改善: 遅が少ない人を優先
        candidates.sort((a, b) => {
            if (a.isA !== b.isA) return a.isA ? 1 : -1; // B優先
            return a.lateCount4w - b.lateCount4w; // 遅が少ない人優先
        });
        const best = candidates[0];
        setAssign(best.r, ds, '遅');
        lateCount++;
      }
    }
  }

  // === 公開API ===
  A.reduceDayShiftTo = reduceDayShiftTo;
  A.enforceExactCount = enforceExactCount;
  A.enforceDayShiftFixedCounts = enforceDayShiftFixedCounts;
})();
