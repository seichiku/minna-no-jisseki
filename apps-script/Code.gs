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

// シート束のキャッシュ保持秒数（分析シートは毎日13/21時更新なので5分で十分新鮮）
var CACHE_TTL_SEC = 300;

// 読み取り対象スプレッドシート（config.js と対応）
var DAILY_ID    = '1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4'; // 日報データベース
var MEMBER_ID   = '1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk'; // 会員名簿(サブスク)
var KAISU_ID    = '1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4'; // 回数券残高台帳
var ANALYSIS_ID = '1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94'; // 分析シート
var MASTER_ID   = '17vs50q2yaxK1NmuHaUgczXS8WMJQH38SSI65yhw3YaQ'; // 顧客マスタ（離客フォローリスト用）
var WEEKLY_ID   = '1NiYQORX9I7imdlt-ycY6_Ry0CqYl0Y0W6gwS0mFqfvM'; // 週次効果測定ダッシュボード（口コミ回収 2026-08-21）

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
  [WEEKLY_ID,   'GBP(3店舗)'],          // 口コミ回収の現状（クチコミ累計/週増分/評価・毎週水曜更新）
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
    // 2026-08-19: CacheService で5分キャッシュ（全員が同じデータを見るため）。
    // 初回ログインは従来通り〜10秒だが、キャッシュ命中時は1〜2秒で返る。
    // 100KB/キー超のシートは put が失敗するので黙ってスキップ＝そのシートだけ毎回読む。
    var sheets = {};
    var cache = {};
    var cacheSvc = CacheService.getScriptCache();
    for (var i = 0; i < SHEET_SPECS.length; i++) {
      var id = SHEET_SPECS[i][0];
      var name = SHEET_SPECS[i][1];
      var key = id + '|' + name;
      var ck = 'b1|' + key; // キャッシュキー（形式変更時は b2| に上げて無効化）
      var hit = cacheSvc.get(ck);
      if (hit != null) {
        sheets[key] = JSON.parse(hit);
        continue;
      }
      try {
        var ss = cache[id] || (cache[id] = SpreadsheetApp.openById(id));
        var sh = ss.getSheetByName(name);
        // 「フロー（3院）」は2026-08-17からタブ名に月が付く（例: フロー（3院）2026年8月）。
        // キーは従来どおり "ID|フロー（3院）" のまま、プレフィックス一致で実タブを解決する。
        if (!sh && name === 'フロー（3院）') {
          var pool = ss.getSheets();
          for (var j = 0; j < pool.length; j++) {
            if (pool[j].getName().indexOf(name) === 0) { sh = pool[j]; break; }
          }
        }
        var grid = sh ? sh.getDataRange().getDisplayValues() : [];
        // 顧客マスタは離客リストに使う3列（B=氏名/E=院/K=最終来院日）だけ返す（列位置は維持）
        if (id === MASTER_ID) grid = slimMaster_(grid);
        sheets[key] = grid;
        try { cacheSvc.put(ck, JSON.stringify(grid), CACHE_TTL_SEC); } catch (ignore) {}
      } catch (err) {
        sheets[key] = null; // アクセス不可（共有未設定）。エラーはキャッシュしない
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

// 顧客マスタを離客リスト用の3列（B=1/E=4/K=10）だけの疎な行に間引く（クライアントの列番号は不変）
function slimMaster_(grid) {
  var out = [];
  for (var i = 0; i < grid.length; i++) {
    var r = grid[i] || [];
    var row = [];
    row[1] = r[1] || '';   // 氏名
    row[4] = r[4] || '';   // 院
    row[10] = r[10] || ''; // 最終来院日
    out.push(row);
  }
  return out;
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
