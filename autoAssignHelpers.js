// autoAssignHelpers.js
// ヘルパー関数群を定義するモジュール。
// AutoAssignLogic.init() により設定された参照を利用して処理を行います。

(function(){
  'use strict';
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  /**
   * NightBand コンテキストを構築します。
   * NightBand プラグインが存在する場合に必要な情報をまとめます。
   */
  function nbCtx(){
    const State = A.State;
    return {
      dates: State.windowDates,
      employeeCount: State.employeeCount,
      range4wStart: State.range4wStart,
      getAssign: A.getAssign,
      hasOffByDate: (r, ds) => A.hasOffByDate(r, ds),
      getEmpAttr: (r) => State.employeesAttr[r] || { level:'B', workType:'three' },
      isHolidayDs: (ds) => State.holidaySet.has(ds)
    };
  }
  /**
   * 指定日の勤務人数および各帯の人数をカウントします。
   * NightBand が提供されていればそちらを使用し、無ければ手動で集計します。
   */
  function countDayStats(dayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    if (window.NightBand && window.NightBand.countDayStats){
      return window.NightBand.countDayStats(nbCtx(), dayIdx);
    }
    const ds = dateStr(State.windowDates[dayIdx]);
    let day = 0, nf = 0, ns = 0;
    let hasADay = false, hasANf = false, hasANs = false;
    for (let r = 0; r < State.employeeCount; r++){
      const mk = getAssign(r, ds);
      const lvl = (State.employeesAttr[r]?.level) || 'B';
      if (mk === '〇' || mk === '早' || mk === '遅'){
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
    // early/late は NightBand の fallback では使用しないため undefined のまま返す
    return { day, nf, ns, early: undefined, late: undefined, hasADay, hasANf, hasANs };
  }
  /**
   * 勤務候補者リストを取得します。
   * NightBand.candidatesFor が存在すればそちらを使用し、なければ独自フィルタを適用します。
   */
  function candidatesFor(dayIdx, mark){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const isLocked = A.isLocked;
    let out = (window.NightBand && window.NightBand.candidatesFor)
      ? window.NightBand.candidatesFor(nbCtx(), dayIdx, mark)
      : [];
    const ds = dateStr(State.windowDates[dayIdx]);
    out = out.filter(r => {
      if (isLocked(r, ds)) return false;
      if (mark === '☆'){
        const isLast = (dayIdx === State.windowDates.length - 1);
        if (!isLast){
          const n = dayIdx + 1;
          if (n >= State.windowDates.length) return false;
          const nds = dateStr(State.windowDates[n]);
          if (isLocked(r, nds)) return false;
        }
        const p = dayIdx - 1;
        if (p >= 0){
          const pds = dateStr(State.windowDates[p]);
          const wt  = (State.employeesAttr[r]?.workType) || 'three';
          if (wt !== 'night' && getAssign(r, pds) === '★') return false;
        }
      }
      if (mark === '〇' || mark === '早' || mark === '☆' || mark === '★' || mark === '●'){
        const prev = dayIdx - 1;
        if (prev >= 0){
          const pds = dateStr(State.windowDates[prev]);
          const prevMk = getAssign(r, pds);
          if (prevMk === '◆'){
            return false;
          }
        }
      }
      return true;
    });
    return out;
  }
  /**
   * 軟休（祝・代）をクリアします。soft leave は NIGHTBand などで使用されることがあります。
   */
  function clearSoftLeaveIfAny(empIdx, ds){
    const lv = A.getLeaveType(empIdx, ds);
    const isSoftLeave = (code) => code === '祝' || code === '代';
    if (lv && isSoftLeave(lv)) A.clearLeaveType(empIdx, ds);
  }
  /**
   * 指定位置に勤務記号を割り当てる関数。ルールチェックや後処理を含みます。
   */
  function tryPlace(dayIdx, r, mark){
    const State = A.State;
    const dateStr = A.dateStr;
    const addDays = A.addDays;
    const getAssign = A.getAssign;
    const setAssign = A.setAssign;
    const clearAssign = A.clearAssign;
    const isLocked = A.isLocked;
    const isRestByDate = A.isRestByDate;
    const getLeaveType = A.getLeaveType;
    const clearLeaveType = A.clearLeaveType;
    const ds = dateStr(State.windowDates[dayIdx]);
    if (isLocked(r, ds)) return false;
    // ☆の場合のみ、28日目→画面外29日目へのペアも許容する
    let datesForRules = State.windowDates;
    if (mark === '☆'){
      const isLast = (dayIdx === State.windowDates.length - 1);
      if (!isLast){
        const n = dayIdx + 1;
        if (n >= State.windowDates.length) return false;
        const nds = dateStr(State.windowDates[n]);
        if (isLocked(r, nds)) return false;
      } else {
        const baseDate = State.windowDates[dayIdx];
        const extra = [ addDays(baseDate, 1), addDays(baseDate, 2), addDays(baseDate, 3) ];
        datesForRules = State.windowDates.concat(extra);
      }
    }
    const pre = window.AssignRules?.precheckPlace?.({
      rowIndex: r, dayIndex: dayIdx, mark,
      dates: datesForRules, employeeCount: State.employeeCount,
      getAssign,
      hasOffByDate: (i, ds0) => isRestByDate(i, ds0),
      getWorkType: (i) => (State.employeesAttr[i]?.workType) || 'three',
      getLevel:   (i) => (State.employeesAttr[i]?.level)    || 'B',
      getForbiddenPairs: (i) => State.forbiddenPairs?.get(i) || new Set()
    }) || { ok: true };
    if (!pre.ok) return false;
    clearSoftLeaveIfAny(r, ds);
    setAssign(r, ds, mark);
    if (mark === '☆' && window.Rules?.applyAfterAssign){
      const res = window.Rules.applyAfterAssign({
        rowIndex: r, dayIndex: dayIdx, mark,
        getAssign, setAssign, clearAssign,
        hasOffByDate: A.hasOffByDate,
        getLeaveType,
        clearLeaveType,
        getWorkType: (i) => (State.employeesAttr[i]?.workType) || 'three',
        gridEl: null, dates: datesForRules
      });
      if (!res.ok){
        clearAssign(r, ds);
        return false;
      }
    }
    return true;
  }
  /**
   * Fisher–Yates アルゴリズムによる配列のシャッフル。
   * 元の配列は破壊せず、新しい配列を返します。
   */
  function shuffleArray(arr){
    const result = Array.isArray(arr) ? arr.slice() : [];
    for (let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }
  /**
   * 祝日セットおよび曜日からその日が土日祝かどうか判定します。
   */
  function isWeekendOrHoliday(dt){
    const State = A.State;
    const dateStr = A.dateStr;
    const w = dt.getDay();
    const ds = dateStr(dt);
    return (w === 0 || w === 6) || (State.holidaySet && State.holidaySet.has(ds));
  }
  /**
   * 日付インデックスに対する目標日勤人数を計算します。
   * Counts 設定が存在すれば固定値を優先し、無ければ平日/土日祝ごとにデフォルト値を返します。
   */
  function targetDayForIndex(dayIdx){
    const State = A.State;
    const dt = State.windowDates[dayIdx];
    const ds = A.dateStr(dt);
    if (window.Counts && typeof window.Counts.getFixedDayCount === 'function'){
      const fixed = window.Counts.getFixedDayCount(ds);
      if (typeof fixed === 'number') return fixed;
    }
    if (window.Counts){
      const isWH = isWeekendOrHoliday(dt);
      if (isWH && Number.isInteger(window.Counts.DAY_TARGET_WEEKEND_HOLIDAY)){
        return window.Counts.DAY_TARGET_WEEKEND_HOLIDAY;
      }
      if (!isWH && Number.isInteger(window.Counts.DAY_TARGET_WEEKDAY)){
        return window.Counts.DAY_TARGET_WEEKDAY;
      }
    }
    return isWeekendOrHoliday(dt) ? 6 : 10;
  }
  /**
   * 直近4週間の日勤回数をカウントします（早・遅含む）。
   */
  function countDayShift4w(r){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    let c = 0;
    const startIdx = State.range4wStart;
    const endIdx   = State.range4wStart + 27;
    for (let i = startIdx; i <= endIdx && i < State.windowDates.length; i++){
      const ds2 = dateStr(State.windowDates[i]);
      const mk2 = getAssign(r, ds2);
      if (mk2 === '〇' || mk2 === '早' || mk2 === '遅') c++;
    }
    return c;
  }
  /**
   * NightBand の定員チェックを行う関数。NightBand が存在しなければ常に true を返します。
   */
  function nightQuotasOK(startIdx, endIdx){
    if (window.NightBand && window.NightBand.nightQuotasOK){
      return window.NightBand.nightQuotasOK(nbCtx(), startIdx, endIdx);
    }
    return true;
  }
  /**
   * 指定職員について直近28日間の☆回数を数えます。
   */
  function countLast28Days(r, endDt){
    const addDays = A.addDays;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const start = addDays(endDt, -27);
    let star = 0;
    for (let i = 0; i < 28; i++){
      const dt = addDays(start, i);
      const ds = dateStr(dt);
      const mk = window.globalGetAssign ? window.globalGetAssign(r, ds) : getAssign(r, ds);
      if (mk === '☆') star++;
    }
    return { star };
  }
  /**
   * 連休の最低ブロック数を確保するための調整を行います。
   * 社内で 2 連休が最低保証されるように、単発の休日などを調整します。
   */
  function ensureRenkyuMin2(startDayIdx, endDayIdx){
    const State = A.State;
    const dateStr = A.dateStr;
    const getAssign = A.getAssign;
    const setAssign = A.setAssign;
    const clearAssign = A.clearAssign;
    const isLocked = A.isLocked;
    const addDays = A.addDays;
    const hasOffByDate = A.hasOffByDate;
    // 補助関数：日付 idx の勤務が休みかどうか
    const isOffAt = (r, idx) => {
      const ds = dateStr(State.windowDates[idx]);
      const mk = getAssign(r, ds);
      return hasOffByDate(r, ds) || !mk;
    };
    // ブロック長 2 以上の休暇期間を数えます
    const countBlocks = (r) => {
      const blocks = [];
      let i = startDayIdx;
      while (i <= endDayIdx){
        if (!isOffAt(r, i)) { i++; continue; }
        let s = i, len = 0;
        while (i <= endDayIdx && isOffAt(r, i)){ len++; i++; }
        if (len >= 2) blocks.push([s, i - 1]);
      }
      return blocks;
    };
    // 指定日の日勤をクリアして別のスタッフで埋め戻す処理
    const clearAndBackfill = (r, dayIdx) => {
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
        // AutoAssignLogic.fillWith が存在すればそれを使用
        if (typeof A.fillWith === 'function'){
          A.fillWith(dayIdx, need, ['〇'], !hasADay);
        }
        ({ day, hasADay } = countDayStats(dayIdx));
        if (day > maxDay || day < minDay || !hasADay){
          setAssign(r, ds, '〇');
          return false;
        }
      }
      return true;
    };
    // 単発の休みの隣の日勤をクリアし休みにする試み
    const tryExpandSingle = (r) => {
      let i = startDayIdx;
      while (i <= endDayIdx){
        if (!isOffAt(r, i)) { i++; continue; }
        let s = i, len = 0;
        while (i <= endDayIdx && isOffAt(r, i)){ len++; i++; }
        if (len === 1){
          const left = s - 1, right = s + 1;
          const order = [];
          if (left  >= startDayIdx) order.push(left);
          if (right <= endDayIdx)   order.push(right);
          for (const d of order){
            const ds0 = dateStr(State.windowDates[d]);
            if (getAssign(r, ds0) === '〇'){
              if (clearAndBackfill(r, d)) return true;
            }
          }
        }
      }
      return false;
    };
    // ダブル日勤を休みに変える試み
    const tryMakeFromDoubleDay = (r) => {
      for (let d = startDayIdx; d < endDayIdx; d++){
        const ds1 = dateStr(State.windowDates[d]);
        const ds2 = dateStr(State.windowDates[d + 1]);
        if (isOffAt(r, d) || isOffAt(r, d + 1)) continue;
        if (getAssign(r, ds1) === '〇' && getAssign(r, ds2) === '〇'){
          if (clearAndBackfill(r, d) && clearAndBackfill(r, d + 1)) return true;
          if (!isOffAt(r, d)) setAssign(r, ds1, '〇');
        }
      }
      return false;
    };
    // ランダム順で社員を処理する
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
  // === 公開API ===
  A.nbCtx = nbCtx;
  A.countDayStats = countDayStats;
  A.candidatesFor = candidatesFor;
  A.clearSoftLeaveIfAny = clearSoftLeaveIfAny;
  A.tryPlace = tryPlace;
  A.shuffleArray = shuffleArray;
  A.isWeekendOrHoliday = isWeekendOrHoliday;
  A.targetDayForIndex = targetDayForIndex;
  A.countDayShift4w = countDayShift4w;
  A.nightQuotasOK = nightQuotasOK;
  A.countLast28Days = countLast28Days;
  A.ensureRenkyuMin2 = ensureRenkyuMin2;
})();
