// ====== ボタン機能関係 ======
// app.jsから切り出したボタンイベントハンドラー群
// module化はせず、グローバルスコープで動作

(function(){
  'use strict';

  // app.jsから参照する要素とState（グローバル変数として既に存在）
  // 必要な要素参照を取得
  let btnJumpMonth, monthPicker, btnPrevDay, btnNextDay, btnHolidayAuto;
  let btnAutoAssign, btnCancel, btnFullCancel, btnUndo, btnSave;
  let btnExportExcel, btnLogout, btnLockRange, btnUnlockRange;
  let fullCancelDlg, fullCancelAllBtn, fullCancelCloseBtn;
  let btnLeaveHoliday, btnLeaveSub, btnLeavePaid, btnLeaveRefresh;
  let btnAttrOpen, attrDlg, attrSave, attrClose;
  let modeRadios;
  let btnClearOffCell, btnClearAssignCell;

  // app.jsのグローバル変数・関数への参照（window経由）
  let State;
  let showToast, switchAnchor, shiftDays, renderGrid, paintRange4w;
  let autoLoadJapanHolidays, exportExcelCsv;
  let cancelChanges, makeCancelBackup, undoCancelRange;
  let applyHolidayLeaveFlags, autoAssignRange;
  let completeCancelAll, completeCancelOneCell;
  let saveWindow, pushToRemote, saveMetaOnly;
  let openAttrDialog, readAttrDialogToState;
  let updateFooterCounts, dateStr, addDays;

  // 初期化関数（app.jsのinitControlsから呼ばれる）
  window.ButtonHandlers = {
    init: function() {
      // 要素の取得
      btnJumpMonth = document.getElementById('btnJumpMonth');
      monthPicker = document.getElementById('monthPicker');
      btnPrevDay = document.getElementById('btnPrevDay');
      btnNextDay = document.getElementById('btnNextDay');
      btnHolidayAuto = document.getElementById('btnHolidayAuto');
      btnAutoAssign = document.getElementById('btnAutoAssign');
      btnCancel = document.getElementById('btnCancel');
      btnFullCancel = document.getElementById('btnFullCancel');
      btnUndo = document.getElementById('btnUndo');
      btnSave = document.getElementById('btnSave');
      btnExportExcel = document.getElementById('btnExportExcel');
      btnLogout = document.getElementById('btnLogout');
      btnLockRange = document.getElementById('btnLockRange');
      btnUnlockRange = document.getElementById('btnUnlockRange');
      
      fullCancelDlg = document.getElementById('fullCancelDlg');
      fullCancelAllBtn = document.getElementById('fullCancelAll');
      fullCancelCloseBtn = document.getElementById('fullCancelClose');
      
      btnLeaveHoliday = document.getElementById('btnLeaveHoliday');
      btnLeaveSub = document.getElementById('btnLeaveSub');
      btnLeavePaid = document.getElementById('btnLeavePaid');
      btnLeaveRefresh = document.getElementById('btnLeaveRefresh');
      
      btnAttrOpen = document.getElementById('btnAttrOpen');
      attrDlg = document.getElementById('attrDlg');
      attrSave = document.getElementById('attrSave');
      attrClose = document.getElementById('attrClose');
            
      btnClearOffCell = document.getElementById('btnClearOffCell');
      btnClearAssignCell = document.getElementById('btnClearAssignCell');
      modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));

      // app.jsのグローバル関数・変数を取得
      State = window.State;
      showToast = window.showToast;
      switchAnchor = window.switchAnchor;
      shiftDays = window.shiftDays;
      renderGrid = window.renderGrid;
      paintRange4w = window.paintRange4w;
      autoLoadJapanHolidays = window.autoLoadJapanHolidays;
      exportExcelCsv = window.exportExcelCsv;
      cancelChanges = window.cancelChanges;
      makeCancelBackup = window.makeCancelBackup;
      undoCancelRange = window.undoCancelRange;
      applyHolidayLeaveFlags = window.applyHolidayLeaveFlags;
      autoAssignRange = window.autoAssignRange;
      completeCancelAll = window.completeCancelAll;
      completeCancelOneCell = window.completeCancelOneCell;
      saveWindow = window.saveWindow;
      pushToRemote = window.pushToRemote;
      saveMetaOnly = window.saveMetaOnly;
      openAttrDialog = window.openAttrDialog;
      readAttrDialogToState = window.readAttrDialogToState;
      updateFooterCounts = window.updateFooterCounts;
      dateStr = window.App?.Dates?.dateStr;
      addDays = window.App?.Dates?.addDays;

    // UndoBufはapp.jsで管理されているグローバル変数（window.UndoBuf）
     

      // イベントリスナーの登録
      setupMonthNavigation();
      setupDayNavigation();
      setupHolidayAutoButton();
      setupAutoAssignButton();
      setupCancelButtons();
      setupLockButtons();
      setupExportButton();
      setupLogoutButton();
      setupModeRadios();
      setupLeaveButtons();
      setupAttrDialog();
      setupEscapeKey();
    }
  };

  // === 月ジャンプ ===
  function setupMonthNavigation() {
    if (btnJumpMonth && monthPicker) {
      btnJumpMonth.addEventListener('click', () => {
        if (monthPicker.showPicker) {
          monthPicker.showPicker();
        } else {
          monthPicker.click();
        }
      });

      monthPicker.addEventListener('change', () => {
        const [y, m] = monthPicker.value.split('-').map(Number);
        if (!y || !m) return;
        switchAnchor(new Date(y, m - 1, 1)); // 月初にジャンプ
      });
    }
  }

  // === 日単位ナビゲーション ===
  function setupDayNavigation() {
    if (btnPrevDay) {
      btnPrevDay.addEventListener('click', () => shiftDays(-1)); // 1日戻る
    }
    if (btnNextDay) {
      btnNextDay.addEventListener('click', () => shiftDays(+1)); // 1日進む
    }
  }

  // === 祝日自動読込 ===
  function setupHolidayAutoButton() {
    if (btnHolidayAuto) {
      btnHolidayAuto.addEventListener('click', autoLoadJapanHolidays);
    }
  }

  // === 自動割り当てボタン ===
  function setupAutoAssignButton() {
    if (!btnAutoAssign) return;

    btnAutoAssign.addEventListener('click', () => {
      const start = State.range4wStart;
      const end = State.range4wStart + 27;

      // アンドゥ用バックアップを確保
      window.UndoBuf = makeCancelBackup();

      // いったん4週間ぶんをクリア（希望休は維持）＋「祝/代」を一括消去（ロックは保持）
      cancelChanges(true, true);

      // 乱数シード更新（クリック毎に変化）
      if (window.NightBand && typeof window.NightBand.setSeed === 'function') {
        window.NightBand.setSeed(((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0));
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

      const s = State.windowDates[start];
      const e = State.windowDates[end];
      showToast(`4週間の自動割り当て完了：${s.getMonth() + 1}/${s.getDate()}〜${e.getMonth() + 1}/${e.getDate()}（別パターン／保存は別）`);

      // 直前状態に戻せるようアンドゥを有効化
      if (btnUndo) btnUndo.disabled = false;
    });
  }

  // === キャンセルボタン群 ===
  function setupCancelButtons() {
    // 通常キャンセル（希望休を残して割当クリア）
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        const sIdx = State.range4wStart;
        const eIdx = sIdx + 27;
        const s = State.windowDates[sIdx];
        const e = State.windowDates[eIdx];
        const msg = `開始：${s.getMonth() + 1}/${s.getDate()} 〜 終了：${e.getMonth() + 1}/${e.getDate()}\n` +
                    `の28日間で、希望休を除き割り当てを未割当に戻します。\n` +
                    `※ ロック済みセルは保持し、「祝」「代」は消去します。よろしいですか？`;
        if (!confirm(msg)) return;

        window.UndoBuf = makeCancelBackup();

        // ロック尊重 + 祝/代 クリア
        cancelChanges(true, true);
        showToast('指定4週間をクリア：「割当」消去／「祝・代」消去／ロック保持（希望休は維持）');

        if (btnUndo) btnUndo.disabled = false;
      });
    }

