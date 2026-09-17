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

// シート束のキャッシュ保持秒数。warmCache（5分おきトリガー）が温め続けるので、
// 実際のデータ鮮度は最大約5分。TTLはトリガー遅延に耐えるよう10分にしている。
var CACHE_TTL_SEC = 600;

// 読み取り対象スプレッドシート（config.js と対応）
var MEMBER_ID   = '1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk'; // 会員名簿(サブスク)
var KAISU_ID    = '1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4'; // 回数券残高台帳
var ANALYSIS_ID = '1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94'; // 分析シート
var MASTER_ID   = '17vs50q2yaxK1NmuHaUgczXS8WMJQH38SSI65yhw3YaQ'; // 顧客マスタ（離客フォローリスト用）
var WEEKLY_ID   = '1NiYQORX9I7imdlt-ycY6_Ry0CqYl0Y0W6gwS0mFqfvM'; // 週次効果測定ダッシュボード（口コミ回収 2026-08-21）
var TAC_ID      = '1Xwdlni7dCWkeFGu5NSvuwzTxMbCni5aR7Pdqm_zhFg8'; // 旧 戦術ダッシュボード（2026-09-09 廃止。キー名 "TAC_ID|行動ログ" は互換のため残す）
var ASA_ID      = '1xRXcMz1DzWUjvDZkZ2Jgoq9F_OewgKiTYyU4cKvA1ZM'; // 朝の仕込みDB（今日の宣言 2026-08-27）

// 各自の育成シート（2026-09-09〜 先行指標＝各シートの「戦術記録」タブ。1行=1アクション）
// 院は各シート「目標」タブの「所属」セルから読む（読めない時は clinic を使う）。
// 追加・退職はここを編集（config.js の ACTIONS.IKUSEI_URLS も揃える）。
var IKUSEI_TAB = '戦術記録';
var IKUSEI = [
  { name: '石本', clinic: '南砂', id: '1fNq7CWb4LLj7n1N5xJYVeMPXX_WI2QoFVdAvaiI7KUI' },
  { name: '加藤', clinic: '南砂', id: '1bdaM928jB-tuVmQ07Nfimzb98vHdhV0-ORhvOu1Zwkg' },
  { name: '白田', clinic: '南砂', id: '1W5ET1R8S_VB1U61vNODU6_zeo57N2Po5YqcofsdJXFA' },
  { name: '篠田', clinic: '塩浜', id: '1CWlIugWp_F3H26VW7d0nbU9YsYbWr3gDOm18lxbvTIQ' },
  { name: '中谷', clinic: '塩浜', id: '1tT5A-PzTK6JN2QKtcQ3et3RJo7egcWDQdY3T_Wm7w6U' },
  { name: '植田', clinic: '東砂', id: '1iRuROCZGWed0uWrDK6KDVpnn28qACS8FuUBbJxmWt8Y' },
  { name: '河内', clinic: '東砂', id: '1t-8i3kOSjjS1tTtzRM_r_mHCHrWOZHIDtmqj8R4QSE4' },
  { name: '作岡', clinic: '東砂', id: '1ZSTXQzxI1wNYoAaAK7RRuZWRBj1qcNdsQoZrMr1WHDw' },
  { name: '田村', clinic: '東砂', id: '1Fgx8btAiWCoOpFsO7AmHpWdqbmXao-HxOiTvrBgPp64' },
  { name: '栗田', clinic: '東砂', id: '1_74VwPTjpctG1AxWLBegq0Rp5xAbjcghOixHMHZvJdc' }
];

