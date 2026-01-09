/* app-render.js : グリッドレンダリング */
  function renderAll(){
    updatePeriodText();
    updateRange4wLabel();
    renderGrid();
  }

// ★追加：最下段の合計3行を描画
  function renderFooterCounts(){
    // 既存があれば作り直す
    const old = grid.querySelector('tfoot');
    if (old) old.remove();

    const tfoot = document.createElement('tfoot');
const rows = [
  { label: '〇 合計', key: 'day' },
  { label: '早 合計', key: 'early' },
  { label: '遅 合計', key: 'late' },
  { label: '（☆＋◆）合計', key: 'nf' },
  { label: '（★＋●）合計', key: 'ns' },
];

    rows.forEach(row=>{
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'col-emp';
      th.textContent = row.label;
      tr.appendChild(th);

      for(let d=0; d<28; d++){
        const td = document.createElement('td');
        td.dataset.day = String(d);
        td.dataset.sum = row.key;
        const c = countForDayLocal(d);
        td.textContent = String(c[row.key]);
        tr.appendChild(td);
      }
      tfoot.appendChild(tr);
    });

    grid.appendChild(tfoot);
  }

  // 合計セルだけ更新（高速）
  function updateFooterCounts(){
    const tfoot = grid.querySelector('tfoot');
    if (!tfoot){ renderFooterCounts(); return; }
    for(let d=0; d<Math.min(28, State.windowDates.length); d++){
const c = countForDayLocal(d);

tfoot.querySelector(`td[data-day="${d}"][data-sum="day"]`).textContent = c.day;
tfoot.querySelector(`td[data-day="${d}"][data-sum="early"]`).textContent = c.early;
tfoot.querySelector(`td[data-day="${d}"][data-sum="late"]`).textContent = c.late;
tfoot.querySelector(`td[data-day="${d}"][data-sum="nf"]`).textContent = c.nf;
tfoot.querySelector(`td[data-day="${d}"][data-sum="ns"]`).textContent = c.ns;

    }
  }
window.updateFooterCounts = updateFooterCounts; //

  // 指定行の4週間マーク・休日・時間セルだけ再計算（手動操作用）
