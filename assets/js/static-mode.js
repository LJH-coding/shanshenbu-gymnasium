(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const apiJson = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }));

  window.__SHANSHENBU_STATIC__ = true;
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }

    const path = url.pathname;
    if (path === '/api/ice') return apiJson({ iceServers: [] });
    if (path === '/api/live') return apiJson({ list: [] });
    if (path === '/api/google' && (!init.method || init.method === 'GET')) return apiJson({ clientId: '' });
    if (path === '/api/ladder') return apiJson({ top: [], me: null, localOnly: true });
    if (path === '/api/rogue') return apiJson({ top: [], me: null, localOnly: true });
    if (path === '/api/t') return apiJson({ ok: true, localOnly: true });
    if (path === '/api/profile' && String(init.method || 'GET').toUpperCase() === 'POST') {
      return apiJson({ ok: true, localOnly: true });
    }
    return apiJson({ error: '此靜態版本未連接原站後端。' }, 501);
  };

  try {
    const nativeBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (nativeBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        value(url, data) {
          const target = new URL(url, location.href);
          if (target.origin === location.origin && target.pathname.startsWith('/api/')) return true;
          return nativeBeacon(url, data);
        },
      });
    }
  } catch (_) {}

  const serverOnlyIds = new Set([
    'lbCreate', 'lbCreateX', 'lbJoin', 'lbSpecBtn',
    'rkGo', 'rkAgain', 'saveGo', 'bwNetBtn', 'bwJoinBtn',
  ]);

  function showNotice(message) {
    let toast = document.getElementById('staticToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'staticToast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function exportProgress() {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ssb_')) data[key] = localStorage.getItem(key);
    }
    const payload = JSON.stringify({
      app: 'shanshenbu-static',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shanshenbu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice('已下載本機進度備份。');
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || ''));
        if (!payload || payload.app !== 'shanshenbu-static' || !payload.data || typeof payload.data !== 'object') {
          throw new Error('格式不符');
        }
        for (const [key, value] of Object.entries(payload.data)) {
          if (key.startsWith('ssb_') && typeof value === 'string') localStorage.setItem(key, value);
        }
        alert('進度已匯入，重新整理後生效。');
        location.reload();
      } catch (_) {
        showNotice('無法匯入：這不是有效的閃身步靜態版備份。');
      }
    };
    reader.readAsText(file);
  }

  function addBackupControls() {
    const menu = document.getElementById('menuDrop');
    if (!menu || document.getElementById('staticBackupBtn')) return;

    const exportBtn = document.createElement('button');
    exportBtn.id = 'staticBackupBtn';
    exportBtn.className = 'mi';
    exportBtn.innerHTML = '<i>💾</i>下載進度備份';
    exportBtn.addEventListener('click', exportProgress);

    const importBtn = document.createElement('button');
    importBtn.className = 'mi';
    importBtn.innerHTML = '<i>📥</i>匯入進度備份';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    input.addEventListener('change', () => input.files && input.files[0] && importProgress(input.files[0]));
    importBtn.addEventListener('click', () => input.click());
    importBtn.appendChild(input);

    const setBtn = document.getElementById('setBtn');
    menu.insertBefore(exportBtn, setBtn || null);
    menu.insertBefore(importBtn, setBtn || null);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !serverOnlyIds.has(target.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNotice('這項功能需要原站的 Worker 後端；靜態版未連接房間、配對、排行榜或雲端存檔服務。');
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const badge = document.createElement('button');
    badge.id = 'staticBadge';
    badge.type = 'button';
    badge.textContent = '靜態版｜單機可玩';
    badge.title = '線上房間、排位、排行榜、雲端存檔與 Google 綁定需要另接後端';
    badge.addEventListener('click', () => showNotice('單機、練習、本地進度可直接使用；線上功能需要自行實作並部署後端。'));
    document.body.appendChild(badge);
    addBackupControls();
  });
})();