// 返すシート一覧 [スプレッドシートID, シート名]。キーは "ID|シート名"。
// 2026-08-28: 旧日報系3シート（フォームの回答 1/2/3）を除外＝日報システムは7月廃止で
// LPも未使用。一番重いデータだったため、読み取り時間と転送量を大きく削減。
var SHEET_SPECS = [
  [MEMBER_ID,   'サマリー'],           // 会員名簿サマリー
  [KAISU_ID,    'サマリー'],           // 回数券台帳サマリー
  [ANALYSIS_ID, '分析'],               // 院予算ブロック
  [ANALYSIS_ID, 'フロー（3院）'],       // 予約率・受診率・離反率など
  [ANALYSIS_ID, '日次達成'],           // 院別・日次予算達成
  [ANALYSIS_ID, '戦術（先行指標）'],     // 転換提案/LINE発信/ロープレ
  [ANALYSIS_ID, '個人ランキング'],      // 個人ランキング
  [MASTER_ID,   '顧客マスタ'],           // 離客フォローリスト（氏名×院×最終来院日）
  [WEEKLY_ID,   'GBP(3店舗)'],          // 口コミ回収の現状（クチコミ累計/週増分/評価・毎週水曜更新）
  [TAC_ID,      '行動ログ'],             // 先行指標の生ログ＝各自の育成シート「戦術記録」を統合（キー名は互換のため旧名のまま 2026-09-14）
  [ASA_ID,      '2026/8/28~'],          // 朝の仕込み＝今日の宣言（2026-08-27 質問改定で新シート化・日付入り名。質問改定ごとに紐づけ直し→ここを新タブ名に更新）
];

// アクセス集計タブの手動作り直し（レイアウト変更後に実行）。
// ファイル先頭の関数＝エディタが自動選択する（誤実行してもログから再集計するだけで安全）。
function rebuildAccessSummary() {
  var ss = SpreadsheetApp.openById(ANALYSIS_ID);
  var sh = ss.getSheetByName(ACCESS_SUM_TAB);
  if (sh) ss.deleteSheet(sh);
  ensureAccessSummary_(ss);
}

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

    // シート束を返す（通常はキャッシュ命中＝warmCacheが5分おきに温めている）
    return json_({
      ok: true,
      user: { name: claims.name || '', email: email, picture: claims.picture || '' },
      sheets: readBundle_(false),
      readAt: __readAt,   // 各シートの取得時刻（キャッシュ命中時はキャッシュに入れた時刻）
    });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err) });
  }
}

