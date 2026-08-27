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

// ドメイン外でもログインを許可する個人アドレス（名指しホワイトリスト 2026-08-27）
// スタッフがスマホの個人Gmailのまま閲覧できるようにする。退職時はここから削除。
var ALLOWED_EMAILS = [
  'lsdcompany0130@gmail.com',   // 竹中
  '0919u.yuji0919@gmail.com',   // 植田
  'u.snooow1@gmail.com',        // 白田
  'my.b.naaaao@gmail.com',      // 有山
  'y41891189@gmail.com',        // 篠田
  'nightmare8121@gmail.com',    // 中谷
  'jun.ishi0615@gmail.com',     // 石本
  '1005revo@gmail.com'          // 加藤
];

// シート束のキャッシュ保持秒数（分析シートは毎日13/21時更新なので5分で十分新鮮）
var CACHE_TTL_SEC = 300;

// 読み取り対象スプレッドシート（config.js と対応）
var DAILY_ID    = '1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4'; // 日報データベース
var MEMBER_ID   = '1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk'; // 会員名簿(サブスク)
var KAISU_ID    = '1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4'; // 回数券残高台帳
var ANALYSIS_ID = '1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94'; // 分析シート
var MASTER_ID   = '17vs50q2yaxK1NmuHaUgczXS8WMJQH38SSI65yhw3YaQ'; // 顧客マスタ（離客フォローリスト用）
var WEEKLY_ID   = '1NiYQORX9I7imdlt-ycY6_Ry0CqYl0Y0W6gwS0mFqfvM'; // 週次効果測定ダッシュボード（口コミ回収 2026-08-21）
var TAC_ID      = '1Xwdlni7dCWkeFGu5NSvuwzTxMbCni5aR7Pdqm_zhFg8'; // 戦術ダッシュボード（行動ログ 2026-08-27）
var ASA_ID      = '1xRXcMz1DzWUjvDZkZ2Jgoq9F_OewgKiTYyU4cKvA1ZM'; // 朝の仕込みDB（今日の宣言 2026-08-27）

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
  [TAC_ID,      '行動ログ'],             // 提案/LINE/ロープレの生ログ（宣言vs実行・先行指標の内訳）
  [ASA_ID,      '2026/8/28~'],          // 朝の仕込み＝今日の宣言（2026-08-27 質問改定で新シート化・日付入り名。質問改定ごとに紐づけ直し→ここを新タブ名に更新）
];

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents ? e.postData.contents : '').trim();
    // 閲覧ログ（LPのsendBeacon・JSON形式）＝社内アクセス解析用の軽量イベント（2026-08-26 竹中要望）
    if (body.charAt(0) === '{') {
      try { var ev = JSON.parse(body); logAccess_(String(ev.email||''), String(ev.name||''), 'tab', String(ev.tab||'')); } catch (ig) {}
      return json_({ ok: true });
    }
    var idToken = body;
    var claims = verifyIdToken_(idToken);
    if (!claims) return json_({ ok: false, error: 'invalid_token' });

    // aud（発行先クライアント）の一致を確認
    if (claims.aud !== CLIENT_ID) return json_({ ok: false, error: 'aud_mismatch' });

    // メール確認済みか
    if (String(claims.email_verified) !== 'true') return json_({ ok: false, error: 'email_unverified' });

    // ドメイン制限
    var email = claims.email || '';
    var domain = email.split('@')[1];
    if (ALLOWED_DOMAIN && domain !== ALLOWED_DOMAIN &&
        ALLOWED_EMAILS.indexOf(String(email).toLowerCase()) < 0) {
      return json_({ ok: false, error: 'domain_forbidden', domain: domain });
    }

    // ログイン記録（アクセス解析 2026-08-26）
    try { logAccess_(email, String(claims.name||''), 'login', ''); } catch (ig2) {}

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
        // 行動ログは2026-08-27夜から月×院別タブ（例:「南砂 8月」）。
        // キーは従来どおり "TAC_ID|行動ログ" のまま、当月3タブを統合スキーマで返す。
        if (id === TAC_ID && name === '行動ログ') {
          var gridT = readTacticsMerged_(ss);
          sheets[key] = gridT;
          try { cacheSvc.put(ck, JSON.stringify(gridT), CACHE_TTL_SEC); } catch (ignoreT) {}
          continue;
        }
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
        // 朝の仕込みはメールアドレス等を落とし、日付/担当者/役割/【宣言】列だけ返す
        if (id === ASA_ID) grid = slimAsa_(grid);
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

