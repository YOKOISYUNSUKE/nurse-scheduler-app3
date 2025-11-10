/* core.dates.js : 日付系の純粋関数を IIFE で App.Dates 名前空間に公開 */
;(function (global) {
  const App = global.App || (global.App = {});

  (function () {
    const pad2 = n => String(n).padStart(2, '0');

    const dateStr = (d) => {
      // YYYY-MM-DD（ローカル時刻）
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    };

    const addDays = (d, n) => {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    };

    function isToday(dt) {
      const n = new Date();
      return dt.getFullYear() === n.getFullYear()
          && dt.getMonth() === n.getMonth()
          && dt.getDate() === n.getDate();
    }

    // 公開
    App.Dates = Object.freeze({ pad2, dateStr, addDays, isToday });
  })();
})(window);
