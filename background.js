// 拡張機能がインストールされた時、右クリックメニューを作成する
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-giga-linker",
    title: "データベース追加リストに入れる",
    contexts: ["page", "link"] // ページ上のどこでも、またはリンクの上で右クリック
  });
});

// 右クリックメニューが押された時の処理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-to-giga-linker") {
    // リンクの上ならリンク先URL、そうでないなら現在のページのURLを取得
    const targetUrl = info.linkUrl || info.pageUrl;
    const targetTitle = tab ? tab.title : "無題のサイト";

    // 保存されているリスト（箱）を開けて、URLを追加して再度しまう
    chrome.storage.local.get({ pendingSites: [] }, (data) => {
      const sites = data.pendingSites;
      
      // まだリストに入っていないURLなら追加する
      if (!sites.some(s => s.url === targetUrl)) {
        sites.push({ url: targetUrl, title: targetTitle });
        
        chrome.storage.local.set({ pendingSites: sites }, () => {
          // アイコンに「バッジ（数字）」をつけて、何件ストックされているか教える
          chrome.action.setBadgeText({ text: sites.length.toString() });
          chrome.action.setBadgeBackgroundColor({ color: "#22c55e" }); // Tailwindのgreen-500
        });
      }
    });
  }
});
