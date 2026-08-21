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

// --- Gemini APIによるサイト自動分析 ---
function analyzeWithGemini(url, title, description) {
  // フォールバック値（API失敗時やキー未設定時に返す安全なデフォルト）
  const fallback = { subject: 'その他', grade: '全学年', memo: description || '' };

  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      console.log('GEMINI_API_KEY未設定のためフォールバック');
      return fallback;
    }

    const prompt = `あなたは小学校教員向けの学習サイト分類アシスタントです。
以下のサイト情報を分析し、JSONのみを返してください。説明文やマークダウンは不要です。

【サイト情報】
- URL: ${url}
- タイトル: ${title}
- 説明: ${description || 'なし'}

【出力JSON形式】
{
  "subject": "該当する教科をカンマ区切りで（選択肢: 国語,算数,理科,社会,英語,生活,道徳,音楽,図工,家庭科,総合,学活,体育,情報,その他）",
  "grade": "対象学年をカンマ区切りで（選択肢: 低学年,中学年,高学年,特支,全学年,教員用）",
  "memo": "サイトの概要を50文字以内で簡潔に"
}

注意:
- subjectは最も関連性の高い教科を1〜3個選んでください
- gradeは対象となる学年層を選んでください。幅広い場合は「全学年」としてください
- memoは教員がサイトの内容を素早く把握できる端的な説明にしてください
- 純粋なJSONのみ出力してください`;

    // API キーは URL クエリに入れない（アクセスログやプロキシに残る）。ヘッダで渡す。
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256
      }
    };

    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      console.log(`Gemini APIエラー (HTTP ${statusCode}):`, response.getContentText());
      return fallback;
    }

    const result = JSON.parse(response.getContentText());
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log('Gemini応答にテキストなし');
      return fallback;
    }

    // JSONブロックを抽出（```json ... ``` でラップされている場合にも対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('Gemini応答からJSON抽出失敗:', text);
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 各フィールドのバリデーション
    const validSubjects = ['国語','算数','理科','社会','英語','生活','道徳','音楽','図工','家庭科','総合','学活','体育','情報','その他'];
    const validGrades = ['低学年','中学年','高学年','特支','全学年','教員用'];

    const subject = parsed.subject
      ? parsed.subject.split(',').map(s => s.trim()).filter(s => validSubjects.includes(s)).join(',') || 'その他'
      : 'その他';
    const grade = parsed.grade
      ? parsed.grade.split(',').map(s => s.trim()).filter(s => validGrades.includes(s)).join(',') || '全学年'
      : '全学年';
    const memo = parsed.memo ? String(parsed.memo).substring(0, 100) : (description || '');

    return { subject, grade, memo };

  } catch (e) {
    console.log('Gemini分析で例外:', e);
    return fallback;
  }
}

// --- サイト情報取得＋AI分析ロジック ---
function fetchUrlInfo(urls) {
  const validUrls = urls.map(u => u.trim()).filter(u => u);
  if (validUrls.length === 0) return [];

  return validUrls.map(url => {
    let title = "";
    let imageUrl = "";
    let description = "";

    try {
      // 1件ずつ安全にフェッチ
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
    }

    // 最終防衛線
    if (!title) title = url; 
    if (!imageUrl) {
      const domainMatch = url.match(/^https?:\/\/[^/]+/);
      if (domainMatch) imageUrl = `https://www.google.com/s2/favicons?domain=${domainMatch[0]}&sz=256`;
    }

    // Gemini APIで教科・学年・概要を自動推定（失敗してもフォールバックで安全）
    const aiResult = analyzeWithGemini(url, title, description);

    return {
      url: url,
      title: title,
      imageUrl: imageUrl,
      subject: aiResult.subject,
      grade: aiResult.grade,
      cbStudent: '〇',
      cbTeacher: '〇',
      pcStaff: '〇',
      memo: aiResult.memo,
      author: '情報部'
    };
  });
}

// =========================================================================
// 外部（Chrome拡張など）からのPOSTリクエストを受け取るWeb API窓口
// =========================================================================
/**
 * ⚠️ ここは合言葉なしで誰でも叩ける窓口だった。
 *
 *    ウェブアプリの URL さえ知っていれば、まったく関係のない人が
 *    好きなURLの配列を投げられた。すると fetchUrlInfo が
 *    **このスクリプトの持ち主（先生）の権限で** UrlFetchApp.fetch を回す。
 *      ・学校のネットワークから見えるページを、外の人が読み出せる（SSRF）
 *      ・1件ごとに Gemini を呼ぶので、利用枠を他人に使い切られる
 *      ・スプレッドシートにいくらでも行を足せる
 *
 *    スクリプトプロパティに置いた合言葉（CLIPPER_SHARED_SECRET）を
 *    リクエストに入れてもらい、サーバー側で照らし合わせる形にした。
 *    拡張の設定画面「あいことば」に同じ文字を入れる。
 *
 *    ＜合言葉の決め方＞
 *      GAS エディタ →「プロジェクトの設定」→「スクリプト プロパティ」
 *      名前: CLIPPER_SHARED_SECRET
 *      値  : 推測されない長めの文字列（20文字以上をおすすめ）
 *            例）エディタで Utilities.getUuid() を1回実行して出た値
 */
var CLIPPER_SECRET_KEY_ = 'CLIPPER_SHARED_SECRET';

// 1回のリクエストで扱うURLの上限。
// 1件ごとにページを取りに行き Gemini にも聞くので、多すぎると実行時間の上限
// （6分）に当たって全部無駄になる。拡張側にも同じ上限がある。
var MAX_URLS_PER_REQUEST_ = 20;

/** 長さの違いで中身を当てられないよう、最後まで比べてから判定する */
function secretMatches_(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("データが送信されていません");

    const payload = JSON.parse(e.postData.contents);

    // --- 合言葉の確認。これを通らないものは、URLを1件も取りに行かない ---
    const expected = PropertiesService.getScriptProperties().getProperty(CLIPPER_SECRET_KEY_);
    if (!expected) {
      // 未設定のまま公開されると、誰でも叩ける状態に逆戻りする。閉じておく。
      throw new Error("受け取り口が未設定です。スクリプトプロパティ CLIPPER_SHARED_SECRET を設定してください。");
    }
    if (!secretMatches_(payload.secret, expected)) {
      throw new Error("あいことばが違います。");
    }

    if (!payload.urls || !payload.urls.length) throw new Error("URLリストが空です");
    if (payload.urls.length > MAX_URLS_PER_REQUEST_) {
      throw new Error(`1回に送れるのは${MAX_URLS_PER_REQUEST_}件までです（${payload.urls.length}件届きました）`);
    }

    // http/https 以外は取りに行かない。念のための最後の一枚。
    const urls = payload.urls
      .map(u => String(u == null ? '' : u).trim())
      .filter(u => /^https?:\/\//i.test(u));
    if (urls.length === 0) throw new Error("http(s) で始まるURLがありません");

    // 超軽量化された関数で情報取得
    const parsedSitesData = fetchUrlInfo(urls);
    saveSites(parsedSitesData);

    return jsonOut_({
      status: 'success', message: `${parsedSitesData.length}件のサイトを登録しました！`
    });

  } catch (error) {
    console.error("doPostエラー:", error);
    return jsonOut_({ status: 'error', message: error.toString() });
  }
}
