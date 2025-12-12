/* auth.js - ログイン専用（改善版：堅牢な認証フロー） */

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

  // ============================================================
  // ★改善1：認証キー生成の決定論化
  // WebCryptoのみを使用、フォールバックなし
  // ============================================================
  async function generateAuthKey(id, password) {
    try {
      // WebCryptoを使用してSHA-256を計算
      const raw = `sched:${id}:${password}`;
      const enc = new TextEncoder().encode(raw);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      const arr = Array.from(new Uint8Array(buf));
      const hex = arr.map(b => b.toString(16).padStart(2, '0')).join('');
      return hex;
    } catch (e) {
      console.error('Failed to generate auth key:', e);
      throw new Error('認証キーの生成に失敗しました。ブラウザがWebCryptoに対応していません。');
    }
  }

  // ============================================================
  // ★改善2：ユーザー登録・検証の明示化とリトライ機能
  // ============================================================
  const REG_KEY = 'auth:registry';
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 100;

  async function remoteGet(k) {
    try {
      return (window.GAS ? GAS.get(k) : null);
    } catch (_) {
      return null;
    }
  }

  async function remotePut(k, data) {
    try {
      return (window.GAS ? GAS.put(k, data) : null);
    } catch (_) {
      return null;
    }
  }

  /**
   * ユーザー登録または検証を行う（リトライ機能付き）
   * 
   * 動作：
   * 1. 認証キーを生成
   * 2. GASから登録簿を取得
   * 3. 既存ユーザーなら検証、新規ユーザーなら登録
   * 4. 登録時は確認読み込みを行い、実際に保存されたか確認
   * 5. 失敗時はリトライ
   * 
   * @param {string} id - ユーザーID
   * @param {string} password - パスワード
   * @returns {Promise<{ck: string, isNew: boolean, attempt: number}>}
   */
  async function registerOrVerifyUserWithRetry(id, password) {
    let ck;
    try {
      ck = await generateAuthKey(id, password);
    } catch (e) {
      throw e; // 認証キー生成失敗は即座に中止
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Auth] Attempt ${attempt}/${MAX_RETRIES}: Fetching registry...`);
        
        // 登録簿を取得
        let reg = await remoteGet(REG_KEY);
        if (!reg || typeof reg !== 'object') {
          reg = {};
        }

        const regEntry = reg[id];

        if (regEntry) {
          // ★既存ユーザー：キーを検証
          console.log(`[Auth] Existing user detected: ${id}`);
          
          if (regEntry.ck !== ck) {
            // パスワード不一致
            throw new Error('このIDは別のパスワードで登録済みです。別のIDにしてください。');
          }
          
          console.log(`[Auth] Password verified for user: ${id}`);
          return { ck, isNew: false, attempt };
        } else {
          // ★新規ユーザー：登録を試みる
          console.log(`[Auth] New user registration: ${id}`);
          
          const newEntry = {
            ck: ck,
            ts: Date.now(),
            version: 1
          };
          reg[id] = newEntry;

          // 登録簿をGASに保存
          console.log(`[Auth] Saving registry to GAS...`);
          await remotePut(REG_KEY, reg);

          // ★重要：確認読み込み
          // 本当に保存されたか確認し、競合を検出
          console.log(`[Auth] Verifying saved data...`);
          await new Promise(r => setTimeout(r, 50)); // GAS側の処理完了を待つ
          
          const verifyReg = await remoteGet(REG_KEY);
          if (!verifyReg || typeof verifyReg !== 'object') {
            throw new Error('登録簿の確認読み込みに失敗しました');
          }

          const verifyEntry = verifyReg[id];
          if (!verifyEntry) {
            throw new Error('登録データが保存されていません（競合の可能性）');
          }

          if (verifyEntry.ck !== ck) {
            // 別のデバイスが先に登録した可能性
            console.warn(`[Auth] Conflict detected: stored key differs from generated key`);
            console.warn(`[Auth] Generated: ${ck.substring(0, 8)}...`);
            console.warn(`[Auth] Stored: ${verifyEntry.ck.substring(0, 8)}...`);
            throw new Error('別のデバイスから同時に登録されました。もう一度ログインしてください。');
          }

          console.log(`[Auth] New user registered successfully: ${id}`);
          return { ck, isNew: true, attempt };
        }
      } catch (e) {
        console.error(`[Auth] Attempt ${attempt} failed:`, e.message);
        
        if (attempt === MAX_RETRIES) {
          // 最後の試行が失敗
          throw e;
        }

        // リトライ前に待機
        const delayMs = RETRY_DELAY_MS * attempt;
        console.log(`[Auth] Retrying after ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

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

      try {
        // ★改善：登録・検証処理をリトライ付きで実行
        console.log(`[Auth] Starting login process for user: ${id}`);
        const { ck, isNew, attempt } = await registerOrVerifyUserWithRetry(id, pw);
        
        console.log(`[Auth] Login successful (attempt: ${attempt}, isNew: ${isNew})`);

        // ローカル保存
        ssSet('sched:loggedIn', '1');
        ssSet('sched:userId', id);
        ssSet('sched:cloudKey', ck);
        
        // 互換性のため、SHA-256キーも保存
        ssSet('sched:cloudKeySha', ck);

        // ログイン完了イベント発火
        await new Promise(r => setTimeout(r, 0));
        emitLogin(id);

      } catch (error) {
        console.error('[Auth] Login failed:', error);
        if (loginError) {
          loginError.textContent = error.message || 'ログインに失敗しました。もう一度お試しください。';
        }
        hideLoginLoading();
      }
    });
  }

  // --- 公開API ---
  window.Auth = { tryAutoLogin };

  // 起動時に自動ログイン試行
  tryAutoLogin();
})();