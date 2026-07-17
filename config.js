// ============================================================
// 設定ファイル — ここを編集してください
// ============================================================

const CONFIG = {
  // Google OAuth Client ID（ID確認＝Sign in with Google 専用に使用）
  // ※ 機密スコープ（spreadsheets）は要求しないため「このアプリはGoogleで
  //    確認されていません」警告は表示されない。
  GOOGLE_CLIENT_ID: '248673786507-mdqci7it6nokcerj001k226k6fungjeu.apps.googleusercontent.com',

  // Apps Script ウェブアプリのURL（データ中継API）
  // apps-script/Code.gs をデプロイして得た /exec URL を貼る。
  // 全シートの読み取りはこのサーバー側で行い、ブラウザには spreadsheets 権限を
  // 一切要求しない（＝未確認アプリ警告を回避）。各シートのスタッフ個別共有も不要。
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyTUM0MIjYag0sm67laJYlcy-gqhUCK2lRMzjEPQaj61vYEFUECIzn7nidMXK4c5WO5/exec',

  // ログインを許可するドメイン（空配列 [] なら全Googleアカウント許可）
  // ※ 正式な判定は Apps Script 側でも行う（クライアント側は早期チェック用）。
  ALLOWED_DOMAINS: ['seichiku.org'],

  // 日報データベース スプレッドシートID
  SPREADSHEET_ID: '1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4',

  // シート名とデータ範囲
  SHEETS: {
    // 日報フォーム回答（症例実績・喜びの声）
    // 1日に最大3患者の記録を持つ構造
    DAILY_REPORT: {
      name: 'フォームの回答 2',
      range: 'A:X',
      columns: {
        timestamp: 0,        // タイムスタンプ
        date: 1,             // 本日の日付
        staffName: 2,        // 氏名
        clinic: 3,           // 所属院
        role: 4,             // 役割
        // 患者①
        p1Name: 5,
        p1Treatment: 6,
        p1Reaction: 7,
        p1Hypothesis: 8,
        p1NextNote: 9,
        // 患者②
        p2Name: 10,
        p2Treatment: 11,
        p2Reaction: 12,
        p2Hypothesis: 13,
        p2NextNote: 14,
        // 患者③
        p3Name: 15,
        p3Treatment: 16,
        p3Reaction: 17,
        p3Hypothesis: 18,
        p3NextNote: 19,
        // サマリ
        closingCount: 20,    // 次回予約クロージング数
        symptomCategory: 21, // 症状カテゴリ
        joyVoice: 22,        // 患者さまの喜びの声
        // 深掘り対象マーカー（2026-06-01 追加）
        deepDiveMark: 23,    // 「患者①」「患者②」「患者③」のチェックボックス、カンマ区切り
      }
    },
    // サンクススコアリング
    THANKS: {
      name: 'フォームの回答 1',
      range: 'A:E',
      columns: {
        timestamp: 0,    // タイムスタンプ
        from: 1,         // 送信者（あなた）
        to: 2,           // 受取人
        points: 3,       // 送るポイント（pt）
        message: 4,      // 称賛のエピソード
      }
    },
    // 月間深掘り3名（プライムタスクフォームの回答から、月初/変更時のみ）
    // 2026-06-01 フォーム連携で「フォームの回答 3」シート自動作成済み
    DEEP_DIVE: {
      name: 'フォームの回答 3',
      range: 'A:AB',
      columns: {
        timestamp: 0,        // タイムスタンプ
        date: 1,             // 本日の日付
        staffName: 2,        // 氏名
        clinic: 3,           // 所属院
        // 患者①〜③（F〜T = 5〜19）は症例ストーリー用、深掘り判定には未使用
        deepDive1: 20,       // 今月の深掘り患者① 氏名／イニシャル
        deepDive2: 21,       // 今月の深掘り患者② 氏名／イニシャル
        deepDive3: 22,       // 今月の深掘り患者③ 氏名／イニシャル
      }
    }
  },

  // 院名のリスト
  CLINICS: ['東砂院', '南砂院', '塩浜院'],

  // ============================================================
  // チーム実績ダッシュボード（サブスク導線・チームファースト）
  // ストックは会員名簿/回数券台帳サマリーからライブ取得（同一OAuth・要seichiku.org共有）
  // 院予算/個人余剰は7月日計表稼働後に分析シートから充填（現状は器）
  // ============================================================
  KPI: {
    ANALYSIS_ID: '1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94', // 分析シート
    MEMBER_ID:   '1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk', // 会員名簿(サブスク)
    KAISU_ID:    '1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4', // 回数券残高台帳
    MEMBER_SHEET: 'サマリー',
    KAISU_SHEET:  'サマリー',
    ANALYSIS_TAB: '分析',          // 院予算ブロック(達成度/信号)をライブ取得
    FLOW_TAB:     'フロー（3院）',   // 予約率(既存/新患/再診)をライブ取得
    PERSONAL_TAB: '個人ランキング',  // 個人ランキング(順位/施術者/院/売上/達成/目的休暇/稼働率/人時)
    DAILY_TAB:    '日次達成',        // 院別・毎日の予算達成(日割予算/診療日数/直近/1〜31日)
    TACTICS_TAB:  '戦術（先行指標）',  // 戦術ダッシュボード月次集計(転換提案/LINE発信/ロープレ)
    SUB_GOAL: 90,      // 12月サブ在籍ゴール
    ORDER_GOAL: 6,     // オーダー回数券 6名/施術者
    CLINICS: ['南砂', '塩浜', '東砂'],
    STAFF: ['石本', '加藤', '白田', '植田', '有山', '竹中'],
  },

  // ============================================================
  // 離客フォローリスト（各院ページ：顧客マスタの最終来院日から算出）
  // 1ヶ月離客=最終来院から30〜59日／2ヶ月離客=60〜89日ぶりに来院が途切れた方。
  // 氏名(B)・院(E)・最終来院日(K)を使用。中継API(SHEET_SPECS)に顧客マスタを追加済み。
  // ※最終来院日は2026年7月の日計表稼働後に蓄積→リストが揃うのは8〜9月以降。
  // ============================================================
  RIHAN: {
    MASTER_ID:    '17vs50q2yaxK1NmuHaUgczXS8WMJQH38SSI65yhw3YaQ', // 顧客マスタ
    MASTER_SHEET: '顧客マスタ',
    COL: { name: 1, clinic: 4, lastVisit: 10 }, // B=氏名 / E=院 / K=最終来院日
    M1_MIN: 30, M1_MAX: 59,  // 1ヶ月離客（区間）
    M2_MIN: 60, M2_MAX: 89,  // 2ヶ月離客（区間）
  },
};
