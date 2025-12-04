/* rules.js */
;(function (global) {
  /**
   * 連鎖ルール適用：セル確定直後に呼ぶ
   * @param {Object} p
   *  - rowIndex, dayIndex, mark
   *  - getAssign(row, dateStr): string|undefined
   *  - setAssign(row, dateStr, mark): void
   *  - clearAssign(row, dateStr): void
   *  - hasOffByDate(row, dateStr): boolean  希望休判定
   *  - getLeaveType(row, dateStr): '祝'|'代'|'年'|'リ'|undefined  ← 追加で渡される場合あり
   *  - clearLeaveType(row, dateStr): void                           ← 追加で渡される場合あり
   *  - gridEl: HTMLTableElement             セルDOM更新に使用（任意）
   *  - dates: Date[]                         当月日付配列
   * @returns {{ok:boolean, message?:string}}
   */
function applyAfterAssign(p) {
  // ルール：☆ の翌日は必ず ★
  if (p.mark === '☆') {
    const next = p.dayIndex + 1;
    if (next >= p.dates.length) {
      return { ok: false, message: '月末のため「通し夜勤（☆→★）」を設定できません' };
    }
    const nds = dateStr(p.dates[next]);
    if (p.hasOffByDate(p.rowIndex, nds)) {
      return { ok: false, message: '翌日が希望休のため「通し夜勤」は設定できません' };
    }
    // 付随して翌日を★に固定（前処理：祝/代は消してから★）
    if (typeof p.getLeaveType === 'function' && typeof p.clearLeaveType === 'function') {
      const lvNext = p.getLeaveType(p.rowIndex, nds);
      if (lvNext === '祝' || lvNext === '代') p.clearLeaveType(p.rowIndex, nds);
    }
if (p.getAssign(p.rowIndex, nds) !== '★') p.setAssign(p.rowIndex, nds, '★');
if (p.gridEl) {
  const td = p.gridEl.querySelector(`td[data-row="${p.rowIndex}"][data-day="${next}"]`);
  if (td) {
    td.textContent = '';
    const sp = document.createElement('span');
    sp.className = 'mark ' + markToClass('★');
    sp.textContent = '★';
    td.appendChild(sp);
  }
}

// 夜勤専従のみ例外：☆★の後も休休を強制しない
const isNight = (typeof p.getWorkType === 'function') && p.getWorkType(p.rowIndex) === 'night';
if (!isNight) {
  const rest1 = p.dayIndex + 2;
  const rest2 = p.dayIndex + 3;
  if (rest2 >= p.dates.length) {
    return { ok:false, message:'月末のため「☆★→休休」を設定できません' };
  }
  [rest1, rest2].forEach(idx=>{
    const rds = dateStr(p.dates[idx]);
    p.clearAssign(p.rowIndex, rds);
    if (p.gridEl) {
      const td2 = p.gridEl.querySelector(`td[data-row="${p.rowIndex}"][data-day="${idx}"]`);
      if (td2) td2.textContent = '';
    }
  });
}

  }
  return { ok: true };
}


  // 共通ユーティリティ（app.js と同名で使用される想定）
  function dateStr(d) {
    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice( -2 );
    const dd = ('0' + d.getDate()).slice( -2 );
    return `${y}-${m}-${dd}`;
  }

  // app.js の markToClass を参照（未定義なら簡易版）
  function markToClass(mk) {
    if (global.MARK_MAP && global.MARK_MAP[mk]) return global.MARK_MAP[mk].className;
    return '';
  }

  global.Rules = { applyAfterAssign };
})(window);
