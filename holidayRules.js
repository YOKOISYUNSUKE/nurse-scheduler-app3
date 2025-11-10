/* holidayRules.js */
;(function (global) {
  function pad2(n){ return String(n).padStart(2,'0'); }
  function dateStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function isWeekend(dt){ const w = (dt instanceof Date ? dt : new Date(dt)).getDay(); return w===0 || w===6; }
  function isHolidayDate(date, isHoliday){
    const ds = dateStr(date instanceof Date ? date : new Date(date));
    if (typeof isHoliday === 'function') return !!isHoliday(ds);
    if (isHoliday && typeof isHoliday.has === 'function') return !!isHoliday.has(ds);
    return false;
  }
   // 祝日/週末の下限人員計算（平日=10, 祝日/週末=5）
  function minDayFor(date, isHoliday){
    const dt = (date instanceof Date) ? date : new Date(date);
    return (isWeekend(dt) || isHolidayDate(dt, isHoliday)) ? 5 : 10;
  }

  // 追加：日本の祝日（holidays-jp.github.io）から該当年のJSONを取得
  // years: number | number[]   → 返り値 { has(ds), get(ds), object } をPromiseで返す
  async function fetchJapanHolidays(years){
    const ys = Array.isArray(years) ? [...new Set(years)] : [years];
    const out = {};
    for (const y of ys){
      const url = `https://holidays-jp.github.io/api/v1/${y}/date.json`;
      try{
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        Object.assign(out, data);
      }catch(_e){
        // フォールバック（全期間JSON→対象年だけ抽出）
        try{
          const res2 = await fetch(`https://holidays-jp.github.io/api/v1/date.json`, { cache: 'force-cache' });
          if (res2.ok){
            const data2 = await res2.json();
            for (const [ds,name] of Object.entries(data2)){
              if (String(ds).startsWith(String(y)+'-')) out[ds] = name;
            }
          }
        }catch(_e2){}
      }
    }
    return {
      has: (ds)=> !!out[ds],
      get: (ds)=> out[ds],
      object: out
    };
  }

  global.HolidayRules = { isWeekend, isHolidayDate, minDayFor, fetchJapanHolidays };
})(window);