// 修正後
  function refresh4wSummaryForRow(r){
    if (!grid || typeof r !== 'number') return;

    // ★重要：キャッシュをクリア（現在のウィンドウの日付で集計を行う）
    _winDateSet = null;
    _storeCache = null;

    const maxIdx = State.windowDates.length - 1;
    if (maxIdx < 0) return;

    const start4w = 0;
    const end4w   = Math.min(27, maxIdx);

    const tdMarks = grid.querySelector(`td.month-marks[data-row="${r}"]`);
    const tdEarly = grid.querySelector(`td.month-early[data-row="${r}"]`);
    const tdLate  = grid.querySelector(`td.month-late[data-row="${r}"]`);
    const tdOff   = grid.querySelector(`td.month-off[data-row="${r}"]`);
    const tdTotal = grid.querySelector(`td.month-total[data-row="${r}"]`);

    if (!tdMarks && !tdEarly && !tdLate && !tdOff && !tdTotal) return;

    // ---- マーク集計（〇 / 通し夜勤ペア / NF / NS） ----
    if (tdMarks){
      let cntO = 0, cntNightPair = 0, cntNF = 0, cntNS = 0;
      for (let d = start4w; d <= end4w; d++){
        const dt4 = State.windowDates[d];
        if (!dt4) continue;
        const ds4 = dateStr(dt4);
        const mk4 = globalGetAssign(r, ds4);
        if (!mk4) continue;

        if (mk4 === '〇'){
          cntO++;
        } else if (mk4 === '☆'){
          cntNightPair++;
        } else if (mk4 === '★'){
          // 直前が☆ならペアとして既にカウント済み
          const prevIdx = d - 1;
          let countedWithPrev = false;
          if (prevIdx >= start4w && prevIdx >= 0){
            const prevDt = State.windowDates[prevIdx];
            if (prevDt){
              const prevMk = globalGetAssign(r, dateStr(prevDt));
              if (prevMk === '☆') countedWithPrev = true;
            }
          }
          if (!countedWithPrev) cntNightPair++;
        } else if (mk4 === '◆'){
          cntNF++;
        } else if (mk4 === '●'){
          cntNS++;
        }
      }

      const lineTop = `〇${cntO}☆★${cntNightPair}`;
      const lineBottom = `◆${cntNF}●${cntNS}`;

      tdMarks.innerHTML = `
        <div class="mm-row">${lineTop}</div>
        <div class="mm-row">${lineBottom}</div>
      `.trim();
    }

    // ---- 早出・遅出集計（表示4週間） ----
    if (tdEarly || tdLate){
      let cntEarly = 0;
      let cntLate = 0;
      for (let d4 = start4w; d4 <= end4w; d4++){
        const dt4 = State.windowDates[d4];
        if (!dt4) continue;
        const ds4 = dateStr(dt4);
        const mk4 = globalGetAssign(r, ds4);
        if (mk4 === '早') cntEarly++;
        if (mk4 === '遅') cntLate++;
      }
      if (tdEarly) tdEarly.textContent = String(cntEarly);
      if (tdLate) tdLate.textContent = String(cntLate);
    }

    // ---- 休日集計＆勤務時間合計（表示4週間） ----
    let cntHoliday = 0;
    let totalMin   = 0;

    if (tdOff || tdTotal){
      for (let d4 = start4w; d4 <= end4w; d4++){
        const dt4 = State.windowDates[d4];
        if (!dt4) continue;
        const ds4 = dateStr(dt4);
        const isOff4 = globalHasOffByDate(r, ds4);
        const lv4 = globalHasLeave(r, ds4) ? (getLeaveType(r, ds4) || '') : undefined;
        const mk4 = globalGetAssign(r, ds4);

     // 特別休暇がある日は休日扱いしない（勤務日としてカウント）
    const hasLeave = !!lv4;
    // 休日判定：希望休フラグがあるか、マークがなく特別休暇もない
    const isRest = (isOff4 || !mk4) && !hasLeave;

    if (isRest){
      cntHoliday++;
      continue;
    }
    if (!mk4) continue;

        let minutes = 0;
        if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
          minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk4) || 0);
        } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
          minutes = Number(window.ShiftDurations.getDefaultForMark(mk4) || 0);
        } else {
          const fallback = { '〇':480, '早': 480, '遅': 540, '☆':480, '★':480, '◆':240, '●':240 };
          minutes = fallback[mk4] || 0;
        }
        totalMin += minutes;
      }

      if (tdOff){
        tdOff.textContent = String(cntHoliday);
      }

      if (tdTotal){
        const formatted = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(totalMin)
          : `${Math.floor(totalMin/60)}:${String(totalMin%60).padStart(2,'0')}`;
        tdTotal.textContent = formatted;

        // 36協定 4週間155時間超 → 赤字表示
        if (totalMin > 155 * 60){
          tdTotal.style.color = '#b91c1c';
          tdTotal.style.fontWeight = '700';
        } else {
          tdTotal.style.color = '';
          tdTotal.style.fontWeight = '';
        }
      }
    }
  }
  window.refresh4wSummaryForRow = refresh4wSummaryForRow;

function updatePeriodText(){
  const s = State.windowDates[0];
  const e = State.windowDates[27];
  periodText.textContent = `${s.getFullYear()}年${s.getMonth()+1}月${s.getDate()}日 〜 ${e.getFullYear()}年${e.getMonth()+1}月${e.getDate()}日`;
}

function updateRange4wLabel(){
  if (!range4wLabel) return;
  const s = State.windowDates[State.range4wStart];
  range4wLabel.textContent = `開始日：${s.getMonth()+1}/${s.getDate()}（28日間）`;
}
window.updateRange4wLabel = updateRange4wLabel;

