// SVGアイコン定義（インラインSVG用）
const ICONS = {
  mouse: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  autorenew: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/></svg>',
  autoAwesome: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>',
};

// 送信先として認めるURLの形。
// ここを見ないと、打ち間違いや貼り間違いで、まったく別のサイトへ
// 集めたURLとシークレットをそのまま送ってしまう。
const GAS_EXEC_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

// 1回に送るURLの上限。GAS 側は1件ずつ取りに行って Gemini にも聞くので、
// まとめて投げすぎると実行時間の上限（6分）に当たって全部無駄になる。
// サーバー側にも同じ上限がある（Code.gs の MAX_URLS_PER_REQUEST）。
const MAX_SITES_PER_SEND = 20;

document.addEventListener('DOMContentLoaded', () => {
  const gasUrlInput = document.getElementById('gas-url-input');
  const secretInput = document.getElementById('gas-secret-input');
  const siteListContainer = document.getElementById('site-list');
  const countBadge = document.getElementById('count-badge');
  const sendBtn = document.getElementById('send-btn');
  const clearBtn = document.getElementById('clear-btn');
  const statusMsg = document.getElementById('status-msg');

  let pendingSites = [];

  // 1. 保存されている設定とURLリストを読み込む
  chrome.storage.local.get(['gasAppUrl', 'gasSecret', 'pendingSites'], (data) => {
    if (data.gasAppUrl) gasUrlInput.value = data.gasAppUrl;
    if (data.gasSecret) secretInput.value = data.gasSecret;
    pendingSites = data.pendingSites || [];
    renderList();
  });

  // 2. URL入力欄が変わったら自動保存する
  gasUrlInput.addEventListener('input', (e) => {
    chrome.storage.local.set({ gasAppUrl: e.target.value.trim() });
  });

  // 3. あいことば（共有シークレット）も自動保存する。
  //    GAS のスクリプトプロパティ CLIPPER_SHARED_SECRET と同じ文字を入れる。
  //    これが無いと、URL を知っている人なら誰でも、先生の権限で
  //    好きなURLを取りに行かせられる（Gemini の利用枠も減る）。
  secretInput.addEventListener('input', (e) => {
    chrome.storage.local.set({ gasSecret: e.target.value.trim() });
  });

  // 4. リストを描画する関数
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

  // 5. リストを保存して画面・バッジを更新
  function saveAndRender() {
    chrome.storage.local.set({ pendingSites: pendingSites }, () => {
      renderList();
      const badgeText = pendingSites.length > 0 ? pendingSites.length.toString() : "";
      chrome.action.setBadgeText({ text: badgeText });
    });
  }

  // 6. リストを空にする
  clearBtn.addEventListener('click', () => {
    if(confirm('送信待ちリストをすべてクリアしますか？')) {
      pendingSites = [];
      saveAndRender();
    }
  });

  // 7. GASバックエンドへ送信（メインイベント）
  sendBtn.addEventListener('click', async () => {
    const url = gasUrlInput.value.trim();
    const secret = secretInput.value.trim();

    if (!url) {
      showStatus('WebアプリのURLを設定してください', 'error');
      return;
    }
    // 打ち間違い・貼り間違いで、よそのサイトへ送ってしまわないように確かめる
    if (!GAS_EXEC_URL_RE.test(url)) {
      showStatus('URLの形が違います（https://script.google.com/macros/s/.../exec）', 'error');
      return;
    }
    if (!secret) {
      showStatus('あいことばを設定してください', 'error');
      return;
    }
    if (pendingSites.length > MAX_SITES_PER_SEND) {
      showStatus(`1回に送れるのは${MAX_SITES_PER_SEND}件までです（いまは${pendingSites.length}件）`, 'error');
      return;
    }

    const sentCount = pendingSites.length;
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="icon icon-lg spin">${ICONS.autorenew}</span> 送信・解析中...`;
    
    try {
      // no-cors はやめた。
      // no-cors だと、GAS が「あいことばが違う」と断っていても、
      // ネットワークが切れていても、こちらからは区別がつかない。
      // それなのに「送信しました！」と出して送信待ちリストを消していたので、
      // 集めたURLが黙って消えていた。
      //
      // GAS のウェブアプリは /exec に POST すると
      // script.googleusercontent.com へ 302 で飛ばし、その先で
      // ContentService の JSON を返す。redirect: 'follow' はその作りに合わせたもの。
      // Content-Type を text/plain にしているのは、プリフライト（OPTIONS）を
      // 出さないため。GAS は OPTIONS に答えられないので、
      // application/json にすると必ず失敗する。
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          secret: secret,
          urls: pendingSites.map(s => s.url)
        })
      });

      if (!response.ok) throw new Error(`サーバーの応答が ${response.status} でした`);

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        // ログイン画面のHTMLが返ってきたときはここに来る
        throw new Error('サーバーからの返事を読めませんでした（URLとアクセス権を確かめてください）');
      }
      if (!result || result.status !== 'success') {
        throw new Error(result && result.message ? result.message : '登録できませんでした');
      }

      // ここまで来て初めて、送信待ちリストを消す。
      showStatus(result.message || `${sentCount}件のサイトを送信しました！`, 'success');
      pendingSites = [];
      saveAndRender();
    } catch (error) {
      // 失敗したときはリストを消さない。あとでもう一度送れる。
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
