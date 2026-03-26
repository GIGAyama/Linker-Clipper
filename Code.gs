// ==========================================
// バックエンド (GAS) - 超軽量・絶対安定版
// ==========================================

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('学習サイトリンク集')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function initSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Sites');
  if (!sheet) {
    sheet = ss.insertSheet('Sites');
    const headers = ['id', 'title', 'url', 'imageUrl', 'subject', 'grade', 'cbStudent', 'cbTeacher', 'pcStaff', 'memo', 'isDuplicate', 'author', 'updatedAt'];
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setBackground('#e0f2fe').setFontWeight('bold');
  }
}

function getSites() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Sites');
  if (!sheet) { initSetup(); SpreadsheetApp.flush(); sheet = ss.getSheetByName('Sites'); }
  
  const data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length <= 1) return [];
  
  const headers = data[0];
  const rows = data.slice(1);
  return rows.map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).reverse();
}

function saveSites(sitesData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Sites');
  if (!sheet) { initSetup(); SpreadsheetApp.flush(); sheet = ss.getSheetByName('Sites'); }
  
  const data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return [];

  const headers = data[0];
  const existingUrls = data.length > 1 ? data.slice(1).map(row => row[headers.indexOf('url')]) : [];
  
  sitesData.forEach(site => {
    site.updatedAt = new Date().toLocaleString('ja-JP');
    let rowIndex = site.id ? data.findIndex(row => row[0] === site.id) : -1;
    site.isDuplicate = existingUrls.includes(site.url) && rowIndex === -1 ? 'はい' : 'いいえ';
    
    const rowData = headers.map(header => {
      if (header === 'id' && !site.id) return Utilities.getUuid();
      return site[header] !== undefined ? site[header] : '';
    });

    if (rowIndex > 0) {
        sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([rowData]);
    } else {
        sheet.appendRow(rowData);
        existingUrls.push(site.url);
    }
  });
  
  SpreadsheetApp.flush(); // 強制書き込みで確実性を担保
  return getSites();
}

function deleteSite(id) {
  if (!id) throw new Error("IDが指定されていません");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Sites');
  if (!sheet) return getSites();

  const data = sheet.getDataRange().getValues();
  const rowIndex = data.findIndex(row => row[0] === id);
  if (rowIndex > 0) {
      sheet.deleteRow(rowIndex + 1);
      SpreadsheetApp.flush();
  }
  return getSites();
}

// --- 極限まで軽量化した情報取得ロジック（絶対にフリーズしません） ---
function fetchUrlInfo(urls) {
  const validUrls = urls.map(u => u.trim()).filter(u => u);
  if (validUrls.length === 0) return [];

  return validUrls.map(url => {
    let title = "";
    let imageUrl = "";
    let description = "";

    try {
      // 1件ずつ安全にフェッチ。重い処理は一切しません。
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      const html = response.getContentText("UTF-8");
      
      if (html) {
        // タイトルの抽出
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
        if (!title) {
          const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
          if (ogTitleMatch) title = ogTitleMatch[1].trim();
        }
        
        // 画像の抽出
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        if (ogImageMatch) imageUrl = ogImageMatch[1].trim();
        if (!imageUrl) {
          const iconMatch = html.match(/<link[^>]*rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*href=["']([^"']+)["']/i) || 
                            html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["']/i);
          if (iconMatch) imageUrl = iconMatch[1].trim();
        }
        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
          const domainMatch = url.match(/^https?:\/\/[^/]+/);
          const domain = domainMatch ? domainMatch[0] : url;
          if (imageUrl.startsWith('/')) imageUrl = domain + imageUrl;
          else imageUrl = url.substring(0, url.lastIndexOf('/') + 1) + imageUrl;
        }

        // 概要（Description）の抽出
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
        if (descMatch) description = descMatch[1].trim();
        if (!description) {
          const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
          if (ogDescMatch) description = ogDescMatch[1].trim();
        }
      }
    } catch (e) {
      console.log(`フェッチエラー (${url}):`, e);
      // アクセス拒否されても落ちず、URLをタイトルにして強行する
    }

    // 最終防衛線
    if (!title) title = url; 
    if (!imageUrl) {
      const domainMatch = url.match(/^https?:\/\/[^/]+/);
      if (domainMatch) imageUrl = `https://www.google.com/s2/favicons?domain=${domainMatch[0]}&sz=256`;
    }

    // AIを使わず、即座にデータを返す
    return {
      url: url,
      title: title,
      imageUrl: imageUrl,
      subject: 'その他',
      grade: '全学年',
      cbStudent: '〇',
      cbTeacher: '〇',
      pcStaff: '〇',
      memo: description || '',
      author: '情報部'
    };
  });
}

// =========================================================================
// 外部（Chrome拡張など）からのPOSTリクエストを受け取るWeb API窓口
// =========================================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("データが送信されていません");
    
    const payload = JSON.parse(e.postData.contents);
    if (!payload.urls || payload.urls.length === 0) throw new Error("URLリストが空です");
    
    // 超軽量化された関数で情報取得
    const parsedSitesData = fetchUrlInfo(payload.urls);
    saveSites(parsedSitesData);
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'success', message: `${parsedSitesData.length}件のサイトを登録しました！` 
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    console.error("doPostエラー:", error);
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'error', message: error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
