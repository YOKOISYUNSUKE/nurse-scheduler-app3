/* counts.config.js */
(function(global){
  const Counts = {
    DAY_MIN_WEEKDAY: 10,
    DAY_ALLOWED_WEEKEND_HOLIDAY: [5,6],
    DAY_TARGET_WEEKDAY: 10,
    DAY_TARGET_WEEKEND_HOLIDAY: 6,
    FIXED_NF: 3,
    FIXED_NS: 3,
    // ★追加：日付ごとの夜勤帯人数設定（キー: "YYYY-MM-DD", 値: {nf: number, ns: number}）
    DATE_SPECIFIC_COUNTS: {}
  };

  Counts.getFixedDayCount = function(ds){
    return null;
  };

  // ★追加：日付ごとの夜勤帯人数を取得（未設定ならnull）
  Counts.getDateSpecificNF = function(ds){
    return Counts.DATE_SPECIFIC_COUNTS[ds]?.nf ?? null;
  };

  Counts.getDateSpecificNS = function(ds){
    return Counts.DATE_SPECIFIC_COUNTS[ds]?.ns ?? null;
  };

  // ★追加：日付ごとの夜勤帯人数を設定
  Counts.setDateSpecificCount = function(ds, nf, ns){
    if (!Counts.DATE_SPECIFIC_COUNTS) Counts.DATE_SPECIFIC_COUNTS = {};
    Counts.DATE_SPECIFIC_COUNTS[ds] = { nf, ns };
    save(); // 即座に永続化
  };

  // ★追加：日付ごとの設定を削除
  Counts.removeDateSpecificCount = function(ds){
    if (Counts.DATE_SPECIFIC_COUNTS && Counts.DATE_SPECIFIC_COUNTS[ds]){
      delete Counts.DATE_SPECIFIC_COUNTS[ds];
      save();
    }
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
    // ★追加：日付別設定の復元
    if (cfg.DATE_SPECIFIC_COUNTS && typeof cfg.DATE_SPECIFIC_COUNTS === 'object'){
      Counts.DATE_SPECIFIC_COUNTS = cfg.DATE_SPECIFIC_COUNTS;
    }
  }
  function load(){ apply(read()); return {...Counts}; }
  function save(partial){
    // ★修正：DATE_SPECIFIC_COUNTSを保持してからapplyを実行
    const currentDateCounts = { ...Counts.DATE_SPECIFIC_COUNTS };
    const next = { ...read(), ...(partial||{}) };
    apply(next);
    // ★修正：保持したDATE_SPECIFIC_COUNTSを復元
    Counts.DATE_SPECIFIC_COUNTS = { ...currentDateCounts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({

      DAY_MIN_WEEKDAY: Counts.DAY_MIN_WEEKDAY,
      DAY_ALLOWED_WEEKEND_HOLIDAY: Counts.DAY_ALLOWED_WEEKEND_HOLIDAY,
      DAY_TARGET_WEEKDAY: Counts.DAY_TARGET_WEEKDAY,
      DAY_TARGET_WEEKEND_HOLIDAY: Counts.DAY_TARGET_WEEKEND_HOLIDAY,
      FIXED_NF: Counts.FIXED_NF,
      FIXED_NS: Counts.FIXED_NS,
      DATE_SPECIFIC_COUNTS: Counts.DATE_SPECIFIC_COUNTS || {} // ★追加
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

  // ★修正：UI配線を統合（日付別設定を含む）
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('btnCountsOpen');
    const dlg = document.getElementById('countsDlg');
    if (!btn || !dlg) return;
    const $ = id => dlg.querySelector(`#${id}`);
    
    // 固定人数設定の要素
    const inpDayMin   = $('cfgDayMin');
    const inpAllowed  = $('cfgDayAllowed');
    const inpTWeek    = $('cfgDayTarget');
    const inpTWH      = $('cfgDayTargetWkHol');
    const inpNF       = $('cfgFixedNF');
    const inpNS       = $('cfgFixedNS');

    // ★追加：日付別設定の要素
    const inpDate = $('cfgDateSpecific');
    const inpDateNF = $('cfgDateNF');
    const inpDateNS = $('cfgDateNS');
    const btnAdd = $('btnAddDateCount');
    const btnRem = $('btnRemoveDateCount');
    const list = $('dateCountsList');

// ★追加：設定済み日付一覧を表示（削除ボタン付き）
function renderDateList(){
  if (!list) return;
  const dates = Object.keys(Counts.DATE_SPECIFIC_COUNTS || {}).sort();
  if (dates.length === 0){
    list.innerHTML = '<p style="color: #999; font-size: 0.9em;">設定済みの日付はここに表示されます</p>';
    return;
  }
  list.innerHTML = dates.map(ds => {
    const cfg = Counts.DATE_SPECIFIC_COUNTS[ds];
    return `<div style="padding: 5px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
      <span><strong>${ds}</strong>: NF=${cfg.nf}, NS=${cfg.ns}</span>
      <button class="btn btn-sm btn-danger" data-date="${ds}" style="padding: 2px 8px; font-size: 0.85em;">削除</button>
    </div>`;
  }).join('');
}

    // ★修正：削除ボタンのイベント委譲（動的に生成されたボタンに対応）
    if (list){
      list.addEventListener('click', (e) => {
        if (e.target.matches('button[data-date]')) {
          const ds = e.target.getAttribute('data-date');
          if (ds && confirm(`${ds} の設定を削除しますか？`)) {
            Counts.removeDateSpecificCount(ds);
            renderDateList();
            if (typeof window.showToast === 'function') window.showToast(`${ds} の設定を削除しました`);
          }
        }
      });
    }

    // ★追加：日付選択時に既存設定を表示
    if (inpDate){
      inpDate.addEventListener('change', ()=>{
        const ds = inpDate.value;
        if (!ds) return;
        const cfg = Counts.DATE_SPECIFIC_COUNTS?.[ds];
        if (cfg){
          inpDateNF.value = cfg.nf;
          inpDateNS.value = cfg.ns;
        } else {
          inpDateNF.value = '';
          inpDateNS.value = '';
        }
      });
    }

    // ★追加：追加ボタン
    if (btnAdd){
      btnAdd.addEventListener('click', ()=>{
        const ds = inpDate?.value;
        const nf = parseInt(inpDateNF?.value, 10);
        const ns = parseInt(inpDateNS?.value, 10);
        if (!ds){
          if (typeof window.showToast === 'function') window.showToast('日付を選択してください');
          return;
        }
        if (!Number.isInteger(nf) || !Number.isInteger(ns) || nf < 0 || ns < 0){
          if (typeof window.showToast === 'function') window.showToast('NFとNSの人数を正しく入力してください');
          return;
        }
        Counts.setDateSpecificCount(ds, nf, ns);
        renderDateList();
        // ★修正：入力フィールドをクリアして次の日付を登録しやすくする
        inpDate.value = '';
        inpDateNF.value = '';
        inpDateNS.value = '';
        if (typeof window.showToast === 'function') window.showToast(`${ds} の設定を追加しました`);

      });
    }

    // ★追加：削除ボタン（入力フィールドから）
    if (btnRem){
      btnRem.addEventListener('click', ()=>{
        const ds = inpDate?.value;
        if (!ds){
          if (typeof window.showToast === 'function') window.showToast('日付を選択してください');
          return;
        }
        if (!Counts.DATE_SPECIFIC_COUNTS?.[ds]){
          if (typeof window.showToast === 'function') window.showToast(`${ds} の設定は存在しません`);
          return;
        }
        if (confirm(`${ds} の設定を削除しますか？`)) {
          Counts.removeDateSpecificCount(ds);
          // ★修正：入力フィールドをクリア
          inpDate.value = '';
          inpDateNF.value = '';
          inpDateNS.value = '';
          renderDateList();

          if (typeof window.showToast === 'function') window.showToast(`${ds} の設定を削除しました`);
        }
      });
    }

    // 固定人数設定の初期表示
    function populate(){
      inpDayMin.value  = String(Counts.DAY_MIN_WEEKDAY);
      inpAllowed.value = Counts.DAY_ALLOWED_WEEKEND_HOLIDAY.join(',');
      inpTWeek.value   = String(Counts.DAY_TARGET_WEEKDAY);
      inpTWH.value     = String(Counts.DAY_TARGET_WEEKEND_HOLIDAY);
      inpNF.value      = String(Counts.FIXED_NF);
      inpNS.value      = String(Counts.FIXED_NS);
    }

    // ★修正：ダイアログを開いたときに固定人数と日付別一覧を表示
    btn.addEventListener('click', ()=>{
      populate();
      renderDateList(); // ★追加：日付別一覧も表示
      dlg.showModal ? dlg.showModal() : (dlg.open = true);
    });

    // 固定人数設定の保存
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