// ============================================================
// シート束の読み取り（キー = "ID|シート名"。読めない場合は null）
// forceRefresh=false: キャッシュ命中分はスキップ（doPost用）
// forceRefresh=true : 全件読み直してキャッシュを更新（warmCache用）
// 100KB/キー超のシートは put が失敗するので黙ってスキップ＝そのシートだけ毎回読む。
// ============================================================
var __readAt = {};   // キー→そのシートを実際に読んだ時刻(ms)。LPの「データ取得時刻」表示用（2026-09-14）
function readBundle_(forceRefresh) {
  var sheets = {};
  var cache = {};
  var cacheSvc = CacheService.getScriptCache();
  for (var i = 0; i < SHEET_SPECS.length; i++) {
    var id = SHEET_SPECS[i][0];
    var name = SHEET_SPECS[i][1];
    var key = id + '|' + name;
    var ck = 'b2|' + key; // キャッシュキー（形式変更時は番号を上げて無効化。b2=2026-09-14 {g,t}形式）
    if (!forceRefresh) {
      var hit = cacheSvc.get(ck);
      if (hit != null) {
        var obj = JSON.parse(hit);
        sheets[key] = obj.g;
        __readAt[key] = obj.t;
        continue;
      }
    }
    // Sheetsサービスの一時障害（"Service Spreadsheets failed while accessing document" が
    // 2026-08-29・09-04 に各1回）対策: 1.5秒待って1回だけ読み直す。それでも失敗なら null。
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var ss = cache[id] || (cache[id] = SpreadsheetApp.openById(id));
        var grid;
        if (id === TAC_ID && name === '行動ログ') {
          // 2026-09-14: 旧戦術ダッシュボードは廃止。各自の育成シート「戦術記録」を
          // 統合して従来スキーマで返す（キー "TAC_ID|行動ログ" はLP互換のため据え置き）。
          grid = readIkuseiTactics_();
        } else {
          var sh = ss.getSheetByName(name);
          // 「フロー（3院）」はタブ名に月が付く（例: フロー（3院）2026年8月）→プレフィックス一致で解決
          if (!sh && name === 'フロー（3院）') {
            var pool = ss.getSheets();
            for (var j = 0; j < pool.length; j++) {
              if (pool[j].getName().indexOf(name) === 0) { sh = pool[j]; break; }
            }
          }
          grid = sh ? sh.getDataRange().getDisplayValues() : [];
          // 顧客マスタは離客リストに使う3列（B=氏名/E=院/K=最終来院日）だけ返す（列位置は維持）
          if (id === MASTER_ID) grid = slimMaster_(grid);
          // 朝の仕込みはメールアドレス等を落とし、日付/担当者/役割/【宣言】列だけ返す
          if (id === ASA_ID) grid = slimAsa_(grid);
        }
        // 2026-09-17: 構築GASが分析シートのタブを削除→再作成→書き込み中（毎時 refreshHourly ／ 13・21時 refreshDaily）に
        // 読むと空や途中の表になる。キャッシュ済みより行数が半分未満に減った分析シートのタブは採用せず、前回の表を保つ（次の5分で拾う）。
        if (forceRefresh && id === ANALYSIS_ID) {
          var prevHit = cacheSvc.get(ck);
          if (prevHit != null) {
            var prevObj = JSON.parse(prevHit);
            var prevRows = (prevObj.g || []).length, newRows = (grid || []).length;
            if (prevRows >= 4 && newRows < prevRows * 0.5) {
              sheets[key] = prevObj.g; __readAt[key] = prevObj.t;   // キャッシュは延長しない＝万一本当に縮んだ表でもTTL(10分)後には新しい表を採用
              Logger.log('再生成中とみなし前回値を維持: ' + name + ' rows ' + prevRows + '→' + newRows);
              break;
            }
          }
        }
        sheets[key] = grid;
        __readAt[key] = new Date().getTime();
        try { cacheSvc.put(ck, JSON.stringify({ g: grid, t: __readAt[key] }), CACHE_TTL_SEC); } catch (ignore) {}
        break;
      } catch (err) {
        sheets[key] = null; // アクセス不可（共有未設定）。エラーはキャッシュしない
        if (attempt === 0) { delete cache[id]; Utilities.sleep(1500); }
      }
    }
  }
  return sheets;
}

