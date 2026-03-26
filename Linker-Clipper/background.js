/**
 * SVGからツールバーアイコンを動的生成する
 * Service Worker内ではDOM (Image, canvas) が使えないため、
 * OffscreenCanvasとfetch+createImageBitmapで処理する
 */
async function setIconFromSVG() {
  try {
    const url = chrome.runtime.getURL('icon.svg');
    const response = await fetch(url);
    const svgText = await response.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const bitmap = await createImageBitmap(blob, { resizeWidth: 128, resizeHeight: 128 });

    // 各サイズのImageDataを生成
    const sizes = [16, 32, 48, 128];
    const imageData = {};
    for (const size of sizes) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, size, size);
      imageData[size] = ctx.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn('アイコン設定に失敗:', e);
  }
}

// 拡張機能がインストールされた時、右クリックメニューを作成する
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-giga-linker",
    title: "データベース追加リストに入れる",
    contexts: ["page", "link"] // ページ上のどこでも、またはリンクの上で右クリック
  });

  // ツールバーアイコンをSVGから動的設定
  setIconFromSVG();
});

// Service Worker起動時にもアイコンを設定（再起動対策）
setIconFromSVG();

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
