(() => {
  const installButtons = [...document.querySelectorAll('[data-pwa-install]')];
  const toolbar = document.getElementById('pwaToolbar');
  const updateButton = document.getElementById('pwaUpdateBtn');
  const offlineNotice = document.getElementById('pwaOfflineNotice');
  const help = document.getElementById('pwaInstallHelp');
  const displayMode = window.matchMedia('(display-mode: standalone)');
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => displayMode.matches || navigator.standalone === true;
  let installPrompt = null, registration = null, reloadForUpdate = false, installBusy = false;
  const notify = message => { if (typeof toast === 'function') toast(message); };

  function refreshControls() {
    const canInstall = !standalone() && Boolean(installPrompt || isiOS);
    installButtons.forEach(button => { button.hidden = !canInstall; button.disabled = installBusy; });
    const hasUpdate = Boolean(registration?.waiting);
    updateButton.hidden = !hasUpdate;
    toolbar.hidden = !canInstall && !hasUpdate;
  }
  function connectionChanged() { offlineNotice.hidden = navigator.onLine !== false; }
  function syncTheme() {
    const header = document.querySelector('.topbar'), meta = document.querySelector('meta[name="theme-color"]');
    const color = getComputedStyle(header).getPropertyValue('--screen-color').trim();
    if (meta && color) meta.content = color;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; refreshControls();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; installButtons.forEach(button => { button.hidden = true; }); toolbar.hidden = updateButton.hidden; });
  displayMode.addEventListener?.('change', refreshControls);
  installButtons.forEach(button => button.addEventListener('click', async () => {
    if (installBusy || standalone()) return;
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null; installBusy = true; refreshControls();
      try { await prompt.prompt(); await prompt.userChoice; }
      catch { notify('Use your browser menu to install the app.'); }
      finally { installBusy = false; refreshControls(); }
    } else if (isiOS) {
      if (typeof help.showModal === 'function') help.showModal(); else help.setAttribute('open', '');
    }
  }));
  document.querySelector('[data-pwa-close]').addEventListener('click', () => {
    if (typeof help.close === 'function') help.close(); else help.removeAttribute('open');
  });
  updateButton.addEventListener('click', () => {
    if (!registration?.waiting) return;
    if (!document.getElementById('processing').classList.contains('hidden')) { notify('Wait for the current action to finish before updating.'); return; }
    if (!window.confirm('Reload to update the app? Save any unfinished forms first.')) return;
    reloadForUpdate = true; updateButton.disabled = true;
    registration.waiting.postMessage({type: 'SKIP_WAITING'});
  });
  window.addEventListener('online', connectionChanged);
  window.addEventListener('offline', connectionChanged);
  new MutationObserver(syncTheme).observe(document.querySelector('.topbar'), {attributes: true, attributeFilter: ['data-screen']});
  connectionChanged(); refreshControls(); syncTheme();

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) { reloadForUpdate = false; window.location.reload(); }
  });
  async function register() {
    try {
      const scope = new URL('./', document.baseURI);
      registration = await navigator.serviceWorker.register(new URL('sw.js', scope), {scope: scope.href, updateViaCache: 'none'});
      refreshControls();
      function watchInstalling() {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') refreshControls(); });
      }
      watchInstalling();
      registration.addEventListener('updatefound', watchInstalling);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { registration.update().catch(() => {}); refreshControls(); }
      });
    } catch { /* A blocked worker must not stop normal online accounting. */ }
  }
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, {once: true});
})();