// 完全クリア（ダイアログ表示）
if (btnFullCancel) {
  btnFullCancel.addEventListener('click', () => {
    if (!fullCancelDlg) return;
    if (typeof fullCancelDlg.showModal === 'function') {
      fullCancelDlg.showModal();
    } else {
      fullCancelDlg.show();
    }
  });
}

// ダイアログ内ボタン：全体完全クリア実行
if (fullCancelAllBtn) {
  fullCancelAllBtn.addEventListener('click', () => {
    completeCancelAll();
    if (fullCancelDlg) fullCancelDlg.close();
  });
}

// ダイアログ内ボタン：閉じる
if (fullCancelCloseBtn) {
  fullCancelCloseBtn.addEventListener('click', () => {
    if (fullCancelDlg) fullCancelDlg.close();
  });
}
  }


  // === ロック範囲ボタン ===
  function setupLockButtons() {
    if (btnLockRange) {
      btnLockRange.addEventListener('click', () => {
        State.lockMode = 'lock';
        State.lockStart = null;
        showToast('範囲ロック：開始セルをクリックしてください');
      });
    }

    if (btnUnlockRange) {
      btnUnlockRange.addEventListener('click', () => {
        State.lockMode = 'unlock';
        State.lockStart = null;
        showToast('範囲ロック解除：開始セルをクリックしてください');
      });
    }
  }

  // === Excel出力ボタン ===
  function setupExportButton() {
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', exportExcelCsv);
    }
  }

  // === ログアウトボタン ===
  function setupLogoutButton() {
    if (!btnLogout) return;

    btnLogout.addEventListener('click', () => {
      // ログアウト時は自動保存
      saveWindow();
      // 保存後にクラウドへも送信
      pushToRemote();

      try {
        sessionStorage.removeItem('sched:loggedIn');
      } catch (_) {}
      try {
        sessionStorage.removeItem('sched:userId');
      } catch (_) {}

      const appView = document.getElementById('appView');
      const loginView = document.getElementById('loginView');
      const loginForm = document.getElementById('loginForm');

      if (appView) appView.classList.remove('active');
      if (loginView) loginView.classList.add('active');
      if (loginForm) loginForm.reset();

      showToast('保存してログアウトしました');
    });
  }

