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
      setupAutoAssignButton();
      setupCancelButtons();
      setupSaveButton();
      setupUndoButton();
      setupLockButtons();
      setupExportButton();
      setupLogoutButton();
      setupModeRadios();
      setupLeaveButtons();
      setupAttrDialog();
      setupClearCellButtons();
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

  // === 保存ボタン ===
  function setupSaveButton() {
    if (!btnSave) return;

    btnSave.addEventListener('click', () => {
      // バリデーション（app.jsのグローバル関数を使用）
      if (window.AssignRules && typeof window.AssignRules.validateWindow === 'function') {
        const res = window.AssignRules.validateWindow({
          dates: State.windowDates,
          employeeCount: State.employeeCount,
          getAssign: window.getAssign,
          isHoliday: (ds) => State.holidaySet.has(ds),
          getLevel: (r) => (State.employeesAttr[r]?.level) || 'B',
          hasOffByDate: window.hasOffByDate,
          getWorkType: (r) => (State.employeesAttr[r]?.workType) || 'three',
          getFixedDayCount: (_ds) => null
        });

        if (!res.ok) {
          const e = res.errors[0];
          const dt = State.windowDates[e.dayIndex];
          const md = (dt.getMonth() + 1) + '/' + dt.getDate();
          const label =
            e.type === 'NF' ? '（☆＋◆）' :
            e.type === 'NS' ? '（★＋●）' :
            e.type === 'DAY_MIN' ? '〇' :
            e.type === 'DAY_WKD_ALLOWED' ? '〇（土日祝の許容数）' :
            e.type === 'DAY_EQ' ? '〇（固定）' :
            e.type === 'A_DAY' ? '〇のA' :
            e.type === 'A_NF' ? '（☆＋◆）のA' :
            e.type === 'A_NS' ? '（★＋●）のA' :
            e.type === 'NEED_NON_NIGHT_DAY' ? '〇帯の非夜勤専従' :
            e.type === 'NEED_NON_NIGHT_NF' ? '（☆＋◆）帯の非夜勤専従' :
            e.type === 'NEED_NON_NIGHT_NS' ? '（★＋●）帯の非夜勤専従' :
            e.type === 'NIGHT_ONLY_NF_MAX2' ? 'NF帯の夜勤専従人数' :  // ★追加
            e.type === 'NIGHT_ONLY_NS_MAX2' ? 'NS帯の夜勤専従人数' :  // ★追加
            e.type === 'WT_DAY_ONLY' ? '日勤専従の勤務形態違反' :
            e.type === 'WT_NIGHT_ONLY' ? '夜勤専従の勤務形態違反' :
            e.type === 'DAY_STREAK_GT5' ? '〇連続' :
            e.type === 'DAY_REST_AFTER5' ? '「〇×5」の直後休' :
            e.type === 'SEQ_NF_DAY' ? '「◆→〇」禁止' :
            e.type === 'SEQ_NF_NS' ? '「◆→●」禁止' :
            e.type === 'SEQ_NS_NF_MAX2' ? '「●→◆」上限' :
            e.type === 'SEQ_NS_NF_GAP' ? '「●→◆」間隔' :
            e.type === 'PAIR_GAP_GE3' ? '「☆★」間隔' :
            e.type === 'SEQ_STAR_AFTER_REST2' ? '「☆★」後の休休' :
            e.type === 'OFF_SINGLE_STREAK_GT2' ? '単一休み連続' :
            e.type === 'WORK_STREAK_GT5' ? '休間隔（6連勤禁止）' :
            e.type === 'RENKYU_GAP_LEQ13' ? '連休間の間隔' :
            e.type === 'RENKYU_MIN2' ? '連休（2日以上）回数' :
            e.type === 'BAND_AC_NIGHT' ? `夜勤帯A+C+夜専の同席${e.band === 'NS' ? '（NS）' : '（NF）'}` :
            '〇';

          const expect =
            e.type === 'DAY_MIN' ? String(e.expected) :
            (e.expected ?? '');
          showToast(`${md} の ${label} が未充足：${e.actual}${expect ? ` / ${expect}` : ''}`);
          return; // 保存中止
        }
      }

      // 4週間の休日数チェック
      {
        const start = State.range4wStart;
        const end = State.range4wStart + 27;
        for (let r = 0; r < State.employeeCount; r++) {
          let off = 0;
          for (let d = start; d <= end; d++) {
            const ds = dateStr(State.windowDates[d]);
            const mk = window.getAssign(r, ds);
            const hasLv = !!window.getLeaveType(r, ds);
            if ((window.hasOffByDate(r, ds) || !mk) && !hasLv) off++;
          }
          const needOff = (function() {
            const sDt = State.windowDates[start];
            const eDt = State.windowDates[end];
            return window.requiredOffFor28(r, sDt, eDt);
          })();

          if (off < needOff) {
            const name = State.employees[r] || `職員${String(r + 1).padStart(2, '0')}`;
            showToast(`${name} の4週間の休日が不足：${off}/${needOff}（希望休・未割当ベース。特別休暇は勤務扱い）`);
            return;
          }
        }
      }

      // 勤務形態ごとの夜勤数チェック
      {
        const start = State.range4wStart;
        const end = State.range4wStart + 27;
        for (let r = 0; r < State.employeeCount; r++) {
          const wt = (State.employeesAttr[r]?.workType) || 'three';
          let starCount = 0;
          let half = 0;
          for (let d = start; d <= end; d++) {
            const ds = dateStr(State.windowDates[d]);
            const mk = window.getAssign(r, ds);
            if (mk === '☆') starCount++;
            if (mk === '◆' || mk === '●') half++;
          }

          const name = State.employees[r] || `職員${String(r + 1).padStart(2, '0')}`;
          if (wt === 'night') {
            if (starCount < 8 || starCount > 10) {
              showToast(`${name}（夜勤専従）の「☆」が${starCount}件です（許容8〜10）。`);
              return;
            }
          } else if (wt === 'two') {
            if (starCount !== 4) {
              showToast(`${name}（二部制）の「☆」は4件必要：${starCount}/4`);
              return;
            }
          } else if (wt === 'three') {
            if (half < 8 || half > 10) {
              showToast(`${name}（三部制）の（◆＋●）は8〜10件を許容（原則10件を目指す）：${half}/8〜10`);
              return;
            }
          }
        }
      }

      // ローリング4週間検証
      {
        const start = State.range4wStart;
        const end = State.range4wStart + 27;
        const err = window.validateRollingFourWeeksWithHistory(start, end);
        if (err) {
          showToast(err);
          return;
        }
      }

      saveWindow();
      showToast('保存しました');
    });
  }

  // === アンドゥボタン ===
  function setupUndoButton() {
    if (!btnUndo) return;

    btnUndo.disabled = true; // 初期は無効化

    btnUndo.addEventListener('click', () => {
      const ok = undoCancelRange();
      if (ok) {
        showToast('元に戻しました（必要なら保存してください）');
      }
    });
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
        showToast(State.mode === 'off' ? '希望休モード' : '割当モード');
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

  // === セルクリアボタン ===
  function setupClearCellButtons() {
    // 希望休のセルクリア
    if (btnClearOffCell) {
      btnClearOffCell.addEventListener('click', () => {
        State.clearCellMode = 'off';
        showToast('希望休クリア：対象セルをクリック（Escで解除）');
      });
    }

    // 割り当てのセルクリア
    if (btnClearAssignCell) {
      btnClearAssignCell.addEventListener('click', () => {
        State.clearCellMode = 'assign';
        showToast('割り当てクリア：対象セルをクリック（Escで解除）');
      });
    }
  }
  // === 従業員編集ダイアログ ===
  function setupAttrDialog() {
    if (btnAttrOpen) {
      btnAttrOpen.addEventListener('click', openAttrDialog);
    }

    if (attrSave) {
      attrSave.addEventListener('click', () => {
        readAttrDialogToState();
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