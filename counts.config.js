/* counts.config.js */
(function(global){
  const Counts = {
    DAY_MIN_WEEKDAY: 10,
    DAY_ALLOWED_WEEKEND_HOLIDAY: [5,6],
    DAY_TARGET_WEEKDAY: 10,
    DAY_TARGET_WEEKEND_HOLIDAY: 6,
    FIXED_NF: 3,
    FIXED_NS: 3
  };

  Counts.getFixedDayCount = function(ds){
    return null;
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
      'DAY_MIN_WEEKDAY','DAY_ALLOWED_WEEKEND_HOLIDAY',
      'DAY_TARGET_WEEKDAY','DAY_TARGET_WEEKEND_HOLIDAY',
      'FIXED_NF','FIXED_NS'
    ];
    for (const k of keys){
      if (!(k in cfg)) continue;
      Counts[k] = (k === 'DAY_ALLOWED_WEEKEND_HOLIDAY')
        ? (Array.isArray(cfg[k]) ? cfg[k].map(n=>parseInt(n,10)).filter(Number.isFinite) : Counts[k])
        : parseInt(cfg[k],10);
    }
  }
  function load(){ apply(read()); return {...Counts}; }
  function save(partial){
    const next = { ...read(), ...(partial||{}) };
    apply(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      DAY_MIN_WEEKDAY: Counts.DAY_MIN_WEEKDAY,
      DAY_ALLOWED_WEEKEND_HOLIDAY: Counts.DAY_ALLOWED_WEEKEND_HOLIDAY,
      DAY_TARGET_WEEKDAY: Counts.DAY_TARGET_WEEKDAY,
      DAY_TARGET_WEEKEND_HOLIDAY: Counts.DAY_TARGET_WEEKEND_HOLIDAY,
      FIXED_NF: Counts.FIXED_NF,
      FIXED_NS: Counts.FIXED_NS
    }));
    window.dispatchEvent(new CustomEvent('counts:changed', { detail: { ...Counts } }));
    if (typeof window.renderGrid === 'function') window.renderGrid(); // 即反映
  }
  Counts.load = load;
  Counts.save = save;

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
    const inpDayMin   = $('cfgDayMin');
    const inpAllowed  = $('cfgDayAllowed');
    const inpTWeek    = $('cfgDayTarget');
    const inpTWH      = $('cfgDayTargetWkHol');
    const inpNF       = $('cfgFixedNF');
    const inpNS       = $('cfgFixedNS');

    function populate(){
      inpDayMin.value  = String(Counts.DAY_MIN_WEEKDAY);
      inpAllowed.value = Counts.DAY_ALLOWED_WEEKEND_HOLIDAY.join(',');
      inpTWeek.value   = String(Counts.DAY_TARGET_WEEKDAY);
      inpTWH.value     = String(Counts.DAY_TARGET_WEEKEND_HOLIDAY);
      inpNF.value      = String(Counts.FIXED_NF);
      inpNS.value      = String(Counts.FIXED_NS);
    }

    btn.addEventListener('click', ()=>{
      populate();
      dlg.showModal ? dlg.showModal() : (dlg.open = true);
    });

    dlg.querySelector('#countsSave')?.addEventListener('click', ()=>{
      const cfg = {
        DAY_MIN_WEEKDAY: parseInt(inpDayMin.value,10),
        DAY_ALLOWED_WEEKEND_HOLIDAY: inpAllowed.value.split(',').map(s=>parseInt(s.trim(),10)).filter(Number.isFinite),
        DAY_TARGET_WEEKDAY: parseInt(inpTWeek.value,10),
        DAY_TARGET_WEEKEND_HOLIDAY: parseInt(inpTWH.value,10),
        FIXED_NF: parseInt(inpNF.value,10),
        FIXED_NS: parseInt(inpNS.value,10)
      };
      save(cfg);
      dlg.close ? dlg.close() : (dlg.open = false);
      if (typeof window.showToast === 'function') window.showToast('人数設定を保存しました');
    });

    dlg.querySelector('#countsClose')?.addEventListener('click', ()=> dlg.close ? dlg.close() : (dlg.open=false));
  });
})(window);

