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

  // ============================================================
  // 判断データベース（植田 公開判断ミラー）
  // 判断ログDB（非公開・竹中＋植田）から「公開用（植田）」「成長ランキング」だけを
  // IMPORTRANGE で写したミラー。顧客No.等の患者特定情報はミラー時点で除外済み。
  // ※このミラーをログインユーザー（@seichiku.org）に閲覧共有しておくこと。
  // ============================================================
  HANDAN_SPREADSHEET_ID: '17L_Bx75HJT1uv-DibxhwfCTU6vvEn3SLuBBHGBMYv3k',
  HANDAN_SHEETS: {
    // 植田の公開判断（教材）
    PUBLIC_JUDGMENT: {
      name: '公開判断',
      range: 'A:X',
      columns: {
        timestamp: 0,
        date: 1,           // 施術日
        staff: 2,          // 担当者
        clinic: 3,         // 院
        problemNo: 4,      // 何個目の悩み？
        type: 5,           // 種別（初再診/転機/離反）
        // 初再診（BEFORE）
        hypothesis: 6,     // 仮説：原因を何だと読んだ？
        evidence: 7,       // 根拠
        reason: 8,         // 施術を選んだ理由
        risk: 9,           // リスク／失敗条件
        alt: 10,           // 別案
        // 転機（AFTER・答え合わせ→新しい判断）
        checkPrev: 11,     // 前回の仮説、実際どうだった？
        checkGap: 12,      // 予想とのズレは？
        newHypothesis: 13, // 次の悩みの仮説
        newEvidence: 14,   // その根拠
        newReason: 15,     // 施術を選んだ理由
        newRisk: 16,       // リスク
        newAlt: 17,        // 別案
        // 離反
        churnWhy: 18,      // なぜ離反したと思う？
        churnPivot: 19,    // どの判断が分岐点だった？
        churnNext: 20,     // 次に同じ状況なら
        // 評価
        uedaComment: 21,   // 植田添削（コメント）
        gapImprove: 22,    // ギャップ改善(-2〜+2)
        commentReflect: 23,// 添削反映(0〜2)
      }
    },
    // 成長ランキング（前月比の伸びで順位・正直さは点数化しない）
    // 先頭にタイトル/注記行があるため、データ行は parse 側で判定する
    GROWTH_RANKING: {
      name: '成長ランキング',
      range: 'A:G',
      columns: {
        staff: 0,      // 担当者
        gapAvg: 1,     // 今月 ギャップ改善(平均)
        reflectAvg: 2, // 今月 添削反映(平均)
        scoreNow: 3,   // 今月 成長スコア
        scorePrev: 4,  // 前月 成長スコア
        delta: 5,      // 伸び(Δ)
        rank: 6,       // 順位
      }
    }
  },
};
