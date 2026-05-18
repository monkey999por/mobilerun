# mobilerun command-runner

`mobilerun run` / `mobilerun macro replay` をブラウザから選択・実行・スケジュールする小さな管理画面。
ローカル開発で `mobilerun` バイナリが PATH 上にあることを前提とする。

> **fork ポリシー**: このディレクトリは droidrun/mobilerun のフォーク側で追加した個人用ツール。
> upstream への影響を最小化するため、コマンド定義・マクロ・viewer ・state はすべてこの
> `command-runner/` 配下に閉じている。upstream をマージ/リベースする際に衝突しないよう、
> リポジトリルートには新規ファイルを置かない方針。

```
command-runner/
├── commands/             コマンド定義 (1ファイル=1コマンド, frontmatter+本文)
├── macros/               mobilerun macro 用の JSON (リプレイ対象)
├── viewer/
│   ├── server.ts         Hono API (実行 / 履歴 / device / schedule)
│   ├── scheduler.ts      croner ベース
│   ├── lib/
│   │   ├── commands.ts   commands/*.md パース + argv 組み立て
│   │   ├── device.ts     device 永続化 (TTL 付き)
│   │   └── runs.ts       実行 (spawn) と SSE ストリーミング
│   ├── src/              React UI
│   └── state/            (gitignore) device.json / schedule.json / runs/<id>/
├── package.json
├── tsconfig.json         server 用
└── viewer/tsconfig.client.json   client 用
```

## 起動

### A. Docker Compose (推奨, dev 一発起動)

`mobilerun` 本体 + `adb` + node 22 を同居させた image をビルドする。
ホットリロード (`tsx watch` + `vite`) も生きるので、ホスト側で `commands/*.yaml` や
`viewer/src/**` を編集すると即時反映。

```bash
cd command-runner
docker compose up -d --build      # 初回ビルド込み
docker compose logs -f viewer     # ログ追跡
# → http://localhost:3102  (UI)
# → http://localhost:3101  (Hono API 直接)

docker compose down               # 停止
```

`localhost/mobilerun-command-runner:local` という image タグで保護 (push 不可)。
build context は `..` (repo root) で、`mobilerun` 本体を image 内に editable install する。

### B. ホスト直 (Node を直接動かす)

```bash
cd command-runner
npm install

# 開発: API(3101) + Vite(3102) 並走
npm run dev
# → http://localhost:3102

# 本番ライク: dist をビルドして単独で 3102 配信
npm run build
npm start
```

`mobilerun` バイナリのパスを変えたい場合は `MOBILERUN_BIN=/path/to/mobilerun npm start` で上書き可能。

### adb サーバーの所在 (mDNS 探索を使う場合のみ要設定)

既定ではコンテナ内で adb サーバーを起動するので、追加設定なしで `adb connect ip:port` は動く。
ただしマルチキャスト mDNS は docker bridge を越えられないため、**「自動探索」「QR ペアリング」タブは空のまま**になる。これらを使いたいケースのみ以下を行う:

**Mac の場合** — ホストで adb サーバーを TCP listen させ、コンテナを `host.docker.internal:5037` 経由でそこに接続させる:

```bash
# ホスト (Mac) で一度実行。バックグラウンドで起動しっぱなしにする。
adb kill-server
adb -a -P 5037 nodaemon server start &
```

そのうえで `compose.yaml` の `ADB_SERVER_SOCKET` / `ANDROID_ADB_SERVER_*` 行のコメントを外して `docker compose up -d` し直す。

**WSL2 の場合** — Windows ↔ WSL2 ↔ docker bridge と 2 段 NAT を越えるので、ホスト adb サーバーを立てても mDNS は届きにくい。**手動入力タブで pair → connect する**のが現実的 (下記参照)。どうしても mDNS 自動探索が必要なら Windows 11 22H2+ で `~/.wslconfig` に `networkingMode=mirrored` を入れ、`compose.yaml` を `network_mode: host` に切り替える必要がある。

### 既知の制限 (Docker)

