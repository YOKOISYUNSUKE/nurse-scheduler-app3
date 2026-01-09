/* app-dialog.js : 属性ダイアログ */
  function openAttrDialog(){
    buildAttrDialog();
    if(typeof attrDlg.showModal === 'function') attrDlg.showModal();
    else attrDlg.show(); // fallback
  }

function buildAttrDialog(){
  attrContent.innerHTML = '';
  for(let i=0;i<State.employeeCount;i++){
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.idx = String(i);
    row.dataset.role = 'row';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'txt';
    name.value = State.employees[i] || `職員${pad2(i+1)}`;
    name.placeholder = `職員名（例：${State.employees[i] || `職員${pad2(i+1)}`}）`;
    name.maxLength = 32;
    name.setAttribute('aria-label','従業員名');
    name.dataset.role = 'name';

    const selLv = document.createElement('select');
    selLv.className = 'select';
    ['A','B','C'].forEach(v=>{
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if((State.employeesAttr[i]?.level||'B')===v) o.selected = true;
      selLv.appendChild(o);
    });

    const selWt = document.createElement('select');
    selWt.className = 'select';
    WorkOrder.forEach(key=>{
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${WorkMap[key].symbol} ${WorkMap[key].label}`;
      if((State.employeesAttr[i]?.workType||'three')===key) o.selected = true;
      selWt.appendChild(o);
    });

  
    // ★追加：夜勤ノルマ入力欄（夜勤専従のみ表示）
    const quotaWrap = document.createElement('div');
    quotaWrap.className = 'quota-wrap';
    quotaWrap.style.display = (State.employeesAttr[i]?.workType||'three') === 'night' ? 'flex' : 'none';
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
    quotaInput.value = State.employeesAttr[i]?.nightQuota || 10;
    quotaInput.title = '夜勤専従の4週間あたりの☆の目標回数';

    quotaWrap.appendChild(quotaLabel);
    quotaWrap.appendChild(quotaInput);

// ★修正：禁忌ペア選択（複数選択可能）
const forbidWrap = document.createElement('div');
forbidWrap.className = 'forbid-wrap';
forbidWrap.style.display = 'flex';
forbidWrap.style.alignItems = 'center';
forbidWrap.style.gap = '4px';

const forbidLabel = document.createElement('span');
forbidLabel.textContent = '禁忌ペア:';
forbidLabel.style.fontSize = '0.9em';

const forbidSelect = document.createElement('select');
forbidSelect.className = 'forbid-select';
forbidSelect.multiple = true;
forbidSelect.style.minWidth = '100px';
forbidSelect.style.maxWidth = '200px';
forbidSelect.size = 3;
for (let j = 0; j < State.employeeCount; j++) {
  if (j === i) continue;
  const opt = document.createElement('option');
  opt.value = String(j);
  opt.textContent = State.employees[j] || `職員${pad2(j+1)}`;
  const current = State.forbiddenPairs.get(i);
  if (current && current.has(j)) opt.selected = true;
  forbidSelect.appendChild(opt);
}

// 左クリックだけで禁忌ペアをトグル選択できるようにする
forbidSelect.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return; // 左クリック以外は無視
  const target = ev.target;
  if (!target || target.tagName !== 'OPTION') return;
  ev.preventDefault();          // ブラウザ標準の選択挙動を抑止
  target.selected = !target.selected;
});

forbidWrap.appendChild(forbidLabel);
forbidWrap.appendChild(forbidSelect);

    // 勤務形態変更時にノルマ入力欄の表示/非表示を切り替え
    selWt.addEventListener('change', ()=>{
      quotaWrap.style.display = selWt.value === 'night' ? 'flex' : 'none';
    });

  // 追加：並び替え＆削除ボタン列
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn btn-outline';
    btnUp.textContent = '▲上へ';
    btnUp.disabled = (i === 0);
    btnUp.addEventListener('click', ()=> moveEmployee(i, i-1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'btn btn-outline';
    btnDown.textContent = '▼下へ';
    btnDown.disabled = (i === State.employeeCount - 1);
    btnDown.addEventListener('click', ()=> moveEmployee(i, i+1));

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-danger';
    btnDel.textContent = '削除';
    btnDel.addEventListener('click', ()=> deleteEmployee(i));

    ctrls.appendChild(btnUp);
    ctrls.appendChild(btnDown);
    ctrls.appendChild(btnDel);

    row.appendChild(name);
    row.appendChild(selLv);
    row.appendChild(selWt);
    row.appendChild(quotaWrap); 
    row.appendChild(forbidWrap);
    row.appendChild(ctrls);
    attrContent.appendChild(row);
  }
}

function readAttrDialogToState(){

  const rows = $$('.row', attrContent);
  rows.forEach(row=>{
    const i = Number(row.dataset.idx);
    const [selLv, selWt] = row.querySelectorAll('select');
    const nameInput = row.querySelector('input[data-role="name"]');
    const quotaInput = row.querySelector('.quota-input');
    const forbidSelect = row.querySelector('.forbid-select'); // ★追加
    const nm = (nameInput?.value || '').trim();
    State.employees[i] = nm || `職員${pad2(i+1)}`;
    // 夜勤ノルマを追加
    const nightQuota = quotaInput ? parseInt(quotaInput.value, 10) : undefined;

    const prev = State.employeesAttr[i] || { level:'B', workType:'three', shiftDurations:{} };
    const next = {
      ...prev,
      level: selLv.value,
      workType: selWt.value,
      nightQuota: (selWt.value === 'night' && Number.isInteger(nightQuota)) ? nightQuota : undefined
    };

    State.employeesAttr[i] = normalizeEmployeeAttrByWorkType(next);

    
    // 禁忌ペアの保存（複数選択対応）
    if (forbidSelect) {
      const selected = Array.from(forbidSelect.selectedOptions).map(opt => Number(opt.value));
      if (selected.length > 0) State.forbiddenPairs.set(i, new Set(selected));
      else State.forbiddenPairs.delete(i);
    }
  });
}

// === ここから追加：従業員の並び替え＆削除（シフト・希望休も紐付けて移動/除去） ===

// Map<index, ...> のキーを入れ替える（存在しないキーは消去）
function swapMapKey(map, a, b){
  const hasA = map.has(a), hasB = map.has(b);
  const vA = hasA ? map.get(a) : undefined;
  const vB = hasB ? map.get(b) : undefined;
  if (hasA) map.set(b, vA); else map.delete(b);
  if (hasB) map.set(a, vB); else map.delete(a);
}

// dates ストア（全期間）内の「配列風オブジェクト」バケツを入れ替え
function swapStoreBuckets(obj, i, j){
  const tmp = obj[i];
  obj[i] = obj[j];
  obj[j] = tmp;
}

function updateLocksAfterSwap(a, b){
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
  const next = new Set();
  for (const k of State.lockedCells){
    const [rs, ds] = k.split('|');
    const r = Number(rs);
    if (r < idx) next.add(`${r}|${ds}`);
    else if (r > idx) next.add(`${r-1}|${ds}`);
    // 等しい（削除対象）は落とす
  }
  State.lockedCells = next;
}

// dates ストア（全期間）内の「配列風オブジェクト」を idx で詰め直す
function remapStoreAfterDelete(obj, idx){
  const out = {};
  Object.keys(obj || {}).forEach(k=>{
    const n = Number(k);
    if (Number.isNaN(n)) return;
    if (n < idx) out[n] = obj[n];
    else if (n > idx) out[n-1] = obj[n];
  });
  return out;
}

// 表示用ダイアログとグリッドを再描画＆メタ保存
function refreshAfterChange(msg){
  buildAttrDialog();
  renderGrid();
  saveMetaOnly();
  if (typeof showToast === 'function') showToast(msg);
}

// 並び替え：from → to へ（シフト/希望休を人に紐付けて丸ごと移動）
function moveEmployee(from, to){
  if (to < 0 || to >= State.employeeCount || from === to) return;

  // 1) 表示配列の入替
  [State.employees[from],     State.employees[to]    ] = [State.employees[to],     State.employees[from]    ];
  [State.employeesAttr[from], State.employeesAttr[to]] = [State.employeesAttr[to], State.employeesAttr[from]];

  // 2) 31日窓内データ（Map）入替
  swapMapKey(State.offRequests, from, to);
  swapMapKey(State.assignments, from, to);

  // 3) 全期間ストアも入替（過去/未来のズレ防止）
  const store = readDatesStore();
  if (!store.off)    store.off    = {};
  if (!store.assign) store.assign = {};
  swapStoreBuckets(store.off,    from, to);
  swapStoreBuckets(store.assign, from, to);
  if (!store.lock) store.lock = {};
  swapStoreBuckets(store.lock,   from, to);
  writeDatesStore(store);

  updateLocksAfterSwap(from, to);
  refreshAfterChange('並び替えました');

}

// 削除：idx の従業員を完全削除（行を詰める／最小人数は維持）
function deleteEmployee(idx){
  if (!confirm('この従業員を削除します。現在の割当と希望休も削除されます。よろしいですか？')) return;

  // 1) 表示配列から除去
  State.employees.splice(idx, 1);
  State.employeesAttr.splice(idx, 1);

  // 1.5) 従業員数を減算し、セレクトを現在値に再構築
  State.employeeCount = Math.max(1, State.employeeCount - 1);
  if (employeeCountSel){
    const maxOpt = Math.max(60, State.employeeCount);
    employeeCountSel.innerHTML = Array.from({length:maxOpt}, (_,i)=> {
      const v = i + 1; return `<option value="${v}">${v}</option>`;
    }).join('');
    employeeCountSel.value = String(State.employeeCount);
  }

  // 2) 31日窓内データ（Map）を詰め直し
  const remap = (map)=>{
    const out = new Map();
    for (const [k, v] of map.entries()){
      const n = Number(k);
      if (n < idx) out.set(n, v);
      else if (n > idx) out.set(n-1, v);
    }
    return out;
  };
  State.offRequests = remap(State.offRequests);
  State.assignments = remap(State.assignments);

  // 3) 全期間ストアも詰め直し（過去/未来のズレ防止）
  const store = readDatesStore();
  store.off    = remapStoreAfterDelete(store.off    || {}, idx);
  store.assign = remapStoreAfterDelete(store.assign || {}, idx);
  store.lock   = remapStoreAfterDelete(store.lock   || {}, idx);
  writeDatesStore(store);

  updateLocksAfterDelete(idx);

  // 4) 整合性維持（現状の employeeCount に合わせるだけ）
  ensureEmployees();

  refreshAfterChange('従業員を削除しました');

}
// === ここまで追加 ===

  