// === モード切替ラジオボタン ===
function setupModeRadios() {
  modeRadios.forEach(r => {
    r.addEventListener('change', () => {
      State.mode = modeRadios.find(x => x.checked).value;
      State.leaveMode = null; // 特別休暇モード解除
      const label = 
        State.mode === 'off' ? '希望休モード' : 
        State.mode === 'assign' ? '割当モード' : 
        State.mode === 'clear' ? 'クリアモード（セルをクリックで消去）' :
        'モード切替';
      showToast(label);
    });
  });
}

  // === 特別休暇ボタン ===
  function setupLeaveButtons() {
    function bindLeaveBtn(btn, code) {
      if (!btn) return;
      btn.addEventListener('click', () => {
        State.leaveMode = (State.leaveMode === code ? null : code);
        const label = State.leaveMode ? `${State.leaveMode}モード` : '特別休暇モード解除';
        showToast(label);
      });
    }

    bindLeaveBtn(btnLeaveHoliday, '祝');
    bindLeaveBtn(btnLeaveSub, '代');
    bindLeaveBtn(btnLeavePaid, '年');
    bindLeaveBtn(btnLeaveRefresh, 'リ');
  }


// 修正後（初期化完了を確認してから実行）
function setupAttrDialog() {
    if (btnAttrOpen) {
      btnAttrOpen.addEventListener('click', () => {
        // 初期化を確認してから実行
        if (!window.EmployeeDialog) {
          console.error('EmployeeDialog が未初期化です');
          showToast('従業員ダイアログの初期化に失敗しました');
          return;
        }
        
        // 優先：employeeDialog.js 側の実装を利用（勤務時間編集ボタン付き）
        if (typeof window.EmployeeDialog.openAttrDialog === 'function') {
          window.EmployeeDialog.openAttrDialog();
        } else if (typeof openAttrDialog === 'function') {
          // フォールバック：従来の実装
          openAttrDialog();
        } else {
          console.error('openAttrDialog が見つかりません');
          showToast('ダイアログを開けません');
        }
      });
    }

    if (attrSave) {
      attrSave.addEventListener('click', () => {
        // 優先：employeeDialog.js 側の readAttrDialogToState を利用
        if (window.EmployeeDialog && typeof window.EmployeeDialog.readAttrDialogToState === 'function') {
          window.EmployeeDialog.readAttrDialogToState();
        } else if (typeof readAttrDialogToState === 'function') {
          // フォールバック：従来の実装
          readAttrDialogToState();
        }
        saveMetaOnly();
        renderGrid();
        if (attrDlg) attrDlg.close();
        showToast('従業員属性を保存しました');
      });
    }

    if (attrClose) {
      attrClose.addEventListener('click', () => {
        if (attrDlg) attrDlg.close();
      });
    }
  }


  // === Escキー処理 ===
  function setupEscapeKey() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && State.clearCellMode) {
        State.clearCellMode = null;
        showToast('セルクリアモードを終了しました');
      }
    });
  }

  // 祝日自動読込ボタンの初期化を忘れずに
  setupHolidayAutoButton();

})();