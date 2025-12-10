/* gasClient.js - GAS(WebApp)接続の極小クライアント */
;(function (global) {
  function getEndpoint() {
    try {
      return sessionStorage.getItem('sched:remoteEndpoint')
        || global.REMOTE_ENDPOINT
        // 既定のフォールバック（旧app.jsのデフォルトに合わせる）
        || 'https://script.google.com/macros/s/AKfycbzdAARZ0_sjGg2SkcnjMt4xXuxPTGHz1y_LrU13Yb4uUCAoYQ2LoigrvjtQSg3vzStr/exec';
    } catch (_) {
      return global.REMOTE_ENDPOINT
        || 'https://script.google.com/macros/s/AKfycbzdAARZ0_sjGg2SkcnjMt4xXuxPTGHz1y_LrU13Yb4uUCAoYQ2LoigrvjtQSg3vzStr/exec';
    }
  }

  function setCloudStatus(state, message){
    const el = document.getElementById('cloudIndicator');
    if(!el) return;
    el.classList.remove('online','offline');
    if(state === 'ok'){
      el.classList.add('online');
      el.textContent = message || '同期OK';
      el.title = 'クラウドと正常に接続されています';
    }else{
      el.classList.add('offline');
      el.textContent = message || '未接続';
      el.title = 'クラウドに接続できません。ローカルデータのみで動作しています。';
    }
  }

  async function get(k){
    try{
      const r = await fetch(`${getEndpoint()}?k=${encodeURIComponent(k)}`, {
        mode: 'cors',
        cache: 'no-cache'
      });
      if (r.ok){
        setCloudStatus('ok');
        const text = await r.text();
        if (!text || text.trim() === '') return {}; // 空レスポンス対策（既存挙動に合わせる）
        try { return JSON.parse(text); } catch(e){ console.error('JSON parse error:', e, text); return {}; }
      } else {
        console.error('Remote GET failed:', r.status, r.statusText);
        setCloudStatus('offline');
      }
    }catch(err){
      console.error('Remote GET error:', err);
      setCloudStatus('offline');
    }
    return null; // フェイルセーフ（既存と同じ）
  }

  async function put(k, data){
    try{
      const r = await fetch(getEndpoint(), {
        method:'POST',
        headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
        mode:'cors',
        cache:'no-cache',
        body: JSON.stringify({ k, data })
      });
      if (r && r.ok){
        setCloudStatus('ok');
      } else {
        console.error('Remote PUT failed:', r?.status, r?.statusText);
        setCloudStatus('offline');
      }
    }catch(err){
      console.error('Remote PUT error:', err);
      setCloudStatus('offline');
    }
  }

  async function testConnection(){
    try{
      const testKey  = 'test:connection';
      const testData = { timestamp: Date.now(), test: true };
      await put(testKey, testData);
      const result = await get(testKey);
      if (result && result.test === true){
        setCloudStatus('ok');
        return { success:true, message:'クラウド接続: 正常' };
      } else {
        setCloudStatus('offline');
        return { success:false, message:'クラウド接続: データの読み書きに失敗しました' };
      }
    }catch(e){
      console.error('Connection test failed:', e);
      setCloudStatus('offline');
      return { success:false, message:'クラウド接続: エラーが発生しました - ' + e.message };
    }
  }
  // meta/dates/counts をまとめて取得する API
  //   GAS 側 doGet(e) の ?k=<cloudKey>&bundle=1 に対応
  async function getAll(baseKey){
    const url = `${getEndpoint()}?k=${encodeURIComponent(baseKey)}&bundle=1`;

    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache'
    });

    if (!res.ok) {
      throw new Error('getAll failed: ' + res.status + ' ' + res.statusText);
    }

    const json = await res.json();
    // 期待する形: { meta: {...}, dates: {...}, counts: {...} }
    return json;
  }


  global.GAS = {
    getEndpoint, setCloudStatus,
    get, put, testConnection,
    getAll 
  };
})(window);

