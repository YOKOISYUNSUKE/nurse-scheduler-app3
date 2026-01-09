/* app-export.js : グローバル公開インターフェース */
  const WorkMap = {
    two:   { symbol:'②', label:'二部制'                 },
    three: { symbol:'③', label:'三部制'                 },
    day:   { symbol:'日', label:'日勤のみ（平日・土日祝OK）' },
    night: { symbol:'夜', label:'夜勤のみ'               },
  };
  const WorkOrder = ['two','three','day','night'];

    // === グローバル公開（buttonHandlers.js / autoAssignLogic.js 用） ===
  window.switchAnchor = switchAnchor;
  window.shiftDays = shiftDays;
  window.paintRange4w = paintRange4w;
  window.cancelChanges = cancelChanges;
  window.makeCancelBackup = makeCancelBackup;
  
  // ★autoAssignLogic.js から参照される関数（委譲）
  window.autoAssignRange = function(s, e){ 
    if(window.AutoAssignLogic) return window.AutoAssignLogic.autoAssignRange(s, e); 
  };
  window.applyHolidayLeaveFlags = function(s, e){ 
    if(window.AutoAssignLogic) return window.AutoAssignLogic.applyHolidayLeaveFlags(s, e); 
  };
  
  // 祝日自動取得関数
  window.autoLoadJapanHolidays = async function(){
    try{
      if (!window.HolidayRules || typeof window.HolidayRules.fetchJapanHolidays !== 'function'){
        showToast('祝日API機能が読み込まれていません');
        return;
      }
      const years = [...new Set(State.windowDates.map(d => d.getFullYear()))];
      const hol = await window.HolidayRules.fetchJapanHolidays(years);
      let count = 0;
      for (const d of State.windowDates){
        const ds = dateStr(d);
        if (hol.has(ds)){
          if (!State.holidaySet.has(ds)) count++;
          State.holidaySet.add(ds);
        }
      }
      renderGrid();
      showToast(`祝日を反映しました：${count}日`);
    }catch(e){
      console.error(e);
      showToast('祝日の取得に失敗しました（ネットワークやCORSをご確認ください）');
    }
  };
  
  window.completeCancelAll = completeCancelAll;
  window.completeCancelOneCell = completeCancelOneCell;
  window.handleClearCell = handleClearCell; 
  window.saveWindow = saveWindow;
  window.pushToRemote = pushToRemote;
  window.openAttrDialog = openAttrDialog;
  window.readAttrDialogToState = readAttrDialogToState;
  window.requiredOffFor28 = requiredOffFor28;
  window.validateRollingFourWeeksWithHistory = validateRollingFourWeeksWithHistory;
  window.countLast28Days = countLast28Days; // 直近4週間集計（36協定チェック用）
  window.State = State;

  // === グローバル公開（cellOperations.js / autoAssignLogic.js 用） ===
  window.isRestByDate = isRestByDate;
  window.markToClass = markToClass;
  window.leaveClassOf = leaveClassOf;
  window.readDatesStore = readDatesStore;
  window.globalGetAssign = globalGetAssign;

