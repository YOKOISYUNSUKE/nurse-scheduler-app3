// buttonHandlers.js - ボタン機能関係のコード
// グローバルスコープで動作（module化なし）

(function(){
  'use strict';
  
  // ====== ボタンイベントハンドラーと関連ロジック ======
  
  // DOM要素の取得を遅延させる（app.jsの初期化後に実行されるため）
  function getElements() {
    const $ = (sel, root=document) => root.querySelector(sel);
    const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
    
    return {
      btnJumpMonth: $('#btnJumpMonth'),
      monthPicker: $('#monthPicker'),
      btnAutoAssign: $('#btnAutoAssign'),
      btnCancel: $('#btnCancel'),
      btnFullCancel: $('#btnFullCancel'),
      btnUndo: $('#btnUndo'),
      btnSave: $('#btnSave'),
      btnExportExcel: $('#btnExportExcel'),
      btnLogout: $('#btnLogout'),
      btnPrevDay: $('#btnPrevDay'),
      btnNextDay: $('#btnNextDay'),
      btnAttrOpen: $('#btnAttrOpen'),
      btnHolidayAuto: $('#btnHolidayAuto'),
      btnLockRange: $('#btnLockRange'),
      btnUnlockRange: $('#btnUnlockRange'),
      fullCancelDlg: $('#fullCancelDlg'),
      fullCancelAllBtn: $('#fullCancelAll'),
      fullCancelCellBtn: $('#fullCancelCell'),
      fullCancelCloseBtn: $('#fullCancelClose'),
      btnLeaveHoliday: $('#btnLeaveHoliday'),
      btnLeaveSub: $('#btnLeaveSub'),
      btnLeavePaid: $('#btnLeavePaid'),
      btnLeaveRefresh: $('#btnLeaveRefresh'),
      attrDlg: $('#attrDlg'),
      attrContent: $('#attrContent'),
      attrSave: $('#attrSave'),
      attrClose: $('#attrClose'),
      employeeCountSel: $('#employeeCount'),
      modeRadios: $$('input[name="mode"]'),
      gridWrap: $('#gridWrap'),
      appView: $('#appView'),
      loginView: $('#loginView'),
      loginForm: $('#loginForm')
    };
  }

  // コントロール初期化関数
  function initControls(){
    const els = getElements();
    if (!els.employeeCountSel) return;
    
    // アクセス用のグローバル参照を取得
    const State = window.State;
    const showToast = window.showToast;
    const ensureEmployees = window.ensureEmployees;
    const renderGrid = window.renderGrid;
    const saveMetaOnly = window.saveMetaOnly;
    const switchAnchor = window.switchAnchor;
    const shiftDays = window.shiftDays;
    const autoLoadJapanHolidays = window.autoLoadJapanHolidays;
    const exportExcelCsv = window.exportExcelCsv;
    const makeCancelBackup = window.makeCancelBackup;
    const cancelChanges = window.cancelChanges;
    const autoAssignRange = window.autoAssignRange;
    const applyHolidayLeaveFlags = window.applyHolidayLeaveFlags;
    const paintRange4w = window.paintRange4w;
    const undoCancelRange = window.undoCancelRange;
    const saveWindow = window.saveWindow;
    const pushToRemote = window.pushToRemote;
    const dragDayNavigation = window.dragDayNavigation;
    const openAttrDialog = window.openAttrDialog;
    const readAttrDialogToState = window.readAttrDialogToState;
    const completeCancelAll = window.completeCancelAll;
    
    // 従業員数セレクトボックスの初期化
    const maxOpt = Math.max(60, State.employeeCount);
    els.employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i)=>{
      const v = i + 1; return `<option value="${v}">${v}</option>`;
    }).join('');
    els.employeeCountSel.value = String(State.employeeCount);
    els.employeeCountSel.disabled = false;
    const empTool = els.employeeCountSel.closest('.tool');
    if (empTool) empTool.style.display = '';
    
    // 従業員数変更イベント
    els.employeeCountSel.addEventListener('change', ()=>{
      State.employeeCount = parseInt(els.employeeCountSel.value,10);
      ensureEmployees();
      renderGrid();
      saveMetaOnly();
    });

    // 月ジャンプボタン
    if (els.btnJumpMonth) {
      els.btnJumpMonth.addEventListener('click', ()=> 
        els.monthPicker.showPicker ? els.monthPicker.showPicker() : els.monthPicker.click()
      );
    }
    
    // 月選択
    if (els.monthPicker) {
      els.monthPicker.addEventListener('change', ()=>{
        const [y,m] = els.monthPicker.value.split('-').map(Number);
        if(!y || !m) return;
        switchAnchor(new Date(y, m-1, 1));
      });
    }

    // 前日・翌日ボタン
    if (els.btnPrevDay) els.btnPrevDay.addEventListener('click', ()=> shiftDays(-1));
    if (els.btnNextDay) els.btnNextDay.addEventListener('click', ()=> shiftDays(+1));
    
    // 祝日自動取得ボタン
    if (els.btnHolidayAuto) els.btnHolidayAuto.addEventListener('click', autoLoadJapanHolidays);
    
    // Excelエクスポートボタン
    if (els.btnExportExcel) els.btnExportExcel.addEventListener('click', exportExcelCsv);
    
    // Undoボタン初期化
    if (els.btnUndo) els.btnUndo.disabled = true;

    // 範囲ロック/解除ボタン
    if (els.btnLockRange) {
      els.btnLockRange.addEventListener('click', ()=>{
        State.lockMode = 'lock'; 
        State.lockStart = null;
        showToast('範囲ロック：開始セルをクリックしてください');
      });
    }
    
    if (els.btnUnlockRange) {
      els.btnUnlockRange.addEventListener('click', ()=>{
        State.lockMode = 'unlock'; 
        State.lockStart = null;
        showToast('範囲ロック解除：開始セルをクリックしてください');
      });
    }

    // 自動割り当てボタン
    if (els.btnAutoAssign) {
      els.btnAutoAssign.addEventListener('click', ()=>{
        const start = State.range4wStart;
        const end   = State.range4wStart + 27;

        // アンドゥ用バックアップを確保
        window.UndoBuf = makeCancelBackup();

        // いったん4週間ぶんをクリア（希望休は維持）＋「祝/代」を一括消去（ロックは保持）
        cancelChanges(true, true);

        // 乱数シード更新（クリック毎に変化）
        if (window.NightBand && typeof window.NightBand.setSeed === 'function') {
          window.NightBand.setSeed(((Date.now() ^ Math.floor(Math.random()*1e9)) >>> 0));
        }
        // ランダム性の強度
        if (window.NightBand && typeof window.NightBand.setRandAmp === 'function') {
          window.NightBand.setRandAmp(1.8);
        }

        // 再自動割当（別パターン）
        autoAssignRange(start, end);

        // 祝日自動付与（休→祝 / 祝日勤務者に代休を自動設定）
        applyHolidayLeaveFlags(start, end);

        renderGrid();
        paintRange4w();

        const s = State.windowDates[start], e = State.windowDates[end];
        showToast(`4週間の自動割り当て完了：${s.getMonth()+1}/${s.getDate()}〜${e.getMonth()+1}/${e.getDate()}（別パターン／保存は別）`);

        // 直前状態に戻せるようアンドゥを有効化
        if (els.btnUndo) els.btnUndo.disabled = false;
      });
    }

    // 保存ボタン
    if (els.btnSave) {
      els.btnSave.addEventListener('click', ()=>{
        // 検証ロジックはapp.jsに残っているため、そのまま呼び出す
        if (window.AssignRules && typeof window.AssignRules.validateWindow === 'function'){
          const res = window.AssignRules.validateWindow({
            dates: State.windowDates,
            employeeCount: State.employeeCount,
            getAssign: window.getAssign,
            isHoliday: (ds)=> State.holidaySet.has(ds),
            getLevel:  (r)=> (State.employeesAttr[r]?.level)||'B',
            hasOffByDate: window.hasOffByDate,
            getWorkType: (r)=> (State.employeesAttr[r]?.workType) || 'three',
            getFixedDayCount: (_ds)=> null
          });

          if (!res.ok){
            const e = res.errors[0];
            const dt = State.windowDates[e.dayIndex];
            const md = (dt.getMonth()+1)+'/'+dt.getDate();
            const label =
              e.type==='NF'                 ? '（☆＋◆）' :
              e.type==='NS'                 ? '（★＋●）' :
              e.type==='DAY_MIN'            ? '〇' :
              e.type==='DAY_WKD_ALLOWED'    ? '〇（土日祝の許容数）' :
              e.type==='DAY_EQ'             ? '〇（固定）' :
              e.type==='A_DAY'              ? '〇のA' :
              e.type==='A_NF'               ? '（☆＋◆）のA' :
              e.type==='A_NS'               ? '（★＋●）のA' :
              e.type==='WT_DAY_ONLY'        ? '日勤専従の勤務形態違反' :
              e.type==='WT_NIGHT_ONLY'      ? '夜勤専従の勤務形態違反' :
              e.type==='DAY_STREAK_GT5'     ? '〇連続' :
              e.type==='DAY_REST_AFTER5'    ? '「〇×5」の直後休' :
              e.type==='SEQ_NF_DAY'         ? '「◆→〇」禁止' :
              e.type==='SEQ_NF_NS'          ? '「◆→●」禁止' :
              e.type==='SEQ_NS_NF_MAX2'     ? '「●→◆」上限' :
              e.type==='SEQ_NS_NF_GAP'      ? '「●→◆」間隔' :
              e.type==='PAIR_GAP_GE3'       ? '「☆★」間隔' :
              e.type==='SEQ_STAR_AFTER_REST2'? '「☆★」後の休休' :
              e.type==='OFF_SINGLE_STREAK_GT2' ? '単一休み連続' :
              e.type==='WORK_STREAK_GT5'    ? '休間隔（6連勤禁止）' :
              e.type==='RENKYU_GAP_LEQ13'   ? '連休間の間隔' :
              e.type==='RENKYU_MIN2'        ? '連休（2日以上）回数' :
              e.type==='BAND_AC_NIGHT'      ? `夜勤帯A+C+夜専の同席${e.band==='NS'?'（NS）':'（NF）'}` :
                                              '〇';

            const expect =
              e.type==='DAY_MIN' ? String(e.expected) :
              (e.expected ?? '');
            showToast(`${md} の ${label} が未充足：${e.actual}${expect?` / ${expect}`:''}`);
            return;
          }
        }

        // 追加ルール：4週間の休日検証（app.jsから呼び出し）
        const validationError = window.validateFourWeeksOff();
        if (validationError) {
          showToast(validationError);
          return;
        }

        // ローリング4週間検証（app.jsから呼び出し）
        const rollingError = window.validateRollingFourWeeksWithHistory(State.range4wStart, State.range4wStart + 27);
        if (rollingError) {
          showToast(rollingError);
          return;
        }

        // 保存実行
        saveWindow();
        showToast('保存しました');
      });
    }

    // キャンセルボタン
    if (els.btnCancel) {
      els.btnCancel.addEventListener('click', ()=>{
        const sIdx = State.range4wStart;
        const eIdx = sIdx + 27;
        const s = State.windowDates[sIdx], e = State.windowDates[eIdx];
        const msg = `開始：${s.getMonth()+1}/${s.getDate()} 〜 終了：${e.getMonth()+1}/${e.getDate()}\n` +
                    `の28日間で、希望休を除き割り当てを未割当に戻します。\n` +
                    `※ ロック済みセルは保持し、「祝」「代」は消去します。よろしいですか？`;
        if (!confirm(msg)) return;

        window.UndoBuf = makeCancelBackup();

        // ロック尊重 + 祝/代 クリア
        cancelChanges(true, true);
        showToast('指定4週間をクリア：「割当」消去／「祝・代」消去／ロック保持（希望休は維持）');

        if (els.btnUndo) els.btnUndo.disabled = false;
      });
    }

    // 完全キャンセルボタン
    if (els.btnFullCancel) {
      els.btnFullCancel.addEventListener('click', ()=>{
        if (!els.fullCancelDlg) return;
        if (typeof els.fullCancelDlg.showModal === 'function') els.fullCancelDlg.showModal();
        else els.fullCancelDlg.show();
      });
    }

    // ダイアログ内ボタンの結線
    if (els.fullCancelAllBtn) {
      els.fullCancelAllBtn.addEventListener('click', ()=>{
        completeCancelAll();
        if (els.fullCancelDlg) els.fullCancelDlg.close();
      });
    }
    
    if (els.fullCancelCellBtn) {
      els.fullCancelCellBtn.addEventListener('click', ()=>{
        State.fullCancelCellMode = true;
        showToast('完全キャンセル（1セル）：対象セルをクリック（Escで解除）');
        if (els.fullCancelDlg) els.fullCancelDlg.close();
      });
    }
    
    if (els.fullCancelCloseBtn) {
      els.fullCancelCloseBtn.addEventListener('click', ()=>{
        if (els.fullCancelDlg) els.fullCancelDlg.close();
      });
    }

    // Escで1セル完全キャンセルを終了
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && State.fullCancelCellMode){
        State.fullCancelCellMode = false;
        showToast('完全キャンセル（1セル）を終了しました');
      }
    });

    // アンドゥボタン
    if (els.btnUndo) {
      els.btnUndo.addEventListener('click', ()=>{
        const ok = undoCancelRange();
        if (ok) {
          showToast('元に戻しました（必要なら保存してください）');
        }
      });
    }

    // ログアウトボタン
    if (els.btnLogout) {
      els.btnLogout.addEventListener('click', ()=>{
        // ログアウト時は自動保存
        saveWindow();
        // 保存後にクラウドへも送信
        pushToRemote();

        try{ sessionStorage.removeItem('sched:loggedIn'); }catch(_){}
        try{ sessionStorage.removeItem('sched:userId'); }catch(_){}
        els.appView.classList.remove('active');
        els.loginView.classList.add('active');
        els.loginForm.reset();
        showToast('保存してログアウトしました');
      });
    }

    // 左右ドラッグで日単位スクロール
    if (els.gridWrap) {
      dragDayNavigation(els.gridWrap);
    }

    // モード切り替え
    if (els.modeRadios) {
      els.modeRadios.forEach(r=> r.addEventListener('change', ()=>{
        State.mode = els.modeRadios.find(x=>x.checked).value;
        State.leaveMode = null;
        showToast(State.mode==='off' ? '希望休モード' : '割当モード');
      }));
    }

    // 特別休暇ボタン
    function bindLeaveBtn(btn, code){
      if (!btn) return;
      btn.addEventListener('click', ()=>{
        State.leaveMode = (State.leaveMode===code ? null : code);
        const label = State.leaveMode ? `${State.leaveMode}モード` : '特別休暇モード解除';
        showToast(label);
      });
    }
    bindLeaveBtn(els.btnLeaveHoliday, '祝');
    bindLeaveBtn(els.btnLeaveSub,     '代');
    bindLeaveBtn(els.btnLeavePaid,    '年');
    bindLeaveBtn(els.btnLeaveRefresh, 'リ');

    // 従業員編集ダイアログ
    if (els.btnAttrOpen) els.btnAttrOpen.addEventListener('click', openAttrDialog);
    if (els.attrSave) {
      els.attrSave.addEventListener('click', ()=>{
        readAttrDialogToState();
        saveMetaOnly();
        renderGrid();
        els.attrDlg.close();
        showToast('従業員属性を保存しました');
      });
    }
    if (els.attrClose) els.attrClose.addEventListener('click', ()=> els.attrDlg.close());
  }

  // グローバルスコープに公開
  window.initButtonHandlers = initControls;

  // DOMContentLoaded後に自動的にinitControlsが呼ばれないように、
  // 代わりにapp.jsから明示的に呼び出してもらう
})();