// 戦術ダッシュボードの当月・院別行動ログタブ（「南砂 8月」等）を統合し、
// 従来の統一スキーマ（0=日付/1=院/2=担当者/3=種別/4=件数/6=カテゴリ）で返す。
// 各タブは A日付 B担当者 C種別 D件数 Eメモ Fカテゴリ(自動) G実効件数(自動)。
// 未入力行（数式プリセットだけの行）はスキップ。LP側の列マッピングは v2 から不変。
function readTacticsMerged_(ss) {
  var clinics = ['南砂', '塩浜', '東砂'];
  var m = new Date().getMonth() + 1;
  var out = [
    ['行動ログ（当月・3院統合）'],
    ['日付', '院', '担当者', '種別', '件数', '', 'カテゴリ(自動)']
  ];
  for (var c = 0; c < clinics.length; c++) {
    var sh = ss.getSheetByName(clinics[c] + ' ' + m + '月');
    if (!sh) continue;
    var grid = sh.getDataRange().getDisplayValues();
    for (var i = 2; i < grid.length; i++) {
      var r = grid[i] || [];
      if (String(r[0] || '') === '') continue;
      var row = [];
      row[0] = r[0] || '';        // 日付
      row[1] = clinics[c];        // 院（タブ名から）
      row[2] = r[1] || '';        // 担当者
      row[3] = r[2] || '';        // 種別
      row[4] = r[3] || '';        // 件数
      row[6] = r[5] || '';        // カテゴリ(自動)
      out.push(row);
    }
  }
  return out;
}

// 朝の仕込みDBを Timestamp/日付/担当者/役割＋「【宣言】」で始まる列だけに間引く
// （メールアドレスや自由記述の仕込み本文はLPに送らない）
function slimAsa_(grid) {
  if (!grid || !grid.length) return grid;
  var head = grid[0] || [];
  var keep = [0, 2, 3, 4];
  for (var c = 0; c < head.length; c++) {
    if (String(head[c]).indexOf('【宣言】') === 0) keep.push(c);
  }
  var out = [];
  for (var i = 0; i < grid.length; i++) {
    var r = grid[i] || [];
    var row = [];
    for (var k = 0; k < keep.length; k++) row[keep[k]] = r[keep[k]] || '';
    out.push(row);
  }
  return out;
}

// ============================================================
// アクセス解析（2026-08-26 竹中要望: 誰が・いつ・どのタブを見ているか）
// 「アクセスログ」（隠しタブ・生ログ）と「アクセス集計」（QUERY数式の見えるタブ）を
// 分析シートに自動作成。ログイン=doPost成功時、タブ閲覧=LPのsendBeacon。
// ============================================================
var ACCESS_LOG_TAB = 'アクセスログ';
var ACCESS_SUM_TAB = 'アクセス集計';
function logAccess_(email, name, type, tab) {
  var ss = SpreadsheetApp.openById(ANALYSIS_ID);
  var sh = ss.getSheetByName(ACCESS_LOG_TAB);
  if (!sh) sh = ss.insertSheet(ACCESS_LOG_TAB);
  // ヘッダー自己修復（初回作成が途中失敗しても次の呼び出しで直る 2026-08-25）
  if (String(sh.getRange(1, 1).getValue()) !== '日時') {
    if (sh.getLastRow() > 0) sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, 5).setValues([['日時', 'email', '氏名', '種別', 'タブ']]).setFontWeight('bold');
  }
  sh.appendRow([new Date(), email, name, type, tab]);
  try { ensureAccessSummary_(ss); } catch (e2) {}   // 集計タブも毎回チェック（存在すれば即return）
}
function ensureAccessSummary_(ss) {
  if (ss.getSheetByName(ACCESS_SUM_TAB)) return;
  var sh = ss.insertSheet(ACCESS_SUM_TAB);
  sh.setHiddenGridlines(true);
  sh.getRange(1,1,1,8).merge().setValue('みんなの実績 アクセス集計（誰が・いつ・どこを見ているか）')
    .setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle');
  sh.setRowHeight(1,30);
  sh.getRange(2,1,1,8).merge().setValue('▸ データ元: 隠しタブ「アクセスログ」（ログイン=中継API・タブ閲覧=LPが自動送信）。計測開始 2026-08-26。リアルタイム反映。')
    .setFontColor('#7f7f7f').setFontSize(9).setWrap(true);
  sh.getRange(4,1).setValue('■ 人別（ログイン回数・最終ログイン）').setFontWeight('bold');
  sh.getRange(5,1).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select C, B, count(A), max(A) where D=\'login\' group by C, B order by count(A) desc label C \'氏名\', B \'email\', count(A) \'ログイン回数\', max(A) \'最終ログイン\'",1),"まだログがありません")');
  sh.getRange(4,7).setValue('■ タブ別 閲覧数').setFontWeight('bold');
  sh.getRange(5,7).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select E, count(A) where D=\'tab\' group by E order by count(A) desc label E \'タブ\', count(A) \'閲覧数\'",1),"まだログがありません")');
  sh.getRange(20,1).setValue('■ 日別ログイン数（直近14日）').setFontWeight('bold');
  sh.getRange(21,1).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select toDate(A), count(B) where D=\'login\' group by toDate(A) order by toDate(A) desc limit 14 label toDate(A) \'日\', count(B) \'ログイン数\'",1),"まだログがありません")');
  sh.getRange(20,4).setValue('■ 人別×タブ別 閲覧数').setFontWeight('bold');
  sh.getRange(21,4).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select C, E, count(A) where D=\'tab\' group by C, E order by C, count(A) desc label C \'氏名\', E \'タブ\', count(A) \'閲覧数\'",1),"まだログがありません")');
  sh.setColumnWidth(1,140); sh.setColumnWidth(2,220); sh.setColumnWidth(4,140);
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