function renderGrid(){
  grid.innerHTML = '';
  // ★重要：描画前にキャッシュをクリア（現在のウィンドウの日付で集計を行う）
  _winDateSet = null;

      // カレンダー月の範囲を決定（表示ウィンドウの先頭日を基準に、その月の1日〜末日）
      const anchor = State.windowDates[0];
      const year = anchor.getFullYear();
      const month = anchor.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0); // 月末日
      // 日リスト
      const days = [];
      for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) days.push(new Date(d));

      // ヘッダ
      const header = ['従業員'];
      days.forEach(dt => {
        const w  = '日月火水木金土'[dt.getDay()];
        header.push(`${dt.getMonth()+1}/${dt.getDate()}(${w})`);
      });
      // 末尾はカレンダー月ではなく「指定4週間(網掛け)」の勤務時間合計
      header.push('4週時間');
      rows.push(header);

      // 本体（カレンダー月の各日を globalGetAssign / globalHasOffByDate / globalHasLeave で参照）
      for (let r = 0; r < State.employeeCount; r++){
        const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
        const line = [name];

        // まずはカレンダー月ぶんの日セルをそのまま出力（表示内容は従来どおり）
        for (const dt of days){
          const ds = dateStr(dt);
          const isOff = globalHasOffByDate(r, ds);
          const lv = globalHasLeave(r, ds) ? (getLeaveType(r, ds) || '') : undefined;
          const mk = globalGetAssign(r, ds);

          const cell = lv ? lv : (isOff ? '休' : (mk || ''));
          line.push(cell);
        }

        // 続いて、表示中4週間（現在のウィンドウ）の勤務時間合計を算出
        let totalMin = 0;
        const maxDayIdx4w = State.windowDates.length - 1;
        const start4w = 0;
        const end4w = maxDayIdx4w;

        if (end4w >= start4w){
          for (let d4 = start4w; d4 <= end4w; d4++){
            const dt4 = State.windowDates[d4];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);
            const isOff4 = globalHasOffByDate(r, ds4);
            const lv4 = globalHasLeave(r, ds4) ? (getLeaveType(r, ds4) || '') : undefined;
            const mk4 = globalGetAssign(r, ds4);
            if (!mk4) continue;
            if (isOff4 || lv4) continue;

            let minutes = 0;
            if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
              minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk4) || 0);
            } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
              minutes = Number(window.ShiftDurations.getDefaultForMark(mk4) || 0);
            } else {
              const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240,'□':540};
              minutes = fallback[mk4] || 0;
            }
            totalMin += minutes;
          }
        }

        // 4週間勤務時間合計を H:MM 形式で末尾に追加
        const fmt = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(totalMin)
          : `${Math.floor(totalMin/60)}:${String(totalMin%60).padStart(2,'0')}`;
        line.push(fmt);

        rows.push(line);
      }

      // CSV化（必要なセルはクオート、Excel互換のCRLF、BOM付き）
      const csv = rows.map(cols => cols.map(v => {
        let s = String(v ?? '');
        const needQuote = /[",\r\n]/.test(s);
        if (needQuote) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',')).join('\r\n');

      const bom = '\uFEFF'; // ExcelでUTF-8を正しく認識させる
      const blob = new Blob([bom, csv], { type: 'text/csv' });

      const s = monthStart;
      const e = monthEnd;
      const fname = `勤務表_${s.getFullYear()}${pad2(s.getMonth()+1)}${pad2(s.getDate())}_${e.getFullYear()}${pad2(e.getMonth()+1)}${pad2(e.getDate())}.csv`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);

      if (typeof showToast === 'function') showToast('CSV（Excel対応）をダウンロードしました');
    }
    function renderGrid(){
      grid.innerHTML = '';
      // ★重要：描画前にキャッシュをクリア（現在のウィンドウの日付で集計を行う）
      _winDateSet = null;
      _storeCache = null;

      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      

      // 左端：従業員列
      const thEmp = document.createElement('th');
      thEmp.className = 'col-emp';
      thEmp.textContent = '従業員';
      trh.appendChild(thEmp);

      // 日付ヘッダ（0〜30日ぶん）
     for(let d=0; d<State.windowDates.length; d++)
{
        const th = document.createElement('th');
        const dt = State.windowDates[d];
        if (dt){
          const ds = dateStr(dt);
          const w = '日月火水木金土'[dt.getDay()];
          th.dataset.day = String(d);
          th.innerHTML = `${dt.getMonth()+1}/${dt.getDate()}<span class="dow">${w}</span>`;
          const wd = dt.getDay();
          if (wd === 0) th.classList.add('sun');
          else if (wd === 6) th.classList.add('sat');
          if (State.holidaySet.has(ds)) th.classList.add('holiday');
          
          // ★ここに移動：日付が存在する場合にクリックイベントを設定
          th.addEventListener('click', ()=>{
            if(window.CellOperations && typeof window.CellOperations.toggleHoliday === 'function'){
              window.CellOperations.toggleHoliday(d);
            }
          });
        } else {
          th.dataset.day = String(d);
        }
        trh.appendChild(th);
      }

      // 右端：マーク集計・早出・遅出・休日集計・4週間勤務時間ヘッダを追加
      const thMarks = document.createElement('th');
      thMarks.className = 'col-month-marks';
      thMarks.innerHTML = '4週<br>マーク';
      trh.appendChild(thMarks);

      const thEarly = document.createElement('th');
      thEarly.className = 'col-month-early';
      thEarly.textContent = '早出';
      trh.appendChild(thEarly);

      const thLate = document.createElement('th');
      thLate.className = 'col-month-late';
      thLate.textContent = '遅出';
      trh.appendChild(thLate);

      const thHoliday = document.createElement('th');
      thHoliday.className = 'col-month-off';
      thHoliday.textContent = '休日';
      trh.appendChild(thHoliday);

      const thTotal = document.createElement('th');
      thTotal.className = 'col-month-total';
      thTotal.innerHTML = '<div>4週</div><div>時間</div>';
      trh.appendChild(thTotal);

      thead.appendChild(trh);

      const tbody = document.createElement('tbody');
      State.employees.forEach((name, r)=>{
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = 'col-emp';
        // 属性チップ
        tdName.appendChild(renderNameCell(r, name));
        tr.appendChild(tdName);

        // 各日セル
        for(let d=0; d<State.windowDates.length; d++)
{
          const dt = State.windowDates[d];
          const ds = dateStr(dt);
          const td = document.createElement('td');
          td.dataset.row = String(r);
          td.dataset.day = String(d);
          // 週末クラス付与（列全体を帯状に）
          const w = dt.getDay();
          if (w === 0) td.classList.add('sun');      // 日曜（赤帯） 
          else if (w === 6) td.classList.add('sat'); // 土曜（青帯）

          if(State.holidaySet.has(ds)) td.classList.add('holiday');

          // 中身：特別休暇 → 希望休 → 割当マーク
          const lv = getLeaveType(r, ds);
          if (lv){
            td.classList.add('off');
            const sp = document.createElement('span');
            sp.className = `leave ${leaveClassOf(lv)}`;
            sp.textContent = lv;
            td.appendChild(sp);
          } else if(hasOffByDate(r, ds)){
            td.classList.add('off');
            td.textContent = '休';
          } else {
            const mk = getAssign(r, ds);
            if(mk){
              const span = document.createElement('span');
              span.className = 'mark ' + markToClass(mk);
              span.textContent = mk;
              td.appendChild(span);
            }
          }

          if (isLocked(r, ds)) {
            td.classList.add('locked');
          }

          td.addEventListener('click', () => {
            // 範囲ロックモードが有効なら先に処理
            if (maybeHandleRangeLock(r, d)) return;

            // ★追加：クリアモード
            if (State.mode === 'clear') {
              handleClearCell(r, d, td);
              return;
            }

            // cellOperations.js に委譲
            if (State.leaveMode) {
              window.CellOperations.toggleLeave(r, d, td);
              return;
            }

            if (State.mode === 'off') {
              window.CellOperations.toggleOff(r, d, td);
              return;
            }

            window.CellOperations.cycleAssign(r, d, td);
          });

          td.addEventListener('contextmenu', (e) => {  
            e.preventDefault();
            const nowLocked = isLocked(r, ds);
            setLocked(r, ds, !nowLocked);
            td.classList.toggle('locked', !nowLocked);
            showToast(!nowLocked
              ? 'セルをロックしました（自動割当の対象外）'
              : 'セルのロックを解除しました');
          });

          tr.appendChild(td);
        }
        // 4週間（表示範囲）のマーク集計 - 常に表示中の28日間を集計
        const start4w = 0;
        const end4w   = Math.min(27, State.windowDates.length - 1);

        let cntO = 0, cntNightPair = 0, cntNF = 0, cntNS = 0, cntHoliday = 0;
        if (end4w >= start4w){
          for (let d = start4w; d <= end4w; d++){
            const dt4 = State.windowDates[d];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);
            const mk4 = globalGetAssign(r, ds4);
            if (!mk4) continue;
            if (mk4 === '〇'){
              cntO++;
            } else if (mk4 === '☆'){
              cntNightPair++;
            } else if (mk4 === '★'){

              const prevIdx = d - 1;
              let countedWithPrev = false;
              if (prevIdx >= start4w && prevIdx >= 0){
                const prevDt = State.windowDates[prevIdx];
                if (prevDt){
                  const prevMk = globalGetAssign(r, dateStr(prevDt));
                  if (prevMk === '☆') countedWithPrev = true;
                }
              }
              if (!countedWithPrev) cntNightPair++;
            } else if (mk4 === '◆'){
              cntNF++;
            } else if (mk4 === '●'){
              cntNS++;
            }
          }
        }

        const tdMarks = document.createElement('td');
        tdMarks.className = 'month-marks';
        tdMarks.dataset.row = String(r);
        const lineTop = `〇${cntO}☆★${cntNightPair}`;
        const lineBottom = `◆${cntNF}●${cntNS}`;
        tdMarks.innerHTML = `
          <div class="mm-row">${lineTop}</div>
          <div class="mm-row">${lineBottom}</div>
        `.trim();
        tr.appendChild(tdMarks);

        // 早出集計セル（表示4週間）
        let cntEarly = 0;
        if (end4w >= start4w){
          for (let d = start4w; d <= end4w; d++){
            const dt4 = State.windowDates[d];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);
            const mk4 = globalGetAssign(r, ds4);
            if (mk4 === '早') cntEarly++;
          }
        }
        const tdEarly = document.createElement('td');
        tdEarly.className = 'month-early';
        tdEarly.dataset.row = String(r);
        tdEarly.textContent = String(cntEarly);
        tr.appendChild(tdEarly);

        // 遅出集計セル（表示4週間）
        let cntLate = 0;
        if (end4w >= start4w){
          for (let d = start4w; d <= end4w; d++){
            const dt4 = State.windowDates[d];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);
            const mk4 = globalGetAssign(r, ds4);
            if (mk4 === '遅') cntLate++;
          }
        }
        const tdLate = document.createElement('td');
        tdLate.className = 'month-late';
        tdLate.dataset.row = String(r);
        tdLate.textContent = String(cntLate);
        tr.appendChild(tdLate);

        // 休日集計セル（表示4週間）
        const tdOff = document.createElement('td');
        tdOff.className = 'month-off';
        tdOff.dataset.row = String(r);

        // === ここで各従業員の「表示4週間」の勤務時間合計と休日数を算出して行の末尾に追加 ===
        cntHoliday = 0; 
        let totalMin = 0;
        if (end4w >= start4w){
          for (let d4 = start4w; d4 <= end4w; d4++){
            const dt4 = State.windowDates[d4];
            if (!dt4) continue;
            const ds4 = dateStr(dt4);

            // 4週内の日付について、
            // 「マークなし or 希望休」かつ「特別休暇なし」を休日としてカウント
            const mk4   = globalGetAssign(r, ds4);
            const hasLv = globalHasLeave(r, ds4);
            const isOff4 = (globalHasOffByDate(r, ds4) || !mk4) && !hasLv;

            if (isOff4){
              cntHoliday++;
              continue;
            }

            // ここまでで休日でないことが確定しているので、
            // 勤務マークが無ければ勤務時間は 0 分としてスキップ
            if (!mk4) continue;

            let minutes = 0;
            if (window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function') {
              minutes = Number(window.ShiftDurations.getDurationForEmployee(State.employeesAttr[r] || {}, mk4) || 0);
            } else if (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function') {
              minutes = Number(window.ShiftDurations.getDefaultForMark(mk4) || 0);
            } else {
              const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240,'□':540};
              minutes = fallback[mk4] || 0;
            }
            totalMin += minutes;
          }
        }

        tdOff.textContent = String(cntHoliday);
        tr.appendChild(tdOff);

        const tdTotal = document.createElement('td');
        tdTotal.className = 'month-total';
        tdTotal.dataset.row = String(r);

        const formatted = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(totalMin)
          : `${Math.floor(totalMin/60)}:${String(totalMin%60).padStart(2,'0')}`;

        tdTotal.textContent = formatted;

        // ★追加：36協定 4週間 155時間超 → 赤字表示
        if (totalMin > 155 * 60) {
          tdTotal.style.color = '#b91c1c';   // var(--danger) と同じ赤
          tdTotal.style.fontWeight = '700';
        } else {
          tdTotal.style.color = '';
          tdTotal.style.fontWeight = '';
        }

        tr.appendChild(tdTotal);
        // === 4週間勤務時間セルの追加ここまで ===

        tbody.appendChild(tr);

      });

      grid.appendChild(thead);
      grid.appendChild(tbody);

      renderFooterCounts();
      paintRange4w();
    }

 window.renderGrid = renderGrid; // ★追加

