// ============================================================
// みんなの実績 — データ中継API（Google Apps Script ウェブアプリ）
//
// 目的：
//   ブラウザ側に spreadsheets 権限（機密スコープ）を要求せずに各シートを読む。
//   これにより「このアプリはGoogleで確認されていません」警告を回避する。
//
// 仕組み：
//   1. ブラウザは「Googleでログイン」で得た ID token（JWT）を POST する。
//   2. ここで ID token を検証（署名・有効期限・aud・ドメイン）。
//   3. @seichiku.org の正規ユーザーだけに、必要な全シートをJSONで返す。
//   読み取りはデプロイ主（＝各シートを閲覧できるアカウント）の権限で行うため、
//   スタッフ個々への各シート共有は不要になる。
//
// デプロイ手順は同フォルダの README.md を参照。
// ============================================================

// このウェブアプリを呼び出せる OAuth クライアントID（サイト側と一致させる）
var CLIENT_ID = '248673786507-mdqci7it6nokcerj001k226k6fungjeu.apps.googleusercontent.com';

// ログインを許可するドメイン
var ALLOWED_DOMAIN = 'seichiku.org';

// 読み取り対象スプレッドシート（config.js と対応）
var DAILY_ID    = '1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4'; // 日報データベース
var MEMBER_ID   = '1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk'; // 会員名簿(サブスク)
var KAISU_ID    = '1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4'; // 回数券残高台帳
var ANALYSIS_ID = '1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94'; // 分析シート
var MASTER_ID   = '17vs50q2yaxK1NmuHaUgczXS8WMJQH38SSI65yhw3YaQ'; // 顧客マスタ（離客フォローリスト用）

// 返すシート一覧 [スプレッドシートID, シート名]。キーは "ID|シート名"。
var SHEET_SPECS = [
  [DAILY_ID,    'フォームの回答 2'],   // 日報（症例実績・喜びの声）
  [DAILY_ID,    'フォームの回答 1'],   // サンクススコアリング
  [DAILY_ID,    'フォームの回答 3'],   // 深掘り3名
  [MEMBER_ID,   'サマリー'],           // 会員名簿サマリー
  [KAISU_ID,    'サマリー'],           // 回数券台帳サマリー
  [ANALYSIS_ID, '分析'],               // 院予算ブロック
  [ANALYSIS_ID, 'フロー（3院）'],       // 予約率・受診率・離反率など
  [ANALYSIS_ID, '日次達成'],           // 院別・日次予算達成
  [ANALYSIS_ID, '戦術（先行指標）'],     // 転換提案/LINE発信/ロープレ
  [ANALYSIS_ID, '個人ランキング'],      // 個人ランキング
  [MASTER_ID,   '顧客マスタ'],           // 離客フォローリスト（氏名×院×最終来院日）
];

function doPost(e) {
  try {
    var idToken = (e && e.postData && e.postData.contents ? e.postData.contents : '').trim();
    var claims = verifyIdToken_(idToken);
    if (!claims) return json_({ ok: false, error: 'invalid_token' });

    // aud（発行先クライアント）の一致を確認
    if (claims.aud !== CLIENT_ID) return json_({ ok: false, error: 'aud_mismatch' });

    // メール確認済みか
    if (String(claims.email_verified) !== 'true') return json_({ ok: false, error: 'email_unverified' });

    // ドメイン制限
    var email = claims.email || '';
    var domain = email.split('@')[1];
    if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN) {
      return json_({ ok: false, error: 'domain_forbidden', domain: domain });
    }

    // 各シートを読み取り（キー = "ID|シート名"）。読めない場合は null（クライアント側で共有案内）。
    var sheets = {};
    var cache = {};
    for (var i = 0; i < SHEET_SPECS.length; i++) {
      var id = SHEET_SPECS[i][0];
      var name = SHEET_SPECS[i][1];
      var key = id + '|' + name;
      try {
        var ss = cache[id] || (cache[id] = SpreadsheetApp.openById(id));
        var sh = ss.getSheetByName(name);
        sheets[key] = sh ? sh.getDataRange().getDisplayValues() : [];
      } catch (err) {
        sheets[key] = null; // アクセス不可（共有未設定）
      }
    }

    return json_({
      ok: true,
      user: { name: claims.name || '', email: email, picture: claims.picture || '' },
      sheets: sheets,
    });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err) });
  }
}

// 動作確認用（ブラウザで /exec を開いたときの応答）
function doGet() {
  return json_({ ok: true, msg: 'みんなの実績 API. POST an id_token as the request body.' });
}

// ID token を Google の tokeninfo で検証（署名・有効期限もここで担保される）
function verifyIdToken_(idToken) {
  if (!idToken) return null;
  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    return null;
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
