/* app-core.js : グローバルAPI、DOM要素、State定義 */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ---- 要素 ----
  const loginView = $('#loginView');
  const appView   = $('#appView');
  const loginForm = $('#loginForm');
  const loginId   = $('#loginId');
  const loginPw   = $('#loginPw');
  const loginError= $('#loginError');
  const btnJumpMonth = $('#btnJumpMonth');
  const monthPicker  = $('#monthPicker');
  const periodText   = $('#periodText');
  const btnAutoAssign= $('#btnAutoAssign');
  const btnCancel    = $('#btnCancel');
  const btnFullCancel= $('#btnFullCancel'); // ★追加：完全キャンセル
  const btnUndo      = $('#btnUndo');       // ★追加：アンドゥ
  const btnSave      = $('#btnSave');
  const btnExportExcel = $('#btnExportExcel');
  const btnLogout    = $('#btnLogout');
  const btnPrevDay  = $('#btnPrevDay');
  const btnNextDay  = $('#btnNextDay');
  const btnAttrOpen = $('#btnAttrOpen');
  const btnHolidayAuto = $('#btnHolidayAuto'); 
  const btnLockRange   = $('#btnLockRange');
  const btnUnlockRange = $('#btnUnlockRange');

  // 完全キャンセル用ダイアログ要素
  const fullCancelDlg      = $('#fullCancelDlg');
  const fullCancelAllBtn   = $('#fullCancelAll');
  const fullCancelCellBtn  = $('#fullCancelCell');
  const fullCancelCloseBtn = $('#fullCancelClose');

  // 特別休暇ボタン
  const btnLeaveHoliday = $('#btnLeaveHoliday');
  const btnLeaveSub     = $('#btnLeaveSub');
  const btnLeavePaid    = $('#btnLeavePaid');
  const btnLeaveRefresh = $('#btnLeaveRefresh');
  const attrDlg = $('#attrDlg');
  const attrContent = $('#attrContent');
  const attrSave = $('#attrSave');
  const attrClose = $('#attrClose');
  const employeeCountSel = $('#employeeCount');
  const range4w = $('#range4w');
  const range4wLabel = $('#range4wLabel');
  const gridWrap = $('#gridWrap');
  const grid     = $('#grid');
  const toast    = $('#toast');
  const modeRadios = $$('input[name="mode"]');

  // sessionStorage ヘルパー関数の定義
  function ssGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function ssSet(key, val) {
    try { sessionStorage.setItem(key, val); } catch (_) {}
  }

  // currentUser 変数の宣言
  let currentUser = null;

