/* auth.js - ログイン専用 */

(function () {
  const $ = (s, r = document) => r.querySelector(s);

  // --- sessionStorage ヘルパ ---
  function ssGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function ssSet(key, val) {
    try { sessionStorage.setItem(key, val); } catch (_) {}
  }

  const loginForm  = $('#loginForm');
  const loginId    = $('#loginId');
  const loginPw    = $('#loginPw');
  const loginError = $('#loginError');
  const loginLoading = $('#loginLoading');

/* 追加：EnterキーでFormを明示送信（PC想定／ボタン非表示に対応） */
  function bindEnterToSubmit(el){
    if(!el || !loginForm) return;
    el.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        if (typeof loginForm.requestSubmit === 'function'){
          loginForm.requestSubmit();
        } else {
          loginForm.dispatchEvent(new Event('submit', { cancelable:true, bubbles:true }));
        }
      }
    });
  }
  bindEnterToSubmit(loginId);
  bindEnterToSubmit(loginPw);

  // --- SHA-256(hex) ---
  async function sha256Hex(str) {
    if (!window.crypto || !window.crypto.subtle) return '';
    const enc  = new TextEncoder().encode(str);
    const buf  = await crypto.subtle.digest('SHA-256', enc);
    const arr  = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- UTF-8 → Base64 ---
  function b64Utf8(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      return '';
    }
  }

  // --- GAS 薄いラッパ（あれば使用） ---
  const REG_KEY = 'auth:registry';
  async function remoteGet(k){ try{ return (window.GAS ? GAS.get(k) : null); }catch(_){ return null; } }
  async function remotePut(k, data){ try{ return (window.GAS ? GAS.put(k, data) : null); }catch(_){ return null; } }

  // --- ログイン完了イベント発火 ---
  function emitLogin(userId) {

    document.dispatchEvent(new CustomEvent('auth:logged-in', {
      detail: { userId }
    }));
  }

  // --- ローディング表示 ---
  function showLoginLoading() {
    if (loginLoading) loginLoading.classList.remove('hidden');
  }
  // 追加：ローディング解除
  function hideLoginLoading() {
    if (loginLoading) loginLoading.classList.add('hidden');
  }

  // --- 自動ログイン ---
  function tryAutoLogin() {
    const ok = ssGet('sched:loggedIn');
    if (!ok) return;
    const uid = ssGet('sched:userId') || 'user';
    showLoginLoading();
    emitLogin(uid);
  }


  // --- フォーム送信処理 ---
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loginError) loginError.textContent = '';

      const id = (loginId && loginId.value || '').trim();
      const pw = (loginPw && loginPw.value || '');

      if (!id) {
        if (loginError) loginError.textContent = 'IDを入力してください';
        return;
      }
      if (pw.length < 8) {
        if (loginError) loginError.textContent = 'パスワードは8文字以上で入力してください';
        return;
      }

      showLoginLoading();

      // 1) ck生成（既存互換）
      const raw   = `sched:${id}:${pw}`;
      const ckSha = await sha256Hex(raw);
      const ckB64 = b64Utf8(raw);
      const ck    = ckSha || (ckB64 ? `b64:${ckB64}` : '');

      // 2) 登録レジストリの取得・検証・新規登録
      try {
        let reg = await remoteGet(REG_KEY);
        if (!reg || typeof reg !== 'object') reg = {};

        if (reg[id] && reg[id] !== ck) {
          if (loginError) loginError.textContent = 'このIDは別のパスワードで登録済みです。別のIDにしてください。';
          hideLoginLoading(); // ここでローディングを確実に止める
          return;
        }
        if (!reg[id]) {
          reg[id] = ck;
          await remotePut(REG_KEY, reg);
        }
      } catch (_) {
        // オフライン等：登録検証はスキップ（ログインは許可）
      }

      // 3) ローカル保存（既存どおり）
      ssSet('sched:loggedIn', '1');
      ssSet('sched:userId', id);
      if (ckSha) ssSet('sched:cloudKeySha', ckSha);
      if (ckB64) ssSet('sched:cloudKeyCompat', `b64:${ckB64}`);
      ssSet('sched:cloudKey', ck);

      // 4) 既存フロー継続（auth:logged-in → クラウド同期 → 入室）
      await new Promise(r => setTimeout(r, 0));
      emitLogin(id);

    });
  }

  // --- 公開API ---
  window.Auth = { tryAutoLogin };

  // 起動時に自動ログイン試行
  tryAutoLogin();
})();



