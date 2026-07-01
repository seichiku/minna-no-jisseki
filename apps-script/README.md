# みんなの実績 — Apps Script（データ中継API）デプロイ手順

「このアプリは Google で確認されていません」警告を無くすため、スプレッドシートの
読み取りを **Apps Script ウェブアプリ**に移しました。ブラウザ側は「Google でログイン」の
**ID 確認だけ**を行い、機密スコープ（spreadsheets）を一切要求しません。

この API を一度デプロイし、発行された URL を `config.js` の `APPS_SCRIPT_URL` に貼れば設定完了です。

## 前提

- デプロイに使う Google アカウントは、以下 4 つのスプレッドシートを**すべて閲覧できる**こと：
  - 日報データベース `1VtEYc26jifylOmEewOQSalzPNwT0MDXx9hupQiTLDo4`
  - 会員名簿(サブスク) `1GF75uOiAM363___Nf13rkQYTs4vPsEXyr1zt4E1uTUk`
  - 回数券残高台帳 `1TZjeowvbF6fqPA2BmE-ryxk360v3E-ZkSgBbknMCMc4`
  - 分析シート `1mIGrmd9S6QrOZz8t5Ntqm9Tqs37JWW_aVVb54AZjh94`
  - 読めないシートは画面に「共有してください」と表示されるので、その場合は
    デプロイ主に閲覧共有を追加する。
- OAuth クライアント ID `248673786507-…` の**承認済み JavaScript 生成元**に
  `https://seichiku.github.io` が入っていること（判断DBと同一クライアントなので設定済み）。

## 手順

1. https://script.google.com/ を開き、**新しいプロジェクト**を作成する。
2. 既定の `コード.gs` の中身を、このフォルダの [`Code.gs`](./Code.gs) の内容で**丸ごと置き換える**。
3. 右上の **デプロイ** →「**新しいデプロイ**」。
   - 種類：**ウェブアプリ**
   - **次のユーザーとして実行**：**自分**（＝各シートを読めるアカウント）
   - **アクセスできるユーザー**：**全員**
     （実際のアクセス制御は Code.gs 内で ID token 検証＋@seichiku.org 限定により行う）
4. 初回は権限承認を求められる → 自分のアカウントで許可する（「詳細」→「移動」）。
5. 発行された **ウェブアプリ URL**（`https://script.google.com/macros/s/XXXX/exec`）をコピー。
6. `config.js` の `APPS_SCRIPT_URL` にその URL を貼り付けて commit / push。

## 動作確認

- ブラウザで `…/exec` を直接開くと `{"ok":true,"msg":"…"}` が表示されれば公開OK。
- サイト（`/minna-no-jisseki/`）で @seichiku.org アカウントのログインボタンを押し、
  警告画面が出ずにダッシュボードが表示されれば成功です。

## コードを更新したとき

`Code.gs` を編集したら、**デプロイ →「デプロイを管理」→ 既存のデプロイを編集 →
バージョンを「新規」にして保存**（URL は変わりません）。新規デプロイを作ると URL が変わるので注意。
