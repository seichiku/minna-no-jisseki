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
      range: 'A:W',
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
    // プライムタスクフォーム連携後、フォームの回答 3 として自動作成される想定
    DEEP_DIVE: {
      name: 'フォームの回答 3',
      range: 'A:Z',
      columns: {
        timestamp: 0,        // タイムスタンプ
        date: 1,             // 本日の日付
        staffName: 2,        // 氏名
        clinic: 3,           // 所属院
        // 残りはプライムタスク本体（その日の行動目標等）
        // 深掘り3名（フォーム末尾、月初・変更時のみ入力）
        deepDive1: 10,       // ※実際の列番号はフォーム連携後に確定
        deepDive2: 11,
        deepDive3: 12,
      }
    }
  },

  // 院名のリスト
  CLINICS: ['東砂院', '南砂院', '塩浜院'],
};
