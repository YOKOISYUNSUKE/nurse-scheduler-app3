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
      if (mk === '〇' || mk === '□'){ day++; if (isA) hasADay = true; }
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
  // 三部制の◆のみカウント
  function countNfForEmp(ctx, r, startIdx, endIdx){
    let count = 0;
    for(let d=startIdx; d<=endIdx; d++){
      const ds = dateStr(ctx.dates[d]);
      const mk = ctx.getAssign(r, ds);
      if (mk === '◆') count++;
    }
    return count;
  }

  // 三部制の●のみカウント
  function countNsForEmp(ctx, r, startIdx, endIdx){
    let count = 0;
    for(let d=startIdx; d<=endIdx; d++){
      const ds = dateStr(ctx.dates[d]);
      const mk = ctx.getAssign(r, ds);
      if (mk === '●') count++;
    }
    return count;
  }

  // 夜勤回数の不足度スコア（大きいほど優先／-Infinity は候補除外）
  function quotaDeficit(ctx, r, mark, startIdx, endIdx){
    const wt = (ctx.getEmpAttr(r)?.workType) || 'three';
    const { star, half } = countNightStatsForEmp(ctx, r, startIdx, endIdx);
    if (mark === '☆' || mark === '★'){
      if (wt === 'night'){
        // 夜勤専従：個別の夜勤ノルマを参照（未設定なら10）
        const quota = ctx.getEmpAttr(r)?.nightQuota || 10;
        if (star >= quota) return -Infinity;
        return 100 + (quota - star);
      }
      if (wt === 'two'){
        // 二部制も個別の☆回数を参照（未設定なら4）
        const quota = ctx.getEmpAttr(r)?.twoShiftQuota || 4;
        if (star >= quota) return -Infinity;
        return 100 + (quota - star) * 20;  
      }
      return -Infinity;
    }
if (mark === '◆' || mark === '●'){
  if (wt !== 'three') return -Infinity;
  
  // 三部制も個別の◆/●回数を参照
  if (mark === '◆') {
    const nfQuota = ctx.getEmpAttr(r)?.threeShiftNfQuota ?? 5;
    const nfCount = countNfForEmp(ctx, r, startIdx, endIdx);
    if (nfCount >= nfQuota) return -Infinity;
    return 100 + (nfQuota - nfCount) * 20;
  }
  if (mark === '●') {
    const nsQuota = ctx.getEmpAttr(r)?.threeShiftNsQuota ?? 5;
    const nsCount = countNsForEmp(ctx, r, startIdx, endIdx);
    if (nsCount >= nsQuota) return -Infinity;
    return 100 + (nsQuota - nsCount) * 20;
  }
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


  // 二部制・三部制の夜勤間隔スコア（夜勤専従は対象外）
  function nightSpacingScore(ctx, dayIdx, mark, r){
    const attr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
    const wt = attr.workType || 'three';
    let groupMarks = null;

    // 二部制：☆★の間隔を均一化（夜勤専従は除外）
    if (wt === 'two' && (mark === '☆' || mark === '★')){
      groupMarks = ['☆','★'];
    }
    // 三部制：◆●の間隔を均一化
    else if (wt === 'three' && (mark === '◆' || mark === '●')){
      groupMarks = ['◆','●'];
    } else {
      // 夜勤専従や対象外の勤務形態はスコア0
      return 0;
    }

    const startIdx = ctx.range4wStart;
    const endIdx   = Math.min(ctx.range4wStart + 27, ctx.dates.length - 1);

    // これまでの同種夜勤の位置と件数
    let lastIdx = -1;
    let count = 0;
    for (let i = startIdx; i <= endIdx; i++){
      const ds2 = dateStr(ctx.dates[i]);
      const mk2 = ctx.getAssign(r, ds2);
      if (groupMarks.includes(mk2)){
        count++;
        if (i < dayIdx) lastIdx = i;
      }
    }

    // まだ一度も入っていない人には少しボーナス
    if (count === 0 && lastIdx === -1){
      return 15;
    }

    // 直近の夜勤からの間隔
    const interval = (lastIdx === -1) ? (dayIdx - startIdx + 1) : (dayIdx - lastIdx);
    if (interval <= 0) return -40; // 同日・逆行するようなケースは強く抑制

    // この4週における理想的な間隔（今置く分も含めた件数で割る）
    const windowLen = endIdx - startIdx + 1;
    const futureCount = count + 1;
    if (futureCount <= 0) return 0;
    const ideal = windowLen / futureCount;

    const diff = Math.abs(interval - ideal);

    // 差が大きいほど不利にする（最大でも数十点程度の影響に抑える）
    const INTERVAL_W = 4;
    let score = - diff * INTERVAL_W;

    // 極端に短い間隔（理想の半分未満）は追加ペナルティ
    if (interval < ideal * 0.5){
      score -= 40;
    }

    return score;
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

  // スコアに応じた「重み付きランダム順」（ソフトマックス風）
  function _softmaxOrderByScore(items){
    if (!Array.isArray(items) || items.length <= 1){
      return Array.isArray(items) ? items.slice() : [];
    }

    const scores = items.map(x => x.score);
    const maxScore = Math.max(...scores);
    const T = 40; // 温度パラメータ：大きいほどランダム寄り、小さいほどスコア優先

    const work = items.map((x, idx) => {
      const w = Math.exp((scores[idx] - maxScore) / T);
      return {
        r: x.r,
        score: x.score,
        _w: w > 0 ? w : 0
      };
    });

    const result = [];
    while (work.length > 0){
      let total = 0;
      for (const x of work){
        total += x._w;
      }

      if (!(total > 0)){
        // すべての重みが 0 もしくは NaN 等の場合はスコア順で残りを並べる
        work.sort((a, b) => b.score - a.score);
        result.push(...work);
        break;
      }

      let rnd = _rand() * total;
      let pickIndex = 0;
      for (let i = 0; i < work.length; i++){
        rnd -= work[i]._w;
        if (rnd <= 0){
          pickIndex = i;
          break;
        }
      }

      result.push(work[pickIndex]);
      work.splice(pickIndex, 1);
    }

    return result;
  }

  // 候補抽出（空き・希望休なし・勤務形態OK）→不足度でスコアリング→重み付きランダム→勤務形態優先
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

    // 二部制／三部制の夜勤間隔をなるべく均一化するスコア（夜勤専従は影響なし）
    const spacing = nightSpacingScore(ctx, dayIdx, mark, r);

    const pen  = acNightPenalty(ctx, dayIdx, mark, r);
    const jitter = (_rand() - 0.5) * _randAmp;
    // ★追加：A属性にボーナスを付与（各帯に必須のため優先度を上げる）
    const attr = ctx.getEmpAttr(r) || { level:'B', workType:'three' };
    const aBonus = (attr.level === 'A') ? 50 : 0;
    return { r, score: base + riskBoost + fair + spacing + pen + aBonus + jitter };
  })

  .filter(x => x.score !== -Infinity);

  // スコアに応じた「重み付きランダム順」（ソフトマックス風）に並べ替え
  out = _softmaxOrderByScore(out);

  out = out.map(x => x.r);

  // 勤務形態の優先度は維持（夜勤専従をグループ先頭のまま）
  out = _orderByWorkType(ctx, out, mark);

  // ★削除：公平ローテは土日祈日公平化と競合するため削除
  // （スコアソートで公平性が確保される）

  return out;
}



