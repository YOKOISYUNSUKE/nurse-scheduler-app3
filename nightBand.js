/* nightBand.js - 夜勤帯の確認と候補抽出（副作用なし） */
;(function (global) {
  function pad2(n){ return String(n).padStart(2,'0'); }
  function dateStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

  // その日の集計（〇, NF, NS と A存在の帯別有無）
  function countDayStats(ctx, dayIdx){
    let day=0, nf=0, ns=0;
    let hasADay=false, hasANf=false, hasANs=false;
    const ds = dateStr(ctx.dates[dayIdx]);
    for(let r=0; r<ctx.employeeCount; r++){
      const mk = ctx.getAssign(r, ds);
      const isA = (ctx.getEmpAttr(r)?.level) === 'A';
      if (mk === '〇'){ day++; if (isA) hasADay = true; }
      if (mk === '☆' || mk === '◆'){ nf++; if (isA) hasANf = true; }

      // NS＝当日の「★ or ●」。★未反映の旧データ対策として前日の☆もフォールバックで許容
      const prevDate = new Date(ctx.dates[dayIdx].getFullYear(), ctx.dates[dayIdx].getMonth(), ctx.dates[dayIdx].getDate() - 1);
      const prevDs = dateStr(prevDate);
      const prevMk = ctx.getAssign(r, prevDs);
      const nsHit = (mk === '★' || mk === '●' || prevMk === '☆');
      if (nsHit){ ns++; if (isA) hasANs = true; }

    }
    return { day, nf, ns, hasADay, hasANf, hasANs };
  }



  // 4週間ウィンドウ内の夜勤実績
  function countNightStatsForEmp(ctx, r, startIdx, endIdx){
    let star=0, half=0; // star=☆の数（＝☆★ペア数）、half=◆+●
    for(let d=startIdx; d<=endIdx; d++){
      const ds = dateStr(ctx.dates[d]);
      const mk = ctx.getAssign(r, ds);
      if (mk === '☆') star++;
      if (mk === '◆' || mk === '●') half++;
    }
    return { star, half };
  }

  // 夜勤回数の不足度スコア（大きいほど優先／-Infinity は候補除外）
  function quotaDeficit(ctx, r, mark, startIdx, endIdx){
    const wt = (ctx.getEmpAttr(r)?.workType) || 'three';
    const { star, half } = countNightStatsForEmp(ctx, r, startIdx, endIdx);
    if (mark === '☆' || mark === '★'){
      if (wt === 'night'){
        // ★修正：個別の夜勤ノルマを参照（未設定なら10）
        const quota = ctx.getEmpAttr(r)?.nightQuota || 10;
        if (star >= quota) return -Infinity; // 目標に到達したら候補から外す
        return 100 + (quota - star);         // ノルマまで強く優先
      }
      if (wt === 'two'){
        if (star >= 4) return -Infinity;
        return 100 + (4 - star);
      }
      return -Infinity; // other は安全側で除外
    }
    if (mark === '◆' || mark === '●'){
      if (wt !== 'three') return -Infinity;
      if (half >= 8) return -Infinity; // 三部制：4週間で◆+●≦8
      return 100 + (8 - half);
    }
    return 0; // 〇などは対象外
  }


  // 勤務形態の優先（☆/★: night→two→他、◆/●: three→他）
  function _orderByWorkType(ctx, list, mark){
    const wtOf = (r)=> (ctx.getEmpAttr(r)?.workType)||'three';
    if (mark==='☆' || mark==='★'){
      const night=[], two=[], other=[];
      list.forEach(r=>{ const wt=wtOf(r); (wt==='night'?night : wt==='two'?two : other).push(r); });
      return night.concat(two, other);
    }
    if (mark==='◆' || mark==='●'){
      const three=[], other=[];
      list.forEach(r=>{ const wt=wtOf(r); (wt==='three'?three : other).push(r); });
      return three.concat(other);
    }
    return list;
  }

  // ★追加：帯と属性を見て「A＋C＋夜勤専従」同席を避けるためのペナルティ
  function _bandOf(mark){ return (mark==='☆'||mark==='◆') ? 'NF' : (mark==='★'||mark==='●') ? 'NS' : null; }
  function _bandRows(ctx, dayIdx, band){
    const ds = dateStr(ctx.dates[dayIdx]);
    const rows = [];
    for (let r=0; r<ctx.employeeCount; r++){
      const mk = ctx.getAssign(r, ds);
      if (band==='NF' && (mk==='☆' || mk==='◆')) rows.push(r);
      if (band==='NS' && (mk==='★' || mk==='●')) rows.push(r);
    }
    return rows;
  }
  function _flags(ctx, rows){
    let hasA=false, hasC=false, hasNi=false;
    for (const r of rows){
      const attr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
      if (attr.level==='A') hasA = true;
      if (attr.level==='C') hasC = true;
      if ((attr.workType||'three')==='night') hasNi = true;
    }
    return { hasA, hasC, hasNi };
  }
  // 置いたと仮定した場合のペナルティ（大きいほど不利：負値）
  function acNightPenalty(ctx, dayIdx, mark, r){
    const band = _bandOf(mark);
    if (!band) return 0;

    // 当日：対象帯で三者同席が成立するなら強ペナルティ
    const rowsToday = _bandRows(ctx, dayIdx, band).concat([r]);
    const f1 = _flags(ctx, rowsToday);
    const p1 = (f1.hasA && f1.hasC && f1.hasNi) ? -900 : 0;

    // ☆は翌日★を伴うので、翌日のNS帯で三者同席成立なら中ペナルティ
    let p2 = 0;
    if (mark==='☆'){
      const nextIdx = dayIdx + 1;
      if (nextIdx < ctx.dates.length){
        const rowsNS = _bandRows(ctx, nextIdx, 'NS').concat([r]);
        const f2 = _flags(ctx, rowsNS);
        if (f2.hasA && f2.hasC && f2.hasNi) p2 = -700;
      }
    }
    return p1 + p2;
  }

  // 乱数（線形合同法）とシード設定
  let _seed = 1;
  let _randAmp = 0.49;                   // ← 既定の振れ幅（従来値互換）
  function setSeed(v){ _seed = (v>>>0) || 1; }
  function setRandAmp(a){                // ← 外部から振れ幅を変更
    const x = Number(a);
    _randAmp = Number.isFinite(x) && x >= 0 ? x : _randAmp;
  }
  function _rand(){                      // 0 <= x < 1
    _seed = (_seed * 1664525 + 1013904223) >>> 0;
    return (_seed >>> 0) / 4294967296;
  }

  // 候補抽出（空き・希望休なし・勤務形態OK）→不足度でソート（微小ゆらぎ）→勤務形態優先→公平ローテ
  function candidatesFor(ctx, dayIdx, mark){
    const ds = dateStr(ctx.dates[dayIdx]);
    const startIdx = ctx.range4wStart;
    const endIdx   = ctx.range4wStart + 27;

    let out = [];
    for(let r=0; r<ctx.employeeCount; r++){
      if (ctx.getAssign(r, ds)) continue;
      if (ctx.hasOffByDate(r, ds)) continue;
      const empAttr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
      const ok = global.AssignRules?.canAssign?.({ empAttr, mark }) || { ok:true };
      if (!ok.ok) continue;
      out.push(r);
    }

// 追加：この4週で“置ける見込みの☆”を概算（前日空き・翌日空き・希望休なし・canAssign可）
function _potentialStars(ctx, r, startIdx, endIdx){
  let pot = 0;
  for(let d=startIdx; d<Math.min(endIdx, ctx.dates.length-1); d++){
    const ds = ctx.dates[d], dsNext = ctx.dates[d+1];
    if (ctx.getAssign(r, ds) || ctx.getAssign(r, dsNext)) continue;
    if (ctx.hasOffByDate(r, ds) || ctx.hasOffByDate(r, dsNext)) continue;
    const empAttr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
    const ok = global.AssignRules?.canAssign?.({ empAttr, mark:'☆' }) || { ok:true };
    if (ok.ok) pot++;
  }
  return pot;
}

// 夜専の不足度に“危険度”を加点
out = out
  .map(r => {
    const base = quotaDeficit(ctx, r, mark, startIdx, endIdx);
    if (base === -Infinity) return { r, score: -Infinity };
    let riskBoost = 0;
    if (mark === '☆') {
      const attr = ctx.getEmpAttr(r) || { workType:'three' };
      if (attr.workType === 'night'){
        const stat = countNightStatsForEmp(ctx, r, startIdx, endIdx); // 既存の☆等カウント関数を想定
        // ★修正：個別の夜勤ノルマを参照（未設定なら10）
        const quota = attr.nightQuota || 10;
        const need = Math.max(0, quota - stat.star);
        const pot  = _potentialStars(ctx, r, startIdx, endIdx);
        if (need > 0){
          // 見込み不足があるほど強く押し上げる（最小でも+120、完全不足は+400）
          riskBoost = (pot === 0) ? 400 : Math.min(300, Math.ceil((need / Math.max(1,pot)) * 120));
        }
      }
    }

    // 土日祝公平化：当該日が土日祝なら、直近4週間の土日祝勤務が少ない人を優先
    const isWeekend = (dt)=> dt.getDay()===0 || dt.getDay()===6;
    const isHoliday = (ds)=> (typeof ctx.isHolidayDs === 'function') ? !!ctx.isHolidayDs(ds) : false;
    const isWH = (idx)=> { const dt = ctx.dates[idx]; const ds = dateStr(dt); return isWeekend(dt) || isHoliday(ds); };
    const whCount28 = (r)=> {
      let c=0;
      for (let i=startIdx; i<=endIdx; i++){
        if (!isWH(i)) continue;
        const ds2 = dateStr(ctx.dates[i]);
        const mk2 = ctx.getAssign(r, ds2);
        if (mk2==='〇' || mk2==='☆' || mk2==='★' || mk2==='◆' || mk2==='●') c++;
      }
      return c;
    };
    // ★修正：土日祈日公平化の重みを強化（Aボーナスと同程度）
    const FAIR_W = 5.0;
    const fair = isWH(dayIdx) ? (- whCount28(r) * FAIR_W) : 0;

const pen  = acNightPenalty(ctx, dayIdx, mark, r);
const jitter = (_rand() - 0.5) * _randAmp;
// ★追加：A属性にボーナスを付与（各帯に必須のため優先度を上げる）
const attr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
const aBonus = (attr.level === 'A') ? 50 : 0;
return { r, score: base + riskBoost + fair + pen + aBonus + jitter };

  })
  .filter(x => x.score !== -Infinity)
  .sort((a, b) => b.score - a.score)
  .map(x => x.r);


    // 勤務形態の優先度は維持（夜勤専従をグループ先頭のまま）
    out = _orderByWorkType(ctx, out, mark);

    // ★削除：公平ローテは土日祈日公平化と競合するため削除
    // （スコアソートで公平性が確保される）

    return out;
  }


    // 4週間の夜勤ノルマ充足判定
    function nightQuotasOK(ctx, startIdx, endIdx){
      for (let r = 0; r < ctx.employeeCount; r++){
        const wt = (ctx.getEmpAttr(r)?.workType) || 'three';
        const { star, half } = countNightStatsForEmp(ctx, r, startIdx, endIdx);
        if (wt === 'night'){
          // ★修正：個別の夜勤ノルマを参照（未設定なら10）
          const quota = ctx.getEmpAttr(r)?.nightQuota || 10;
          const minQuota = Math.max(0, quota - 2); // 下限はノルマ-2
          if (star < minQuota || star > quota) return false;
        } else if (wt === 'two'){
          if (star < 4) return false; // 二部制：4週間で☆≦4（下限も4）
        } else { // three
          if (half < 8) return false; // 三部制：4週間で◆+●≦8（下限も8）
        }
      }
      return true;
    }


global.NightBand = { countDayStats, candidatesFor, nightQuotasOK, setSeed, setRandAmp };
})(window);

