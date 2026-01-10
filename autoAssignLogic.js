// autoAssignLogic.js
// アグリゲータモジュール。
// 個別のファイルに分割された自動割り当てロジックを読み込み、
// AutoAssignLogic オブジェクトに公開関数を紐付けます。

/*
  このファイルは他のモジュールより後に読み込まれることを前提としています。
  index.html では autoAssignGlobals.js, autoAssignHelpers.js, autoAssignFill.js,
  autoAssignEnforce.js, autoAssignNormalize.js, autoAssignMain.js, autoAssignLeave.js
  の順に読み込み、その最後に本ファイルを読み込んでください。
*/

(function(){
  'use strict';
  // 既に各モジュールでプロパティが設定されていることを期待。
  const A = window.AutoAssignLogic = window.AutoAssignLogic || {};
  // このファイルでは公開APIを再掲するのみ。
  window.AutoAssignLogic = {
    init: A.init,
    autoAssignRange: A.autoAssignRange,
    applyHolidayLeaveFlags: A.applyHolidayLeaveFlags,
    isWeekendOrHoliday: A.isWeekendOrHoliday,
    targetDayForIndex: A.targetDayForIndex
  };
})();