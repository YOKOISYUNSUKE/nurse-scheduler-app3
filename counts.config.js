/* counts.config.js */
(function(global){
  const Counts = {
    DAY_TARGET_WEEKDAY: 16,
    DAY_TARGET_WEEKEND_HOLIDAY: 6,
    FIXED_NF: 3,
    FIXED_NS: 3,
    // 特定日ごとの固定条件 { 'YYYY-MM-DD': { day, nf, ns } }
    FIXED_BY_DATE: {},
    EARLY_TARGET_WEEKDAY: 1,
    EARLY_TARGET_WEEKEND_HOLIDAY: 1,
    LATE_TARGET_WEEKDAY: 1,
    LATE_TARGET_WEEKEND_HOLIDAY: 1
  };

  function pad2(n){ return String(n).padStart(2,'0'); }
  function toDs(dtOrString){
    if (!dtOrString) return null;
    if (typeof dtOrString === 'string') return dtOrString;
    if (dtOrString instanceof Date){
      return `${dtOrString.getFullYear()}-${pad2(dtOrString.getMonth()+1)}-${pad2(dtOrString.getDate())}`;
    }
    return null;
  }

  function normalizeFixedMap(src){
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const [ds, v] of Object.entries(src)){
      if (!ds || typeof ds !== 'string') continue;
      if (!v || typeof v !== 'object') continue;
      const day   = Number.isFinite(v.day)   ? Number(v.day)   : null;
      const early = Number.isFinite(v.early) ? Number(v.early) : null;
      const late  = Number.isFinite(v.late)  ? Number(v.late)  : null;
      const nf    = Number.isFinite(v.nf)    ? Number(v.nf)    : null;
      const ns    = Number.isFinite(v.ns)    ? Number(v.ns)    : null;
      if (day==null && early==null && late==null && nf==null && ns==null) continue;
      out[ds] = {};
      if (day!=null)   out[ds].day   = day;
      if (early!=null) out[ds].early = early;
      if (late!=null)  out[ds].late  = late;
      if (nf!=null)    out[ds].nf    = nf;
      if (ns!=null)    out[ds].ns    = ns;
    }
    return out;
  }


  Counts.getFixedConfigFor = function(ds){
    const key = toDs(ds);
    if (!key) return null;
    return (Counts.FIXED_BY_DATE && Counts.FIXED_BY_DATE[key]) || null;
  };

  // 『〇』人数の固定値（あれば数値、なければ null）
  Counts.getFixedDayCount = function(ds){
    const cfg = Counts.getFixedConfigFor(ds);
    return (cfg && Number.isFinite(cfg.day)) ? cfg.day : null;
  };
  // 早出目標人数取得関数
  Counts.getEarlyShiftTarget = function(dt, isHolidayFn){
    const ds = toDs(dt);
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.early)) return cfg.early;

    const isHol = isHolidayFn ? !!isHolidayFn(ds) : false;
    const w = (dt instanceof Date) ? dt.getDay() : NaN;
    const isWkEndOrHol = isHol || w === 0 || w === 6;
    return isWkEndOrHol ? Counts.EARLY_TARGET_WEEKEND_HOLIDAY : Counts.EARLY_TARGET_WEEKDAY;
  };

  // 遅出目標人数取得関数
  Counts.getLateShiftTarget = function(dt, isHolidayFn){
    const ds = toDs(dt);
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.late)) return cfg.late;

    const isHol = isHolidayFn ? !!isHolidayFn(ds) : false;
    const w = (dt instanceof Date) ? dt.getDay() : NaN;
    const isWkEndOrHol = isHol || w === 0 || w === 6;
    return isWkEndOrHol ? Counts.LATE_TARGET_WEEKEND_HOLIDAY : Counts.LATE_TARGET_WEEKDAY;
  };


  // 「☆＋◆」固定人数（特定日設定 ＞ グローバル設定）
  Counts.getFixedNF = function(ds){
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.nf)) return cfg.nf;
    return Counts.FIXED_NF;
  };

  // 「★＋●」固定人数（特定日設定 ＞ グローバル設定）
  Counts.getFixedNS = function(ds){
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.ns)) return cfg.ns;
    return Counts.FIXED_NS;
  };



  // 自動割当用：その日の『〇』目標人数
  Counts.getDayTarget = function(dt, isHolidayFn){
    const ds = toDs(dt);
    const fixed = Counts.getFixedDayCount(ds);
    if (Number.isInteger(fixed)) return fixed;

    const isHol = isHolidayFn ? !!isHolidayFn(ds) : false;
    const w = (dt instanceof Date) ? dt.getDay() : NaN;
    const isWkEndOrHol = isHol || w === 0 || w === 6;
    return isWkEndOrHol ? Counts.DAY_TARGET_WEEKEND_HOLIDAY : Counts.DAY_TARGET_WEEKDAY;
  };

  global.Counts = Counts;


  // === 追加：永続化＆イベント＆UI接続 ===
  const STORAGE_KEY = 'sched:counts';

  function read(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function apply(cfg){
    if (!cfg) return;
    const keys = [
      'DAY_TARGET_WEEKDAY','DAY_TARGET_WEEKEND_HOLIDAY',
      'EARLY_TARGET_WEEKDAY','EARLY_TARGET_WEEKEND_HOLIDAY',  
      'LATE_TARGET_WEEKDAY','LATE_TARGET_WEEKEND_HOLIDAY',     
      'FIXED_NF','FIXED_NS'
    ];
    for (const k of keys){
      if (!(k in cfg)) continue;
      Counts[k] = parseInt(cfg[k],10);
    }
    // 特定日固定条件

    if ('FIXED_BY_DATE' in cfg){
      Counts.FIXED_BY_DATE = normalizeFixedMap(cfg.FIXED_BY_DATE);
    }
  }
  function load(){ apply(read()); return {...Counts}; }
  function save(partial){
    const next = { ...read(), ...(partial||{}) };
    apply(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      DAY_TARGET_WEEKDAY: Counts.DAY_TARGET_WEEKDAY,
      DAY_TARGET_WEEKEND_HOLIDAY: Counts.DAY_TARGET_WEEKEND_HOLIDAY,
      EARLY_TARGET_WEEKDAY: Counts.EARLY_TARGET_WEEKDAY,            
      EARLY_TARGET_WEEKEND_HOLIDAY: Counts.EARLY_TARGET_WEEKEND_HOLIDAY,  
      LATE_TARGET_WEEKDAY: Counts.LATE_TARGET_WEEKDAY,               
      LATE_TARGET_WEEKEND_HOLIDAY: Counts.LATE_TARGET_WEEKEND_HOLIDAY,   
      FIXED_NF: Counts.FIXED_NF,
      FIXED_NS: Counts.FIXED_NS,
      FIXED_BY_DATE: Counts.FIXED_BY_DATE
    }));


    // 人数設定もクラウドへ同期（ログイン済みかつpushToRemoteがあれば）
    try{
      if (global.pushToRemote && typeof global.pushToRemote === 'function'){
        global.pushToRemote();
      }
    }catch(_){}

    window.dispatchEvent(new CustomEvent('counts:changed', { detail: { ...Counts } }));
    if (typeof window.renderGrid === 'function') window.renderGrid(); // 即反映
  }
  Counts.load = load;
  Counts.save = save;


  // "YYYY-MM-DD 〇 早 遅 ☆＋◆ ★＋●" 形式テキスト ⇔ FIXED_BY_DATE マップ
  function parseFixedByDateText(text){
    const map = {};
    if (!text) return map;
    const lines = text.split(/\r?\n/);
    for (const line of lines){
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const ds = parts[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;

      const nums = parts.slice(1)
        .map(v => parseInt(v,10))
        .filter(v => !Number.isNaN(v));

      const entry = {};

      if (nums.length === 0){
        // 日付のみの行：固定解除（＝何も記録しない／既定値を使用）
        map[ds] = entry;
        continue;
      }

      // 先頭は常に『〇』
      if (Number.isFinite(nums[0])) entry.day = nums[0];

      if (nums.length === 2){
        // 旧形式（YYYY-MM-DD 〇 NF）
        if (Number.isFinite(nums[1])) entry.nf = nums[1];
      } else if (nums.length === 3){
        // 旧形式（YYYY-MM-DD 〇 NF NS）
        if (Number.isFinite(nums[1])) entry.nf = nums[1];
        if (Number.isFinite(nums[2])) entry.ns = nums[2];
      } else if (nums.length >= 4){
        // 新形式（YYYY-MM-DD 〇 早 遅 ☆＋◆ [★＋●]）
        if (Number.isFinite(nums[1])) entry.early = nums[1];
        if (Number.isFinite(nums[2])) entry.late  = nums[2];
        if (Number.isFinite(nums[3])) entry.nf    = nums[3];
        if (nums.length >= 5 && Number.isFinite(nums[4])) entry.ns = nums[4];
      }

      map[ds] = entry;
    }
    return map;
  }

  function exportFixedByDateText(map){
    const src = map || Counts.FIXED_BY_DATE || {};
    const dates = Object.keys(src).sort();
    const lines = [];
    for (const ds of dates){
      const v = src[ds] || {};
      const parts = [ds];
      if (Number.isFinite(v.day)) parts.push(String(v.day));
      if (Number.isFinite(v.nf))  parts.push(String(v.nf));
      if (Number.isFinite(v.ns))  parts.push(String(v.ns));
      lines.push(parts.join(' '));
    }
    return lines.join('\n');
  }

  Counts.exportFixedByDateText = function(map){
    return exportFixedByDateText(map || Counts.FIXED_BY_DATE);
  };

  function init(){
    load();
    window.dispatchEvent(new CustomEvent('counts:init', { detail: { ...Counts } }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // UI配線（存在する場合のみ）
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('btnCountsOpen');
    const dlg = document.getElementById('countsDlg');
    if (!btn || !dlg) return;
    const $ = id => dlg.querySelector(`#${id}`);
    const inpTWeek       = $('cfgDayTarget');
    const inpTWH         = $('cfgDayTargetWkHol');
    const inpEarlyWeekday = $('cfgEarlyTargetWeekday');
    const inpEarlyWkHol   = $('cfgEarlyTargetWkHol');
    const inpLateWeekday  = $('cfgLateTargetWeekday');
    const inpLateWkHol    = $('cfgLateTargetWkHol');
    const inpNF          = $('cfgFixedNF');
    const inpNS          = $('cfgFixedNS');
    const inpFixedByDate = $('cfgFixedByDate');
    const inpFixedDate   = $('cfgFixedDate');
    const inpFixedDay    = $('cfgFixedDay');
    const inpFixedEarlyDate = $('cfgFixedEarlyDate');
    const inpFixedLateDate  = $('cfgFixedLateDate');
    const inpFixedNFDate = $('cfgFixedNFDate');
    const inpFixedNSDate = $('cfgFixedNSDate');
    const btnFixedAdd    = $('btnFixedByDateAdd');



    function populate(){
      inpTWeek.value   = String(Counts.DAY_TARGET_WEEKDAY);
      inpTWH.value     = String(Counts.DAY_TARGET_WEEKEND_HOLIDAY);
      inpNF.value      = String(Counts.FIXED_NF);
      inpNS.value      = String(Counts.FIXED_NS);
      if (inpEarlyWeekday) inpEarlyWeekday.value = String(Counts.EARLY_TARGET_WEEKDAY);
      if (inpEarlyWkHol)   inpEarlyWkHol.value   = String(Counts.EARLY_TARGET_WEEKEND_HOLIDAY);
      if (inpLateWeekday)  inpLateWeekday.value  = String(Counts.LATE_TARGET_WEEKDAY);
      if (inpLateWkHol)    inpLateWkHol.value    = String(Counts.LATE_TARGET_WEEKEND_HOLIDAY);
      if (inpFixedByDate){

        inpFixedByDate.value = Counts.exportFixedByDateText
          ? Counts.exportFixedByDateText()
          : '';
      }
      if (inpFixedDate){
        inpFixedDate.value = '';
        if (inpFixedDay)        inpFixedDay.value        = '';
        if (inpFixedEarlyDate)  inpFixedEarlyDate.value  = '';
        if (inpFixedLateDate)   inpFixedLateDate.value   = '';
        if (inpFixedNFDate)     inpFixedNFDate.value     = '';
        if (inpFixedNSDate)     inpFixedNSDate.value     = '';
      }
    }

    // 日付変更時：テキストエリアから該当日の設定を読み込んで反映
    if (inpFixedDate && inpFixedByDate){
      inpFixedDate.addEventListener('change', ()=>{
        const ds = inpFixedDate.value;
        if (!ds){
          if (inpFixedDay)        inpFixedDay.value        = '';
          if (inpFixedEarlyDate)  inpFixedEarlyDate.value  = '';
          if (inpFixedLateDate)   inpFixedLateDate.value   = '';
          if (inpFixedNFDate)     inpFixedNFDate.value     = '';
          if (inpFixedNSDate)     inpFixedNSDate.value     = '';
          return;
        }
        const map = parseFixedByDateText(inpFixedByDate.value || '');
        const v = map[ds] || {};
        if (inpFixedDay)        inpFixedDay.value        = Number.isFinite(v.day)   ? String(v.day)   : '';
        if (inpFixedEarlyDate)  inpFixedEarlyDate.value  = Number.isFinite(v.early) ? String(v.early) : '';
        if (inpFixedLateDate)   inpFixedLateDate.value   = Number.isFinite(v.late)  ? String(v.late)  : '';
        if (inpFixedNFDate)     inpFixedNFDate.value     = Number.isFinite(v.nf)    ? String(v.nf)    : '';
        if (inpFixedNSDate)     inpFixedNSDate.value     = Number.isFinite(v.ns)    ? String(v.ns)    : '';
      });
    }


    // 「追加」ボタン：テキストエリアの内容を（該当日行を）更新 or 追加
    if (btnFixedAdd && inpFixedByDate && inpFixedDate){
      btnFixedAdd.addEventListener('click', ()=>{
        const ds = inpFixedDate.value;
        if (!ds) return;

        const parts = [ds];
        const dayStr   = inpFixedDay        ? inpFixedDay.value.trim()        : '';
        const earlyStr = inpFixedEarlyDate  ? inpFixedEarlyDate.value.trim()  : '';
        const lateStr  = inpFixedLateDate   ? inpFixedLateDate.value.trim()   : '';
        const nfStr    = inpFixedNFDate     ? inpFixedNFDate.value.trim()     : '';
        const nsStr    = inpFixedNSDate     ? inpFixedNSDate.value.trim()     : '';

        if (dayStr)   parts.push(dayStr);
        if (earlyStr) parts.push(earlyStr);
        if (lateStr)  parts.push(lateStr);
        if (nfStr)    parts.push(nfStr);
        if (nsStr)    parts.push(nsStr);

        const line = parts.join(' ');


        const raw = inpFixedByDate.value || '';
        const lines = raw.split(/\r?\n/);
        const map = new Map();

        // 既存行をマップ化（先頭のYYYY-MM-DDをキーにする）
        for (const rawLine of lines){
          const t = rawLine.trim();
          if (!t) continue;
          const first = t.split(/\s+/)[0];
          if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) continue;
          map.set(first, t);
        }

        // 今回の入力で上書き（同じ日付があれば置き換え）
        map.set(ds, line);

        const sortedDates = Array.from(map.keys()).sort();
        inpFixedByDate.value = sortedDates
          .map(key => map.get(key))
          .join('\n');
      });
    }

    btn.addEventListener('click', ()=>{

      populate();
      dlg.showModal ? dlg.showModal() : (dlg.open = true);
    });

    dlg.querySelector('#countsSave')?.addEventListener('click', ()=>{
      const fixedMap = inpFixedByDate
        ? parseFixedByDateText(inpFixedByDate.value || '')
        : {};

const cfg = {
  DAY_TARGET_WEEKDAY: parseInt(inpTWeek.value,10),
  DAY_TARGET_WEEKEND_HOLIDAY: parseInt(inpTWH.value,10),
  FIXED_NF: parseInt(inpNF.value,10),
  FIXED_NS: parseInt(inpNS.value,10),
  FIXED_BY_DATE: fixedMap,
        EARLY_TARGET_WEEKDAY: inpEarlyWeekday ? parseInt(inpEarlyWeekday.value,10) : 1,
        EARLY_TARGET_WEEKEND_HOLIDAY: inpEarlyWkHol ? parseInt(inpEarlyWkHol.value,10) : 1,
        LATE_TARGET_WEEKDAY: inpLateWeekday ? parseInt(inpLateWeekday.value,10) : 1,
        LATE_TARGET_WEEKEND_HOLIDAY: inpLateWkHol ? parseInt(inpLateWkHol.value,10) : 1
};

      save(cfg);

      dlg.close ?  dlg.close() : (dlg.open = false);
      if (typeof window.showToast === 'function') window.showToast('人数設定を保存しました');
    });

    dlg.querySelector('#countsClose')?.addEventListener('click', ()=> dlg.close ? dlg.close() : (dlg.open=false));
  });

})(window);
