/* supabaseClient.js : Supabase接続（任意）
   - 未設定でもアプリが壊れない「ベストエフォート」設計
   - 目的：移行期の二重保存（GAS + Supabase）
*/

(function(){
  function isConfigured(){
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  }

  function parseKey(k){
    // k: "<cloudKey>:meta" or "<cloudKey>:counts"
    const idx = String(k || '').lastIndexOf(':');
    if (idx <= 0) return { cloud_key: null, field: null };
    return {
      cloud_key: k.slice(0, idx),
      field: k.slice(idx + 1)
    };
  }

  function nextRev(cloud_key){
    // リビジョン番号を管理（localStorage使用）
    // キー形式: "supa:rev:{cloud_key}"
    const revKey = `supa:rev:${cloud_key}`;
    try {
      const current = parseInt(localStorage.getItem(revKey) || '0', 10);
      const next = current + 1;
      localStorage.setItem(revKey, String(next));
      return next;
    } catch (e) {
      // localStorage が使用不可の場合は、タイムスタンプベースのリビジョン
      console.warn('[SUPA] localStorage unavailable, using timestamp-based rev:', e);
      return Math.floor(Date.now() / 1000);
    }
  }

  async function request(path, opts){
    const url = `${window.SUPABASE_URL}${path}`;
    const headers = Object.assign({
      'apikey': window.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`
    }, (opts && opts.headers) ? opts.headers : {});

    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      const err = new Error(`[SUPA] HTTP ${res.status} ${res.statusText} ${text}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function put(k, data){
    if (!isConfigured()) return null;

    const { cloud_key, field } = parseKey(k);
    if (!cloud_key || (field !== 'meta' && field !== 'counts')) return null;

    const payload = { cloud_key };
    payload[field] = data;
    payload.updated_by = window.currentUserId || null;
    payload.rev = nextRev(cloud_key);

    // schedules: cloud_key(PK), meta(jsonb), counts(jsonb)
    // upsert: on_conflict=cloud_key
    await request(`/rest/v1/schedules?on_conflict=cloud_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    });
    return true;
  }

  async function get(k){
    if (!isConfigured()) return null;

    const { cloud_key, field } = parseKey(k);
    if (!cloud_key || (field !== 'meta' && field !== 'counts')) return null;

    const select = encodeURIComponent(field);
    const eq = encodeURIComponent(`eq.${cloud_key}`);
    const res = await request(`/rest/v1/schedules?select=${select}&cloud_key=${eq}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    const rows = await res.json().catch(()=>[]);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0] ? rows[0][field] : null;
  }

  window.SUPA = {
    isConfigured,
    get,
    put
  };
})();
