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
        <div class="h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
          <span class="material-symbols-rounded text-3xl mb-1 opacity-50">mouse</span>
          <p class="text-[10px]">登録したいサイト上で<br>右クリックして追加してください</p>
        </div>
      `;
      sendBtn.disabled = true;
      return;
    }

    sendBtn.disabled = false;
    siteListContainer.innerHTML = '';
    
    pendingSites.forEach((site, index) => {
      const item = document.createElement('div');
      item.className = "bg-white p-2 rounded-lg shadow-sm border border-slate-100 flex items-center gap-2 group";
      item.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="text-[11px] font-bold text-slate-800 truncate leading-tight">${site.title}</div>
          <div class="text-[9px] text-slate-400 truncate mt-0.5">${site.url}</div>
        </div>
        <button class="delete-item-btn p-1 text-slate-300 hover:text-red-500 transition-colors" data-index="${index}">
          <span class="material-symbols-rounded text-[16px]">close</span>
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
    sendBtn.innerHTML = `<span class="material-symbols-rounded text-xl animate-spin">autorenew</span> 送信・解析中...`;
    
    try {
      // データベース（GAS）にPOSTリクエストを送る
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow', // GASでPOSTを受け取るための必須設定
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({ urls: pendingSites.map(s => s.url) })
      });

      const result = await response.json();

      if (result.status === 'success') {
        showStatus(result.message, 'success');
        pendingSites = []; // 成功したらリストを空にする
        saveAndRender();
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      showStatus('送信エラー: ' + error.message, 'error');
    } finally {
      sendBtn.disabled = pendingSites.length === 0;
      sendBtn.innerHTML = `<span class="material-symbols-rounded text-xl">auto_awesome</span> AIで一括登録する`;
    }
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `text-xs text-center mb-2 font-bold ${type === 'error' ? 'text-red-500' : 'text-green-600'} block`;
    setTimeout(() => { statusMsg.classList.add('hidden'); }, 4000);
  }
});
