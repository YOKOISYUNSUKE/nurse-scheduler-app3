/* marks.js */
;(function (global) {
  // 画面上で扱う記号の正定義
  const MARKS = [
    { key: '〇', id: 'day',        className: 'mark-day',   label: '日勤',                 desc: '日勤' },
    { key: '☆', id: 'nightStart', className: 'mark-night', label: '通し夜勤 はじめ',     desc: '通し夜勤の勤務開始日' },
    { key: '★', id: 'nightEnd',   className: 'mark-night', label: '通し夜勤 おわり',     desc: '通し夜勤の終了日（☆の翌日）' },
    { key: '◆', id: 'nightFirst', className: 'mark-nf',    label: '夜勤 前半（夕〜24時）', desc: '例：11日の◆は11日夕〜24時' },
    { key: '●', id: 'nightSecond',className: 'mark-ns',    label: '夜勤 後半（0〜朝）',   desc: '例：11日の●は11日0時〜朝' },
  ];

  // 旧→新の移行（データ読み込み時に適用）
  const LEGACY = { '▲': '◆', '■': '●' };

  const MARK_MAP = Object.fromEntries(MARKS.map(m => [m.key, m]));

  function normalizeMark(mk) {
    if (mk == null) return mk;
    if (LEGACY[mk]) return LEGACY[mk];
    return mk;
  }

  // 公開
  global.MARKS = MARKS;
  global.MARK_MAP = MARK_MAP;
  global.normalizeMark = normalizeMark;
})(window);
