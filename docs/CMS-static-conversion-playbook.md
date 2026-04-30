# CMSサイト静的HTML化プレイブック

このメモは、CMSサイトを「リンク切れ・画像漏れ・外部依存・レイアウト崩れ」をできるだけ起こさずに静的HTML化するための実務手順です。

## 基本方針

1. 本番CMSはバックアップを取ってから作業する。
2. CMSバックエンドで、できるだけ静的化しやすい状態に整える。
3. クローラーでHTML・CSS・JS・画像・フォント・PDF等を取得する。
4. ローカル参照へ変換する。
5. 不要なRSS/Atom、検索、ログイン、フォーム、管理系URLを除外または無効化する。
6. query URLは、必要なものだけ意味のある静的URLへ変換する。
7. 複数の監査スクリプトで「ファイル上」と「ブラウザ解決後」と「HTTP配信後」を確認する。
8. GitHub Pages / Cloudflare Pages などへ配置する。

## CMSバックエンドで事前に行うこと

- キャッシュを有効化し、公開側の表示を安定させる。
- 非公開・ログイン必須・管理者用ページをメニューや公開リンクから外す。
- 問い合わせフォーム、検索フォーム、コメント投稿、ログイン、会員機能など、静的化後に動かない機能を洗い出す。
- RSS/Atomが不要なら、HTML内のfeed linkを除去する前提にする。
- サイトマップ、メニュー、カテゴリ一覧、ページネーションを確認する。
- URL正規化を決める。
  - 例: `/blog.html?start=10` -> `/blog/page/2.html`
  - 例: `/links.html?task=weblink.go&id=...` -> 外部URLへ直接リンク
- 本番サイトで500を返すURLや壊れた拡張機能があれば、クローリング前に一覧化する。

## 推奨ディレクトリ構成

```text
project/
  site/                 # 配布する静的サイト本体
  crawl-output/         # 監査CSVやクロールログ
  *.mjs                 # 静的化・監査スクリプト
```

`site/` の中だけをGitHub PagesやCloudflare Pagesへアップロードする。`crawl-output/` や作業用スクリプトは公開不要。

## スクリプト運用順

このプロジェクトで使った主なスクリプトは次の通り。

### 取得・補修

```powershell
node static-crawl.mjs
node repair-static.mjs
node offline-clean.mjs
node localize-elements.mjs
```

目的:
- HTML、CSS、JS、画像、フォント、PDF等をローカルへ取得
- 絶対URLをローカル相対URLへ変換
- `base href` 起因の階層ズレを補正
- 画像・CSS・JSの欠落を補修

### 不要機能の除去

```powershell
node remove-google-analytics.mjs
node remove-feed-alternates.mjs
node speed-up-local-gimmicks.mjs
```

目的:
- Google Analyticsなどの外部読み込みを除去
- RSS/Atom参照を除去
- 静的サイトで不要な遅延ギミックや外部依存を減らす

### 表示崩れ対策

```powershell
node add-logo-preload.mjs
node inline-breadcrumb-dividers.mjs
node fix-breadcrumb-ascii.mjs
```

目的:
- ロゴなど重要画像の表示遅延を減らす
- パンくず記号など、Webフォント依存になりがちな記号をローカルまたは文字へ置換
- 外部フォントがなくても意味が通る表示にする

### query URL整理

CMS静的化では `?start=10` や `?Itemid=...` のようなURLが大量に出る。

今回の判断基準:

- RSS/Atom: 不要なら削除
- ページネーション: 意味のあるURLへ移動
  - `/blog.html?start=10` -> `/blog/page/2.html`
  - `/works/publication.html?start=20` -> `/works/publication/page/3.html`
- CMSの外部リンクリダイレクト: 中間ページを使わず外部URLへ直接リンク
- 同じ内容の `Itemid` 付きURL: 既存のクリーンURLへ統合
- 意味のない `__query/hash.html`: 最終成果物から削除