// 5分おきの時間トリガーで実行（トリガーはGASエディタのUIから作成済み）。
// キャッシュを常に温めておくことで、誰がいつ開いてもキャッシュ命中（1〜3秒）で返す。
// readBundle_ の try/catch をすり抜ける Sheets 障害もあったため、関数全体を3秒後に1回だけやり直す
// （次の5分トリガーでも回復するので、2回目も失敗したときだけ失敗通知が届く）。
function warmCache() {
  try {
    readBundle_(true);
  } catch (e) {
    Utilities.sleep(3000);
    readBundle_(true);
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

// 各自の育成シート「戦術記録」タブ（A日付 B種別 C件数 Dメモ Eカテゴリ(自動) F実効件数(自動)）を
// 全員分統合し、従来の統一スキーマ（0=日付/1=院/2=担当者/3=種別/4=件数/6=カテゴリ）で返す。
// 先頭2行はヘッダー（row0[1]=読めた人・row0[2]=読めなかった人 → LPが「出どころ」に表示）。
// 日付は getValues() の Date を yyyy-MM-dd に正規化（表示値「9/1」のままだとLP側で年が判定できない）。
// 「9/1」のような文字列は今年扱い（1ヶ月以上未来なら前年）。
function readIkuseiTactics_() {
  var okNames = [], ngNames = [];
  var out = [
    ['戦術記録（育成シート・全員統合）', '', ''],
    ['日付', '院', '担当者', '種別', '件数', '', 'カテゴリ(自動)']
  ];
  var today = new Date();
  for (var i = 0; i < IKUSEI.length; i++) {
    var p = IKUSEI[i];
    try {
      var ss = SpreadsheetApp.openById(p.id);
      var sh = ss.getSheetByName(IKUSEI_TAB);
      if (!sh) { ngNames.push(p.name + '(タブ無し)'); continue; }
      var clinic = ikuseiClinic_(ss) || p.clinic;
      var lr = sh.getLastRow();
      if (lr < 3) { okNames.push(p.name); continue; }
      var vals = sh.getRange(3, 1, lr - 2, 6).getValues();
      var disp = sh.getRange(3, 1, lr - 2, 6).getDisplayValues();
      for (var r = 0; r < vals.length; r++) {
        var d = normDate_(vals[r][0], disp[r][0], today);
        var kind = String(disp[r][1] || '').trim();
        if (!d || !kind) continue;   // 日付か種別が無い行＝未入力（数式プリセットのみ）
        var row = [];
        row[0] = d;
        row[1] = clinic;
        row[2] = p.name;
        row[3] = kind;
        row[4] = String(disp[r][2] || '').trim();   // 件数（空欄=1件はLP側で解釈）
        row[6] = String(disp[r][4] || '').trim();   // カテゴリ(自動)
        out.push(row);
      }
      okNames.push(p.name);
    } catch (e) {
      ngNames.push(p.name);
    }
  }
  out[0][1] = okNames.join('・');
  out[0][2] = ngNames.join('・');
  return out;
}

// 育成シート「目標」タブの「所属」セル（例: 南砂院）から院名を取る。見つからなければ ''。
function ikuseiClinic_(ss) {
  try {
    var sh = ss.getSheets()[0];
    var v = sh.getRange(1, 1, 8, 2).getValues();
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][0]).trim() === '所属') return String(v[i][1] || '').replace('院', '').trim();
    }
  } catch (e) {}
  return '';
}

