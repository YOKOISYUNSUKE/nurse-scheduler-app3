// ====== セル操作関連 ======
// app.jsから切り出したセルクリック時の操作ロジック

(function(){
  'use strict';

  // app.jsのグローバル変数・関数への参照
  let State, grid;
  let dateStr, getAssign, setAssign, clearAssign;
  let hasOffByDate, getLeaveType, setLeaveType, clearLeaveType;
  let isLocked, setLocked;
  let showToast, updateFooterCounts, renderGrid, refresh4wSummaryForRow;
  let isRestByDate, markToClass, leaveClassOf;


  // 初期化関数（app.jsから呼ばれる）
  window.CellOperations = {
    init: function() {
      // グローバル変数・関数の取得
      State = window.State;
      grid = document.getElementById('grid');
      dateStr = window.App?.Dates?.dateStr;
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
      renderGrid = window.renderGrid;
      refresh4wSummaryForRow = window.refresh4wSummaryForRow;
      isRestByDate = window.isRestByDate;
      markToClass = window.markToClass;
      leaveClassOf = window.leaveClassOf;
    },



    // 公開関数
    toggleHoliday: toggleHoliday,
    toggleLeave: toggleLeave,
    toggleOff: toggleOff,
    cycleAssign: cycleAssign
  };

  // === 祝日トグル ===
  function toggleHoliday(dayIdx){
    const ds = dateStr(State.windowDates[dayIdx]);
    if(State.holidaySet.has(ds)) State.holidaySet.delete(ds);
    else State.holidaySet.add(ds);
    renderGrid();
  }

  // === 勤務形態別クリックサイクル ===
  function cycleOrderFor(r){
    const wt = (State.employeesAttr[r]?.workType) || 'three';
    switch (wt){
      case 'two':   return ['', '〇', '早', '遅', '☆', ''];                
      case 'three': return ['', '〇', '早', '遅', '◆', '●', ''];            
      case 'day':   return ['', '〇', '早', '遅', '☆', '◆', '●', ''];   
      case 'night': return ['', '☆', ''];                           
      default:      return ['', '〇', '早', '遅', '◆', '●', ''];
    }
  }

  function nextCycleMark(cur, order){
    const idx = order.indexOf(cur || '');
    return order[(idx + 1) % order.length];
  }

  // === 手動割り当て専用の軽量連鎖「☆→翌日★」 ===
  function forceNextDayStar(r, dayIdx){
    const nextIndex = dayIdx + 1;
    if (nextIndex >= State.windowDates.length) return;
    const dsNext = dateStr(State.windowDates[nextIndex]);
    
    if (hasOffByDate(r, dsNext)) return;
    const cur = getAssign(r, dsNext);
    if (cur === '★' || (cur && cur !== '')) return;

   if (getAssign(r, dsNext) !== '★' && getAssign(r, dateStr(State.windowDates[dayIdx])) === '☆') setAssign(r, dsNext, '★');
    const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
    if (nextCell){
      nextCell.textContent = '';
      const sp = document.createElement('span');
      sp.className = 'mark ' + markToClass('★');
      sp.textContent = '★';
      nextCell.appendChild(sp);
    }

    // 28日目の翌日★は自動ロック
if (getAssign(r, dsNext) === '★' && dayIdx === State.range4wStart + 27){
  setLocked(r, dsNext, true);
  const nc = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
  if (nc) nc.classList.add('locked');
}

    if (typeof updateFooterCounts === 'function') updateFooterCounts();
    if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);

  }

  // === 翌日の「★」を強制消去 ===
  function removeNextDayStarIfAny(r, dayIdx){
    const nextIndex = dayIdx + 1;
    if (nextIndex >= State.windowDates.length) return;
    const nds = dateStr(State.windowDates[nextIndex]);
    if (getAssign(r, nds) === '★'){
      clearAssign(r, nds);
      setLocked(r, nds, false);
      const nextCell = grid.querySelector(`td[data-row="${r}"][data-day="${nextIndex}"]`);
      if (nextCell){
        nextCell.classList.remove('locked');
        nextCell.textContent = '';
      }
      if (typeof updateFooterCounts === 'function') updateFooterCounts();
      if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
    }
  }


  // === 割当モード：マークサイクル ===
  function cycleAssign(r, d, td){
    const IGNORE_RULES_ON_MANUAL = true;
    const ds = dateStr(State.windowDates[d]);
    
    if (isLocked(r, ds)){ 
      showToast('ロック中のセルは変更できません'); 
      return; 
    }
    
    const lvHere = getLeaveType(r, ds);
    if (lvHere && lvHere !== '代'){ 
      showToast('特別休暇のため変更不可（祝/年/リ）'); 
      return; 
    }
    if (lvHere === '代'){
      clearLeaveType(r, ds);
      td.textContent = '';
      td.classList.remove('off');
    }

    if (hasOffByDate(r, ds)) { 
      showToast('希望休のため割当不可');
      return; 
    }

    const current = getAssign(r, ds) || '';
    const order = cycleOrderFor(r);
    const next = nextCycleMark(current, order);
    const wasNightThrough = (current === '☆');

    // 空→消去
    if (next === '') {
      clearAssign(r, ds);
      td.textContent = '';
      if (wasNightThrough) {
        removeNextDayStarIfAny(r, d);
      }
      updateFooterCounts();
      if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
      return;
    }


    // 勤務形態チェック（手動はスキップ）
    if (!IGNORE_RULES_ON_MANUAL && window.AssignRules && typeof window.AssignRules.canAssign === 'function') {
      const empAttr = State.employeesAttr[r] || { level:'B', workType:'three' };
      const ok1 = window.AssignRules.canAssign({ empAttr, mark: next });
      if (!ok1.ok){ 
        showToast(ok1.message||'勤務形態に合いません'); 
        return; 
      }
    }

    // 日内組合せチェック（手動はスキップ）
    if (!IGNORE_RULES_ON_MANUAL && window.AssignRules && typeof window.AssignRules.precheckPlace === 'function') {
      const ok2 = window.AssignRules.precheckPlace({
        rowIndex:r, dayIndex:d, mark:next,
        dates:State.windowDates, employeeCount:State.employeeCount,
        getAssign, hasOffByDate:(i,ds2)=>hasOffByDate(i, ds2),
        getWorkType: (i)=> (State.employeesAttr[i]?.workType) || 'three',
        getLevel:   (i)=> (State.employeesAttr[i]?.level)    || 'B'
      });
      if (!ok2.ok){ 
        showToast(ok2.message||'組合せ上限を超えます'); 
        return; 
      }
    }

    // 当日セル反映
    setAssign(r, ds, next);
    td.textContent = '';
    const span = document.createElement('span');
    span.className = 'mark ' + markToClass(next);
    span.textContent = next;
    td.appendChild(span);
    updateFooterCounts();
    if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);

    // ☆の翌日は★
    if (next === '☆') {
      forceNextDayStar(r, d);
    }


    // 連鎖ルール適用（手動はスキップ）
    if (!IGNORE_RULES_ON_MANUAL && window.Rules && typeof window.Rules.applyAfterAssign === 'function') {
      const result = window.Rules.applyAfterAssign({
        rowIndex: r, dayIndex: d, mark: next,
        getAssign, setAssign, clearAssign, 
        hasOffByDate: (i,ds)=>isRestByDate(i, ds),
        getLeaveType, clearLeaveType,
        gridEl: grid,
        dates: State.windowDates
      });

      if (!result.ok) {
        clearAssign(r, ds);
        td.textContent = '';
        updateFooterCounts(); 
        if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
        showToast(result.message || 'ルール違反です');
        return;
      } else {
        updateFooterCounts();
        if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
      }
    }

    // ☆を別記号に変更したら翌日の★を消す
    if (wasNightThrough && next !== '☆') {
      removeNextDayStarIfAny(r, d);
    }
  }

  // === 特別休暇トグル ===