確認:

```powershell
Test-Path site\__query
rg -n "__query" site
```

期待結果:

```text
False
```

`rg` は一致なし。

### 監査

```powershell
node verify-static.mjs
node audit-static-integrity.mjs
node audit-browser-resolved-links.mjs
node audit-remote-resources.mjs
node audit-loading-dependencies.mjs
```

それぞれの役割:

- `verify-static.mjs`: ローカルリンク切れ確認
- `audit-static-integrity.mjs`: HTML/CSS/画像などの参照整合性確認
- `audit-browser-resolved-links.mjs`: ブラウザ基準で解決されるURL確認
- `audit-remote-resources.mjs`: 外部読み込み資源の残存確認
- `audit-loading-dependencies.mjs`: Webフォント、外部JS、遅延ギミック候補の確認

ローカルHTTP配信での最終確認:

```powershell
node audit-http-resources.mjs
```

このスクリプトは `toolkit.config.json` の `localOrigin` で `site/` が配信されている前提。サーバーを立ててから実行する。既定値は `http://127.0.0.1:8123`。

期待値:

```json
{
  "failures": 0
}
```

### 追加の手動確認

```powershell
rg -n -i "mailto:|<form\b|action=\"https?://|__query" site --glob "*.html"
rg -n -i "googleapis|gstatic|fontawesome|ajax.googleapis|analytics|googletagmanager" site
```

見るポイント:

- 問い合わせメールや個人情報が残っていないか
- 外部フォントや外部CDNを読みに行っていないか
- 静的化後に動かないフォームが残っていないか
- query中間ページが残っていないか

## URL変換の考え方

静的化では「元のURLを完全再現」よりも「意味の通る静的URL」を優先した方が保守しやすい。

推奨:

```text
/blog.html?start=10
  -> /blog/page/2.html

/blog/itemlist/category/24-official-series.html?start=20
  -> /blog/itemlist/category/24-official-series/page/3.html

/links.html?task=weblink.go&id=123
  -> 直接 <external-url>
```

避けたいもの:

```text
/__query/f897665b7ff2.html
```

理由:

- 意味が分からない
- 将来の修正が難しい
- ユーザーが見たとき不自然
- GitHub Pages等では問題ないが、保守性が低い

## 最終チェックリスト

- `site/__query` が存在しない
- `rg -n "__query" site` が一致なし
- `verify-static.mjs` が `missingLocalLinks: 0`
- `audit-static-integrity.mjs` が `total: 0`
- `audit-browser-resolved-links.mjs` が `total: 0`
- `audit-remote-resources.mjs` が `remoteResources: 0`
- `audit-http-resources.mjs` が `failures: 0`
- トップページのロゴが即時表示される
- 主要ページのロゴが即時表示される
- パンくず記号がWebフォントなしでも表示される
- カルーセルが外部読み込み待ちになっていない
- ブログやカテゴリのページ送りがリンク切れしない
- 外部サイトへのリンクは直接外部URLへ向く
- RSS/Atomが不要ならHTMLから消えている
- 問い合わせメールやフォームが不要なら消えている
- GitHub Pages等へpush後、公開URLでも代表ページを確認する

## GitHub Pages配置メモ

`site/` をリポジトリルートとして管理するのが楽。

```powershell
cd site
git status
git add -A
git commit -m "Update static site"
git push
```

DNS:

- apex `<domain>`: GitHub Pagesの4つのAレコード
- `www`: `<account>.github.io` へのCNAME
- GitHub Pages側でCustom domainを設定
- Enforce HTTPSを有効化

DNS確認:

```powershell
Resolve-DnsName <domain> -Type A -Server 1.1.1.1
Resolve-DnsName <domain> -Type A -Server 8.8.8.8
Resolve-DnsName www.<domain> -Type CNAME -Server 1.1.1.1
curl.exe -I --resolve <domain>:443:<github-pages-ip> https://<domain>/
```
