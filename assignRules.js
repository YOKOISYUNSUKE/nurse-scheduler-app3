/* assignRules.js */
// 勤務形態の許容マーク + 置く前チェック + 1日組合せ検証を提供
;(function (global) {
  // 勤務形態ごとの許可マーク
  const ALLOW = {
    two:   new Set(['〇','□','☆','★']), // 二部制：○ or □ or ☆★
    three: new Set(['〇','□','◆','●']), // 三部制：○ or □ or ◆ or ●
    day:   new Set(['〇','□']),          // 日専：○ or □
    night: new Set(['☆','★']),      // 夜専：☆★ only
  };

  // ---- 単一セルの「勤務形態」チェック ----

  function canAssign(ctx){
    if (!ctx || !ctx.mark) return { ok:true }; // 空（消去）は常に可
    const wt = (ctx.empAttr && ctx.empAttr.workType) || 'three';
    const allow = ALLOW[wt] || ALLOW.three;
    if (!allow.has(ctx.mark)){
      const msg =
        wt==='two'   ? '二部制は「〇,□,☆,★」のみ可' :
        wt==='three' ? '三部制は「〇,□,◆,●」のみ可' :
        wt==='day'   ? '日勤専属は「〇,□」のみ可' :
        wt==='night' ? '夜勤専属は「☆,★」のみ可' :
        '勤務形態に合いません';
      return { ok:false, message: msg };
    }
    return { ok:true };
  }

  // ---- 日単位のカウント（全従業員） ----
  function countForDay(dayIndex, dates, employeeCount, getAssign, override){
    // override: {rowIndex, mark} を当該日の仮置きに反映（optional）
    let day=0, nf=0, ns=0; // day=〇+□, nf=(☆+◆), ns=(★+●)
    const ds = dateStr(dates[dayIndex]);
    for(let r=0; r<employeeCount; r++){
      let mk = getAssign(r, ds);
      if (override && override.rowIndex===r) mk = override.mark || undefined;
      if (mk==='〇' || mk==='□') day++;
      if (mk==='☆' || mk==='◆') nf++;
      if (mk==='★' || mk==='●') ns++;
    }
    return { day, nf, ns };
  }
  function dateStr(d){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

// ★新規追加：指定日の夜勤専従カウント（NF帯 or NS帯）
  function countNightOnlyWorkers(p, dayIndex, band) {
    const ds = dateStr(p.dates[dayIndex]);
    let count = 0;
    
    for(let r = 0; r < p.employeeCount; r++){
      const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(r) || 'three') : 'three';
      if (wt !== 'night') continue; // 夜勤専従のみカウント
      
      let mk = p.getAssign(r, ds);
      // 仮置きを反映
      if (r === p.rowIndex) mk = p.mark;
      
      if (band === 'NF' && (mk === '☆' || mk === '◆')) count++;
      if (band === 'NS' && (mk === '★' || mk === '●')) count++;
    }
    
    return count;
  }


  // ---- 置く前の「組合せ」上限チェック（過剰防止） ----
  /**
   * @param {Object} p
   *  - rowIndex, dayIndex, mark
   *  - dates, employeeCount
   *  - getAssign(row, dateStr)
   *  - hasOffByDate(row, dateStr)
   */
  
function precheckPlace(p){
  if (!p || !p.mark) return { ok:true };           // 消去は常に可
  const d = p.dayIndex;
  const dsNext = (p.dates[d+1] ? dateStr(p.dates[d+1]) : null);
  // ★追加：勤務形態ごとのペア間インターバル（夜勤専従＝0日、その他＝3日）
  const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(p.rowIndex) || 'three') : 'three';
  const pairGapMinDays = (wt === 'night') ? 0 : 3;
  const idxDiffMin = pairGapMinDays + 1;

// ★追加：禁忌ペアチェック（NF帯・NS帯のみ適用、〇は対象外）
  if (p.mark && typeof p.getForbiddenPairs === 'function') {
    const ds = dateStr(p.dates[d]);
    const forbidden = p.getForbiddenPairs(p.rowIndex);
    if (forbidden && forbidden.size > 0) {
      // NF帯（☆/◆）またはNS帯（★/●）のみチェック（〇は対象外）
      let targetBand = null;
      if (p.mark === '☆' || p.mark === '◆') targetBand = 'NF';
      else if (p.mark === '★' || p.mark === '●') targetBand = 'NS';
      
      if (targetBand) {
        for (let r = 0; r < p.employeeCount; r++) {
          if (r === p.rowIndex) continue;
          if (!forbidden.has(r)) continue;
          
          let mk = p.getAssign(r, ds);
          if (targetBand === 'NF' && (mk === '☆' || mk === '◆')) {
            return { ok: false, message: `禁忌ペア：${r+1}番目の職員と同じNF帯には配置できません` };
          }
          if (targetBand === 'NS' && (mk === '★' || mk === '●')) {
            return { ok: false, message: `禁忌ペア：${r+1}番目の職員と同じNS帯には配置できません` };
          }
        }
      }
    }
  }

// ★新規：同一日の夜勤専従は最大2名まで（NF帯・NS帯それぞれ）
  if (wt === 'night') {
    if (p.mark === '☆' || p.mark === '◆') {
      const currentCount = countNightOnlyWorkers(p, d, 'NF');
      if (currentCount >= 2) {
        return { ok: false, message: '同一日のNF帯（☆＋◆）に夜勤専従は最大2名までです' };
      }
    }
    if (p.mark === '★' || p.mark === '●') {
      const currentCount = countNightOnlyWorkers(p, d, 'NS');
      if (currentCount >= 2) {
        return { ok: false, message: '同一日のNS帯（★＋●）に夜勤専従は最大2名までです' };
      }
    }
    // ☆の場合は翌日の★も考慮
    if (p.mark === '☆' && dsNext) {
      const nextIndex = d + 1;
      if (nextIndex < p.dates.length) {
        const nextCount = countNightOnlyWorkers(p, nextIndex, 'NS');
        if (nextCount >= 2) {
          return { ok: false, message: '翌日のNS帯（★＋●）に夜勤専従が既に2名いるため、☆を配置できません' };
        }
      }
    }
  }



  // ★新規：逆順抑止（夜専を除く）— 前日が「★」なら当日の「☆」は不可
  if (p.mark === '☆' && wt !== 'night'){
    const prev = d - 1;
    if (prev >= 0){
      const dsPrev = dateStr(p.dates[prev]);
      if (p.getAssign(p.rowIndex, dsPrev) === '★'){
        return { ok:false, message:'前日が「★」のため当日の「☆」は不可（逆順通し禁止）' };
      }
    }
  }

  // ★新規：夜勤専従の連続ペア≦2（「☆★☆★☆★」禁止）
  if (p.mark === '☆' && wt === 'night'){
    const d1 = d - 1, d2 = d - 2, d3 = d - 3, d4 = d - 4;
    if (d4 >= 0){
      const ds1 = dateStr(p.dates[d1]);
      const ds2 = dateStr(p.dates[d2]);
      const ds3 = dateStr(p.dates[d3]);
      const ds4 = dateStr(p.dates[d4]);
      const mk1 = p.getAssign(p.rowIndex, ds1);
      const mk2 = p.getAssign(p.rowIndex, ds2);
      const mk3 = p.getAssign(p.rowIndex, ds3);
      const mk4 = p.getAssign(p.rowIndex, ds4);
      const twoPairsRightBefore = (mk4==='☆' && mk3==='★' && mk2==='☆' && mk1==='★');
      if (twoPairsRightBefore){
        return { ok:false, message:'夜勤専従は「☆★」の連続は2回までです（☆★☆★☆★は禁止）' };
      }
    }
  }
  


if (p.mark === '★'){
    const prev = d - 1;
    if (prev < 0) return { ok:false, message:'「★」は前日に「☆」がある場合のみ可' };
    const dsPrev = dateStr(p.dates[prev]);
    const prevMk = p.getAssign(p.rowIndex, dsPrev);  // ← 追加：prevMkを定義

  if (prevMk === '★'){  // ← 正常に参照可能
    return { ok:false, message:'「★」は連続して配置できません' };
  }
  
  if (prevMk !== '☆'){
    return { ok:false, message:'「★」は前日に「☆」がある場合のみ可' };
  }


    // ★から次の☆までの“間”が規定未満なら不可
    {
      let nextStart = -1;
      for (let i=d+1; i<p.dates.length; i++){
        const dsI = dateStr(p.dates[i]);
        if (p.getAssign(p.rowIndex, dsI) === '☆'){ nextStart = i; break; }
      }
      if (nextStart !== -1 && (nextStart - d) < idxDiffMin){
        return { ok:false, message:`「☆★」のペアと次の「☆★」の間隔は${pairGapMinDays}日以上必要です（直後ペアまで近すぎます）` };
      }
    }
  }




    const restChk = (function(){
      const need = 5;
      if (d - need >= 0){
        let allDay = true;
        for(let i=1;i<=need;i++){
          const ds = dateStr(p.dates[d - i]);
          const mk = p.getAssign(p.rowIndex, ds);
          if (mk !== '〇' && mk !== '□'){ allDay = false; break; }
        }
        if (allDay){
          return { ok:false, message:'日勤（〇/□）5連続の翌日は必ず休（未割り当て/希望休）です' };
        }
      }
      return { ok:true };
    })();

    if (!restChk.ok) return restChk;

    // ★追加：日勤×5 の2日目も休（＝連休必須）。前日が「休（希望休 or 未割当）」で、
    //         その前5日が全て「〇/□」なら当日も配置禁止
    {
      const need = 5;
      const prev1 = d - 1;
      const start = d - 1 - need; // d-6 〜 d-2 が 日勤×5
      if (start >= 0 && prev1 >= 0){
        let allPrev5Day = true;
        for (let i = start; i < start + need; i++){
          const ds5 = dateStr(p.dates[i]);
          const mk5 = p.getAssign(p.rowIndex, ds5);
          if (mk5 !== '〇' && mk5 !== '□'){ allPrev5Day = false; break; }
        }
        if (allPrev5Day){
          const dsPrev1 = dateStr(p.dates[prev1]);
          const mkPrev1 = p.getAssign(p.rowIndex, dsPrev1);
          const prev1IsRest = (!mkPrev1) || (p.hasOffByDate && p.hasOffByDate(p.rowIndex, dsPrev1));
          if (prev1IsRest){
            return { ok:false, message:'日勤（〇/□）×5後は連休必須（2日目も休）。配置できません' };
          }
        }
      }
    }

    // ★追加：NG並び「◆→〇」「◆→□」
    // 1) 前日が◆なら当日の「〇」「□」は不可
    if (p.mark === '〇' || p.mark === '□'){
      const prev = d - 1;
      if (prev >= 0){
        const dsPrev = dateStr(p.dates[prev]);
        if (p.getAssign(p.rowIndex, dsPrev) === '◆'){
          return { ok:false, message:'「◆」の翌日に日勤（〇/□）は不可（十分な休息を確保してください）' };
        }
      }
    }
    // 2) 当日が◆で、翌日に既に「〇」「□」があるなら不可
    if (p.mark === '◆'){
      const next = d + 1;
      if (next < p.dates.length){
        const dsNext2 = dateStr(p.dates[next]);
        const mkNext2 = p.getAssign(p.rowIndex, dsNext2);
        if (mkNext2 === '〇' || mkNext2 === '□'){
          return { ok:false, message:'「◆→〇/□」の並びは不可です（翌日は休を確保）' };
        }
      }
    }

    // ★新規：NG並び「◆●」（☆★と同義のため禁止）
    if (p.mark === '◆'){
      const next = d + 1;
      if (next < p.dates.length){
        const dsNext = dateStr(p.dates[next]);
        if (p.getAssign(p.rowIndex, dsNext) === '●'){
          return { ok:false, message:'「◆●」は禁止（☆★と同義）' };
        }
      }
    }
    if (p.mark === '●'){
      const prev = d - 1;
      if (prev >= 0){
        const dsPrev = dateStr(p.dates[prev]);
        if (p.getAssign(p.rowIndex, dsPrev) === '◆'){
          return { ok:false, message:'「◆●」は禁止（☆★と同義）' };
        }
      }
    }

    // ★新規：「●◆」は月内（二者の31日ウィンドウ）で2回まで & インターバル≧3日
    if (p.mark === '●' || p.mark === '◆'){
      const starts = [];
      for (let i = 0; i < p.dates.length - 1; i++){
        const ds0 = dateStr(p.dates[i]);
        const ds1 = dateStr(p.dates[i+1]);
        let mk0 = p.getAssign(p.rowIndex, ds0);
        let mk1 = p.getAssign(p.rowIndex, ds1);
        // 仮置き反映
        if (i === d)       mk0 = p.mark;
        if (i+1 === d)     mk1 = p.mark;
        if (mk0 === '●' && mk1 === '◆') starts.push(i);
      }
      // 回数上限
      if (starts.length > 2){
        return { ok:false, message:'「●◆」は月内2回までです' };
      }
      // 連続ペア間のインターバル（先行「●◆」の次日から次の「●◆」開始まで≧3日）
      for (let j = 0; j < starts.length - 1; j++){
        const gap = starts[j+1] - (starts[j] + 1); // （s2 - (s1+1)）
        if (gap < 3){
          return { ok:false, message:'「●◆」同士の間隔は3日以上あけてください' };
        }
      }
    }

    // ★追加：NS帯での「A・C・夜勤専従」同席禁止（当日★/●を置く場合）
    if (p.mark==='★' || p.mark==='●'){
      const ds = dateStr(p.dates[d]);

      const nsRows = [];
      for(let r=0;r<p.employeeCount;r++){
        let mk = p.getAssign(r, ds);
        if (r===p.rowIndex) mk = p.mark; // 仮置き反映
        if (mk==='★' || mk==='●') nsRows.push(r);
      }
      const getLv = (i)=> (typeof p.getLevel==='function' ? (p.getLevel(i)||'B') : 'B');
      const getWk = (i)=> (typeof p.getWorkType==='function' ? (p.getWorkType(i)||'three') : 'three');
      const hasA  = nsRows.some(i=> getLv(i)==='A');
      const hasC  = nsRows.some(i=> getLv(i)==='C');
      const hasNi = nsRows.some(i=> getWk(i)==='night');
      if (hasA && hasC && hasNi){
        return { ok:false, message:'NF帯で「A・C・夜勤専従」が同席になるため不可' };
      }
    }


// 当日：NF側（☆+◆）は設定の固定値「のみ」（特定日設定を優先）
    if (p.mark==='☆' || p.mark==='◆'){
      const ds = dateStr(p.dates[d]);
      const FIXED_NF = (window.Counts && typeof window.Counts.getFixedNF === 'function')
        ? window.Counts.getFixedNF(ds)
        : ((window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3);
      const c = countForDay(d, p.dates, p.employeeCount, p.getAssign, {rowIndex:p.rowIndex, mark:p.mark});
      if (c.nf > FIXED_NF) return { ok:false, message:`当日の（☆＋◆）は${FIXED_NF}名のみです` };
    }


    // 当日：NS側（★+●）は設定の固定値「のみ」（特定日設定を優先）
    if (p.mark==='★' || p.mark==='●'){
      const ds = dateStr(p.dates[d]);
      const FIXED_NS = (window.Counts && typeof window.Counts.getFixedNS === 'function')
        ? window.Counts.getFixedNS(ds)
        : ((window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3);
      const c = countForDay(d, p.dates, p.employeeCount, p.getAssign, {rowIndex:p.rowIndex, mark:p.mark});
      if (c.ns > FIXED_NS) return { ok:false, message:`当日の（★＋●）は${FIXED_NS}名のみです` };
    }


    // ★追加：夜勤帯で「A・C・夜勤専従」の同席禁止（NF帯）
    if (p.mark==='☆' || p.mark==='◆'){
      const ds = dateStr(p.dates[d]);
      // その日のNF帯メンバー（仮置き含む）
      const nfRows = [];
      for(let r=0;r<p.employeeCount;r++){
        let mk = p.getAssign(r, ds);
        if (r===p.rowIndex) mk = p.mark; // 仮置き反映
        if (mk==='☆' || mk==='◆') nfRows.push(r);
      }
      const getLv   = (i)=> (typeof p.getLevel==='function' ? (p.getLevel(i)||'B') : 'B');
      const getWk   = (i)=> (typeof p.getWorkType==='function' ? (p.getWorkType(i)||'three') : 'three');
      const hasA    = nfRows.some(i=> getLv(i)==='A');
      const hasC    = nfRows.some(i=> getLv(i)==='C');
      const hasNi   = nfRows.some(i=> getWk(i)==='night');
      if (hasA && hasC && hasNi){
        return { ok:false, message:'NF帯で「A・C・夜勤専従」が同席になるため不可' };
      }
    }
    
// 当日：NS側（★+●）は固定値「のみ」
if (p.mark==='☆'){
  if (d+1 >= p.dates.length) return { ok:false, message:'月末のため「☆」を置けません' };
  if (p.hasOffByDate && p.hasOffByDate(p.rowIndex, dsNext)) return { ok:false, message:'翌日が希望休のため「☆」を置けません' };

// 「☆★」の次の1日（d+2）が無い場合は不可（休を確保できない）
  if (d + 2 >= p.dates.length){
    return { ok:false, message:'月末のため「☆★→休」を置けません' };
  }

      // 翌日★を仮置きして過剰チェック
      // 既に本人が翌日に★なら差分ゼロ
      const already = p.getAssign(p.rowIndex, dsNext) === '★';
      if (!already){
      // 翌日の ns を再計算（本人に★を仮置き）
        let day=0, nf=0, ns=0;
        for(let r=0;r<p.employeeCount;r++){
          let mk = p.getAssign(r, dsNext);
          if (r===p.rowIndex) mk = '★';
          if (mk==='〇') day++;
          if (mk==='☆' || mk==='◆') nf++;
          if (mk==='★' || mk==='●') ns++;
        }
        const FIXED_NS = (window.Counts && typeof window.Counts.getFixedNS === 'function')
          ? window.Counts.getFixedNS(dsNext)
          : ((window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3);
        if (ns > FIXED_NS) return { ok:false, message:`翌日の（★＋●）が${FIXED_NS}名を超えます` };

      }


      // ★追加：翌日のNS帯でも「A・C・夜勤専従」の同席禁止（☆により翌日★が付くため）
      {
        const dsNS = dsNext;
        const nsRows = [];
        for(let r=0;r<p.employeeCount;r++){
          let mk = p.getAssign(r, dsNS);
          if (r===p.rowIndex) mk = '★'; // 仮置きの★
          if (mk==='★' || mk==='●') nsRows.push(r);
        }
        const getLv = (i)=> (typeof p.getLevel==='function' ? (p.getLevel(i)||'B') : 'B');
        const getWk = (i)=> (typeof p.getWorkType==='function' ? (p.getWorkType(i)||'three') : 'three');
        const hasA  = nsRows.some(i=> getLv(i)==='A');
        const hasC  = nsRows.some(i=> getLv(i)==='C');
        const hasNi = nsRows.some(i=> getWk(i)==='night');
        if (hasA && hasC && hasNi){
          return { ok:false, message:'翌日のNS帯で「A・C・夜勤専従」が同席になるため不可' };
        }
      }

      // 追加：☆★と次の☆★の間は勤務形態ごとの下限日数（夜勤専従=0, その他=3）を空ける
      {
        // 直前ペアの終了日（★）を探索
        let prevEnd = -1;
        for (let i=d-1; i>=1; i--){
          const dsI  = dateStr(p.dates[i]);
          const dsIm = dateStr(p.dates[i-1]);
          if (p.getAssign(p.rowIndex, dsI) === '★' && p.getAssign(p.rowIndex, dsIm) === '☆'){ prevEnd = i; break; }
        }
        // (★)と次の(☆)のインデックス差が規定未満なら不可
        if (prevEnd !== -1 && (d - prevEnd) < idxDiffMin){
          return { ok:false, message:`「☆★」のペアと次の「☆★」の間隔は${pairGapMinDays}日以上必要です（直前ペアから近すぎます）` };
        }
        // 新規ペアの★は d+1。そこから次の☆まで idxDiffMin 以上必要
        let nextStart = -1;
        for (let i=d+2; i<p.dates.length; i++){
          const dsI = dateStr(p.dates[i]);
          if (p.getAssign(p.rowIndex, dsI) === '☆'){ nextStart = i; break; }
        }
        if (nextStart !== -1 && (nextStart - (d+1)) < idxDiffMin){
          return { ok:false, message:`「☆★」のペアと次の「☆★」の間隔は${pairGapMinDays}日以上必要です（直後ペアまで近すぎます）` };
        }
      }
    }



    // 追加：日勤連続≦5（6個目の〇/□は不可／前後合算）
    if (p.mark === '〇' || p.mark === '□'){
      const countPrev = (()=>{ let c=0; for(let i=d-1;i>=0;i--){ const ds=dateStr(p.dates[i]); const mk=p.getAssign(p.rowIndex, ds); if (mk==='〇'||mk==='□') c++; else break; } return c; })();
      const countNext = (()=>{ let c=0; for(let i=d+1;i<p.dates.length;i++){ const ds=dateStr(p.dates[i]); const mk=p.getAssign(p.rowIndex, ds); if (mk==='〇'||mk==='□') c++; else break; } return c; })();
      const total = countPrev + 1 + countNext;
      if (total > 5) return { ok:false, message:'日勤（〇/□）の連続は最大5日までです' };
    }

    // ★新規：休日と休日のインターバル≦5日（＝6連勤禁止）
    {
      const r = p.rowIndex;
      const isOffAt = (idx)=>{
        const ds = dateStr(p.dates[idx]);
        if (idx === p.dayIndex) {
          if (p.mark) return false;            // いま置こうとしている日は勤務扱い
        } else if (p.mark === '☆' && idx === p.dayIndex + 1) {
          return false;                        // ☆の翌日の仮★も勤務扱い
        }
        const mk  = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        return off || !mk;                     // 希望休 or 未割当 → 休
      };
      let streak = 0;
      for (let i = 0; i < p.dates.length; i++){
        if (isOffAt(i)) { streak = 0; }
        else {
          streak++;
          if (streak > 5){
            return { ok:false, message:'休日と休日のインターバルは5日以内にしてください（6連勤は不可）' };
          }
        }
      }
    }

    // ★追加：連休（…休休）と連休（休休…）の“間”≦13日（当日の仮置きを含めて判定）
    {
      const r = p.rowIndex;
      const isOffAt = (idx) => {
        const ds = dateStr(p.dates[idx]);
        // 当日を仮置き後として扱う（何かマークを置いたら“休”ではない）
        if (idx === p.dayIndex) {
          if (p.mark) return false;
        } else if (p.mark === '☆' && idx === p.dayIndex + 1) {
          // ☆の翌日は★が付くため“休”ではない
          return false;
        }
        const mk = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        return off || !mk; // 希望休 or 未割当 を“休”とみなす
      };

      // 連休（休が2日以上連続）ブロック抽出
      const blocks = [];
      let i = 0;
      while (i < p.dates.length){
        if (!isOffAt(i)) { i++; continue; }
        let start = i, len = 0;
        while (i < p.dates.length && isOffAt(i)) { len++; i++; }
        if (len >= 2) blocks.push([start, i-1]); // [開始, 終了]
      }
      // 隣接ブロック間の“間”を評価（次の開始 - 前の終了 - 1）
      for (let b = 0; b < blocks.length - 1; b++){
        const endPrev   = blocks[b][1];
        const startNext = blocks[b+1][0];
        const gap = startNext - endPrev - 1;
        if (gap > 13){
          return { ok:false, message:'連休（2日以上）と次の連休の間は13日以内にしてください' };
        }
      }
    }
    // ★新規：「遅出（□）」の翌日は勤務マーク禁止
    {
      const r = p.rowIndex;
      const idx = p.dayIndex;

      // 1) 前日が「□」なら当日の勤務マークは禁止
      if (p.mark){
        const prev = idx - 1;
        if (prev >= 0){
          const dsPrev = dateStr(p.dates[prev]);
          const mkPrev = p.getAssign(r, dsPrev);
          if (mkPrev === '□'){
            return { ok:false, message:'「□」の翌日には勤務マークを配置できません' };
          }
        }
      }

      // 2) 当日に「□」を置く場合、翌日は未割当であることを要求
      if (p.mark === '□'){
        const next = idx + 1;
        if (next < p.dates.length){
          const dsNext2 = dateStr(p.dates[next]);
          const mkNext = p.getAssign(r, dsNext2);
          if (mkNext){
            return { ok:false, message:'「□」の翌日は未割当にしてください（先に翌日の勤務マークを外してください）' };
          }
        }
      }
    }

// 「☆★」直後1日は休専用（配置禁止）
    // ※4週間で最低2回の二連休は別途チェック（validateWindow内）
    {
      const prev1 = p.dayIndex - 1;
      const prev2 = p.dayIndex - 2;
      const dsPrev1 = prev1>=0 ? dateStr(p.dates[prev1]) : null;
      const dsPrev2 = prev2>=0 ? dateStr(p.dates[prev2]) : null;
      const mkPrev1 = dsPrev1 ? p.getAssign(p.rowIndex, dsPrev1) : undefined;
      const mkPrev2 = dsPrev2 ? p.getAssign(p.rowIndex, dsPrev2) : undefined;
      const isAfterPair = (mkPrev2==='☆' && mkPrev1==='★'); // d = k+2（★の翌日）
      const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(p.rowIndex) || 'three') : 'three';
      if (isAfterPair && p.mark && wt !== 'night'){
        return { ok:false, message:'「☆★」の次の1日は必ず休（希望休または未割当）。配置できません' };
      }
    }

    // 36協定 4週間155時間（実労働）の上限チェック
    if (typeof global.countLast28Days === 'function'){
      try {
        const endDt = p.dates[d];
        const stats = global.countLast28Days(p.rowIndex, endDt);
        if (stats && typeof stats.workMinutes === 'number'){
          const limitMinutes = 155 * 60; // 4週155時間
          // 既存のマーク分を差し引き、今回のマークを仮置きした場合の総時間を計算
          const ds = dateStr(endDt);
          let currentMk = null;
          if (typeof p.getAssign === 'function'){
            currentMk = p.getAssign(p.rowIndex, ds) || null;
          }

          const state = global.State || {};
          const attrs = (state.employeesAttr && state.employeesAttr[p.rowIndex]) || {};

          const sd = global.ShiftDurations;
          const calcMinutes = (mk)=>{
            if (!mk) return 0;
            if (sd && typeof sd.getDurationForEmployee === 'function'){
              return Number(sd.getDurationForEmployee(attrs, mk) || 0);
            }
            if (sd && typeof sd.getDefaultForMark === 'function'){
              return Number(sd.getDefaultForMark(mk) || 0);
            }
            const fallback = {'〇':480,'☆':480,'★':480,'◆':240,'●':240};
            return fallback[mk] || 0;
          };

          const currentMin   = calcMinutes(currentMk);
          const candidateMin = calcMinutes(p.mark);
          const newTotal = stats.workMinutes - currentMin + candidateMin;

          if (newTotal > limitMinutes){
            // NS/NFの人数充足は絶対条件：夜勤帯の不足を埋める勤務は36協定より優先
            let mustKeepNightQuota = false;
            const isNightMark = (p.mark === '☆' || p.mark === '◆' || p.mark === '★' || p.mark === '●');
            if (isNightMark && typeof countForDay === 'function'){
              try {
                const dsDay = dateStr(p.dates[d]);

                const FIXED_NF2 = (window.Counts && typeof window.Counts.getFixedNF === 'function')
                  ? window.Counts.getFixedNF(dsDay)
                  : ((window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3);
                const FIXED_NS2 = (window.Counts && typeof window.Counts.getFixedNS === 'function')
                  ? window.Counts.getFixedNS(dsDay)
                  : ((window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3);

                // 当日の現状カウント（候補マークを置く前）
                const cntToday = countForDay(d, p.dates, p.employeeCount, p.getAssign);

                if ((p.mark === '☆' || p.mark === '◆') && cntToday.nf < FIXED_NF2){
                  mustKeepNightQuota = true;
                }
                if ((p.mark === '★' || p.mark === '●') && cntToday.ns < FIXED_NS2){
                  mustKeepNightQuota = true;
                }

                // 「☆」は翌日のNS（★）も埋めるため、翌日分の不足も確認
                if (p.mark === '☆' && d + 1 < p.dates.length){
                  const dsNext2 = dateStr(p.dates[d+1]);
                  const FIXED_NS_NEXT = (window.Counts && typeof window.Counts.getFixedNS === 'function')
                    ? window.Counts.getFixedNS(dsNext2)
                    : ((window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3);
                  const cntNext = countForDay(d+1, p.dates, p.employeeCount, p.getAssign);
                  if (cntNext.ns < FIXED_NS_NEXT){
                    mustKeepNightQuota = true;
                  }
                }
              } catch(e){
                // 夜勤帯充足判定での例外は無視し、従来通り36協定のみで判定
              }
            }

            if (!mustKeepNightQuota){
              return { ok:false, message:'4週間の実労働時間が155時間を超えるため、この勤務は配置できません' };
            }
          }
        }
      } catch(e){
        // 36協定チェックで例外が出ても、割り当て処理自体は継続させる

      }
    }

    return { ok:true };
  }




  // ---- 保存前：全日厳格検証（絶対条件） ----
  /**
   *  - 〇 >= 10
   *  - （☆＋◆） = 3
   *  - （★＋●） = 3
   */
   function validateWindow(p){
    const errors = [];
    for (let d = 0; d < p.dates.length; d++){
      const dt = p.dates[d];
      const ds = dateStr(dt);

      // その日の総数（〇, NF, NS）
      const cnt = countForDay(d, p.dates, p.employeeCount, p.getAssign);

      // 夜勤帯の固定値（絶対条件）：設定値に置換
      const FIXED_NF = (window.Counts && typeof window.Counts.getFixedNF === 'function')
        ? window.Counts.getFixedNF(ds)
        : ((window.Counts && Number.isInteger(window.Counts.FIXED_NF)) ? window.Counts.FIXED_NF : 3);
      const FIXED_NS = (window.Counts && typeof window.Counts.getFixedNS === 'function')
        ? window.Counts.getFixedNS(ds)
        : ((window.Counts && Number.isInteger(window.Counts.FIXED_NS)) ? window.Counts.FIXED_NS : 3);
      if (cnt.nf !== FIXED_NF) errors.push({ dayIndex:d, type:'NF', expected:FIXED_NF, actual:cnt.nf });
      if (cnt.ns !== FIXED_NS) errors.push({ dayIndex:d, type:'NS', expected:FIXED_NS, actual:cnt.ns });

      // 追加：『〇』人数（固定＝未使用）→ 平日：最低値 / 土日祝：許容リスト
      const fx = (typeof p.getFixedDayCount === 'function') ? p.getFixedDayCount(ds) : null;

      if (Number.isInteger(fx)) {
        if (cnt.day !== fx) {
          errors.push({ dayIndex:d, type:'DAY_EQ', expected: fx, actual: cnt.day });
        }
      } else {
        const isWkEndOrHol = ((dt.getDay() === 0 || dt.getDay() === 6) || (p.isHoliday && p.isHoliday(ds)));
        if (isWkEndOrHol){
          const target = (window.Counts && typeof window.Counts.getDayTarget === 'function')
            ? window.Counts.getDayTarget(dt, p.isHoliday)
            : 6;
          if (cnt.day !== target){
            errors.push({ dayIndex:d, type:'DAY_WKD_ALLOWED', expected:String(target), actual:cnt.day });
          }
        } else {
          const target = (window.Counts && typeof window.Counts.getDayTarget === 'function')
            ? window.Counts.getDayTarget(dt, p.isHoliday)
            : 16;
          if (cnt.day !== target) {
            errors.push({ dayIndex:d, type:'DAY_ALLOWED', expected:String(target), actual:cnt.day });
          }
        }
      }


// ★新規：同一日の夜勤専従は最大2名まで（NF帯・NS帯それぞれ）
      const nightOnlyNF = countNightOnlyWorkers({ 
        dates: p.dates, 
        employeeCount: p.employeeCount,
        getAssign: p.getAssign,
        getWorkType: p.getWorkType
      }, d, 'NF');
      
      const nightOnlyNS = countNightOnlyWorkers({ 
        dates: p.dates, 
        employeeCount: p.employeeCount,
        getAssign: p.getAssign,
        getWorkType: p.getWorkType
      }, d, 'NS');

      if (nightOnlyNF > 2) {
        errors.push({ dayIndex: d, type: 'NIGHT_ONLY_NF_MAX2', expected: '<=2', actual: nightOnlyNF });
      }
      if (nightOnlyNS > 2) {
        errors.push({ dayIndex: d, type: 'NIGHT_ONLY_NS_MAX2', expected: '<=2', actual: nightOnlyNS });
      }




      // 各帯にレベルAが必ず存在 & 夜勤専従のみの帯を禁止（〇帯 / NF帯 / NS帯）
      let hasADay=false, hasANf=false, hasANs=false;
      let hasNonNightDay=false, hasNonNightNf=false, hasNonNightNs=false;
      let countDay=0, countNf=0, countNs=0;
      
      for (let r=0; r<p.employeeCount; r++){
        const mk = p.getAssign(r, ds);
        const lv = (typeof p.getLevel === 'function') ? p.getLevel(r) : 'B';
        const wt = (typeof p.getWorkType === 'function') ? p.getWorkType(r) : 'three';
        const isA = (lv === 'A');
        const isNonNight = (wt !== 'night');
        
        if (!mk) continue;
        
        if (mk === '〇' || mk === '□'){
          countDay++;
          if (isA) hasADay = true;
          if (isNonNight) hasNonNightDay = true;
        }
        if (mk === '☆' || mk === '◆'){
          countNf++;
          if (isA) hasANf = true;
          if (isNonNight) hasNonNightNf = true;
        }
        if (mk === '★' || mk === '●'){
          countNs++;
          if (isA) hasANs = true;
          if (isNonNight) hasNonNightNs = true;
        }
      }
      
      // Aレベル必須チェック（人が配置されている帯のみ）
      if (countDay > 0 && !hasADay) errors.push({ dayIndex:d, type:'A_DAY', expected:'>=1', actual:0 });
      if (countNf > 0 && !hasANf)  errors.push({ dayIndex:d, type:'A_NF',  expected:'>=1', actual:0 });
      if (countNs > 0 && !hasANs)  errors.push({ dayIndex:d, type:'A_NS',  expected:'>=1', actual:0 });
      
      // 夜勤専従のみの帯を禁止（各帯に最低1人は非夜勤専従が必要）（人が配置されている帯のみ）
      if (countDay > 0 && !hasNonNightDay) errors.push({ dayIndex:d, type:'NEED_NON_NIGHT_DAY', expected:'>=1 non-night', actual:0 });
      if (countNf > 0 && !hasNonNightNf)  errors.push({ dayIndex:d, type:'NEED_NON_NIGHT_NF',  expected:'>=1 non-night', actual:0 });
      if (countNs > 0 && !hasNonNightNs)  errors.push({ dayIndex:d, type:'NEED_NON_NIGHT_NS',  expected:'>=1 non-night', actual:0 });
    }

   // ★追加：帯内の禁止組成「A・C・夜勤専従」の同席（NF/NS）を日ごとに検証
    for (let d2 = 0; d2 < p.dates.length; d2++){
      const ds = dateStr(p.dates[d2]);
      const nfRows = [], nsRows = [];
      for(let r=0;r<p.employeeCount;r++){
        const mk = p.getAssign(r, ds);
        if (mk==='☆' || mk==='◆') nfRows.push(r);
        if (mk==='★' || mk==='●') nsRows.push(r);
      }
      const getLv = (i)=> (typeof p.getLevel==='function' ? (p.getLevel(i)||'B') : 'B');
      const getWk = (i)=> (typeof p.getWorkType==='function' ? (p.getWorkType(i)||'three') : 'three');
      const nfHasA  = nfRows.some(i=> getLv(i)==='A');
      const nfHasC  = nfRows.some(i=> getLv(i)==='C');
      const nfHasNi = nfRows.some(i=> getWk(i)==='night');
      if (nfHasA && nfHasC && nfHasNi){
        errors.push({ dayIndex:d2, type:'BAND_AC_NIGHT', band:'NF' });
      }
      const nsHasA  = nsRows.some(i=> getLv(i)==='A');
      const nsHasC  = nsRows.some(i=> getLv(i)==='C');
      const nsHasNi = nsRows.some(i=> getWk(i)==='night');
      if (nsHasA && nsHasC && nsHasNi){
        errors.push({ dayIndex:d2, type:'BAND_AC_NIGHT', band:'NS' });
      }
    }


// 追加：勤務形態の絶対制約（夜勤専従＝☆★のみ、日勤専従＝全マーク許容〈お試し運用〉）
{
  for (let r = 0; r < p.employeeCount; r++){
    const wt = (typeof p.getWorkType === 'function')
      ? (p.getWorkType(r) || 'three')
      : 'three';
    const allow = (function(){
      if (wt === 'day')   return new Set(['〇','☆','★','◆','●']); // お試し夜勤を許容
      if (wt === 'night') return new Set(['☆','★']);
      if (wt === 'two')   return new Set(['〇','☆','★']);
      return new Set(['〇','◆','●']); // three
    })();

    for (let d = 0; d < p.dates.length; d++){
      const ds = dateStr(p.dates[d]);
      const mk = p.getAssign(r, ds);
      if (!mk) continue; // 未割当は対象外
      if (!allow.has(mk)){
        const type = (wt==='day') ? 'WT_DAY_ONLY' :
                     (wt==='night') ? 'WT_NIGHT_ONLY' : 'WT_MISMATCH';
        errors.push({ rowIndex:r, dayIndex:d, type, expected:[...allow].join(','), actual:mk });
      }
    }
  }
}



// 追加：各職員の連続〇と直後休みの厳格検証
    for (let r = 0; r < p.employeeCount; r++){
      let d = 0;
      while (d < p.dates.length){
        // 日勤（〇/□）の連続長を測る
        const start = d;
        let run = 0;
        while (d < p.dates.length){
          const ds = dateStr(p.dates[d]);
          const mk = p.getAssign(r, ds);
          if (mk === '〇' || mk === '□') { run++; d++; } else break;
        }
        if (run > 0){
          // 日勤連続≦5
          if (run > 5){
            errors.push({ rowIndex:r, dayIndex:(start + run - 1), type:'DAY_STREAK_GT5', expected:'<=5', actual:run });
          }
          // 5連続 → 直後2休（未割当 or 希望休）
          if (run === 5){
            const rest1 = start + run;
            const rest2 = rest1 + 1;
            let ok2 = 0;
            const isRest = (idx)=>{
              if (idx >= p.dates.length) return false;
              const ds = dateStr(p.dates[idx]);
              const mk = p.getAssign(r, ds);
              const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
              return off || !mk;
            };
            if (isRest(rest1)) ok2++;
            if (isRest(rest2)) ok2++;
            if (ok2 < 2){
              errors.push({ rowIndex:r, dayIndex:rest1, type:'DAY_REST_AFTER5', expected:'>=2', actual:ok2 });
            }
          }
        }
        // 次の位置へ
        d = (run > 0) ? d : d + 1;
      }
    }
    // 隣接禁止パターン「◆→〇」「◆→□」
    for (let r = 0; r < p.employeeCount; r++){
      for (let d = 0; d < p.dates.length - 1; d++){
        const ds = dateStr(p.dates[d]);
        const dsN = dateStr(p.dates[d+1]);
        const mk  = p.getAssign(r, ds);
        const mkN = p.getAssign(r, dsN);
        if (mk === '◆' && (mkN === '〇' || mkN === '□')){
          errors.push({ rowIndex:r, dayIndex:d, type:'SEQ_NF_DAY', expected:'(休 or 非日勤)', actual:`◆→${mkN}` });
        }
      }
    }
    // 「遅出（□）」の翌日は勤務マーク禁止
    for (let r = 0; r < p.employeeCount; r++){
      for (let d = 0; d < p.dates.length - 1; d++){
        const ds  = dateStr(p.dates[d]);
        const dsN = dateStr(p.dates[d+1]);
        const mk  = p.getAssign(r, ds);
        const mkN = p.getAssign(r, dsN);
        if (mk === '□' && mkN){
          errors.push({ rowIndex:r, dayIndex:d+1, type:'LATE_NEXT_DAY_EMPTY', expected:'no mark', actual:mkN });
        }
      }
    }

    // NG「◆→●」（☆★と同義のため禁止）
    for (let r = 0; r < p.employeeCount; r++){
      for (let d = 0; d < p.dates.length - 1; d++){
        const ds  = dateStr(p.dates[d]);
        const dsN = dateStr(p.dates[d+1]);
        const mk  = p.getAssign(r, ds);
        const mkN = p.getAssign(r, dsN);
        if (mk === '◆' && mkN === '●'){
          errors.push({ rowIndex:r, dayIndex:d, type:'SEQ_NF_NS', expected:'NG', actual:'◆→●' });
        }
      }
    }
// 「★★」の並びを禁止
for (let r = 0; r < p.employeeCount; r++){
  for (let d = 0; d < p.dates.length - 1; d++){
    const ds  = dateStr(p.dates[d]);
    const dsN = dateStr(p.dates[d+1]);
    const mk  = p.getAssign(r, ds);
    const mkN = p.getAssign(r, dsN);
    if (mk === '★' && mkN === '★'){
      errors.push({ 
        rowIndex: r, 
        dayIndex: d, 
        type: 'SEQ_STAR_STAR', 
        expected: 'NG', 
        actual: '★→★' 
      });
    }
  }
}



    // 「●→◆」は月内2回まで & インターバル≧3日
    for (let r = 0; r < p.employeeCount; r++){
      const starts = [];
      for (let d = 0; d < p.dates.length - 1; d++){
        const ds  = dateStr(p.dates[d]);
        const dsN = dateStr(p.dates[d+1]);
        const mk  = p.getAssign(r, ds);
        const mkN = p.getAssign(r, dsN);
        if (mk === '●' && mkN === '◆') starts.push(d);
      }
      if (starts.length > 2){
        errors.push({ rowIndex:r, dayIndex:starts[2], type:'SEQ_NS_NF_MAX2', expected:'<=2', actual: starts.length });
      }
      for (let i = 0; i < Math.max(0, starts.length - 1); i++){
        const gap = starts[i+1] - (starts[i] + 1);
        if (gap < 3){
          errors.push({ rowIndex:r, dayIndex:starts[i+1], type:'SEQ_NS_NF_GAP', expected:'>=3', actual: gap });
        }
      }
    }

    // ☆★ペア間隔（勤務形態で可変）
//   night: >=0日 / others: >=3日
    for (let r = 0; r < p.employeeCount; r++){
      const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(r) || 'three') : 'three';
      const pairGapMinDays = (wt === 'night') ? 0 : 3;
      const idxDiffMin = pairGapMinDays + 1;

      let lastEnd = null; // 直近ペアの★インデックス
      for (let d = 0; d < p.dates.length - 1; d++){
        const ds  = dateStr(p.dates[d]);
        const dsN = dateStr(p.dates[d+1]);
        const mk  = p.getAssign(r, ds);
        const mkN = p.getAssign(r, dsN);
      if (mk === '☆' && mkN === '★'){
        if (lastEnd != null && (d - lastEnd) < idxDiffMin){
          // 実際の“間”の日数＝(d - lastEnd - 1)
          errors.push({ rowIndex:r, dayIndex:d, type:'PAIR_GAP_GE3', expected:`>=${pairGapMinDays}`, actual:(d - lastEnd - 1) });
        }
        lastEnd = d + 1;
      }
    }
  }

  // 夜勤専従の連続ペア≦2（「☆★☆★☆★」禁止）
  for (let r = 0; r < p.employeeCount; r++){
    const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(r) || 'three') : 'three';
    if (wt !== 'night') continue;
    let consec = 0;
    let lastEnd = null; // 直近ペアの★インデックス
    for (let d = 0; d < p.dates.length - 1; d++){
      const ds  = dateStr(p.dates[d]);
      const dsN = dateStr(p.dates[d+1]);
      const mk  = p.getAssign(r, ds);
      const mkN = p.getAssign(r, dsN);
      if (mk === '☆' && mkN === '★'){
        // 直前のペア終端（★）の翌日から始まっていれば“連続”
        consec = (lastEnd != null && d === lastEnd + 1) ? (consec + 1) : 1;
        if (consec > 2){
          errors.push({ rowIndex:r, dayIndex:d, type:'NIGHT_CONSEC_PAIR_LE2', expected:'<=2', actual:consec });
        }
        lastEnd = d + 1;
      }
    }
  }

// 「☆★」の次の1日は休（希望休 or 未割当）必須
  // ※4週間で最低2回の二連休は RENKYU_MIN2 でチェック

    for (let r = 0; r < p.employeeCount; r++){
      for (let d = 0; d < p.dates.length - 2; d++){
        const ds0 = dateStr(p.dates[d]);
        const ds1 = dateStr(p.dates[d+1]);
if (p.getAssign(r, ds0) === '☆' && p.getAssign(r, ds1) === '★'){
  const wt = (typeof p.getWorkType === 'function') ? (p.getWorkType(r) || 'three') : 'three';
  const ds2 = dateStr(p.dates[d+2]);
  const mk2 = p.getAssign(r, ds2);
  const off2 = (typeof p.hasOffByDate==='function') ? p.hasOffByDate(r, ds2) : false;
  const isRest2 = off2 || !mk2;
  if (wt !== 'night' && !isRest2){
    errors.push({ rowIndex:r, dayIndex:d, type:'SEQ_STAR_AFTER_REST1', expected:'休', actual:`${mk2||'休'}` });
  }
}

      }
    }

    // 単一休みは連続二回まで（「休」1日のブロックが3連続以上を禁止）
    for (let r = 0; r < p.employeeCount; r++){
      let consecSingles = 0;
      let d = 0;
      const isOffAt = (idx) => {
        const ds = dateStr(p.dates[idx]);
        const mk = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        // 休（希望休）または未割当を“休”と扱う
        return off || !mk;
      };
      while (d < p.dates.length){
        if (!isOffAt(d)) { d++; continue; }
        // 休ブロック長を計測
        let len = 0;
        while (d < p.dates.length && isOffAt(d)) { len++; d++; }
        if (len === 1){
          consecSingles++;
          if (consecSingles > 2){
            errors.push({
              rowIndex: r,
              dayIndex: d-1,
              type: 'OFF_SINGLE_STREAK_GT2',
              expected: '<=2',
              actual: consecSingles
            });
          }
        } else {
          // 連休(2日以上)が入ればリセット
          consecSingles = 0;
        }
      }
    }

    // 休日と休日のインターバル≦5（＝6連勤禁止）
    for (let r = 0; r < p.employeeCount; r++){
      let streak = 0;
      for (let d = 0; d < p.dates.length; d++){
        const ds = dateStr(p.dates[d]);
        const mk = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        const isOff = off || !mk;
        if (isOff) { streak = 0; }
        else {
          streak++;
          if (streak > 5){
            errors.push({ rowIndex:r, dayIndex:d, type:'WORK_STREAK_GT5', expected:'<=5', actual:streak });
          }
        }
      }
    }

    // 連休（…休休）と連休（休休…）の“間”≦13日（31日窓内で2ブロック以上ある場合のみ）
    for (let r = 0; r < p.employeeCount; r++){
      const blocks = [];
      let i = 0;
      const isOffAt2 = (idx) => {
        const ds = dateStr(p.dates[idx]);
        const mk = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        return off || !mk;
      };
      while (i < p.dates.length){
        if (!isOffAt2(i)) { i++; continue; }
        let start = i, len = 0;
        while (i < p.dates.length && isOffAt2(i)) { len++; i++; }
        if (len >= 2) blocks.push([start, i-1]);
      }
      for (let b = 0; b < blocks.length - 1; b++){
        const endPrev   = blocks[b][1];
        const startNext = blocks[b+1][0];
        const gap = startNext - endPrev - 1;
        if (gap > 13){
          errors.push({
            rowIndex: r,
            dayIndex: startNext,
            type: 'RENKYU_GAP_LEQ13',
            expected: '<=13',
            actual: gap
          });
        }
      }
    }

    // 連休（2日以上の“休”連続）を各職員で月2回以上（31日窓）必須
    for (let r = 0; r < p.employeeCount; r++){
      const blocks = [];
      let i = 0;
      const isOffAt = (idx) => {
        const ds = dateStr(p.dates[idx]);
        const mk = p.getAssign(r, ds);
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        return off || !mk; // 希望休 or 未割当 を“休”と扱う
      };
      while (i < p.dates.length){
        if (!isOffAt(i)) { i++; continue; }
        let start = i, len = 0;
        while (i < p.dates.length && isOffAt(i)) { len++; i++; }
        if (len >= 2) blocks.push([start, i-1]);
      }
      if (blocks.length < 2){
        errors.push({
          rowIndex: r,
          dayIndex: 0,
          type: 'RENKYU_MIN2',
          expected: '>=2',
          actual: blocks.length
        });
      }
    }

    // 全従業員の4週8休（±1許容）を厳格チェック
    for (let r = 0; r < p.employeeCount; r++){
      // 4週間の休日数を集計
      let offCount = 0;
      for (let d = 0; d < p.dates.length && d < 28; d++){
        const ds = dateStr(p.dates[d]);
        const mk = p.getAssign(r, ds);
        const hasLv = (typeof p.getLeaveType === 'function') ? !!p.getLeaveType(r, ds) : false;
        const off = (typeof p.hasOffByDate === 'function') ? p.hasOffByDate(r, ds) : false;
        // 特別休暇がある日は休日扱いしない（勤務日としてカウント）
        const isRest = (off || !mk) && !hasLv;
        if (isRest) offCount++;
      }

      // ★始まり/☆終わりを判定
      const dsStart = dateStr(p.dates[0]);
      const dsEnd = dateStr(p.dates[Math.min(27, p.dates.length - 1)]);
      const mkStart = p.getAssign(r, dsStart);
      const mkEnd = p.getAssign(r, dsEnd);
      const starStart = (mkStart === '★');
      const starEnd = (mkEnd === '☆');

      let base = 8;
      if (starStart && !starEnd) base = 7;
      else if (!starStart && starEnd) base = 9;

      const minOff = Math.max(7, base - 1);
      const maxOff = Math.min(9, base + 1);

      if (offCount < minOff || offCount > maxOff){
        errors.push({
          rowIndex: r,
          dayIndex: 0,
          type: 'OFF_COUNT_4W8REST',
          expected: `${minOff}〜${maxOff}`,
          actual: offCount
        });
      }
    }

    return { ok: errors.length === 0, errors };
  }


  global.AssignRules = { canAssign, precheckPlace, validateWindow };
})(window);
