/* app-navigation.js : アンカー移動、スクロール */
  function switchAnchor(newAnchor){

    // ★移動前に保存
    saveWindow();
    // ★アンドゥは別ウィンドウに持ち越さない
    UndoBuf = null;
    if (btnUndo) btnUndo.disabled = true;

    saveScroll();
    loadWindow(newAnchor);
    renderAll();
    restoreScroll();
  }

  // インポート等で、ファイル側の期間へ自動的に移動したい場合に利用
  function jumpToDateString(ds){
    const s = String(ds || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if(!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
    const dt = new Date(y, mo - 1, d);
    if(String(dt) === 'Invalid Date') return false;
    switchAnchor(dt);
    return true;
  }
  window.jumpToDateString = jumpToDateString;

  function shiftDays(n){
    switchAnchor(addDays(State.anchor, n));
  }

  // ---- ドラッグで日単位スクロール ----
  function dragDayNavigation(el){
    let down = false, sx = 0, moved = false, downTarget = null;
    let lastShiftedDays = 0; // ドラッグ中に既に移動した日数を記録

    el.addEventListener('pointerdown', (e)=>{
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true;
      sx = e.clientX;
      moved = false;
      downTarget = e.target;
      lastShiftedDays = 0; // リセット
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e)=>{
      if (!down) return;
      const dx = e.clientX - sx;
      
      // 一定以上動いたらmovedフラグを立てる
      if (Math.abs(dx) > 6) moved = true;
      
      // リアルタイムスクロール：一定距離ごとに日付を移動
      const firstTh = grid.querySelector('thead th[data-day="0"]');
      const cellW = firstTh ? firstTh.getBoundingClientRect().width : 56;
      const days = -Math.round(dx / (cellW * 0.7));
      
      // 前回の移動から変化があれば日付を変更
      if (days !== 0 && days !== lastShiftedDays) {
        const deltaDays = days - lastShiftedDays;
        shiftDays(deltaDays);
        lastShiftedDays = days;
        // 基準点を更新（連続ドラッグに対応）
        sx = e.clientX;
        lastShiftedDays = 0;
      }
    });

    el.addEventListener('pointerup', (e)=>{
      if (!down) return;
      el.releasePointerCapture(e.pointerId);

      if (!moved){
        if (downTarget && downTarget !== el){
          downTarget.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
        }
        down = false;
        downTarget = null;
        return;
      }

      // pointerup時の追加移動は不要（pointermoveで処理済み）
      down = false;
      downTarget = null;
      lastShiftedDays = 0;
    });
  }

  // スクロール位置保持（横スクロールの感覚維持）
  let lastScroll = 0;
  function saveScroll(){ lastScroll = gridWrap.scrollLeft; }
  function restoreScroll(){ gridWrap.scrollLeft = lastScroll; }

