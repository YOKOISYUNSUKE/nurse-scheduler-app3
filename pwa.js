// PWA: Service Worker 登録・インストールボタン・オンライン状態表示
(function () {
  // PWA: Service Worker（Project Pages配下にも確実に効かせる）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
        console.error('SW register failed:', err);
      });
    });
  }

  // PWA: Install（beforeinstallprompt）
  let _deferredPrompt = null;
  const installBtn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'inline-flex';
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      _deferredPrompt = null;
      installBtn.style.display = 'none';
      console.log('PWA install:', outcome);
    });
  }

  // ネット状態を表示（既存のクラウド状態と連動）
  window.addEventListener('online',  () => { if (window.GAS) GAS.setCloudStatus('ok'); });
  window.addEventListener('offline', () => { if (window.GAS) GAS.setCloudStatus('offline'); });
})();
