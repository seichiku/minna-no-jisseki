// ============================================================
// 設定ファイル — ここを編集してください
// ============================================================

const CONFIG = {
  // Google OAuth Client ID（Google Cloud Console で作成）
  // 手順: https://console.cloud.google.com → APIとサービス → 認証情報 → OAuth 2.0 クライアントID
  GOOGLE_CLIENT_ID: '248673786507-mdqci7it6nokcerj001k226k6fungjeu.apps.googleusercontent.com',

  // ログインを許可するドメイン（空配列 [] なら全Googleアカウント許可）
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
};
