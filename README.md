# CMS Static HTML Toolkit

CMSで作られたサイトを静的HTML化するときに再利用するための作業セットです。

対象サイトは `toolkit.config.json` または環境変数で指定します。

## 中身

```text
cms-static-html-toolkit/
  README.md
  toolkit.config.example.json
  docs/
    CMS-static-conversion-playbook.md
    CMS-static-conversion-prompts.md
  scripts/
    *.mjs
```

## 使い方

新しい案件では、作業ディレクトリにこのフォルダをコピーし、対象サイト用に次の構成を作ります。

```text
project/
  site/                 # 静的サイト出力先
  crawl-output/         # 監査CSV・クロールログ出力先
  cms-static-html-toolkit/
  toolkit.config.json
```

まず設定ファイルを作ります。

```powershell
Copy-Item cms-static-html-toolkit\toolkit.config.example.json toolkit.config.json
```

`toolkit.config.json` の最低限の設定:

```json
{
  "targetOrigin": "https://www.example.com",
  "startUrls": ["/"],
  "internalHosts": ["www.example.com", "example.com"],
  "canonicalHost": "www.example.com"
}
```

スクリプトは原則として、`site/` と `crawl-output/` があるプロジェクトルートで実行します。

```powershell
cd project
node cms-static-html-toolkit\scripts\verify-static.mjs
```

既存スクリプトをルート直下に置いて使いたい場合は、`scripts/` の中身をプロジェクトルートへコピーしても構いません。

## 標準ワークフロー

### 1. CMS側の準備

まず以下を読む。

```text
docs/CMS-static-conversion-playbook.md
```

CMSバックエンドで、非公開ページ、ログイン、問い合わせフォーム、RSS/Atom、検索、コメント投稿などを整理します。

### 2. クロール・ローカル化

```powershell
node scripts\static-crawl.mjs
node scripts\repair-static.mjs
node scripts\offline-clean.mjs
node scripts\localize-elements.mjs
```

### 3. 外部依存・不要機能の除去

```powershell
node scripts\remove-google-analytics.mjs
node scripts\remove-feed-alternates.mjs
node scripts\speed-up-local-gimmicks.mjs
```

### 4. 表示崩れ対策

```powershell
node scripts\add-logo-preload.mjs
node scripts\inline-breadcrumb-dividers.mjs
node scripts\fix-breadcrumb-ascii.mjs
node scripts\fix-query-base.mjs
```

### 5. 監査

```powershell
node scripts\verify-static.mjs
node scripts\audit-static-integrity.mjs
node scripts\audit-browser-resolved-links.mjs
node scripts\audit-remote-resources.mjs
node scripts\audit-loading-dependencies.mjs
```

HTTP配信後の確認は、`site/` を `toolkit.config.json` の `localOrigin` で配信してから実行します。既定値は `http://127.0.0.1:8123` です。

```powershell
node scripts\audit-http-resources.mjs
```

## 重要な合格条件

```powershell
Test-Path site\__query
rg -n "__query" site
```

期待値:

- `site\__query` が存在しない
- `__query` の参照が0件
- ローカルリンク切れが0件
- 外部読み込み依存が0件
- HTTPリソース取得失敗が0件

## プロンプト集

Codexなどへ作業を依頼するときは以下を使います。

```text
docs/CMS-static-conversion-prompts.md
```

用途別に、全体戦略、クロール依頼、query URL整理、外部依存除去、表示遅延調査、フォーム/メール削除、最終確認、GitHub Pages公開、DNS確認のプロンプトを入れています。

## License

MIT
