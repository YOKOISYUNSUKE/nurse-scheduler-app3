/* counts.config.js */
(function(global){
  const Counts = {
    DAY_TARGET_WEEKDAY: 16,
    DAY_TARGET_WEEKEND_HOLIDAY: 6,
    FIXED_NF: 3,
    FIXED_NS: 3,
    // 土日祝の☆＋◆／★＋● 固定人数（未設定なら平日と同じ値）
    FIXED_NF_WEEKEND_HOLIDAY: 3,
    FIXED_NS_WEEKEND_HOLIDAY: 3,
    // 特定日ごとの固定条件 { 'YYYY-MM-DD': { day, early, late, nf, ns } }
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


  // 「☆＋◆」固定人数（特定日設定 ＞ 平日／土日祝のグローバル設定）
  Counts.getFixedNF = function(dsOrDt){
    const ds = toDs(dsOrDt);
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.nf)) return cfg.nf;

    const isHol = (typeof global.isHoliday === 'function') ? !!global.isHoliday(ds) : false;

    let dt = null;
    if (dsOrDt instanceof Date){
      dt = dsOrDt;
    } else if (typeof ds === 'string'){
      const parts = ds.split('-');
      if (parts.length === 3){
        const y = parseInt(parts[0],10);
        const m = parseInt(parts[1],10) - 1;
        const d = parseInt(parts[2],10);
        const tmp = new Date(y, m, d);
        if (Number.isFinite(tmp.getTime())) dt = tmp;
      }
    }

    const w = dt ? dt.getDay() : NaN;
    const isWeekend = (w === 0 || w === 6);
    const isWkEndOrHol = isWeekend || isHol;

    if (isWkEndOrHol && Number.isFinite(Counts.FIXED_NF_WEEKEND_HOLIDAY)){
      return Counts.FIXED_NF_WEEKEND_HOLIDAY;
    }
    return Counts.FIXED_NF;
  };

  // 「★＋●」固定人数（特定日設定 ＞ 平日／土日祝のグローバル設定）
  Counts.getFixedNS = function(dsOrDt){
    const ds = toDs(dsOrDt);
    const cfg = Counts.getFixedConfigFor(ds);
    if (cfg && Number.isFinite(cfg.ns)) return cfg.ns;

    const isHol = (typeof global.isHoliday === 'function') ? !!global.isHoliday(ds) : false;

    let dt = null;
    if (dsOrDt instanceof Date){
      dt = dsOrDt;
    } else if (typeof ds === 'string'){
      const parts = ds.split('-');
      if (parts.length === 3){
        const y = parseInt(parts[0],10);
        const m = parseInt(parts[1],10) - 1;
        const d = parseInt(parts[2],10);
        const tmp = new Date(y, m, d);
        if (Number.isFinite(tmp.getTime())) dt = tmp;
      }
    }

    const w = dt ? dt.getDay() : NaN;
    const isWeekend = (w === 0 || w === 6);
    const isWkEndOrHol = isWeekend || isHol;

    if (isWkEndOrHol && Number.isFinite(Counts.FIXED_NS_WEEKEND_HOLIDAY)){
      return Counts.FIXED_NS_WEEKEND_HOLIDAY;
    }
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
      'FIXED_NF','FIXED_NS',
      'FIXED_NF_WEEKEND_HOLIDAY','FIXED_NS_WEEKEND_HOLIDAY'
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
      FIXED_NF_WEEKEND_HOLIDAY: Counts.FIXED_NF_WEEKEND_HOLIDAY,
      FIXED_NS_WEEKEND_HOLIDAY: Counts.FIXED_NS_WEEKEND_HOLIDAY,
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

const clamp0to30 = (v) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(30, Math.max(0, n));
};

// 数値は 0〜30 に丸める（UI側のmin/maxだけだと手入力で負数が残るため）
const nums = parts.slice(1)
  .map(v => clamp0to30(v))
  .filter(v => v !== null);


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
      if (Number.isFinite(v.day))   parts.push(String(v.day));
      if (Number.isFinite(v.early)) parts.push(String(v.early));
      if (Number.isFinite(v.late))  parts.push(String(v.late));
      if (Number.isFinite(v.nf))    parts.push(String(v.nf));
      if (Number.isFinite(v.ns))    parts.push(String(v.ns));

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
    const inpTWeek        = $('cfgDayTarget');
    const inpTWH          = $('cfgDayTargetWkHol');
    const inpEarlyWeekday = $('cfgEarlyTargetWeekday');
    const inpEarlyWkHol   = $('cfgEarlyTargetWkHol');
    const inpLateWeekday  = $('cfgLateTargetWeekday');
    const inpLateWkHol    = $('cfgLateTargetWkHol');
    const inpNF           = $('cfgFixedNF');
    const inpNS           = $('cfgFixedNS');
    const inpNFHoliday    = $('cfgFixedNFHoliday');
    const inpNSHoliday    = $('cfgFixedNSHoliday');
    const inpFixedByDate  = $('cfgFixedByDate');
    const inpFixedDate   = $('cfgFixedDate');
    const inpFixedDay    = $('cfgFixedDay');
    const inpFixedEarlyDate = $('cfgFixedEarlyDate');
    const inpFixedLateDate  = $('cfgFixedLateDate');
    const inpFixedNFDate = $('cfgFixedNFDate');
    const inpFixedNSDate = $('cfgFixedNSDate');
    const btnFixedAdd    = $('btnFixedByDateAdd');

    // 登録済み一覧（表）
    const fixedListBody = dlg.querySelector('#fixedByDateListBody');

    // 0〜30に丸め（手入力やプログラム更新でも負数を残さない）
    const clamp0to30 = (v) => {
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) return null;
      return Math.min(30, Math.max(0, n));
    };

    function getMapFromTextarea(){
      return parseFixedByDateText(inpFixedByDate ? (inpFixedByDate.value || '') : '');
    }

    function setTextareaFromMap(map){
      if (!inpFixedByDate) return;
      inpFixedByDate.value = exportFixedByDateText(map || {});
    }

    function renderFixedByDateList(){
      if (!fixedListBody || !inpFixedByDate) return;

      const map = getMapFromTextarea();
      const dates = Object.keys(map).sort();
      fixedListBody.innerHTML = '';

      if (dates.length === 0){
        const tr = document.createElement('tr');
        tr.className = 'empty-row';
        tr.innerHTML = '<td colspan="7">登録データがありません</td>';
        fixedListBody.appendChild(tr);
        return;
      }

      for (const ds of dates){
        const v = map[ds] || {};
        const tr = document.createElement('tr');
        tr.dataset.ds = ds;
        tr.innerHTML = `
          <td>${ds}</td>
          <td><input type="number" min="0" max="30" step="1" data-field="day" value="${Number.isFinite(v.day) ? v.day : ''}"></td>
          <td><input type="number" min="0" max="30" step="1" data-field="early" value="${Number.isFinite(v.early) ? v.early : ''}"></td>
          <td><input type="number" min="0" max="30" step="1" data-field="late" value="${Number.isFinite(v.late) ? v.late : ''}"></td>
          <td><input type="number" min="0" max="30" step="1" data-field="nf" value="${Number.isFinite(v.nf) ? v.nf : ''}"></td>
          <td><input type="number" min="0" max="30" step="1" data-field="ns" value="${Number.isFinite(v.ns) ? v.ns : ''}"></td>
          <td><button type="button" class="btn btn-outline btn-sm" data-action="del">削除</button></td>
        `;
        fixedListBody.appendChild(tr);
      }
    }



    function populate(){
      inpTWeek.value   = String(Counts.DAY_TARGET_WEEKDAY);
      inpTWH.value     = String(Counts.DAY_TARGET_WEEKEND_HOLIDAY);
      inpNF.value      = String(Counts.FIXED_NF);
      inpNS.value      = String(Counts.FIXED_NS);
      if (inpNFHoliday){
        inpNFHoliday.value = String(
          Number.isFinite(Counts.FIXED_NF_WEEKEND_HOLIDAY)
            ? Counts.FIXED_NF_WEEKEND_HOLIDAY
            : Counts.FIXED_NF
        );
      }
      if (inpNSHoliday){
        inpNSHoliday.value = String(
          Number.isFinite(Counts.FIXED_NS_WEEKEND_HOLIDAY)
            ? Counts.FIXED_NS_WEEKEND_HOLIDAY
            : Counts.FIXED_NS
        );
      }
      if (inpEarlyWeekday) inpEarlyWeekday.value = String(Counts.EARLY_TARGET_WEEKDAY);
      if (inpEarlyWkHol)   inpEarlyWkHol.value   = String(Counts.EARLY_TARGET_WEEKEND_HOLIDAY);
      if (inpLateWeekday)  inpLateWeekday.value  = String(Counts.LATE_TARGET_WEEKDAY);
      if (inpLateWkHol)    inpLateWkHol.value    = String(Counts.LATE_TARGET_WEEKEND_HOLIDAY);
      if (inpFixedByDate){

        inpFixedByDate.value = Counts.exportFixedByDateText
          ? Counts.exportFixedByDateText()
          : '';
        renderFixedByDateList();
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

        renderFixedByDateList();
      });
    }
    // 登録済み一覧（表）：直接編集 → テキストエリアへ反映
    if (fixedListBody && inpFixedByDate){
      fixedListBody.addEventListener('input', (e)=>{
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.tagName !== 'INPUT') return;
        const field = target.getAttribute('data-field');
        if (!field) return;

        const tr = target.closest('tr');
        const ds = tr ? tr.dataset.ds : null;
        if (!ds) return;

        const v = target.value.trim();
        const n = (v === '') ? null : clamp0to30(v);

        const map = getMapFromTextarea();
        const entry = map[ds] ? { ...map[ds] } : {};

        if (n === null) delete entry[field];
        else entry[field] = n;

        // 全部空なら日付ごと消す
        const hasAny = ['day','early','late','nf','ns'].some(k => Number.isFinite(entry[k]));
        if (!hasAny) delete map[ds];
        else map[ds] = entry;

        setTextareaFromMap(map);
      });

      // 削除ボタン
      fixedListBody.addEventListener('click', (e)=>{
        const btnEl = e.target;
        if (!(btnEl instanceof HTMLElement)) return;
        if (btnEl.getAttribute('data-action') !== 'del') return;
        const tr = btnEl.closest('tr');
        const ds = tr ? tr.dataset.ds : null;
        if (!ds) return;

        const map = getMapFromTextarea();
        delete map[ds];
        setTextareaFromMap(map);
        renderFixedByDateList();
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

      if (inpNFHoliday && inpNFHoliday.value !== ''){
        cfg.FIXED_NF_WEEKEND_HOLIDAY = parseInt(inpNFHoliday.value,10);
      }
      if (inpNSHoliday && inpNSHoliday.value !== ''){
        cfg.FIXED_NS_WEEKEND_HOLIDAY = parseInt(inpNSHoliday.value,10);
      }

      save(cfg);

      dlg.close ?  dlg.close() : (dlg.open = false);
      if (typeof window.showToast === 'function') window.showToast('人数設定を保存しました');
    });

    dlg.querySelector('#countsClose')?.addEventListener('click', ()=>{
      dlg.close ? dlg.close() : (dlg.open = false);
    });
  });

})(window);

