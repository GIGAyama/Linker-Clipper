// SVGアイコン定義（インラインSVG用）
const ICONS = {
  mouse: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  autorenew: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/></svg>',
  autoAwesome: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>',
};

document.addEventListener('DOMContentLoaded', () => {
  const gasUrlInput = document.getElementById('gas-url-input');
  const siteListContainer = document.getElementById('site-list');
  const countBadge = document.getElementById('count-badge');
  const sendBtn = document.getElementById('send-btn');
  const clearBtn = document.getElementById('clear-btn');
  const statusMsg = document.getElementById('status-msg');

  let pendingSites = [];

  // 1. 保存されている設定とURLリストを読み込む
  chrome.storage.local.get(['gasAppUrl', 'pendingSites'], (data) => {
    if (data.gasAppUrl) gasUrlInput.value = data.gasAppUrl;
    pendingSites = data.pendingSites || [];
    renderList();
  });

  // 2. URL入力欄が変わったら自動保存する
  gasUrlInput.addEventListener('input', (e) => {
    chrome.storage.local.set({ gasAppUrl: e.target.value.trim() });
  });

  // 3. リストを描画する関数
  function renderList() {
    countBadge.textContent = `${pendingSites.length}件`;
    
    if (pendingSites.length === 0) {
      siteListContainer.innerHTML = `
        <div class="empty-state">
          <span class="icon icon-3xl">${ICONS.mouse}</span>
          <p>登録したいサイト上で<br>右クリックして追加してください</p>
        </div>
      `;
      sendBtn.disabled = true;
      return;
    }

    sendBtn.disabled = false;
    siteListContainer.innerHTML = '';
    
    pendingSites.forEach((site, index) => {
      const item = document.createElement('div');
      item.className = 'site-item';
      item.innerHTML = `
        <div class="site-item-info">
          <div class="site-item-title">${escapeHtml(site.title)}</div>
          <div class="site-item-url">${escapeHtml(site.url)}</div>
        </div>
        <button class="delete-item-btn" data-index="${index}">
          <span class="icon icon-md">${ICONS.close}</span>
        </button>
      `;
      siteListContainer.appendChild(item);
    });

    // 個別削除ボタンのイベント
    document.querySelectorAll('.delete-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = e.currentTarget.getAttribute('data-index');
        pendingSites.splice(idx, 1);
        saveAndRender();
      });
    });
  }

  // 4. リストを保存して画面・バッジを更新
  function saveAndRender() {
    chrome.storage.local.set({ pendingSites: pendingSites }, () => {
      renderList();
      const badgeText = pendingSites.length > 0 ? pendingSites.length.toString() : "";
      chrome.action.setBadgeText({ text: badgeText });
    });
  }

  // 5. リストを空にする
  clearBtn.addEventListener('click', () => {
    if(confirm('送信待ちリストをすべてクリアしますか？')) {
      pendingSites = [];
      saveAndRender();
    }
  });

  // 6. GASバックエンドへ送信（メインイベント）
  sendBtn.addEventListener('click', async () => {
    const url = gasUrlInput.value.trim();
    if (!url) {
      showStatus('WebアプリのURLを設定してください', 'error');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="icon icon-lg spin">${ICONS.autorenew}</span> 送信・解析中...`;
    
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({ sites: pendingSites.map(s => ({ url: s.url, title: s.title })) })
      });

      // no-corsではレスポンス内容を読めないため、送信完了をもって成功とみなす
      showStatus(`${pendingSites.length}件のサイトを送信しました！`, 'success');
      pendingSites = [];
      saveAndRender();
    } catch (error) {
      showStatus('送信エラー: ' + error.message, 'error');
    } finally {
      sendBtn.disabled = pendingSites.length === 0;
      sendBtn.innerHTML = `<span class="icon icon-lg">${ICONS.autoAwesome}</span> AIで一括登録する`;
    }
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg visible ${type}`;
    setTimeout(() => { statusMsg.className = 'status-msg'; }, 4000);
  }

  // HTMLエスケープ（XSS防止）
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
