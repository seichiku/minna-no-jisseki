// ============================================================
// 設定ファイル — ここを編集してください
// ============================================================

const CONFIG = {
  // Google OAuth Client ID（Google Cloud Console で作成）
  // 手順: https://console.cloud.google.com → APIとサービス → 認証情報 → OAuth 2.0 クライアントID
  GOOGLE_CLIENT_ID: '549687201713-okd4nunh3660l0eslvh5tqtkjhdarijq.apps.googleusercontent.com',

  // ログインを許可するドメイン（空配列 [] なら全Googleアカウント許可）
  ALLOWED_DOMAINS: ['seichiku.org'],

  // 日報データベース スプレッドシートID
  SPREADSHEET_ID: '1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4',

  // シート名とデータ範囲
  SHEETS: {
    // 日報フォーム回答（症例実績・喜びの声）
    DAILY_REPORT: {
      name: 'フォームの回答 2',
      range: 'A:Z',
      // カラムマッピング（0始まり。実際のシートに合わせて調整してください）
      columns: {
        timestamp: 0,    // タイムスタンプ
        date: 1,         // 本日の日付
        staffName: 2,    // 氏名
        clinic: 3,       // 所属院
        role: 4,         // 役割
        // 喜びの声・症例関連（フォームの列番号に合わせて調整）
        joyVoice: 10,       // 患者さまの喜びの声
        symptomCategory: 11, // 症状カテゴリ
        caseTitle: 12,       // 症例タイトル
      }
    },
    // サンクススコアリング（別シートまたは別スプレッドシート）
    THANKS: {
      name: 'サンクス',  // シート名を実際に合わせてください
      range: 'A:Z',
      columns: {
        timestamp: 0,
        from: 1,      // 送信者
        to: 2,         // 受信者
        message: 3,    // メッセージ
      }
    }
  },

  // サンクスが別スプレッドシートの場合はここにID（同じなら空文字）
  THANKS_SPREADSHEET_ID: '',
};