// ログイン完了時の処理
  document.addEventListener('auth:logged-in', async (ev) => {
    const uid = ev.detail?.userId || 'user';
    currentUser = uid;

    // ★変更点1: まずローカルデータのみ復元
    console.log('[App] Step 1: Loading local data...');
    loadWindow(State.anchor);
    
    // ★変更点2: 画面遷移
    console.log('[App] Step 2: Switching to calendar view...');
    await enterApp();
    
    // ★変更点3: 画面遷移後に同期を実行（視覚的フィードバック付き）
    console.log('[App] Step 3: Starting cloud sync...');
    await performCloudSync(uid);
  });

  // ★新規追加: 同期処理を独立した関数として定義
  async function performCloudSync(userId) {
    const syncIndicator = document.getElementById('cloudIndicator');
    
    try {
      // 同期中の表示
      if (syncIndicator) {
        syncIndicator.classList.remove('online', 'offline');
        syncIndicator.classList.add('syncing');
        syncIndicator.textContent = '同期中...';
        syncIndicator.title = 'クラウドと同期しています';
      }

      // クラウドキーの取得
      const ck = ssGet('sched:cloudKey');
      if (!ck) {
        console.warn('[App] No cloud key found, skipping sync');
        if (syncIndicator) {
          syncIndicator.classList.remove('syncing');
          syncIndicator.classList.add('offline');
          syncIndicator.textContent = '未接続';
        }
        return;
      }

      console.log('[App] Fetching cloud data...');
      
      // ★変更点4: クラウドデータ取得（GAS.getAll使用）
      if (!window.GAS || typeof window.GAS.getAll !== 'function') {
        console.warn('[App] GAS.getAll is not available');
        if (syncIndicator) {
          syncIndicator.classList.remove('syncing');
          syncIndicator.classList.add('offline');
          syncIndicator.textContent = 'GAS未接続';
        }
        return;
      }

      const bundle = await GAS.getAll(ck);
      const cloudMeta = bundle?.meta || null;
      const cloudCounts = bundle?.counts || null;

      // ★変更点5: クラウドデータで上書き（meta/countsのみ）
      if (cloudMeta || cloudCounts) {
        console.log('[App] Applying cloud data...');
        
        // meta の反映
        if (cloudMeta && typeof cloudMeta === 'object') {
          if (typeof cloudMeta.employeeCount === 'number' && cloudMeta.employeeCount > 0) {
            State.employeeCount = cloudMeta.employeeCount;
          }
          if (Array.isArray(cloudMeta.employees) && cloudMeta.employees.length > 0) {
            State.employees = cloudMeta.employees.slice();
          }
          if (Array.isArray(cloudMeta.employeesAttr) && cloudMeta.employeesAttr.length > 0) {
            State.employeesAttr = cloudMeta.employeesAttr.map(attr => normalizeEmployeeAttrByWorkType({
              level: attr.level || 'B',
              workType: attr.workType || 'three',
              nightQuota: attr.nightQuota,
              twoShiftQuota: attr.twoShiftQuota,
              threeShiftNfQuota: attr.threeShiftNfQuota,
              threeShiftNsQuota: attr.threeShiftNsQuota,
              shiftDurations: attr.shiftDurations ? {...attr.shiftDurations} : {},
              hasEarlyShift: attr.hasEarlyShift || false,
              earlyShiftType: attr.earlyShiftType || 'all',
              hasLateShift: attr.hasLateShift || false,
              lateShiftType: attr.lateShiftType || 'all'
            }));
          }
          if (Array.isArray(cloudMeta.forbiddenPairs)) {
            State.forbiddenPairs = new Map(
              cloudMeta.forbiddenPairs.map(([k, arr]) => [k, new Set(arr)])
            );
          }
          if (typeof cloudMeta.range4wStart === 'number') {
            State.range4wStart = cloudMeta.range4wStart;
          }
        }

        // counts の反映
        if (cloudCounts && typeof cloudCounts === 'object' && window.Counts) {
          const keys = [
            'DAY_TARGET_WEEKDAY','DAY_TARGET_WEEKEND_HOLIDAY',
            'EARLY_TARGET_WEEKDAY','EARLY_TARGET_WEEKEND_HOLIDAY',
            'LATE_TARGET_WEEKDAY','LATE_TARGET_WEEKEND_HOLIDAY',
            'FIXED_NF','FIXED_NS',
            'FIXED_NF_WEEKEND_HOLIDAY','FIXED_NS_WEEKEND_HOLIDAY',
            'FIXED_BY_DATE'
          ];
          for (const k of keys) {
            if (k in cloudCounts) {
              window.Counts[k] = cloudCounts[k];
            }
          }
        }
        
        // ローカルストレージにも保存
        saveMetaOnly();
        
        // カレンダー再描画
        renderGrid();
        
        console.log('[App] Cloud sync completed successfully');
        
        if (syncIndicator) {
          syncIndicator.classList.remove('syncing');
          GAS.setCloudStatus('ok', '同期完了');
        }
      } else {
        console.log('[App] No cloud data found, keeping local data');
        if (syncIndicator) {
          syncIndicator.classList.remove('syncing');
          GAS.setCloudStatus('ok', 'ローカル優先');
        }
      }
      
    } catch (error) {
      console.error('[App] Cloud sync failed:', error);
      if (syncIndicator) {
        syncIndicator.classList.remove('syncing');
        GAS.setCloudStatus('offline', '同期失敗');
      }
      // エラーが発生してもローカルデータは保持される
    }
  }

  // ---- 状態 ----
  const today = new Date();
  const State = {
    userId: null,
    // 連続28日ウィンドウの開始日（任意の日付）
    anchor: new Date(today.getFullYear(), today.getMonth(), 1),
    windowDates: [],            // [Date x28]
    employees: [],
    employeeCount: 20,
    employeesAttr: [],          // [{level:'A'|'B'|'C', workType:'two'|'three'|'day'|'night'}]
    // 永続化は日付キー（YYYY-MM-DD）で行う
    forbiddenPairs: new Map(), // Map<empIndex, Set<empIndex>>：禁忌ペア
  // 例：0番目の職員が2番・5番と禁忌 → forbiddenPairs.get(0) = Set([2, 5])

    holidaySet: new Set(),      // Set<dateStr>
    offRequests: new Map(),     // Map<empIndex, Set<dateStr>>
    leaveRequests: new Map(),   // Map<empIndex, Map<dateStr, '祝'|'代'|'年'|'リ'>>
    assignments: new Map(),     // Map<empIndex, Map<dateStr, mark>>
    range4wStart: 0,            // 0..3（31-28=3）
    lastSaved: null,            // スナップショット
    mode: null,                 // null | 'off' | 'assign'
    leaveMode: null,            // null | '祝'|'代'|'年'|'リ'
    manualOverride: false,      // 手動割当（上書き）トグル
    lockedCells: new Set(),     // Set<"row|YYYY-MM-DD">：自動割当の上書き対象外
    lockMode: null,             // 'lock' | 'unlock' | null（範囲選択モード）
    lockStart: null,            // { r, d }（開始セル）
    fullCancelCellMode: false,  // ★追加：完全キャンセル（1セル）モード
    isGlobalLocked: false,      // ★追加：全体ロック状態

  };