// 4週間の夜勤ノルマ充足判定（厳格化：ノルマ完全一致を要求）
    function nightQuotasOK(ctx, startIdx, endIdx){
      for (let r = 0; r < ctx.employeeCount; r++){
        const wt = (ctx.getEmpAttr(r)?.workType) || 'three';
        const { star, half } = countNightStatsForEmp(ctx, r, startIdx, endIdx);
        if (wt === 'night'){
          // ★厳格化：個別の夜勤ノルマと完全一致を要求（許容範囲なし）
          const quota = ctx.getEmpAttr(r)?.nightQuota || 10;
          if (star !== quota) return false;
        } else if (wt === 'two'){
          if (star < 4) return false; // 二部制：4週間で☆≦4（下限も4）
        } else { // three
        // ★修正：三部制も個別の◆/●回数を参照
        const nfQuota = ctx.getEmpAttr(r)?.threeShiftNfQuota ?? 5;
        const nsQuota = ctx.getEmpAttr(r)?.threeShiftNsQuota ?? 5;
        const nfCount = countNfForEmp(ctx, r, startIdx, endIdx);
        const nsCount = countNsForEmp(ctx, r, startIdx, endIdx);
        if (nfCount < nfQuota || nsCount < nsQuota) return false;
      }
      }
      return true;
    }


global.NightBand = { countDayStats, candidatesFor, nightQuotasOK, setSeed, setRandAmp };
})(window);

