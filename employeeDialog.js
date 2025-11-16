// ====== 従業員ダイアログ管理モジュール ======
(function(){
  'use strict';

  const WorkMap = {
    two:   { symbol:'②', label:'二部制' },
    three: { symbol:'③', label:'三部制' },
    day:   { symbol:'日', label:'日勤のみ（平日・土日祝OK）' },
    night: { symbol:'夜', label:'夜勤のみ' },
  };
  const WorkOrder = ['two','three','day','night'];

  // グローバル依存の取得（app.jsから公開済みを想定）
  const getState = () => window.SchedulerState;
  const { pad2 } = window.App?.Dates || {};

  // DOM要素
  let attrDlg, attrContent, attrSave, attrClose;
  let employeeCountSel;

  function init(){
    // DOM要素の取得
    attrDlg = document.getElementById('attrDlg');
    attrContent = document.getElementById('attrContent');
    attrSave = document.getElementById('attrSave');
    attrClose = document.getElementById('attrClose');
    employeeCountSel = document.getElementById('employeeCount');

    // イベントリスナー設定
    if (attrSave) attrSave.addEventListener('click', saveAndClose);
    if (attrClose) attrClose.addEventListener('click', closeDialog);
  }

  function openAttrDialog(){
    buildAttrDialog();
    if(typeof attrDlg.showModal === 'function') attrDlg.showModal();
    else attrDlg.show();
  }

  function buildAttrDialog(){
    const State = getState();
    if (!State) return;

    attrContent.innerHTML = '';
    for(let i = 0; i < State.employeeCount; i++){
      const row = createEmployeeRow(i, State);
      attrContent.appendChild(row);
    }
  }

  function createEmployeeRow(i, State){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.idx = String(i);
    row.dataset.role = 'row';

    // 名前入力
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'txt';
    name.value = State.employees[i] || `職員${pad2(i+1)}`;
    name.placeholder = `職員名（例：${State.employees[i] || `職員${pad2(i+1)}`}）`;
    name.maxLength = 32;
    name.setAttribute('aria-label','従業員名');
    name.dataset.role = 'name';

    // レベルセレクト
    const selLv = createLevelSelect(State.employeesAttr[i]?.level || 'B');

    // 勤務形態セレクト
    const selWt = createWorkTypeSelect(State.employeesAttr[i]?.workType || 'three');

    // 夜勤ノルマ入力
    const quotaWrap = createQuotaInput(State.employeesAttr[i], selWt);

    // コントロールボタン（上へ・下へ・削除）
    const ctrls = createControls(i, State);

    row.appendChild(name);
    row.appendChild(selLv);
    row.appendChild(selWt);
    row.appendChild(quotaWrap);
    row.appendChild(ctrls);

    return row;
  }

  function createLevelSelect(currentLevel){
    const sel = document.createElement('select');
    sel.className = 'select';
    ['A','B','C'].forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if(currentLevel === v) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function createWorkTypeSelect(currentType){
    const sel = document.createElement('select');
    sel.className = 'select';
    WorkOrder.forEach(key => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol} ${WorkMap[key].label}`;
      if(currentType === key) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function createQuotaInput(attr, selWt){
    const quotaWrap = document.createElement('div');
    quotaWrap.className = 'quota-wrap';
    quotaWrap.style.display = (attr?.workType || 'three') === 'night' ? 'flex' : 'none';
    quotaWrap.style.alignItems = 'center';
    quotaWrap.style.gap = '4px';

    const quotaLabel = document.createElement('span');
    quotaLabel.textContent = '☆ノルマ:';
    quotaLabel.style.fontSize = '0.9em';

    const quotaInput = document.createElement('input');
    quotaInput.type = 'number';
    quotaInput.className = 'quota-input';
    quotaInput.style.width = '50px';
    quotaInput.min = '0';
    quotaInput.max = '15';
    quotaInput.value = attr?.nightQuota || 10;
    quotaInput.title = '夜勤専従の4週間あたりの☆の目標回数';

    quotaWrap.appendChild(quotaLabel);
    quotaWrap.appendChild(quotaInput);

    // 勤務形態変更時にノルマ表示切替
    selWt.addEventListener('change', () => {
      quotaWrap.style.display = selWt.value === 'night' ? 'flex' : 'none';
    });

    return quotaWrap;
  }

  function createControls(i, State){
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn btn-outline';
    btnUp.textContent = '▲上へ';
    btnUp.disabled = (i === 0);
    btnUp.addEventListener('click', () => moveEmployee(i, i-1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'btn btn-outline';
    btnDown.textContent = '▼下へ';
    btnDown.disabled = (i === State.employeeCount - 1);
    btnDown.addEventListener('click', () => moveEmployee(i, i+1));

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-danger';
    btnDel.textContent = '削除';
    btnDel.addEventListener('click', () => deleteEmployee(i));

    ctrls.appendChild(btnUp);
    ctrls.appendChild(btnDown);
    ctrls.appendChild(btnDel);

    return ctrls;
  }

  function readAttrDialogToState(){
    const State = getState();
    if (!State) return;

    const rows = Array.from(attrContent.querySelectorAll('.row'));
    rows.forEach(row => {
      const i = Number(row.dataset.idx);
      const [selLv, selWt] = row.querySelectorAll('select');
      const nameInput = row.querySelector('input[data-role="name"]');
      const quotaInput = row.querySelector('.quota-input');
      
      const nm = (nameInput?.value || '').trim();
      State.employees[i] = nm || `職員${pad2(i+1)}`;
      
      const nightQuota = quotaInput ? parseInt(quotaInput.value, 10) : undefined;
      State.employeesAttr[i] = { 
        level: selLv.value, 
        workType: selWt.value,
        nightQuota: (selWt.value === 'night' && Number.isInteger(nightQuota)) ? nightQuota : undefined
      };
    });
  }

  // 従業員の並び替え
  function moveEmployee(from, to){
    const State = getState();
    if (!State || to < 0 || to >= State.employeeCount || from === to) return;

    // 表示配列の入替
    [State.employees[from], State.employees[to]] = [State.employees[to], State.employees[from]];
    [State.employeesAttr[from], State.employeesAttr[to]] = [State.employeesAttr[to], State.employeesAttr[from]];

    // 31日窓内データ（Map）入替
    swapMapKey(State.offRequests, from, to);
    swapMapKey(State.assignments, from, to);

    // 全期間ストアも入替
    const store = window.readDatesStore();
    if (!store.off) store.off = {};
    if (!store.assign) store.assign = {};
    if (!store.lock) store.lock = {};
    swapStoreBuckets(store.off, from, to);
    swapStoreBuckets(store.assign, from, to);
    swapStoreBuckets(store.lock, from, to);
    writeDatesStore(store);

    updateLocksAfterSwap(from, to);
    refreshAfterChange('並び替えました');
  }

  // 従業員の削除
  function deleteEmployee(idx){
    if (!confirm('この従業員を削除します。現在の割当と希望休も削除されます。よろしいですか？')) return;

    const State = getState();
    if (!State) return;

    // 表示配列から除去
    State.employees.splice(idx, 1);
    State.employeesAttr.splice(idx, 1);

    // 従業員数を減算
    State.employeeCount = Math.max(1, State.employeeCount - 1);
    if (employeeCountSel){
      const maxOpt = Math.max(60, State.employeeCount);
      employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i) => {
        const v = i + 1;
        return `<option value="${v}">${v}</option>`;
      }).join('');
      employeeCountSel.value = String(State.employeeCount);
    }

    // 31日窓内データ（Map）を詰め直し
    State.offRequests = remapEmployeeMap(State.offRequests, idx);
    State.assignments = remapEmployeeMap(State.assignments, idx);

    // 全期間ストアも詰め直し
    const store = window.readDatesStore();
    store.off = remapStoreAfterDelete(store.off || {}, idx);
    store.assign = remapStoreAfterDelete(store.assign || {}, idx);
    store.lock = remapStoreAfterDelete(store.lock || {}, idx);
    writeDatesStore(store);

    updateLocksAfterDelete(idx);
    ensureEmployees();
    refreshAfterChange('従業員を削除しました');
  }

  // ユーティリティ関数群
  function swapMapKey(map, a, b){
    const hasA = map.has(a), hasB = map.has(b);
    const vA = hasA ? map.get(a) : undefined;
    const vB = hasB ? map.get(b) : undefined;
    if (hasA) map.set(b, vA); else map.delete(b);
    if (hasB) map.set(a, vB); else map.delete(a);
  }

  function swapStoreBuckets(obj, i, j){
    const tmp = obj[i];
    obj[i] = obj[j];
    obj[j] = tmp;
  }

  function remapEmployeeMap(map, idx){
    const out = new Map();
    for (const [k, v] of map.entries()){
      const n = Number(k);
      if (n < idx) out.set(n, v);
      else if (n > idx) out.set(n-1, v);
    }
    return out;
  }

  function remapStoreAfterDelete(obj, idx){
    const out = {};
    Object.keys(obj || {}).forEach(k => {
      const n = Number(k);
      if (Number.isNaN(n)) return;
      if (n < idx) out[n] = obj[n];
      else if (n > idx) out[n-1] = obj[n];
    });
    return out;
  }

  function updateLocksAfterSwap(a, b){
    const State = getState();
    if (!State) return;

    const next = new Set();
    for (const k of State.lockedCells){
      const [rs, ds] = k.split('|');
      let r = Number(rs);
      if (r === a) r = b; else if (r === b) r = a;
      next.add(`${r}|${ds}`);
    }
    State.lockedCells = next;
  }

  function updateLocksAfterDelete(idx){
    const State = getState();
    if (!State) return;

    const next = new Set();
    for (const k of State.lockedCells){
      const [rs, ds] = k.split('|');
      const r = Number(rs);
      if (r < idx) next.add(`${r}|${ds}`);
      else if (r > idx) next.add(`${r-1}|${ds}`);
    }
    State.lockedCells = next;
  }

  function ensureEmployees(){
    const State = getState();
    if (!State) return;

    const need = State.employeeCount;
    const cur = State.employees.length;
    if(cur < need){
      for(let i = cur; i < need; i++){
        State.employees.push(`職員${pad2(i+1)}`);
        State.employeesAttr.push({ level:'B', workType:'three' });
      }
    } else if(cur > need){
      State.employees.length = need;
      State.employeesAttr.length = need;
    }
  }

  function writeDatesStore(store){
    // app.jsのグローバル関数に委譲
    if (window.writeDatesStore) {
      window.writeDatesStore(store);
    }
  }

  function refreshAfterChange(msg){
    buildAttrDialog();
    if (window.renderGrid) window.renderGrid();
    if (window.saveMetaOnly) window.saveMetaOnly();
    if (window.showToast) window.showToast(msg);
  }

  function saveAndClose(){
    readAttrDialogToState();
    if (window.saveMetaOnly) window.saveMetaOnly();
    if (window.renderGrid) window.renderGrid();
    closeDialog();
  }

  function closeDialog(){
    if (attrDlg && typeof attrDlg.close === 'function') {
      attrDlg.close();
    }
  }

  // グローバル公開
  window.EmployeeDialog = {
    init,
    openAttrDialog,
    readAttrDialogToState
  };

})();