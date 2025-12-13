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
    const days = State.windowDates.slice(0, 28);
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
          cell = mk; // 〇, ☆, ★, ◆, ●, 早, 遅, □
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

    // BOM除去
    if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // 行分割（CRLF/LF/CR対応）
    const lines = text.split(/\r\n|\n|\r/).filter(line => line.trim() !== '');
    if(lines.length < 2) throw new Error('データが不足しています');

    // ヘッダ行解析
    const header = parseCSVLine(lines[0]);
    if(header[0] !== '従業員') throw new Error('ヘッダー形式が不正です（1列目は「従業員」である必要があります）');

    // 日付列を抽出（ヘッダから日付部分を取得）
    const dateCols = [];
    for(let c = 1; c < header.length; c++){
      const col = header[c];
      // "2025-01-15(水)" or "2025-01-15" 形式から日付を抽出
      const match = col.match(/(\d{4}-\d{2}-\d{2})/);
      if(match){
        dateCols.push({ col: c, ds: match[1] });
      }
    }

    if(dateCols.length === 0) throw new Error('日付列が見つかりません');

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
        if(!cellValue) continue;

        // 値を解釈
        if(cellValue === '休'){
          // 希望休として設定
          let s = State.offRequests.get(r);
          if(!s){ s = new Set(); State.offRequests.set(r, s); }
          s.add(ds);
          // 既存の割当・特休をクリア
          if(window.clearAssign) window.clearAssign(r, ds);
          if(window.clearLeaveType) window.clearLeaveType(r, ds);
          appliedCount++;

        } else if(['祝','代','年','リ'].includes(cellValue)){
          // 特別休暇として設定
          if(window.setLeaveType){
            window.setLeaveType(r, ds, cellValue);
          }
          // 希望休をクリア
          const s = State.offRequests.get(r);
          if(s) s.delete(ds);
          // 既存の割当をクリア
          if(window.clearAssign) window.clearAssign(r, ds);
          appliedCount++;

        } else if(['〇','○','☆','★','◆','●','早','遅','□'].includes(cellValue)){
          // 割当マークとして設定（○を〇に正規化）
          let mark = cellValue;
          if(mark === '○') mark = '〇'; // 全角丸
          if(window.setAssign){
            window.setAssign(r, ds, mark);
          }
          // 希望休・特休をクリア
          const s = State.offRequests.get(r);
          if(s) s.delete(ds);
          if(window.clearLeaveType) window.clearLeaveType(r, ds);
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
  function parseCSVLine(line){
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
      header.push(`${dt.getMonth()+1}/${dt.getDate()}(${w})`);
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
    const fallback = { '〇': 480, '早': 480, '遅': 540, '☆': 480, '★': 480, '◆': 240, '●': 240, '□': 540 };
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
    input.accept = '.csv,.xlsx,.xls';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if(!file) return;

      try{
        let result;
        const ext = file.name.split('.').pop().toLowerCase();

        if(ext === 'csv'){
          result = await importAssignmentCSV(file);
        } else if(ext === 'xlsx' || ext === 'xls'){
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
    exportCSV: exportAssignmentCSV,
    importCSV: importAssignmentCSV,
    exportExcel: exportAssignmentExcel,
    importExcel: importAssignmentExcel,
    openImportDialog: openImportDialog
  };

})(window);