- 自動探索 / QR ペアリングはホスト adb サーバー共有 (Mac) か mirrored networking (Windows 11) が必須。WSL2 既定構成では空のまま
- 上記が使えない時は viewer の **「手動入力」タブ** から **(1) pair ip:port + 6 桁 PIN → (2) connect ip:port** を順に入れる (WSL2 環境はこの導線で全部動く)
- USB 接続デバイスは Docker からは見えない (USB パススルー不可)。USB 端末を使う時はホスト直 (B 起動方式) を選ぶ
- **mobilerun の認証**: `${HOME}/Library/Application Support/droidrun` を bind mount しているので
  ホストで `mobilerun anthropic login` 済みなら同じトークンが使われる (WSL2 の場合は **コンテナ内で**
  `docker compose exec viewer mobilerun anthropic login` を実行することで bind mount 先のホスト側に保存される)

## 緊急停止 (viewer から中断できない場合)

通常は viewer の **コマンドカード or 実行履歴の「中断」ボタン** で `SIGTERM` を送るが、
ブラウザが応答しない / 暴走している時のためにシェルからの強制停止手段:

### Docker compose 起動の場合

```bash
# A) コンテナ内の mobilerun プロセスだけ kill (推奨。viewer は生き続ける)
docker compose exec viewer pkill -f mobilerun
# 効かない時は SIGKILL
docker compose exec viewer pkill -9 -f mobilerun

# B) viewer コンテナごと再起動 (進行中の run は全て kill される)
docker compose restart viewer

# C) コンテナを落として作り直し (環境変数変更後など)
docker compose down
docker compose up -d
```

### ホスト直 (npm run dev) 起動の場合

```bash
pkill -f mobilerun          # SIGTERM
pkill -9 -f mobilerun       # SIGKILL
```

### 端末側のアプリも止めたい

mobilerun を kill してもアプリは動き続ける。アプリ側を強制停止:

```bash
# コンテナ内から
docker compose exec viewer adb shell am force-stop <package>
# 例: TikTok Lite
docker compose exec viewer adb shell am force-stop com.zhiliaoapp.musically.go
# X
docker compose exec viewer adb shell am force-stop com.twitter.android
# にゃんこ大戦争
docker compose exec viewer adb shell am force-stop jp.co.ponos.battlecats
```

### adb の状態が壊れた時

```bash
# ホスト側
adb kill-server
adb -a -P 5037 nodaemon server start &     # 再起動

# コンテナ側 (キャッシュクリア)
docker compose exec viewer adb kill-server
```

### viewer 内部 state を消したい (履歴・スケジュール全消去)

```bash
rm -rf command-runner/viewer/state/runs
rm -f  command-runner/viewer/state/schedule.json
rm -f  command-runner/viewer/state/device.json
docker compose restart viewer
```

---

## デバイス指定 (動的 + 自動探索)

ヘッダ右上の device pill をクリックするとデバイス選択モーダルが開く。
2 タブ構成 (`自動探索` / `手動入力`)。

**自動探索 (mDNS)** — ユーザー入力を最小化する推奨フロー。
端末側で「開発者オプション → ワイヤレスデバッグ」を ON にしておくと、
`adb mdns services` で検出される。Mac と端末が同一ネットワーク (VPN を切る)
にいる必要がある。

- *接続可能 (ペアリング済み)*: 過去にペアリング済みのサービス。「接続」を
  1 クリックすると `adb connect <ip:port>` → 成功で device に保存。**IP もポートもタイプ不要**
- *ペアリング待機中*: 端末側で「ペアリングコードでデバイスをペア設定」を開いた状態。
  「ペアリング」ボタン → 6 桁 PIN 入力 → `adb pair` → 完了後に自動で
  connection service を探して接続まで一気通貫
- *adb devices*: USB 接続済みなど、すでに `adb devices` に出ているもの。「選択して保存」で device 値にする

**手動入力** — 自動探索が動かない時のフォールバック (**WSL2/Docker bridge 環境ではこっちが標準**)。

- 初回のみ: 端末側「ペアリングコードでデバイスをペア設定」を開き、表示される
  `ip:port` と 6 桁 PIN を **(1) ペアリング** 欄に入れて「ペアリング」 → 内部で
  `adb pair` 実行
- 毎回: 端末側「ワイヤレスデバッグ」画面の `IPアドレスとポート` (ペアリング用とは別ポート)
  を **(2) 接続** 欄に入れて「接続して保存」 → 内部で `adb connect` → 成功時に device 値として保存

