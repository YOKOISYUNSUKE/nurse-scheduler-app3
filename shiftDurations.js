// Shift durations configuration (別ファイル)
// - 15分刻み（300分=5:00 〜 1200分=20:00）で選択肢を作成します。
// - マークごとのデフォルト値、選択肢取得、バリデーションを提供します.
//
// 使い方（例）
//   const opts = window.ShiftDurations.getOptionsForMark('〇');
//   // opts -> [{ value: 480, label: "8:00" }, ...]
//
//   const ok = window.ShiftDurations.isDurationAllowed('☆', 720); // true/false
//
(function(){
  'use strict';

  // marks の一覧（UIやロジック中で使われる文字）
  var MARKS = ['〇','☆','★','◆','●'];

  // 15分刻みの分数配列（300..1200）
  function buildMinutesOptions(){
    var res = [];
    for (var m = 300; m <= 1200; m += 15){
      res.push(m);
    }
    return res;
  }

  var minutesList = buildMinutesOptions();

  function minutesToLabel(m){
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + ':' + (mm < 10 ? '0' + mm : mm);
  }

  // デフォルト値（分単位）— 必要に応じてここを変更してください
  var DEFAULT_FOR_MARK = {
    '〇': 8 * 60,   // 8:00
    '☆': 12 * 60,  // 12:00 (夜勤想定)
    '★': 12 * 60,
    '◆': 8 * 60,
    '●': 8 * 60
  };

  // 内部で使う選択肢（label/value）
  var OPTIONS = minutesList.map(function(m){
    return { value: m, label: minutesToLabel(m) };
  });

  // mark に対する選択肢（現在は全て同じOPTIONSを返すが将来拡張可能）
  function getOptionsForMark(mark){
    // 将来的に mark ごとに範囲を変える場合はここで分岐する
    if (MARKS.indexOf(mark) === -1) return [];
    return OPTIONS.slice(); // copy
  }

  function getDefaultForMark(mark){
    return DEFAULT_FOR_MARK[mark] || DEFAULT_FOR_MARK['〇'];
  }

  function isDurationAllowed(mark, minutes){
    if (MARKS.indexOf(mark) === -1) return false;
    return minutesList.indexOf(minutes) !== -1;
  }

  // ユーティリティ: 分→HH:MM 表示
  function formatMinutes(minutes){
    return minutesToLabel(minutes);
  }

// --- 修正後（末尾部分に関数追加） ---
  // 従業員属性から勤務時間を取得（フォールバック付き）
  function getDurationForEmployee(empAttr, mark){
    if (!empAttr || !mark) return getDefaultForMark(mark);
    if (empAttr.shiftDurations && Number.isFinite(empAttr.shiftDurations[mark])){
      return empAttr.shiftDurations[mark];
    }
    return getDefaultForMark(mark);
  }

  // 勤務時間を時間:分の文字列に変換（表示用）
  function formatDurationLabel(minutes){
    if (!Number.isFinite(minutes)) return '---';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return h + '時間' + (m > 0 ? m + '分' : '');
  }

  // 公開（window）
  window.ShiftDurations = {
    MARKS: MARKS,
    minutesList: minutesList,
    getOptionsForMark: getOptionsForMark,
    getDefaultForMark: getDefaultForMark,
    isDurationAllowed: isDurationAllowed,
    formatMinutes: formatMinutes,
    getDurationForEmployee: getDurationForEmployee,
    formatDurationLabel: formatDurationLabel
  };
})();