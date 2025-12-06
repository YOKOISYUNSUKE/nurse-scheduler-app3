// ====== 従業員ダイアログ管理モジュール ======
(function(){
  'use strict';

  const WorkMap = {
    two:   { symbol:'②', label:'二部制' },
    three: { symbol:'③', label:'三部制' },
    day:   { symbol:'日', label:'日勤のみ' },
    night: { symbol:'夜', label:'夜勤のみ' },
  };
  const WorkOrder = ['two','three','day','night'];

  // グローバル依存の取得（app.jsから公開済みを想定）
  const getState = () => window.SchedulerState;
  const { pad2 } = window.App?.Dates || {};

  // DOM要素
  let attrDlg, attrContent, attrSave, attrClose;
  let employeeCountSel;

// 修正後（DOMContentLoaded でラップ）
function init(){
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInternal);
  } else {
    initInternal();
  }
}

function initInternal(){
    // DOM要素の取得（イベントリスナーは buttonHandlers.js 側で管理）
    attrDlg = document.getElementById('attrDlg');
    attrContent = document.getElementById('attrContent');
    attrSave = document.getElementById('attrSave');
    attrClose = document.getElementById('attrClose');
    employeeCountSel = document.getElementById('employeeCount');
}


  function openAttrDialog(){
    buildAttrDialog();
    if(typeof attrDlg.showModal === 'function') attrDlg.showModal();
    else attrDlg.show();
  }

  function buildAttrDialog(){
    const State = getState();
    if (!State) return;

    attrContent.innerHTML = '';

    // --- 勤務時間（全体）一括設定パネル ---
    // 既に ShiftDurations が読み込まれていることが前提
    if (window.ShiftDurations){
      const globalWrap = document.createElement('div');
      globalWrap.className = 'global-durations';
      globalWrap.style.display = 'flex';
      globalWrap.style.flexDirection = 'column';
      globalWrap.style.gap = '8px';
      globalWrap.style.marginBottom = '12px';

      const title = document.createElement('div');
      title.textContent = '勤務時間（全体）一括設定';
      title.style.fontWeight = '600';
      globalWrap.appendChild(title);

      const marks = window.ShiftDurations.MARKS || ['〇','☆','★','◆','●'];
      const fields = document.createElement('div');
      fields.style.display = 'flex';
      fields.style.flexWrap = 'wrap';
      fields.style.gap = '8px';

      const currentDefs = (typeof window.ShiftDurations.getAllGlobalDefaults === 'function')
        ? window.ShiftDurations.getAllGlobalDefaults()
        : {};

      marks.forEach(mk => {
        const field = document.createElement('div');
        field.style.minWidth = '120px';
        field.style.display = 'flex';
        field.style.flexDirection = 'column';

        const lbl = document.createElement('label');
        lbl.textContent = mk + ' マーク（全体既定）';
        field.appendChild(lbl);

        const sel = document.createElement('select');
        sel.className = 'select global-duration-select';
        sel.dataset.mark = mk;
        // 選択肢は ShiftDurations.getOptionsForMark から取得
        const opts = (typeof window.ShiftDurations.getOptionsForMark === 'function')
          ? window.ShiftDurations.getOptionsForMark(mk)
          : (function(){
              const out = [];
              for (let m = 300; m <= 1200; m += 15) out.push({ value: m, label: `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}` });
              return out;
            })();
        opts.forEach(o => {
          const op = document.createElement('option');
          op.value = String(o.value);
          op.textContent = o.label;
          sel.appendChild(op);
        });

        const curVal = currentDefs[mk] ?? (window.ShiftDurations.getDefaultForMark ? window.ShiftDurations.getDefaultForMark(mk) : null);
        if (curVal != null) sel.value = String(curVal);

        const info = document.createElement('div');
        info.className = 'current-duration-label';
        info.style.fontSize = '0.8em';
        info.style.color = '#6b7280';
        info.textContent = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
          ? window.ShiftDurations.formatMinutes(Number(curVal) || 0)
          : `${Math.floor((Number(curVal)||0)/60)}:${String((Number(curVal)||0)%60).padStart(2,'0')}`;

        sel.addEventListener('change', () => {
          const val = parseInt(sel.value, 10);
          if (!Number.isFinite(val)) return;
          // 更新：ShiftDurations にセット（既存の個別設定は上書きしない）
          if (typeof window.ShiftDurations.setGlobalDefault === 'function') {
            window.ShiftDurations.setGlobalDefault(mk, val);
          } else {
            // フォールバックで直接格納（非推奨）
            window.ShiftDurations._globalDefaults = window.ShiftDurations._globalDefaults || {};
            window.ShiftDurations._globalDefaults[mk] = val;
          }
          // ラベル更新
          info.textContent = (window.ShiftDurations && typeof window.ShiftDurations.formatMinutes === 'function')
            ? window.ShiftDurations.formatMinutes(val)
            : `${Math.floor(val/60)}:${String(val%60).padStart(2,'0')}`;

          // 即時保存（メタデータのみ）
          if (typeof window.saveMetaOnly === 'function') {
            window.saveMetaOnly();
            if (typeof window.showToast === 'function') {
              window.showToast(`${mk} を一括で ${info.textContent} に変更しました`);
            }
          }

          // 画面上の月合計なども即時反映
          if (typeof window.renderGrid === 'function') {
            window.renderGrid();
          }
        });


        field.appendChild(sel);
        field.appendChild(info);
        fields.appendChild(field);
      });

      globalWrap.appendChild(fields);
      
      // 一括適用ボタンを追加
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-accent';
      applyBtn.textContent = '適応';
      applyBtn.title = '現在の全体既定値を全従業員に一括適用';
      applyBtn.style.marginTop = '8px';
      applyBtn.style.alignSelf = 'flex-start';
      applyBtn.addEventListener('click', () => {
        applyGlobalDurationsToAll();
      });
      globalWrap.appendChild(applyBtn);
      
      attrContent.appendChild(globalWrap);
    }
    // --- ここまで全体設定パネル ---
    // --- 早出・遅出の一括選択パネル ---
    {
      const bulkWrap = document.createElement('div');
      bulkWrap.style.display = 'flex';
      bulkWrap.style.flexWrap = 'wrap';
      bulkWrap.style.alignItems = 'center';
      bulkWrap.style.gap = '8px';
      bulkWrap.style.marginBottom = '12px';
      bulkWrap.style.padding = '8px';
      bulkWrap.style.backgroundColor = '#f9fafb';
      bulkWrap.style.borderRadius = '8px';

      const bulkTitle = document.createElement('div');
      bulkTitle.textContent = '早出・遅出 一括設定';
      bulkTitle.style.fontSize = '0.9em';
      bulkTitle.style.fontWeight = '600';
      bulkTitle.style.marginRight = '8px';
      bulkWrap.appendChild(bulkTitle);

      // 早出一括
      const earlyBlock = document.createElement('div');
      earlyBlock.style.display = 'flex';
      earlyBlock.style.alignItems = 'center';
      earlyBlock.style.gap = '4px';

      const earlyLabel = document.createElement('span');
      earlyLabel.textContent = '早出';
      earlyLabel.style.fontSize = '0.85em';
      earlyBlock.appendChild(earlyLabel);

      const earlySel = document.createElement('select');
      earlySel.className = 'select';
      ['none','all','weekday','holiday'].forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent =
          v === 'none'    ? 'なし' :
          v === 'all'     ? '全日' :
          v === 'weekday' ? '平日のみ' :
                            '土日祝のみ';
        earlySel.appendChild(opt);
      });
      earlySel.value = 'none';
      earlyBlock.appendChild(earlySel);

      const earlyBtn = document.createElement('button');
      earlyBtn.type = 'button';
      earlyBtn.className = 'btn btn-outline btn-sm';
      earlyBtn.textContent = '早出を一括適用';
      earlyBtn.addEventListener('click', () => {
        applyBulkEarlyShift(earlySel.value);
      });
      earlyBlock.appendChild(earlyBtn);

      bulkWrap.appendChild(earlyBlock);

      // 遅出一括
      const lateBlock = document.createElement('div');
      lateBlock.style.display = 'flex';
      lateBlock.style.alignItems = 'center';
      lateBlock.style.gap = '4px';

      const lateLabel = document.createElement('span');
      lateLabel.textContent = '遅出';
      lateLabel.style.fontSize = '0.85em';
      lateBlock.appendChild(lateLabel);

      const lateSel = document.createElement('select');
      lateSel.className = 'select';
      ['none','all','weekday','holiday'].forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent =
          v === 'none'    ? 'なし' :
          v === 'all'     ? '全日' :
          v === 'weekday' ? '平日のみ' :
                            '土日祝のみ';
        lateSel.appendChild(opt);
      });
      lateSel.value = 'none';
      lateBlock.appendChild(lateSel);

      const lateBtn = document.createElement('button');
      lateBtn.type = 'button';
      lateBtn.className = 'btn btn-outline btn-sm';
      lateBtn.textContent = '遅出を一括適用';
      lateBtn.addEventListener('click', () => {
        applyBulkLateShift(lateSel.value);
      });
      lateBlock.appendChild(lateBtn);

      bulkWrap.appendChild(lateBlock);

      const note = document.createElement('div');
      note.textContent = '※夜勤専従（勤務形態：夜勤のみ）は対象外です。';
      note.style.fontSize = '0.8em';
      note.style.color = '#6b7280';
      note.style.marginLeft = '4px';
      bulkWrap.appendChild(note);

      attrContent.appendChild(bulkWrap);
    }

    // --- 従業員ごとの行を追加 ---
    for (let i = 0; i < State.employeeCount; i++){
      const row = createEmployeeRow(i, State);  // ← 今度は正しく参照できる
      attrContent.appendChild(row);
    }

  }

  // createEmployeeRow を buildAttrDialog の外に移動（関数スコープを修正）
  function createEmployeeRow(i, State){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.idx = String(i);
    row.dataset.role = 'row';

    // 名前入力
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'txt';
    name.value = State.employees[i] || `職員${pad2(i+1)}`;
    name.placeholder = `職員名（例：${State.employees[i] || `職員${pad2(i+1)}`}）`;
    name.maxLength = 32;
    name.setAttribute('aria-label','従業員名');
    name.dataset.role = 'name';

    // レベルセレクト
    const selLv = createLevelSelect(State.employeesAttr[i]?.level || 'B');

    // 勤務形態セレクト
    const selWt = createWorkTypeSelect(State.employeesAttr[i]?.workType || 'three');

    // 夜勤ノルマ入力
    const quotaWrap = createQuotaInput(State.employeesAttr[i], selWt);

    // 禁忌ペア選択
    const forbidWrap = createForbiddenPairsSelect(i, State);

    // 各従業員ごとの勤務時間（マーク毎）を編集できるフィールドを作成
    const empAttr = State.employeesAttr[i] || (State.employeesAttr[i] = {});
    const durationsWrap = createShiftDurationFields(empAttr);
    // 初期は折りたたんでおく（ボタンで表示/非表示）
    durationsWrap.style.display = 'none';

    // --- 重要: ここで早出・遅出トグルを生成してから append する ---
    const earlyToggle = createEarlyShiftToggle(empAttr, selWt);
    const lateToggle  = createLateShiftToggle(empAttr, selWt);


    // 勤務時間編集ボタン（表示/非表示のトグル）
    const btnDur = document.createElement('button');
    btnDur.type = 'button';
    btnDur.className = 'btn btn-outline btn-duration-toggle';
    btnDur.textContent = '勤務時間編集';
    btnDur.title = 'この従業員のマーク別勤務時間を編集';
    btnDur.addEventListener('click', () => {
      const isHidden = durationsWrap.style.display === 'none' || durationsWrap.style.display === '';
      durationsWrap.style.display = isHidden ? 'flex' : 'none';
      btnDur.textContent = isHidden ? '勤務時間を閉じる' : '勤務時間編集';
    });

    // コントロールボタン（上へ・下へ・削除）
    const ctrls = createControls(i, State);

    row.appendChild(name);
    row.appendChild(selLv);
    row.appendChild(selWt);
    row.appendChild(quotaWrap);
    row.appendChild(earlyToggle);
    row.appendChild(lateToggle);
    row.appendChild(forbidWrap);
    row.appendChild(btnDur);        // ★追加：勤務時間編集ボタン
    row.appendChild(durationsWrap); // ★追加：勤務時間フィールド
    row.appendChild(ctrls);

    return row;
  }

  // 各マーク（〇/☆/★/◆/●）ごとの勤務時間を従業員属性で編集するフィールド群を作る
  // empAttr.shiftDurations は { '〇':minutes, '☆':minutes, ... } の形で保持する
  function createShiftDurationFields(empAttr){
    const wrap = document.createElement('div');
    wrap.className = 'durations-wrap';
    wrap.style.display = 'none'; // 初期は非表示
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';
    wrap.style.padding = '8px';
    wrap.style.backgroundColor = '#f8fafc';
    wrap.style.borderRadius = '8px';
    wrap.style.marginTop = '4px';

    // タイトル
    const title = document.createElement('div');
    title.textContent = '勤務時間設定（15分刻み）';
    title.style.fontSize = '0.85em';
    title.style.fontWeight = '600';
    title.style.color = '#475569';
    wrap.appendChild(title);

    // フィールド群のコンテナ
    const fieldsContainer = document.createElement('div');
    fieldsContainer.style.display = 'flex';
    fieldsContainer.style.flexWrap = 'wrap';
    fieldsContainer.style.gap = '8px';
    wrap.appendChild(fieldsContainer);

    const marks = (window.ShiftDurations && window.ShiftDurations.MARKS) 
      ? window.ShiftDurations.MARKS 
      : ['〇','☆','★','◆','●'];

    // 初期化：empAttr.shiftDurations オブジェクトだけを確保
    // 実際の値は「個別 > 全体既定 > デフォルト」で解決し、
    // 変更されたマークだけを empAttr.shiftDurations に保持する
    if (!empAttr.shiftDurations) {
      empAttr.shiftDurations = {};
    }

    marks.forEach(mk => {
      const fieldWrap = document.createElement('div');

      fieldWrap.className = 'duration-field';
      fieldWrap.style.display = 'flex';
      fieldWrap.style.flexDirection = 'column';
      fieldWrap.style.alignItems = 'stretch';
      fieldWrap.style.minWidth = '120px';
      fieldWrap.style.padding = '6px';
      fieldWrap.style.backgroundColor = '#fff';
      fieldWrap.style.borderRadius = '6px';
      fieldWrap.style.border = '1px solid #e5e7eb';

      const lbl = document.createElement('label');
      lbl.textContent = mk + ' マーク';
      lbl.style.fontSize = '0.85em';
      lbl.style.fontWeight = '600';
      lbl.style.marginBottom = '4px';
      lbl.style.color = '#1f2937';

      const sel = document.createElement('select');
      sel.className = 'select duration-select';
      sel.dataset.mark = mk;
      sel.style.fontSize = '0.9em';
      sel.style.padding = '4px 6px';

      // 選択肢を取得
      const opts = (window.ShiftDurations && window.ShiftDurations.getOptionsForMark)
        ? window.ShiftDurations.getOptionsForMark(mk)
        : (function(){
            const out = [];
            for (let m = 300; m <= 1200; m += 15) {
              const h = Math.floor(m/60);
              const mm = m%60;
              out.push({ value: m, label: `${h}:${String(mm).padStart(2,'0')}` });
            }
            return out;
          })();

      opts.forEach(o => {
        const op = document.createElement('option');
        op.value = String(o.value);
        op.textContent = o.label;
        sel.appendChild(op);
      });

      // 現在値を設定（優先順位: 個別 > 全体既定 > デフォルト）
      const per = empAttr.shiftDurations[mk];
      const global = (window.ShiftDurations && typeof window.ShiftDurations.getGlobalDefault === 'function')
        ? window.ShiftDurations.getGlobalDefault(mk)
        : undefined;
      const def = (window.ShiftDurations && typeof window.ShiftDurations.getDefaultForMark === 'function')
        ? window.ShiftDurations.getDefaultForMark(mk)
        : 480;
      const currentValue = Number.isFinite(per)
        ? per
        : (Number.isFinite(global) ? global : def);
      sel.value = String(currentValue);

      // 現在の時間を表示
      const currentLabel = document.createElement('div');

      currentLabel.className = 'current-duration-label';
      currentLabel.style.fontSize = '0.75em';
      currentLabel.style.color = '#6b7280';
      currentLabel.style.marginTop = '2px';
      currentLabel.textContent = window.ShiftDurations && window.ShiftDurations.formatDurationLabel
        ? window.ShiftDurations.formatDurationLabel(currentValue)
        : `${Math.floor(currentValue/60)}時間${currentValue%60>0?currentValue%60+'分':''}`;

      sel.addEventListener('change', () => {
        const newValue = parseInt(sel.value, 10);
        if (!isNaN(newValue)) {
          empAttr.shiftDurations[mk] = newValue;
          
          // 表示ラベルを更新
          currentLabel.textContent = window.ShiftDurations && window.ShiftDurations.formatDurationLabel
            ? window.ShiftDurations.formatDurationLabel(newValue)
            : `${Math.floor(newValue/60)}時間${newValue%60>0?newValue%60+'分':''}`;
          
          // 即時保存（メタデータのみ）
          if (typeof window.saveMetaOnly === 'function') {
            window.saveMetaOnly();
            if (typeof window.showToast === 'function') {
              window.showToast(`${mk} の勤務時間を ${currentLabel.textContent} に変更しました`);
            }
          }

          // 画面上の月合計なども即時反映
          if (typeof window.renderGrid === 'function') {
            window.renderGrid();
          }
        }
      });


      fieldWrap.appendChild(lbl);
      fieldWrap.appendChild(sel);
      fieldWrap.appendChild(currentLabel);
      fieldsContainer.appendChild(fieldWrap);
    });

    return wrap;
  }

  function createLevelSelect(currentLevel){
    const sel = document.createElement('select');
    sel.className = 'select level-select';
    // 追加: 明示的な data-role を付与（DOM 取得を安定化）
    sel.setAttribute('data-role','level');
    ['A','B','C'].forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if(currentLevel === v) o.selected = true;
      sel.appendChild(o);
    });
    
    // レベルA選択時に他のレベルAを自動的に禁忌ペアに追加
    sel.addEventListener('change', (e) => {
      handleLevelAAutoForbidden(e.target);
    });
    
    return sel;
  }
  
  // レベルA選択時に他のレベルAを自動的に禁忌ペアに追加する処理
  function handleLevelAAutoForbidden(selectElement){
    const State = getState();
    if (!State) return;
    
    const newLevel = selectElement.value;
    const row = selectElement.closest('[data-role="row"]');
    if (!row) return;
    
    const currentIndex = parseInt(row.dataset.idx, 10);
    if (!Number.isFinite(currentIndex)) return;
    
    // レベルAが選択された場合
    if (newLevel === 'A') {
      // 他のレベルAの従業員を検索
      const otherLevelAIndices = [];
      for (let i = 0; i < State.employeeCount; i++) {
        if (i === currentIndex) continue;
        const attr = State.employeesAttr[i] || {};
        if (attr.level === 'A') {
          otherLevelAIndices.push(i);
        }
      }
      
      // 現在の従業員の禁忌ペアに他のレベルAを追加
      if (!State.forbiddenPairs.has(currentIndex)) {
        State.forbiddenPairs.set(currentIndex, new Set());
      }
      const currentPairs = State.forbiddenPairs.get(currentIndex);
      
      otherLevelAIndices.forEach(idx => {
        currentPairs.add(idx);
        
        // 相手側にも追加（双方向）
        if (!State.forbiddenPairs.has(idx)) {
          State.forbiddenPairs.set(idx, new Set());
        }
        State.forbiddenPairs.get(idx).add(currentIndex);
      });
      
      // 禁忌ペアカウント表示を更新
      updateForbiddenCountDisplay(currentIndex, State);
      
      // 他のレベルAのカウント表示も更新
      otherLevelAIndices.forEach(idx => {
        updateForbiddenCountDisplay(idx, State);
      });
      
      // 保存
      if (window.saveMetaOnly) window.saveMetaOnly();
      
      // トースト通知
      if (otherLevelAIndices.length > 0 && window.showToast) {
        window.showToast(`レベルAを選択したため、他のレベルA従業員${otherLevelAIndices.length}名を禁忌ペアに追加しました`);
      }
    }
  }
  
  // 禁忌ペアカウント表示を更新するヘルパー関数
  function updateForbiddenCountDisplay(employeeIndex, State){
    const row = attrContent.querySelector(`[data-idx="${employeeIndex}"]`);
    if (!row) return;
    
    const countLabel = row.querySelector('.forbid-count');
    if (!countLabel) return;
    
    const pairs = State.forbiddenPairs.get(employeeIndex);
    const count = pairs ? pairs.size : 0;
    countLabel.textContent = count > 0 ? `(${count}件)` : '';
  }

  function createWorkTypeSelect(currentType){
    const sel = document.createElement('select');
    sel.className = 'select worktype-select';
    // 追加: 明示的な data-role を付与（DOM 取得を安定化）
    sel.setAttribute('data-role','worktype');
    WorkOrder.forEach(key => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol} ${WorkMap[key].label}`;
      if(currentType === key) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function createQuotaInput(attr, selWt){
    const quotaWrap = document.createElement('div');
    quotaWrap.className = 'quota-wrap';
    quotaWrap.style.display = (attr?.workType || 'three') === 'night' ? 'flex' : 'none';
    quotaWrap.style.alignItems = 'center';
    quotaWrap.style.gap = '4px';

    const quotaLabel = document.createElement('span');
    quotaLabel.textContent = '☆ノルマ:';
    quotaLabel.style.fontSize = '0.9em';

    const quotaInput = document.createElement('input');
    quotaInput.type = 'number';
    quotaInput.className = 'quota-input';
    quotaInput.style.width = '50px';
    quotaInput.min = '0';
    quotaInput.max = '15';
    quotaInput.value = attr?.nightQuota || 10;
    quotaInput.title = '夜勤専従の4週間あたりの☆の目標回数';

    quotaWrap.appendChild(quotaLabel);
    quotaWrap.appendChild(quotaInput);

    // 勤務形態変更時にノルマ表示切替
    selWt.addEventListener('change', () => {
      quotaWrap.style.display = selWt.value === 'night' ? 'flex' : 'none';
    });

    return quotaWrap;
  }

// --- 早出(early shift)・遅出(late shift) 選択（スクロール式セレクト） ---

function createEarlyShiftToggle(attr, selWt){
  const wrap = document.createElement('div');
  wrap.className = 'early-toggle';
  wrap.style.display = (selWt && selWt.value === 'night') ? 'none' : 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.padding = '4px 0';

  if (!attr) attr = {};

  const label = document.createElement('span');
  label.textContent = '早出';
  label.style.fontSize = '0.9em';

  const sel = document.createElement('select');
  sel.className = 'select early-select';

  const options = [
    { value: 'none',    label: 'なし' },
    { value: 'all',     label: '全日' },
    { value: 'weekday', label: '平日のみ' },
    { value: 'holiday', label: '土日祝のみ' }
  ];

  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });

  let initValue = 'none';
  if (attr.hasEarlyShift){
    initValue = attr.earlyShiftType || 'all';
  }
  if (!options.some(o => o.value === initValue)){
    initValue = 'none';
  }
  sel.value = initValue;

  function applyValue(v){
    if (v === 'none'){
      attr.hasEarlyShift = false;
      delete attr.earlyShiftType;
    } else {
      attr.hasEarlyShift = true;
      attr.earlyShiftType = v;
    }

    if (typeof window.saveMetaOnly === 'function') window.saveMetaOnly();
    if (typeof window.renderGrid === 'function') window.renderGrid();
  }

  sel.addEventListener('change', () => {
    const v = sel.value;
    applyValue(v);
    if (typeof window.showToast === 'function'){
      const text =
        v === 'none'    ? '早出なしに変更しました' :
        v === 'all'     ? '早出：全日に変更しました' :
        v === 'weekday' ? '早出：平日のみに変更しました' :
                          '早出：土日祝のみに変更しました';
      window.showToast(text);
    }
  });

  if (selWt){
    const syncByWorkType = () => {
      const isNight = selWt.value === 'night';
      wrap.style.display = isNight ? 'none' : 'flex';
      sel.disabled = isNight;
      if (isNight){
        sel.value = 'none';
        applyValue('none');
      }
    };
    selWt.addEventListener('change', syncByWorkType);
    syncByWorkType();
  }

  wrap.appendChild(label);
  wrap.appendChild(sel);
  return wrap;
}

function createLateShiftToggle(attr, selWt){
  const wrap = document.createElement('div');
  wrap.className = 'late-toggle';
  wrap.style.display = (selWt && selWt.value === 'night') ? 'none' : 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.padding = '4px 0';

  if (!attr) attr = {};

  const label = document.createElement('span');
  label.textContent = '遅出';
  label.style.fontSize = '0.9em';

  const sel = document.createElement('select');
  sel.className = 'select late-select';

  const options = [
    { value: 'none',    label: 'なし' },
    { value: 'all',     label: '全日' },
    { value: 'weekday', label: '平日のみ' },
    { value: 'holiday', label: '土日祝のみ' }
  ];

  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });

  let initValue = 'none';
  if (attr.hasLateShift){
    initValue = attr.lateShiftType || 'all';
  }
  if (!options.some(o => o.value === initValue)){
    initValue = 'none';
  }
  sel.value = initValue;

  function applyValue(v){
    if (v === 'none'){
      attr.hasLateShift = false;
      delete attr.lateShiftType;
    } else {
      attr.hasLateShift = true;
      attr.lateShiftType = v;
    }

    if (typeof window.saveMetaOnly === 'function') window.saveMetaOnly();
    if (typeof window.renderGrid === 'function') window.renderGrid();
  }

  sel.addEventListener('change', () => {
    const v = sel.value;
    applyValue(v);
    if (typeof window.showToast === 'function'){
      const text =
        v === 'none'    ? '遅出なしに変更しました' :
        v === 'all'     ? '遅出：全日に変更しました' :
        v === 'weekday' ? '遅出：平日のみに変更しました' :
                          '遅出：土日祝のみに変更しました';
      window.showToast(text);
    }
  });

  if (selWt){
    const syncByWorkType = () => {
      const isNight = selWt.value === 'night';
      wrap.style.display = isNight ? 'none' : 'flex';
      sel.disabled = isNight;
      if (isNight){
        sel.value = 'none';
        applyValue('none');
      }
    };
    selWt.addEventListener('change', syncByWorkType);
    syncByWorkType();
  }

  wrap.appendChild(label);
  wrap.appendChild(sel);
  return wrap;
}

// 早出・遅出の一括適用ロジック
function applyBulkEarlyShift(value){
  const State = getState();
  if (!State) return;
  if (!['none','all','weekday','holiday'].includes(value)) return;

  for (let i = 0; i < State.employeeCount; i++){
    const attr = State.employeesAttr[i] || (State.employeesAttr[i] = {});
    const wt = attr.workType || 'three';
    if (wt === 'night') continue;  // 夜勤専従は対象外

    if (value === 'none'){
      attr.hasEarlyShift = false;
      delete attr.earlyShiftType;
    } else {
      attr.hasEarlyShift = true;
      attr.earlyShiftType = value;
    }
  }

  if (attrContent){
    const rows = Array.from(attrContent.querySelectorAll('.row'));
    rows.forEach(row => {
      const idx = Number(row.dataset.idx);
      if (!Number.isInteger(idx)) return;
      const selWt = row.querySelector('select[data-role="worktype"]') || row.querySelector('select.worktype-select');
      const wtVal = selWt ? selWt.value : (State.employeesAttr[idx]?.workType || 'three');
      if (wtVal === 'night') return;
      const sel = row.querySelector('select.early-select');
      if (sel){
        sel.value = value;
      }
    });
  }

  if (typeof window.saveMetaOnly === 'function') window.saveMetaOnly();
  if (typeof window.renderGrid === 'function') window.renderGrid();
  if (typeof window.showToast === 'function'){
    const label =
      value === 'none'    ? 'なし' :
      value === 'all'     ? '全日' :
      value === 'weekday' ? '平日のみ' :
                            '土日祝のみ';
    window.showToast(`早出を一括で「${label}」に設定しました`);
  }
}

function applyBulkLateShift(value){
  const State = getState();
  if (!State) return;
  if (!['none','all','weekday','holiday'].includes(value)) return;

  for (let i = 0; i < State.employeeCount; i++){
    const attr = State.employeesAttr[i] || (State.employeesAttr[i] = {});
    const wt = attr.workType || 'three';
    if (wt === 'night') continue;  // 夜勤専従は対象外

    if (value === 'none'){
      attr.hasLateShift = false;
      delete attr.lateShiftType;
    } else {
      attr.hasLateShift = true;
      attr.lateShiftType = value;
    }
  }

  if (attrContent){
    const rows = Array.from(attrContent.querySelectorAll('.row'));
    rows.forEach(row => {
      const idx = Number(row.dataset.idx);
      if (!Number.isInteger(idx)) return;
      const selWt = row.querySelector('select[data-role="worktype"]') || row.querySelector('select.worktype-select');
      const wtVal = selWt ? selWt.value : (State.employeesAttr[idx]?.workType || 'three');
      if (wtVal === 'night') return;
      const sel = row.querySelector('select.late-select');
      if (sel){
        sel.value = value;
      }
    });
  }

  if (typeof window.saveMetaOnly === 'function') window.saveMetaOnly();
  if (typeof window.renderGrid === 'function') window.renderGrid();
  if (typeof window.showToast === 'function'){
    const label =
      value === 'none'    ? 'なし' :
      value === 'all'     ? '全日' :
      value === 'weekday' ? '平日のみ' :
                            '土日祝のみ';
    window.showToast(`遅出を一括で「${label}」に設定しました`);
  }
}




// --- employeeDialog.js に追加（createQuotaInput関数の後） ---

  function createForbiddenPairsSelect(i, State){
    const forbidWrap = document.createElement('div');
    forbidWrap.className = 'forbid-wrap';
    forbidWrap.style.display = 'flex';
    forbidWrap.style.alignItems = 'center';
    forbidWrap.style.gap = '8px';

    // 禁忌ペアボタン
    const forbidBtn = document.createElement('button');
    forbidBtn.type = 'button';
    forbidBtn.className = 'btn btn-outline';
    forbidBtn.textContent = '禁忌ペア';
    forbidBtn.title = 'この従業員の禁忌ペア（一緒に勤務できない相手）を設定';
    
    // 現在の禁忌ペア数を表示
    const forbidCount = document.createElement('span');
    forbidCount.className = 'forbid-count';
    forbidCount.style.fontSize = '0.85em';
    forbidCount.style.color = '#6b7280';
    const current = State.forbiddenPairs.get(i);
    const count = current ? current.size : 0;
    forbidCount.textContent = count > 0 ? `(${count}件)` : '';

    // ボタンクリックで別窓を開く
    forbidBtn.addEventListener('click', () => {
      openForbiddenPairDialog(i, State, forbidCount);
    });

    forbidWrap.appendChild(forbidBtn);
    forbidWrap.appendChild(forbidCount);

    return forbidWrap;
  }


  // 禁忌ペア選択ダイアログを開く
  function openForbiddenPairDialog(employeeIndex, State, countLabel){
    const empName = State.employees[employeeIndex] || `職員${pad2(employeeIndex+1)}`;
    
    // ダイアログ要素を作成
    const dialog = document.createElement('dialog');
    dialog.className = 'attr forbid-pair-dialog';
    dialog.style.maxWidth = '500px';
    dialog.style.width = '90%';

    // ヘッダー
    const header = document.createElement('header');
    header.textContent = `禁忌ペア設定：${empName}`;
    dialog.appendChild(header);

    // コンテンツ
    const content = document.createElement('div');
    content.className = 'content';
    content.style.maxHeight = '400px';
    content.style.overflowY = 'auto';

    const hint = document.createElement('p');
    hint.textContent = '一緒に勤務できない従業員を選択してください（複数選択可）';
    hint.style.marginBottom = '12px';
    hint.style.color = '#6b7280';
    content.appendChild(hint);

    // チェックボックスリスト
    const checkboxList = document.createElement('div');
    checkboxList.style.display = 'flex';
    checkboxList.style.flexDirection = 'column';
    checkboxList.style.gap = '8px';

    const currentPairs = State.forbiddenPairs.get(employeeIndex) || new Set();
    const currentEmpAttr = State.employeesAttr[employeeIndex] || {};
    const isCurrentLevelA = currentEmpAttr.level === 'A';

    for (let j = 0; j < State.employeeCount; j++) {
      if (j === employeeIndex) continue;

      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.style.padding = '8px';
      label.style.borderRadius = '6px';
      label.style.cursor = 'pointer';
      label.style.transition = 'background-color 0.2s';
      label.addEventListener('mouseenter', () => {
        label.style.backgroundColor = '#f3f4f6';
      });
      label.addEventListener('mouseleave', () => {
        label.style.backgroundColor = 'transparent';
      });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(j);
      
      // レベルA同士の場合は自動チェック（解除も可能）
      const targetEmpAttr = State.employeesAttr[j] || {};
      const isTargetLevelA = targetEmpAttr.level === 'A';
      const shouldAutoCheck = isCurrentLevelA && isTargetLevelA;
      
      checkbox.checked = currentPairs.has(j) || shouldAutoCheck;
      checkbox.style.width = '18px';
      checkbox.style.height = '18px';
      checkbox.style.cursor = 'pointer';

      const text = document.createElement('span');
      const empAttr = State.employeesAttr[j] || {};
      const levelBadge = empAttr.level === 'A' ? ' [レベルA]' : '';
      text.textContent = (State.employees[j] || `職員${pad2(j+1)}`) + levelBadge;
      text.style.fontSize = '0.95em';
      
      // レベルA同士の場合は色を変えて強調
      if (empAttr.level === 'A') {
        text.style.color = '#dc2626';
        text.style.fontWeight = '600';
      }

      label.appendChild(checkbox);
      label.appendChild(text);
      checkboxList.appendChild(label);
    }

    content.appendChild(checkboxList);
    dialog.appendChild(content);

    // フッター
    const footer = document.createElement('footer');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn btn-outline';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', () => {
      dialog.close();
      document.body.removeChild(dialog);
    });

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn btn-accent';
    btnSave.textContent = '保存';
    btnSave.addEventListener('click', () => {
      // チェックされた項目を取得
      const checkboxes = checkboxList.querySelectorAll('input[type="checkbox"]');
      const newPairs = new Set();
      checkboxes.forEach(cb => {
        if (cb.checked) {
          newPairs.add(parseInt(cb.value, 10));
        }
      });

      // State に反映（双方向に設定）
      State.forbiddenPairs.set(employeeIndex, newPairs);
      
      // 相手側にも設定
      newPairs.forEach(j => {
        if (!State.forbiddenPairs.has(j)) {
          State.forbiddenPairs.set(j, new Set());
        }
        State.forbiddenPairs.get(j).add(employeeIndex);
      });

      // 削除された項目は相手側からも削除
      for (let j = 0; j < State.employeeCount; j++) {
        if (j === employeeIndex) continue;
        if (!newPairs.has(j) && currentPairs.has(j)) {
          const otherPairs = State.forbiddenPairs.get(j);
          if (otherPairs) {
            otherPairs.delete(employeeIndex);
          }
        }
      }

      // カウント表示を更新
      if (countLabel) {
        countLabel.textContent = newPairs.size > 0 ? `(${newPairs.size}件)` : '';
      }

      // 保存してダイアログを閉じる
      if (window.saveMetaOnly) window.saveMetaOnly();
      if (window.showToast) window.showToast('禁忌ペアを保存しました');
      
      dialog.close();
      document.body.removeChild(dialog);
    });

    footer.appendChild(btnCancel);
    footer.appendChild(btnSave);
    dialog.appendChild(footer);

    // ダイアログを DOM に追加して表示
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.show();
    }

    // Escape キーで閉じる
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dialog.close();
        document.body.removeChild(dialog);
      }
    });
  }

  function createControls(i, State){
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn btn-outline';
    btnUp.textContent = '▲上へ';
    btnUp.disabled = (i === 0);
    btnUp.addEventListener('click', () => moveEmployee(i, i-1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'btn btn-outline';
    btnDown.textContent = '▼下へ';
    btnDown.disabled = (i === State.employeeCount - 1);
    btnDown.addEventListener('click', () => moveEmployee(i, i+1));

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-danger';
    btnDel.textContent = '削除';
    btnDel.addEventListener('click', () => deleteEmployee(i));

    ctrls.appendChild(btnUp);
    ctrls.appendChild(btnDown);
    ctrls.appendChild(btnDel);

    return ctrls;
  }

function readAttrDialogToState(){
    const State = getState();
    if (!State) return;

    const rows = Array.from(attrContent.querySelectorAll('.row'));
    rows.forEach(row => {
      const i = Number(row.dataset.idx);
      // 明示的に data-role で取得するように変更（より堅牢）
      const selLv = row.querySelector('select[data-role="level"]') || row.querySelector('select.level-select');
      const selWt = row.querySelector('select[data-role="worktype"]') || row.querySelector('select.worktype-select');
      const nameInput = row.querySelector('input[data-role="name"]');
      const quotaInput = row.querySelector('.quota-input');
      // duration-select はクラスで取得（各 select に data-mark 属性は既に設定済み）
      const durSelects = Array.from(row.querySelectorAll('select.duration-select'));

      const nm = (nameInput?.value || '').trim();
      State.employees[i] = nm || `職員${pad2(i+1)}`;

      const nightQuota = quotaInput ? parseInt(quotaInput.value, 10) : undefined;

      // 既存の属性を保持しつつ更新（shiftDurations 等を上書きしない）
      const prev = State.employeesAttr[i] || {};
      const merged = Object.assign({}, prev, {
        level: selLv ? selLv.value : (prev.level || 'B'),
        workType: selWt ? selWt.value : (prev.workType || 'three'),
        nightQuota: (selWt && selWt.value === 'night' && Number.isInteger(nightQuota)) ? nightQuota : (prev.nightQuota)
      });

      // 読み取り：早出トグルの状態を取り込む（当該行に存在する場合）
      const earlyChk = row.querySelector('.early-toggle input[type="checkbox"]');
      merged.hasEarlyShift = earlyChk ? Boolean(earlyChk.checked) : (prev.hasEarlyShift || false);

      // 読み取り：遅出トグルの状態を取り込む（当該行に存在する場合）
      const lateChk = row.querySelector('.late-toggle input[type="checkbox"]');
      merged.hasLateShift = lateChk ? Boolean(lateChk.checked) : (prev.hasLateShift || false);


      // 更新：duration selects の値を読み取って empAttr.shiftDurations を更新
      if (!merged.shiftDurations) merged.shiftDurations = {};
      const sd = Object.assign({}, merged.shiftDurations);
      durSelects.forEach(s => {
        const mk = s.dataset.mark;
        if (!mk) return;
        const v = parseInt(s.value, 10);
        if (!isNaN(v)) {
          sd[mk] = v;
        }
      });
      merged.shiftDurations = sd;

      State.employeesAttr[i] = merged;

      // 禁忌ペアは別窓で直接 State に保存されるため、ここでは読み取り不要
    });
  }


  // 従業員の並び替え
  function moveEmployee(from, to){
    const State = getState();
    if (!State || to < 0 || to >= State.employeeCount || from === to) return;

    // 表示配列の入替
    [State.employees[from], State.employees[to]] = [State.employees[to], State.employees[from]];
    [State.employeesAttr[from], State.employeesAttr[to]] = [State.employeesAttr[to], State.employeesAttr[from]];

    // 31日窓内データ（Map）入替
    swapMapKey(State.offRequests, from, to);
    swapMapKey(State.assignments, from, to);

    // 全期間ストアも入替
    const store = window.readDatesStore();
    if (!store.off) store.off = {};
    if (!store.assign) store.assign = {};
    if (!store.lock) store.lock = {};
    swapStoreBuckets(store.off, from, to);
    swapStoreBuckets(store.assign, from, to);
    swapStoreBuckets(store.lock, from, to);
    writeDatesStore(store);

    updateLocksAfterSwap(from, to);
    refreshAfterChange('並び替えました');
  }

  // 従業員の削除
  function deleteEmployee(idx){
    if (!confirm('この従業員を削除します。現在の割当と希望休も削除されます。よろしいですか？')) return;

    const State = getState();
    if (!State) return;

    // 表示配列から除去
    State.employees.splice(idx, 1);
    State.employeesAttr.splice(idx, 1);

    // 従業員数を減算
    State.employeeCount = Math.max(1, State.employeeCount - 1);
    if (employeeCountSel){
      const maxOpt = Math.max(60, State.employeeCount);
      employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i) => {
        const v = i + 1;
        return `<option value="${v}">${v}</option>`;
      }).join('');
      employeeCountSel.value = String(State.employeeCount);
    }

    // 31日窓内データ（Map）を詰め直し
    State.offRequests = remapEmployeeMap(State.offRequests, idx);
    State.assignments = remapEmployeeMap(State.assignments, idx);

    // 全期間ストアも詰め直し
    const store = window.readDatesStore();
    store.off = remapStoreAfterDelete(store.off || {}, idx);
    store.assign = remapStoreAfterDelete(store.assign || {}, idx);
    store.lock = remapStoreAfterDelete(store.lock || {}, idx);
    writeDatesStore(store);

    updateLocksAfterDelete(idx);
    ensureEmployees();
    refreshAfterChange('従業員を削除しました');
  }

  // ユーティリティ関数群
  function swapMapKey(map, a, b){
    const hasA = map.has(a), hasB = map.has(b);
    const vA = hasA ? map.get(a) : undefined;
    const vB = hasB ? map.get(b) : undefined;
    if (hasA) map.set(b, vA); else map.delete(b);
    if (hasB) map.set(a, vB); else map.delete(a);
  }

  function swapStoreBuckets(obj, i, j){
    const tmp = obj[i];
    obj[i] = obj[j];
    obj[j] = tmp;
  }

  function remapEmployeeMap(map, idx){
    const out = new Map();
    for (const [k, v] of map.entries()){
      const n = Number(k);
      if (n < idx) out.set(n, v);
      else if (n > idx) out.set(n-1, v);
    }
    return out;
  }

  function remapStoreAfterDelete(obj, idx){
    const out = {};
    Object.keys(obj || {}).forEach(k => {
      const n = Number(k);
      if (Number.isNaN(n)) return;
      if (n < idx) out[n] = obj[n];
      else if (n > idx) out[n-1] = obj[n];
    });
    return out;
  }

  function updateLocksAfterSwap(a, b){
    const State = getState();
    if (!State) return;

    const next = new Set();
    for (const k of State.lockedCells){
      const [rs, ds] = k.split('|');
      let r = Number(rs);
      if (r === a) r = b; else if (r === b) r = a;
      next.add(`${r}|${ds}`);
    }
    State.lockedCells = next;
  }

  function updateLocksAfterDelete(idx){
    const State = getState();
    if (!State) return;

    const next = new Set();
    for (const k of State.lockedCells){
      const [rs, ds] = k.split('|');
      const r = Number(rs);
      if (r < idx) next.add(`${r}|${ds}`);
      else if (r > idx) next.add(`${r-1}|${ds}`);
    }
    State.lockedCells = next;
  }

  function ensureEmployees(){
    const State = getState();
    if (!State) return;

    const need = State.employeeCount;
    const cur = State.employees.length;
    if(cur < need){
      for(let i = cur; i < need; i++){
        State.employees.push(`職員${pad2(i+1)}`);
        State.employeesAttr.push({ level:'B', workType:'three' });
      }
    } else if(cur > need){
      State.employees.length = need;
      State.employeesAttr.length = need;
    }
  }

  function writeDatesStore(store){
    // app.jsのグローバル関数に委譲
    if (window.writeDatesStore) {
      window.writeDatesStore(store);
    }
  }

  // 全体既定値を全従業員に一括適用する関数
  function applyGlobalDurationsToAll(){
    const State = getState();
    if (!State) return;
    
    if (!window.ShiftDurations) {
      if (window.showToast) window.showToast('エラー：ShiftDurationsモジュールが見つかりません');
      return;
    }
    
    // 確認ダイアログ
    if (!confirm('現在の全体既定値を全従業員に一括適用します。\n各従業員の個別設定はリセットされます。\nよろしいですか？')) {
      return;
    }
    
    // 全体既定値を取得
    const globalDefs = (typeof window.ShiftDurations.getAllGlobalDefaults === 'function')
      ? window.ShiftDurations.getAllGlobalDefaults()
      : {};
    
    // 全従業員の shiftDurations をクリア（個別設定をリセット）
    let appliedCount = 0;
    for (let i = 0; i < State.employeeCount; i++) {
      if (!State.employeesAttr[i]) {
        State.employeesAttr[i] = { level: 'B', workType: 'three' };
      }
      // shiftDurations を空にすることで、全体既定値が適用される
      State.employeesAttr[i].shiftDurations = {};
      appliedCount++;
    }
    
    // ダイアログを再構築して表示を更新
    buildAttrDialog();
    
    // 保存とトースト表示
    if (window.saveMetaOnly) window.saveMetaOnly();
    if (window.renderGrid) window.renderGrid();
    if (window.showToast) {
      const marks = window.ShiftDurations.MARKS || ['〇','☆','★','◆','●'];
      const summary = marks.map(mk => {
        const val = globalDefs[mk] || (window.ShiftDurations.getDefaultForMark ? window.ShiftDurations.getDefaultForMark(mk) : 0);
        const formatted = (window.ShiftDurations.formatMinutes ? window.ShiftDurations.formatMinutes(val) : `${Math.floor(val/60)}:${String(val%60).padStart(2,'0')}`);
        return `${mk}:${formatted}`;
      }).join(', ');
      window.showToast(`${appliedCount}人の従業員に一括適用しました\n${summary}`);
    }
  }

  function refreshAfterChange(msg){
    buildAttrDialog();
    if (window.renderGrid) window.renderGrid();
    if (window.saveMetaOnly) window.saveMetaOnly();
    if (window.showToast) window.showToast(msg);
  }

  function saveAndClose(){
    readAttrDialogToState();
    if (window.saveMetaOnly) window.saveMetaOnly();
    if (window.renderGrid) window.renderGrid();
    closeDialog();
  }

  function closeDialog(){
    if (attrDlg && typeof attrDlg.close === 'function') {
      attrDlg.close();
    }
  }

// 修正後（init() を自動実行）
  // グローバル公開
  window.EmployeeDialog = {
    init,
    openAttrDialog,
    readAttrDialogToState
  };

  // 自動初期化（DOM読み込み完了後）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();