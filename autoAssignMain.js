// autoAssignMain.js
// 自動割り当て処理のメインアルゴリズムを提供するモジュール。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * 指定された日付範囲に対して自動で夜勤・日勤・早出・遅出を割り当てます。
   * 各種固定値や上限値は window.Counts に設定されているものを使用します。
   */
  function autoAssignRange(startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const addDays = A.addDays;
    const getAssign = A.getAssign;
    const setAssign = A.setAssign;
    const clearAssign = A.clearAssign;
    const isRestByDate = A.isRestByDate;
    const isLocked = A.isLocked;
    // 目標 NF 人数
    function targetNFFor(ds){
      if (window.Counts && typeof window.Counts.getFixedNF === 'function'){
        return window.Counts.getFixedNF(ds);
      }
      return (window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3;
    }
    // 目標 NS 人数
    function targetNSFor(ds){
      if (window.Counts && typeof window.Counts.getFixedNS === 'function'){
        return window.Counts.getFixedNS(ds);
      }
      return (window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3;
    }
    // 夜勤割当フェーズ：日付順序をランダム化
    let dayOrderForNightShift = [];
    for (let d = startDayIdx; d <= endDayIdx; d++){
      dayOrderForNightShift.push(d);
    }
    dayOrderForNightShift = A.shuffleArray(dayOrderForNightShift);
    // 3 回スウィープして NF/NS 不足を埋める
    for (let sweep = 0; sweep < 3; sweep++){
      let changed = false;
      for (const d of dayOrderForNightShift){
        const ds = dateStr(State.windowDates[d]);
        const FIXED_NF = targetNFFor(ds);
        const FIXED_NS = targetNSFor(ds);
        let { nf, ns, hasANf, hasANs } = A.countDayStats(d);
        if (nf < FIXED_NF){
          const before = nf;
          A.fillWith(d, FIXED_NF - nf, ['☆','◆'], !hasANf);
          nf = A.countDayStats(d).nf;
          if (nf > FIXED_NF){
            A.enforceExactCount(d, FIXED_NF, FIXED_NS);
            nf = A.countDayStats(d).nf;
          }
          if (nf !== before) changed = true;
        }
        if (ns < FIXED_NS){
          const before = ns;
          A.fillWith(d, FIXED_NS - ns, ['★','●'], !hasANs);
          ns = A.countDayStats(d).ns;
          if (ns > FIXED_NS){
            A.enforceExactCount(d, FIXED_NF, FIXED_NS);
            ns = A.countDayStats(d).ns;
          }
          if (ns !== before) changed = true;
        }
      }
      if (!changed) break;
    }
    // 夜勤帯のノルマチェック。NightBand が存在し、nightQuotasOK が false の場合の処理
    if (!A.nightQuotasOK(startDayIdx, endDayIdx)){
      for (const d of A.shuffleArray(dayOrderForNightShift)){
        const ds = dateStr(State.windowDates[d]);
        const FIXED_NF = targetNFFor(ds);
        const FIXED_NS = targetNSFor(ds);
        let { nf, ns } = A.countDayStats(d);
        if (nf < FIXED_NF) A.fillWith(d, FIXED_NF - nf, ['☆','◆'], true);
        if (ns < FIXED_NS) A.fillWith(d, FIXED_NS - ns, ['★','●'], true);
        A.enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    }
    // 夜勤専従のノルマ 10 を満たすまで割り当て
    (function ensureNightToTen(){
      let nightEmpOrder = [];
      for (let r = 0; r < State.employeeCount; r++){
        if ((State.employeesAttr[r]?.workType) === 'night') nightEmpOrder.push(r);
      }
      nightEmpOrder = A.shuffleArray(nightEmpOrder);
      for (const r of nightEmpOrder){
        const now = A.countLast28Days(r, State.windowDates[State.range4wStart + 27]).star;
        const quota = State.employeesAttr[r]?.nightQuota || 10;
        let need = Math.max(0, quota - now);
        if (need === 0) continue;
        for (let d = startDayIdx; d <= endDayIdx - 1 && need > 0; d++){
          const ds0 = dateStr(State.windowDates[d]);
          const dsNext = dateStr(State.windowDates[d+1]);
          if (getAssign(r, ds0) || getAssign(r, dsNext)) continue;
          if (isRestByDate(r, ds0) || isRestByDate(r, dsNext)) continue;
          if (A.tryPlace(d, r, '☆')) need--;
        }
      }
    })();
    // 夜勤専従配置後に厳格化
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const ds = dateStr(State.windowDates[d]);
      const FIXED_NF = targetNFFor(ds);
      const FIXED_NS = targetNSFor(ds);
      A.enforceExactCount(d, FIXED_NF, FIXED_NS);
    }
    // 夜勤専従ノルマ完全達成まで繰り返す厳格化
    (function ensureNightToQuotaStrict(){
      const MAX_ATTEMPTS = 100;
      let nightEmpOrder = [];
      for (let r = 0; r < State.employeeCount; r++){
        if ((State.employeesAttr[r]?.workType) === 'night') nightEmpOrder.push(r);
      }
      if (nightEmpOrder.length === 0) return;
      let attempts = 0;
      let allSatisfied = false;
      while (!allSatisfied && attempts < MAX_ATTEMPTS){
        attempts++;
        allSatisfied = true;
        nightEmpOrder = A.shuffleArray(nightEmpOrder);
        for (const r of nightEmpOrder){
          const now = A.countLast28Days(r, State.windowDates[State.range4wStart + 27]).star;
          const quota = State.employeesAttr[r]?.nightQuota || 10;
          let need = Math.max(0, quota - now);
          if (need === 0) continue;
          allSatisfied = false;
          // 日付順をシャッフルして配置を試みる
          let dayOrder = [];
          for (let d = startDayIdx; d <= endDayIdx - 1; d++) dayOrder.push(d);
          dayOrder = A.shuffleArray(dayOrder);
          for (const d of dayOrder){
            if (need <= 0) break;
            const ds0 = dateStr(State.windowDates[d]);
            const dsNext = dateStr(State.windowDates[d+1]);
            if (getAssign(r, ds0) || getAssign(r, dsNext)) continue;
            if (isRestByDate(r, ds0) || isRestByDate(r, dsNext)) continue;
            if (isLocked(r, ds0) || isLocked(r, dsNext)) continue;
            if (A.tryPlace(d, r, '☆')) need--;
          }
        }
      }
      // ノルマ未達の場合はトーストで通知
      const unmetList = [];
      for (const r of nightEmpOrder){
        const now = A.countLast28Days(r, State.windowDates[State.range4wStart + 27]).star;
        const quota = State.employeesAttr[r]?.nightQuota || 10;
        if (now < quota){
          const name = State.employees ? (State.employees[r] || `職員${r+1}`) : `職員${r+1}`;
          unmetList.push(`${name}: ${now}/${quota}`);
          if (typeof A.showToast === 'function'){
            console.warn(`夜勤専従 ${name} のノルマ未達: ${now}/${quota}`);
          }
        }
      }
      if (unmetList.length > 0 && typeof A.showToast === 'function'){
        A.showToast(`⚠️ 夜勤専従ノルマ未達: ${unmetList.join(', ')}`);
      }
    })();
    // 再度厳格化
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const ds = dateStr(State.windowDates[d]);
      const FIXED_NF = targetNFFor(ds);
      const FIXED_NS = targetNSFor(ds);
      A.enforceExactCount(d, FIXED_NF, FIXED_NS);
    }
    // A レベルの NF/NS を必ず配置するように調整
    (function enforceANightBands(){
      const dayOrder = A.shuffleArray(dayOrderForNightShift.slice());
      for (const d of dayOrder){
        let { hasANf, hasANs } = A.countDayStats(d);
        if (hasANf && hasANs) continue;
        const ds = dateStr(State.windowDates[d]);
        const prevDs = (d > 0) ? dateStr(State.windowDates[d-1]) : null;
        const nextDs = (d + 1 < State.windowDates.length) ? dateStr(State.windowDates[d+1]) : null;
        const getLv = (i) => (State.employeesAttr[i]?.level) || 'B';
        const nonArows = (marks) => {
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
        const findAFor = (mark) => {
          const cand = A.shuffleArray(A.candidatesFor(d, mark).filter(r => getLv(r) === 'A'));
          for (const r of cand){
            if (A.tryPlace(d, r, mark)) return r;
            if (mark === '★' && A.placePrevStar(d, r)) return r;
          }
          return null;
        };
        // NF 帯の A 配置
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
              if (hadNext) setAssign(r, nextDs, '★');
              setAssign(r, ds, '☆');
            }
          }
        }
        // NS 帯の A 配置
        ({ hasANf, hasANs } = A.countDayStats(d));
        if (!hasANs){
          let placed = false;
          for (const r of nonArows(['●'])){
            const keep = '●';
            clearAssign(r, ds);
            const rA = findAFor('●');
            if (rA !== null){ placed = true; break; }
            setAssign(r, ds, keep);
          }
          if (!placed){
            for (const r of nonArows(['★'])){
              const hadPrev = prevDs && getAssign(r, prevDs) === '☆';
              if (hadPrev) clearAssign(r, prevDs);
              clearAssign(r, ds);
              const rA = findAFor('★');
              if (rA !== null){ placed = true; break; }
              setAssign(r, ds, '★');
              if (hadPrev) setAssign(r, prevDs, '☆');
            }
          }
        }
      }
    })();
    // 残りの夜勤不足を埋める
    (function fillRemainingNightShifts(){
      for (let d = startDayIdx; d <= endDayIdx; d++){
        const ds = dateStr(State.windowDates[d]);
        const FIXED_NF = targetNFFor(ds);
        const FIXED_NS = targetNSFor(ds);
        let { nf, ns } = A.countDayStats(d);
        if (nf < FIXED_NF){
          A.fillWith(d, FIXED_NF - nf, ['☆','◆'], true);
        }
        if (ns < FIXED_NS){
          A.fillWith(d, FIXED_NS - ns, ['★','●'], true);
        }
        A.enforceExactCount(d, FIXED_NF, FIXED_NS);
      }
    })();
    // 日勤を割り当てる
    for (let d = startDayIdx; d <= endDayIdx; d++){
      const targetDay = A.targetDayForIndex(d);
      const dt = State.windowDates[d];
      const ds = dateStr(dt);
      const now = A.countDayStats(d).day;
      let need = targetDay - now;
      if (need > 0){
        const filler = A.fillDayShift(d);
        filler(need);
      }
      // 正規化
      if (typeof A.normalizeOffToEight === 'function'){
        A.normalizeOffToEight(startDayIdx, endDayIdx);
      }
      // 固定人数の厳格化
      A.enforceDayShiftFixedCounts(d);
    }
// 改善：日勤割り当て後、夜勤帯のA職員確保を再確認
// 日勤割り当て時に夜勤帯のA職員が削除される可能性があるため、最終確認を実施
for (let d = startDayIdx; d <= endDayIdx; d++){
  const ds = dateStr(State.windowDates[d]);
  const FIXED_NF = targetNFFor(ds);
  const FIXED_NS = targetNSFor(ds);
  A.enforceExactCount(d, FIXED_NF, FIXED_NS);  // ← 最終確認で夜勤帯のA職員を確保
}


    // 最終的な連休最低確保
    if (typeof A.ensureRenkyuMin2 === 'function'){
      A.ensureRenkyuMin2(startDayIdx, endDayIdx);
    }
  }
  // === 公開API ===
  A.autoAssignRange = autoAssignRange;
})();