値は `viewer/state/device.json` に TTL 付きで保存される (デフォルト 8 時間)。
期限切れ or 未設定の状態で起動 / 実行すると自動でモーダルが再表示される。

スケジュール経由の実行も同じ device 値を参照する。エントリ単位で固定したい場合は
スケジュール追加時に `device上書き` 欄にアドレスを入れる。

### adb バイナリ

`ADB_BIN` 環境変数で adb のパスを上書き可能。デフォルトは PATH 上の `adb`。

## コマンド定義 (YAML)

`commands/<id>.yaml` 1 ファイル = 1 コマンド。**viewer から CRUD 編集**できるので
基本は UI 経由で OK。テキストエディタで直接いじる場合のスキーマは下記。

| key | 型 | 用途 |
|---|---|---|
| `id` | str | 必須。ファイル名と一致。`[a-z0-9][a-z0-9-]*` |
| `name` | str | 表示名 |
| `app` | str | グルーピング用 (X / TikTok Lite / ...) |
| `type` | `run` \| `macro` | 必須 |
| `status` | `confirmed` \| `unconfirmed` | バッジ表示 |
| `tags` | str[] | 検索用 |
| `notes` | str | 1行サブ説明 |
| `prompt` | str | run: `mobilerun run` の末尾引数。macro: メモ。複数行は `prompt: \|` ブロック |
| `steps` | num | run: `--steps N` |
| `vision` | bool | run: `--vision` を付ける |
| `reasoning` | bool | run: `--reasoning` を付ける |
| `macro_file` | str | macro: `command-runner/` からの相対パス (例: `macros/foo.json`) |
| `delay` | num | macro: `--delay N` |
| `max_steps` | num | macro: `--max-steps N` |

### viewer での編集

- コマンドカード右下の「編集」 → モーダルが開く
- 「構造化フォーム」タブ: 各フィールド個別入力 (型に応じて表示項目が切り替わる)
- 「生 YAML」タブ: textarea で直接編集 (高度なケース)
- 「+ 新規」で新しいコマンドを作成 (構造化モードのみ)
- 「削除」ボタンで `commands/<id>.yaml` を削除

## API 概要

| method | path | 用途 |
|---|---|---|
| GET | `/api/commands` | 一覧 |
| GET | `/api/commands/:id` | 個別 (構造化 + 生 YAML 文字列) |
| POST | `/api/commands` `{id, name, type, ...}` | 新規作成 |
| PUT | `/api/commands/:id` `{...fields}` or `{raw}` | 更新 (構造化 / 生 YAML どちらも可) |
| DELETE | `/api/commands/:id` | 削除 |
| GET | `/api/device` | 現在値 (期限切れなら null) |
| POST | `/api/device` `{device, ttlSeconds?}` | 保存 |
| DELETE | `/api/device` | クリア |
| POST | `/api/runs` `{commandId}` | 実行開始 (device 未設定なら 409) |
| GET | `/api/runs` | 履歴 |
| GET | `/api/runs/:id` | meta + 全ログ |
| GET | `/api/runs/:id/stream` | SSE で log + end |
| POST | `/api/runs/:id/cancel` | SIGTERM |
| GET | `/api/adb/discover` | `adb mdns services` + `adb devices` 統合一覧 |
| POST | `/api/adb/connect` `{target, ttlSeconds?}` | `adb connect`、成功時に device に保存 |
| POST | `/api/adb/pair` `{addr, code}` | `adb pair` (PIN ペアリング) |
| POST | `/api/adb/disconnect` `{target}` | `adb disconnect` |
| GET | `/api/schedule` | 一覧 (next/last 含む) |
| POST | `/api/schedule` `{name, commandId, kind, cron?, runAt?, deviceOverride?}` | 追加 |
| PATCH | `/api/schedule/:id` | enabled 切替など |
| POST | `/api/schedule/:id/run` | 今すぐ実行 |
| DELETE | `/api/schedule/:id` | 削除 |

## TODO / 既知の制限

- 1 プロセス前提 (state は file IO ベース、複数同時起動非対応)
- ログは `viewer/state/runs/<id>/log.txt` に追記し続けるので、長尺マクロでは肥大化する
- スケジュールは絶対時刻ベース。タイムゾーンはサーバプロセスのローカル
- Slack 通知や Docker 化は未実装
