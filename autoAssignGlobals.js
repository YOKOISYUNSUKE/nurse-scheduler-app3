// autoAssignGlobals.js
// グローバル初期化を担当するモジュール
// 各モジュールで必要となる共通の状態や関数への参照をセットアップします。

(function(){
  'use strict';
  // AutoAssignLogic を初期化します。まだ存在しない場合は新規作成。
  const A = window.AutoAssignLogic || {};
  /**
   * 初期化関数（アプリケーションがロードされた際に呼び出す）
   * app.js などから参照される想定です。
   * グローバルに配置されている State などを AutoAssignLogic の内部に保持し、
   * 他モジュールが共通の参照を使用できるようにします。
   */
  A.init = function(){
    // 状態オブジェクトおよび共通ユーティリティへの参照を格納
    A.State = window.SchedulerState || window.State;
    A.grid = document.getElementById('grid');
    const dates = window.App?.Dates || {};
    A.dateStr = dates.dateStr;
    A.addDays = dates.addDays;
    A.getAssign = window.getAssign;
    A.setAssign = window.setAssign;
    A.clearAssign = window.clearAssign;
    A.hasOffByDate = window.hasOffByDate;
    A.getLeaveType = window.getLeaveType;
    A.setLeaveType = window.setLeaveType;
    A.clearLeaveType = window.clearLeaveType;
    A.isLocked = window.isLocked;
    A.setLocked = window.setLocked;
    A.showToast = window.showToast;
    A.updateFooterCounts = window.updateFooterCounts;
    A.isRestByDate = window.isRestByDate;
    // 従業員ごとの休暇ノルマ計算に用いる関数
    if (typeof window.requiredOffFor28 === 'function'){
      A.requiredOffFor28 = window.requiredOffFor28;
    }
    // forbiddenPairs は State に含まれていることを想定
    if (A.State && A.State.forbiddenPairs){
      A.forbiddenPairs = A.State.forbiddenPairs;
    }
  };
  // AutoAssignLogic をグローバルへ書き戻し
  window.AutoAssignLogic = A;
})();
