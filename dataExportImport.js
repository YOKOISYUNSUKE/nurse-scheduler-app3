/* dataExportImport.js - 割り当てデータのエクスポート/インポート機能 */
;(function(global){
  'use strict';

  // ==============================
  // ユーティリティ
  // ==============================
  const { dateStr, addDays, pad2 } = (window.App && window.App.Dates) || {};

  function getState(){ return window.State || window.SchedulerState; }

  // 日付文字列を安全に取得
  function safeDate(d){
    if (!d) return null;
    if (typeof dateStr === 'function') return dateStr(d);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  // 現在の「指定4週間」（range4wStart〜+27）を返す（range4wStartが無ければ先頭28日）
  function getCurrent4wDays(State){
    const start = Number.isInteger(State && State.range4wStart) ? State.range4wStart : 0;
    const dates = (State && Array.isArray(State.windowDates)) ? State.windowDates : [];
    return dates.slice(start, start + 28);
  }

  // ==============================
  // CSVエクスポート（割り当てデータ専用・インポート対応形式）
  // ==============================
  function exportAssignmentCSV(){
    const State = getState();
    if(!State){
      console.error('State not available');
      return;
    }

    // 表示中の4週間（28日）をエクスポート
    const days = getCurrent4wDays(State);
    const rows = [];


    // ヘッダ行: 従業員名, 日付1, 日付2, ... 
    const header = ['従業員'];
    days.forEach(dt => {
      const ds = safeDate(dt);
      const w = '日月火水木金土'[dt.getDay()];
      header.push(`${ds}(${w})`);
    });
    rows.push(header);

    // 各従業員の行
    for(let r = 0; r < State.employeeCount; r++){
      const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
      const row = [name];

      for(const dt of days){
        const ds = safeDate(dt);
        
        // 特別休暇 > 希望休 > 割当 の優先度で出力
        const lv = window.getLeaveType ? window.getLeaveType(r, ds) : null;
        const off = window.hasOffByDate ? window.hasOffByDate(r, ds) : false;
        const mk = window.getAssign ? window.getAssign(r, ds) : null;

        let cell = '';
        if(lv){
          cell = lv; // 祝, 代, 年, リ
        } else if(off){
          cell = '休';
        } else if(mk){
          cell = mk; // 〇, ☆, ★, ◆, ●, 早, 遅
        }
        row.push(cell);
      }
      rows.push(row);
    }

    // CSV生成（Excel対応: BOM + CRLF）
    const csv = rows.map(cols => cols.map(v => {
      let s = String(v ?? '');
      const needQuote = /[",\r\n]/.test(s);
      if(needQuote) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',')).join('\r\n');

    const bom = '\uFEFF';
    const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' });

    // ファイル名
    const s = days[0];
    const e = days[days.length - 1];
    const p2 = (n) => String(n).padStart(2,'0');
    const fname = `割当データ_${s.getFullYear()}${p2(s.getMonth()+1)}${p2(s.getDate())}_${e.getFullYear()}${p2(e.getMonth()+1)}${p2(e.getDate())}.csv`;

    // ダウンロード
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);

    if(typeof window.showToast === 'function'){
      window.showToast('割り当てCSVをエクスポートしました');
    }
  }

  // ==============================
  // CSVインポート
  // ==============================
  function importAssignmentCSV(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try{
          const text = e.target.result;
          const result = parseAndApplyCSV(text);
          resolve(result);
        }catch(err){
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function parseAndApplyCSV(text){
    const State = getState();
    if(!State) throw new Error('State not available');

    // --- インポート用：特別休暇を「検証なし」で反映する ---
    // app.js 側の setLeaveType は UI 入力制約を持つため、
    // インポート時は “保存データの復元” を優先して State.leaveRequests を直接更新する。
    function rawSetLeave(empIdx, ds, code){
      if(!State.leaveRequests) State.leaveRequests = new Map();
      let mp = State.leaveRequests.get(empIdx);
      if(!mp){
        mp = new Map();
        State.leaveRequests.set(empIdx, mp);
      }
      mp.set(ds, code);
    }
    function rawClearLeave(empIdx, ds){
      const mp = State.leaveRequests && State.leaveRequests.get(empIdx);
      if(mp){
        mp.delete(ds);
        if(mp.size === 0) State.leaveRequests.delete(empIdx);
      }
    }

    // BOM除去
    if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);


    // 行分割（CRLF/LF/CR対応）
    const lines = text.split(/\r\n|\n|\r/).filter(line => line.trim() !== '');
    if(lines.length < 2) throw new Error('データが不足しています');

    // ヘッダ行解析
    const header = parseCSVLine(lines[0]).map(v => String(v ?? '').replace(/\uFEFF/g,'').trim());
    if(!/^従業員/.test(header[0] || '')){
      throw new Error('ヘッダー形式が不正です（1列目は「従業員」である必要があります）');
    }

    // 現在表示中（先頭28日）の日付セット & 月日→日付(YYYY-MM-DD)の変換表
    const windowDays = getCurrent4wDays(State);
    const windowSet = new Set(windowDays.map(d => safeDate(d)).filter(Boolean));
    const mdToDs = new Map(); // "M/D" -> "YYYY-MM-DD"
    windowDays.forEach(dt => {
      const ds = safeDate(dt);
      if(!ds) return;
      const m = dt.getMonth() + 1;
      const d = dt.getDate();
      mdToDs.set(`${m}/${d}`, ds);
      mdToDs.set(`${m}月${d}日`, ds);
    });

    function normalizeYMD(y, m, d){
      const yy = String(y).padStart(4,'0');
      const mm = String(m).padStart(2,'0');
      const dd = String(d).padStart(2,'0');
      return `${yy}-${mm}-${dd}`;
    }

    // ヘッダ文字列から YYYY-MM-DD を取り出す（YYYY/MM/DD, M/D, M月D日 も対応）
    function resolveHeaderDateToDs(label){
      const s = String(label ?? '').trim();

      // 1) ISO or slash (YYYY-MM-DD / YYYY/MM/DD)
      let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      if(m){
        return normalizeYMD(Number(m[1]), Number(m[2]), Number(m[3]));
      }

      // 2) month/day (M/D)
      m = s.match(/^(\d{1,2})\/(\d{1,2})/);
      if(m){
        return mdToDs.get(`${Number(m[1])}/${Number(m[2])}`) || null;
      }

      // 3) Japanese (M月D日)
      m = s.match(/^(\d{1,2})月(\d{1,2})日/);
      if(m){
        return mdToDs.get(`${Number(m[1])}月${Number(m[2])}日`) || null;
      }

      return null;
    }

    const dateCols = [];
    for(let c=1; c<header.length; c++){
      const ds = resolveHeaderDateToDs(header[c]);
      if(ds && windowSet.has(ds)){
        dateCols.push({ col: c, ds });
      }
    }

    if(dateCols.length === 0){
      const s = safeDate(windowDays[0]);
      const e = safeDate(windowDays[windowDays.length - 1]);
      throw new Error(`ファイルの日付が現在の表示期間（${s}〜${e}）と一致しません。先に該当期間へ移動してからインポートしてください。`);
    }



    // 従業員名→インデックスのマップ
    const empMap = new Map();
    for(let i = 0; i < State.employeeCount; i++){
      const name = (State.employees[i] || `職員${String(i+1).padStart(2,'0')}`).trim();
      empMap.set(name, i);
    }

    let appliedCount = 0;
    let skippedCount = 0;
    const warnings = [];

    // データ行を処理
    for(let lineIdx = 1; lineIdx < lines.length; lineIdx++){
      const row = parseCSVLine(lines[lineIdx]);
      if(row.length === 0) continue;

      const empName = (row[0] || '').trim();
      const r = empMap.get(empName);

      if(r === undefined){
        warnings.push(`行${lineIdx + 1}: 従業員「${empName}」が見つかりません`);
        skippedCount++;
        continue;
      }

// 各日付セルを処理
for(const { col, ds } of dateCols){
  const cellValue = (row[col] || '').trim();

  // まず既存データをクリア（= 上書きの土台）
  const hadOff  = window.hasOffByDate ? window.hasOffByDate(r, ds) : false;
  const hadLeave = window.getLeaveType ? window.getLeaveType(r, ds) : null;
  const hadMk   = window.getAssign ? window.getAssign(r, ds) : null;

  const offSet = State.offRequests.get(r);
  if(offSet) { offSet.delete(ds); if(offSet.size === 0) State.offRequests.delete(r); }
  rawClearLeave(r, ds);
  if(window.clearAssign) window.clearAssign(r, ds);

  // 空なら「未割当」上書きとして完了
  if(!cellValue){

    if(hadOff || hadLeave || hadMk) appliedCount++;
    continue;
  }

  // 値を解釈（ここに来る時点で、必ず上書きできる）
  if(cellValue === '休'){
    let s = State.offRequests.get(r);
    if(!s){ s = new Set(); State.offRequests.set(r, s); }
    s.add(ds);
    appliedCount++;

  } else if(['祝','代','年','リ'].includes(cellValue)){
    rawSetLeave(r, ds, cellValue);
    appliedCount++;

  } else if(['〇','○','☆','★','◆','●','早','遅'].includes(cellValue)){
    let mark = cellValue;
    if(mark === '○') mark = '〇';
    if(window.setAssign) window.setAssign(r, ds, mark);
    appliedCount++;

  } else {
    warnings.push(`行${lineIdx + 1}列${col + 1}: 不明な値「${cellValue}」をスキップ`);
    skippedCount++;
  }
}

    }

    // 画面更新
if(typeof window.renderGrid === 'function') window.renderGrid();
if(typeof window.updateFooterCounts === 'function') window.updateFooterCounts();
if(typeof window.saveWindow === 'function') window.saveWindow();

    return {
      success: true,
      appliedCount,
      skippedCount,
      warnings,
      message: `${appliedCount}件のデータをインポートしました${skippedCount > 0 ? `（${skippedCount}件スキップ）` : ''}`
    };
  }

  // CSV行をパース（クオート対応）
  function parseCSVLine(line, delimiter=','){
    const result = [];
    let current = '';
    let inQuote = false;

    for(let i = 0; i < line.length; i++){
      const ch = line[i];
      
      if(inQuote){
        if(ch === '"'){
          if(line[i+1] === '"'){
            current += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          current += ch;
        }
      } else {
        if(ch === '"'){
          inQuote = true;
        } else if(ch === ','){
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  // ==============================
  // Excelエクスポート（SheetJS使用）
  // ==============================
  async function exportAssignmentExcel(){
    const State = getState();
    if(!State){
      console.error('State not available');
      return;
    }

    // SheetJSの読み込み確認
    if(typeof XLSX === 'undefined'){
      // 動的にSheetJSを読み込み
      await loadSheetJS();
    }

    if(typeof XLSX === 'undefined'){
      if(typeof window.showToast === 'function'){
        window.showToast('Excelライブラリの読み込みに失敗しました');
      }
      return;
    }

    // 表示中の4週間（28日）をエクスポート
    const days = State.windowDates.slice(0, 28);
    const wsData = [];

    // ヘッダ行
    const header = ['従業員'];
    days.forEach(dt => {
      const ds = safeDate(dt);
      const w = '日月火水木金土'[dt.getDay()];
      header.push(`${ds}(${w})`);
    });
    header.push('4週時間');
    wsData.push(header);

    // 各従業員の行
    for(let r = 0; r < State.employeeCount; r++){
      const name = State.employees[r] || `職員${String(r+1).padStart(2,'0')}`;
      const row = [name];

      let totalMin = 0;

      for(const dt of days){
        const ds = safeDate(dt);
        
        const lv = window.getLeaveType ? window.getLeaveType(r, ds) : null;
        const off = window.hasOffByDate ? window.hasOffByDate(r, ds) : false;
        const mk = window.getAssign ? window.getAssign(r, ds) : null;

        let cell = '';
        if(lv){
          cell = lv;
        } else if(off){
          cell = '休';
        } else if(mk){
          cell = mk;
          // 勤務時間を集計
          const minutes = getWorkMinutes(State.employeesAttr[r] || {}, mk);
          totalMin += minutes;
        }
        row.push(cell);
      }

      // 勤務時間合計
      const hrs = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      row.push(`${hrs}:${String(mins).padStart(2,'0')}`);

      wsData.push(row);
    }

    // ワークシート作成
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 列幅設定
ws['!cols'] = [
  { wch: 12 }, // 従業員名
  ...days.map(() => ({ wch: 8 })), // 日付列
  { wch: 8 }  // 時間列
];


    // ワークブック作成
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '割当表');

    // ファイル名
    const s = days[0];
    const e = days[days.length - 1];
    const p2 = (n) => String(n).padStart(2,'0');
    const fname = `割当データ_${s.getFullYear()}${p2(s.getMonth()+1)}${p2(s.getDate())}_${e.getFullYear()}${p2(e.getMonth()+1)}${p2(e.getDate())}.xlsx`;

    // ダウンロード
    XLSX.writeFile(wb, fname);

    if(typeof window.showToast === 'function'){
      window.showToast('Excelファイルをエクスポートしました');
    }
  }

  // 勤務時間を取得
  function getWorkMinutes(attr, mark){
    if(window.ShiftDurations && typeof window.ShiftDurations.getDurationForEmployee === 'function'){
      return Number(window.ShiftDurations.getDurationForEmployee(attr, mark) || 0);
    }
    if(window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function'){
      return Number(window.ShiftDurations.getDefaultForMark(mark) || 0);
    }
    const fallback = { '〇': 480, '早': 480, '遅': 540, '☆': 480, '★': 480, '◆': 240, '●': 240 };
    return fallback[mark] || 0;
  }

  // SheetJSを動的に読み込み
  function loadSheetJS(){
    return new Promise((resolve, reject) => {
      if(typeof XLSX !== 'undefined'){
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('SheetJS load failed'));
      document.head.appendChild(script);
    });
  }

  // ==============================
  // Excelインポート（SheetJS使用）
  // ==============================
  async function importAssignmentExcel(file){
    // SheetJSの読み込み確認
    if(typeof XLSX === 'undefined'){
      await loadSheetJS();
    }

    if(typeof XLSX === 'undefined'){
      throw new Error('Excelライブラリの読み込みに失敗しました');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try{
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // 最初のシートを取得
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // CSVとして変換してパース
          const csv = XLSX.utils.sheet_to_csv(worksheet);
          const result = parseAndApplyCSV(csv);
          resolve(result);
        }catch(err){
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ==============================
  // ファイル選択ダイアログを開く
  // ==============================
function openImportDialog(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];

      if(!file) return;

      try{
        let result;
const ext = file.name.split('.').pop().toLowerCase();

if(ext === 'xlsx' || ext === 'xls'){
  result = await importAssignmentExcel(file);
} else {
  throw new Error('対応していないファイル形式です');
}


        if(typeof window.showToast === 'function'){
          window.showToast(result.message);
        }

        // 警告があれば表示
        if(result.warnings && result.warnings.length > 0){
          console.warn('インポート警告:', result.warnings);
        }
      }catch(err){
        console.error('インポートエラー:', err);
        if(typeof window.showToast === 'function'){
          window.showToast('インポートに失敗しました: ' + err.message);
        }
      }
    };

    input.click();
  }

  // ==============================
  // グローバル公開
  // ==============================
  global.DataExportImport = {
    exportExcel: exportAssignmentExcel,
    importExcel: importAssignmentExcel,
    openImportDialog: openImportDialog
  };

})(window);