function markToClass(mk){
  if (window.MARK_MAP && window.MARK_MAP[mk]) return window.MARK_MAP[mk].className;
  if (mk === '□') return 'mk-late';
  return '';
}

  
    function renderNameCell(idx, name){
    const wrap = document.createElement('div');
    wrap.className = 'emp-wrap';

    const span = document.createElement('span');
    span.textContent = name;
    wrap.appendChild(span);

    // Level select (A/B/C)
    const selLv = document.createElement('select');
    selLv.className = 'mini-select level';
    ['A','B','C'].forEach(v=>{
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      selLv.appendChild(o);
    });
    selLv.value = (State.employeesAttr[idx]?.level)||'B';
    selLv.title = 'レベル（A/B/C）';
    selLv.addEventListener('change', ()=>{
      const a = State.employeesAttr[idx] || (State.employeesAttr[idx]={level:'B', workType:'three'});
      a.level = selLv.value;
      saveMetaOnly(); // ← 即時保存
    });

    // UIに反映（レベル選択を先に配置）
    wrap.appendChild(selLv);

    // WorkType select（二部/三部/日/夜）
    const selWk = document.createElement('select');
    selWk.className = 'mini-select work';
    ['two','three','day','night'].forEach(key=>{
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol}`;
      selWk.appendChild(o);
    });
    selWk.value = (State.employeesAttr[idx]?.workType)||'three';
    selWk.title = '勤務形態';

    selWk.addEventListener('change', ()=>{
      const a = State.employeesAttr[idx] || (State.employeesAttr[idx]={level:'B', workType:'three'});
      a.workType = selWk.value;
      normalizeEmployeeAttrByWorkType(a);
      saveMetaOnly(); // ← 即時保存
    });

    wrap.appendChild(selWk);

    return wrap;
  }

  function paintRange4w(){
    $$('.range4w', grid).forEach(c=> c.classList.remove('range4w'));
    const s = State.range4wStart;
    const e = s + 27;
    for(let d=s; d<=e; d++){
      $$(`[data-day="${d}"]`, grid).forEach(cell=> cell.classList.add('range4w'));
    }
  }

  // 範囲ロック/解除：開始→終了セルの2クリックで矩形適用
  function maybeHandleRangeLock(r, d){
    if (!State.lockMode) return false;
    if (!State.lockStart){
      State.lockStart = { r, d };
      showToast('終了セルをクリックしてください');
      return true;
    }
    const r0 = Math.min(State.lockStart.r, r);
    const r1 = Math.max(State.lockStart.r, r);
    const d0 = Math.min(State.lockStart.d, d);
    const d1 = Math.max(State.lockStart.d, d);
    for (let rr=r0; rr<=r1; rr++){
      for (let dd=d0; dd<=d1; dd++){
        const ds2 = dateStr(State.windowDates[dd]);
        setLocked(rr, ds2, State.lockMode === 'lock');
      }
    }
    renderGrid();
    showToast(State.lockMode==='lock' ? '範囲をロックしました（自動割当の対象外）' : '範囲のロックを解除しました');
    State.lockMode = null;
    State.lockStart = null;
    return true;
  }

  function hasOffByDate(empIdx, ds){
    const s = State.offRequests.get(empIdx);
    return s ? s.has(ds) : false;
  }
  window.hasOffByDate = hasOffByDate; // ★追加
  // 特別休暇の取得/設定
  function getLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    return m ? m.get(ds) : undefined;
  }
window.getLeaveType = getLeaveType; // ★追加
function isWeekendByDs(ds){
  const dt = State.windowDates.find(dt => dateStr(dt) === ds);
  const w  = dt ? dt.getDay() : (new Date(ds)).getDay();
  return w === 0 || w === 6;
}

// ==============================
// CellOperations フォールバック
// （cellOperations.js が未読込でも、希望休など最低限の操作が動作するようにする）
// ==============================
if (!window.CellOperations) window.CellOperations = {};

if (typeof window.CellOperations.toggleOff !== 'function') {
  window.CellOperations.toggleOff = function toggleOffFallback(r, dayIdx, td){
    const dt = State.windowDates[dayIdx];
    if (!dt) return;
    const ds = dateStr(dt);

    // 特別休暇がある日は希望休を置かない（表示優先の衝突を回避）
    const lv = (typeof getLeaveType === 'function') ? getLeaveType(r, ds) : undefined;
    if (lv) {
      showToast('このセルは特別休暇が設定されています（解除してから希望休を置いてください）');
      return;
    }

    // 既存の割当があればクリア（☆なら翌日の★も連動して外す）
    const prevMk = (typeof getAssign === 'function') ? getAssign(r, ds) : undefined;
    if (prevMk) {
      clearAssign(r, ds);
      if (prevMk === '☆') removeNextStarByDs(r, ds);
    }

    let s = State.offRequests.get(r);
    if (!s) { s = new Set(); State.offRequests.set(r, s); }

    if (s.has(ds)) {
      s.delete(ds);
      if (s.size === 0) State.offRequests.delete(r);
      td.classList.remove('off');
      td.textContent = '';
    } else {
      s.add(ds);
      td.classList.add('off');
      td.textContent = '休';
    }

    if (typeof updateFooterCounts === 'function') updateFooterCounts();
  };
}

  // 翌日の★を日付文字列ベースで消去（cellOperations.jsと共通利用）
  function removeNextStarByDs(r, ds){
    const idx = State.windowDates.findIndex(dt => dateStr(dt) === ds);

    if (idx < 0) return;
    const nextIndex = idx + 1;
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
    }
  }

function setLeaveType(empIdx, ds, code){
  // 夜勤専従には「祝」「代」を割り当て不可
  const wt = (State.employeesAttr[empIdx]?.workType) || 'three';
  if ((code === '祝' || code === '代') && wt === 'night'){
    if (typeof showToast === 'function'){
      showToast('夜勤専従には「祝」「代」を設定できません');
    }
    return false;
  }
  // 「祝」は土日には付与禁止
  if (code === '祝' && isWeekendByDs(ds)){
    if (typeof showToast === 'function'){
      showToast('土日には「祝」を設定できません（振替休日を平日に設定してください）');
    }
    return false;
  }
  let m = State.leaveRequests.get(empIdx);

  if(!m){ m = new Map(); State.leaveRequests.set(empIdx, m); }
  m.set(ds, code);

  // ★追加：自動付与（祝/代 等）でも翌日の「★」を強制消去
  removeNextStarByDs(empIdx, ds);
  return true;
}
window.setLeaveType = setLeaveType; // ★追加

  function clearLeaveType(empIdx, ds){
    const m = State.leaveRequests.get(empIdx);
    if(m){ m.delete(ds); if(m.size===0) State.leaveRequests.delete(empIdx); }
  }
  window.clearLeaveType = clearLeaveType; // ★追加
  // 追加：自動割当で上書き可能な“ソフト休暇”（祝/代）
  function isSoftLeave(code){ return code === '祝' || code === '代'; }
  function clearSoftLeaveIfAny(empIdx, ds){
    const lv = getLeaveType(empIdx, ds);
    if (lv && isSoftLeave(lv)) clearLeaveType(empIdx, ds);
  }

  // “休息”の判定（希望休 or 特別休暇）
  function isRestByDate(empIdx, ds){
    return hasOffByDate(empIdx, ds) || !!getLeaveType(empIdx, ds);
  }
  function leaveClassOf(code){
    if (code === '祝') return 'lv-hol';
    if (code === '代') return 'lv-sub';
    if (code === '年') return 'lv-ann';
    if (code === 'リ') return 'lv-rs';
    return '';
  }

  function getAssign(r, ds){
    const m = State.assignments.get(r);
    return m ? m.get(ds) : undefined;
  }
 window.getAssign = getAssign; 

function setAssign(r, ds, mk){
  let m = State.assignments.get(r);
  if(!m){ m = new Map(); State.assignments.set(r,m); }
  
  if(mk) {
    m.set(ds, mk);
  } else {
    m.delete(ds);
  }

  if (mk === '〇' || mk === '□') removeNextStarByDs(r, ds);
  
}

window.setAssign = setAssign; // ★追加
function clearAssign(r, ds){
  const m = State.assignments.get(r);
  if(m){ 
    m.delete(ds);
    if(m.size===0) State.assignments.delete(r);
  }
  
}

window.clearAssign = clearAssign; // ★追加
//  isToday は core.dates.js（App.Dates.isToday）へ移動