function toggleLeave(r, d, td){
    const ds = dateStr(State.windowDates[d]);

    if (isLocked(r, ds)){ 
      showToast('ロック中のセルは変更できません'); 
      return; 
    }
    
    const code = State.leaveMode;
    if (!code) {
      showToast('特別休暇ボタンを先に選択してください');
      return;
    }
    
    // 既に同じ特別休暇が設定されている場合は解除
    const currentLeave = getLeaveType(r, ds);
    if (currentLeave === code) {
      clearLeaveType(r, ds);
      td.textContent = '';
      td.classList.remove('off');
      updateFooterCounts(d);
      if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
      showToast(`「${code}」を解除しました`);
      return;
    }

    // 希望休がある場合は先にクリア
    if (hasOffByDate(r, ds)) {
      const s = State.offRequests.get(r);
      if (s) {
        s.delete(ds);
        if (s.size === 0) State.offRequests.delete(r);
      }
    }
    
    // 既存の割り当てをクリア（特別休暇は勤務マークと排他）
    if (getAssign(r, ds)) {
      clearAssign(r, ds);
    }
    
    // 特別休暇を設定
    const ok = setLeaveType(r, ds, code);
    if (!ok) return;

    td.textContent = '';
    td.classList.add('off');
    const sp = document.createElement('span');
    sp.className = `leave ${leaveClassOf(code)}`;
    sp.textContent = code;
    td.appendChild(sp);

    removeNextDayStarIfAny(r, d);
    updateFooterCounts(d);
    if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
    showToast(`「${code}」を設定しました`);
}


  // === 希望休トグル ===
  function toggleOff(r, d, td){
    const ds = dateStr(State.windowDates[d]);
    
    if (isLocked(r, ds)){ 
      showToast('ロック中のセルは変更できません'); 
      return; 
    }
    
    const lvHere = getLeaveType(r, ds);
    
    if (lvHere && lvHere !== '代'){ 
      showToast('特別休暇のため変更不可（祝/年/リ）'); 
      return; 
    }
    if (lvHere === '代'){
      clearLeaveType(r, ds);
      td.textContent = '';
      td.classList.remove('off');
    }
    
    let s = State.offRequests.get(r);
    if(!s){ s = new Set(); State.offRequests.set(r,s); }

    // 解除
    if(s.has(ds)){
      s.delete(ds);
      td.classList.remove('off');
      td.textContent = '';
      updateFooterCounts();
      if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
      return;
    }


    // 単一休み3連続チェック
    const wouldViolate = (()=>{
      const isOffAt = (idx)=>{
        const dsi = dateStr(State.windowDates[idx]);
        const mk  = getAssign(r, dsi);
        const off = (hasOffByDate(r, dsi) || dsi === ds);
        return off || !mk;
      };
      let consecSingles = 0;
      let i = 0;
      while (i < State.windowDates.length){
        if (!isOffAt(i)) { i++; continue; }
        let len = 0;
        while (i < State.windowDates.length && isOffAt(i)) { len++; i++; }
        if (len === 1){
          consecSingles++;
          if (consecSingles > 2) return true;
        } else {
          consecSingles = 0;
        }
      }
      return false;
    })();
    
    if (wouldViolate){
      showToast('単一休みは連続2回までです（例：〇〇休〇休〇〇休〇→NG）');
      return;
    }

    // 休を反映
    s.add(ds);
    td.classList.add('off');
    td.textContent = '休';
    clearAssign(r, ds);
    removeNextDayStarIfAny(r, d);
    updateFooterCounts();
    if (typeof refresh4wSummaryForRow === 'function') refresh4wSummaryForRow(r);
  }


})();