// 日付の正規化（Date→yyyy-MM-dd／「9/1」「2026/9/1」等の文字列→yyyy-MM-dd／不明→''）
function normDate_(val, dispVal, today) {
  var d = null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    d = val;
  } else {
    var t = String(dispVal || val || '').trim();
    var m = t.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
    if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else {
      m = t.match(/^(\d{1,2})[\/月](\d{1,2})/);
      if (m) {
        d = new Date(today.getFullYear(), +m[1] - 1, +m[2]);
        if (d.getTime() - today.getTime() > 31 * 86400000) d.setFullYear(d.getFullYear() - 1);
      }
    }
  }
  if (!d) return '';
  return Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
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
  if (!sh) {
    sh = ss.insertSheet(ACCESS_LOG_TAB, ss.getSheets().length);  // 末尾に作る
    sh.hideSheet();  // 生ログは隠しタブ＝人が見るのは「アクセス集計」（誰が何件は人別表）2026-08-29 竹中要望
  }
  // ヘッダー自己修復（初回作成が途中失敗しても次の呼び出しで直る 2026-08-25）
  if (String(sh.getRange(1, 1).getValue()) !== '日時') {
    if (sh.getLastRow() > 0) sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, 5).setValues([['日時', 'email', '氏名', '種別', 'タブ']]).setFontWeight('bold');
  }
  sh.appendRow([new Date(), email, name, type, tab]);
  try { ensureAccessSummary_(ss); } catch (e2) {}   // 集計タブも毎回チェック（存在すれば即return）
}
// 2026-08-28 レイアウト刷新（竹中要望「見づらい・余白が多い」対応）:
//   3表を横並び（A:C 人別 / E:F タブ別 / H:I 日別）＋ 22行目〜 人別×タブのピボット表。
//   日付列はQUERYのformat句で書式指定（旧版はシリアル値がそのまま見えていた）。
//   氏名「テスト」= curl疎通テストの行は閲覧系の表から除外。
function ensureAccessSummary_(ss) {
  if (ss.getSheetByName(ACCESS_SUM_TAB)) return;
  var sh = ss.insertSheet(ACCESS_SUM_TAB, ss.getSheets().length);  // 末尾に作る（先頭側のタブ順を乱さない）
  sh.setHiddenGridlines(true);
  sh.getRange(1,1,1,9).merge().setValue('みんなの実績 アクセス集計（誰が・いつ・どこを見ているか）')
    .setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle');
  sh.setRowHeight(1,30);
  sh.getRange(2,1,1,9).merge().setValue('▸ データ元: 隠しタブ「アクセスログ」（ログイン=中継API・タブ閲覧=LPが自動送信）。計測開始 2026-08-26。リアルタイム反映。')
    .setFontColor('#7f7f7f').setFontSize(9).setWrap(true);
  sh.getRange(4,1).setValue('■ 人別 ログイン').setFontWeight('bold');
  sh.getRange(5,1).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select C, count(A), max(A) where D=\'login\' group by C order by count(A) desc label C \'氏名\', count(A) \'回数\', max(A) \'最終ログイン\'",1),"まだログがありません")');
  sh.getRange(4,5).setValue('■ タブ別 閲覧数').setFontWeight('bold');
  sh.getRange(5,5).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select E, count(A) where D=\'tab\' and C != \'テスト\' group by E order by count(A) desc label E \'タブ\', count(A) \'閲覧数\'",1),"まだログがありません")');
  sh.getRange(4,8).setValue('■ 日別 ログイン数（直近14日）').setFontWeight('bold');
  sh.getRange(5,8).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select toDate(A), count(B) where D=\'login\' group by toDate(A) order by toDate(A) desc limit 14 label toDate(A) \'日\', count(B) \'ログイン数\'",1),"まだログがありません")');
  sh.getRange(22,1).setValue('■ 人別 × タブ別 閲覧数（行=氏名・列=タブ）').setFontWeight('bold');
  sh.getRange(23,1).setFormula('=IFERROR(QUERY(アクセスログ!A:E,"select C, count(A) where D=\'tab\' and C != \'テスト\' group by C pivot E label C \'氏名\'",1),"まだログがありません")');
  // 日付列の書式（QUERYのformat句はセル書式に反映されないため setNumberFormat で確実に指定）
  // ※22行目からのピボット表に食い込まないよう20行目まで（食い込むと件数が日付表示になる）
  sh.getRange(6,3,15,1).setNumberFormat('MM/dd HH:mm');   // 最終ログイン
  sh.getRange(6,8,15,1).setNumberFormat('MM/dd');          // 日別の日付
  // ヘッダー行（QUERYの1行目が入る位置）の見た目と列幅（ほぼ均一グリッド＝下段ピボットも同じ列で崩れない）
  sh.getRange(5,1,1,3).setFontWeight('bold').setBackground('#d9e1f2');
  sh.getRange(5,5,1,2).setFontWeight('bold').setBackground('#d9e1f2');
  sh.getRange(5,8,1,2).setFontWeight('bold').setBackground('#d9e1f2');
  sh.getRange(23,1,1,12).setFontWeight('bold').setBackground('#d9e1f2');
  var w=[130,90,110,110,140,90,90,90,90,100,100,100];
  for (var i=0;i<w.length;i++) sh.setColumnWidth(i+1,w[i]);
}

// 動作確認用（ブラウザで /exec を開いたときの応答）
function doGet(e) {
  // 2026-09-14: 育成シート読込の疎通確認（?diag=ikusei）。件数と読めた/読めなかった人だけ返す（個人情報なし）。
  if (e && e.parameter && e.parameter.diag === 'ikusei') {
    var g = readIkuseiTactics_();
    return json_({ ok: true, rows: g.length - 2, read: g[0][1], unread: g[0][2], sample: g.length > 2 ? g[2] : null });
  }
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
