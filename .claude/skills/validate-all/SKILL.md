---
name: validate-all
description: command-runner 配下の atomic コマンド (10件) と orchestration skill (4件) を実機接続前提で順に走らせ、ログから PASS/FAIL を判定し、典型的な失敗パターンは yaml/SKILL.md を Edit して再実行する自己修復オーケストレータ。最後に自分自身の SKILL.md も整合性検査して必要なら更新する。
when_to_use: 「全部動作確認」「validate-all」「全 skill 動かして」のように、validation-checklist.md (#5) のスイートを一気に流したい時。単発の atomic を確かめたいだけなら viewer から直接 run を叩く。
allowed-tools: Bash(curl *) Bash(jq *) Bash(sleep *) Bash(date *) Bash(ls *) Bash(cat *) Bash(grep *) Read Edit Write
---

# validate-all

実機接続済み (device TTL 内) を前提に、`command-runner/docs/validation-checklist.md` のスイートを最初から最後まで自動で回す。
各ケースは **(1) 走らせる → (2) ログを読む → (3) 判定する → (4) FAIL なら 1 箇所だけ Edit して再実行 → (5) PASS まで or 3 回失敗で諦める** の 5 ステップ。
最後にこの SKILL 自身の整合性検査と self-repair も行う (= **「動作確認の他に」自分自身も更新可能**)。

## 起動前提

- viewer が `http://localhost:3102` (UI) / `http://localhost:3101` (API) で稼働
  - skill 内では **`API_BASE=http://localhost:3101`** を既定で使う (Vite プロキシ越しでも同じ JSON が返るが、SSE と CORS の都合で直接 API ポートが楽)
  - 環境変数 `MOBILERUN_VIEWER_API` で上書き可
- `GET /api/device` の `connected: true`
  - false なら **修復しない**: WSL2 はペアリング手動運用が確定済み (`feedback-wsl2-adb-pairing`)。
    "device not connected — pair manually via viewer modal first" とだけ報告して即終了
- 並列実行ロック (#8 / #12) に従う: 必ず前の run の終了を待ってから次を投げる
- 子 skill の起動は禁止: `POST /api/skill-runs` は orchestrator 自身が skill として走っている間 mutex で 409 になる。
  skill 群の検証は「その skill が内部で叩く atomic シーケンスを orchestrator が直接代行する」方式で行う

## API 操作の最小プリミティブ

skill 内では `Bash(curl)` + `Bash(jq)` だけで以下を実現する。すべて `set -e` 不要 (個別判定する):

```bash
API="${MOBILERUN_VIEWER_API:-http://localhost:3101}"

# device 状態
curl -fsS "$API/api/device" | jq '.'

# run 起動 (parameters は object、無い場合は省略可)
curl -fsS -X POST "$API/api/runs" \
  -H 'content-type: application/json' \
  -d '{"commandId":"x-open-foryou"}' | jq -r '.run.id'

# 終了まで待機 (1秒ポーリング、最大 timeout 秒)
wait_run() {
  local id=$1 timeout=${2:-300}
  local t=0
  while [ $t -lt $timeout ]; do
    local s=$(curl -fsS "$API/api/runs/$id" | jq -r '.run.status')
    [ "$s" != "running" ] && echo "$s" && return 0
    sleep 1; t=$((t+1))
  done
  echo "timeout"
}

# ログ全文取得
curl -fsS "$API/api/runs/$ID" | jq -r '.log'
```

SSE (`/api/runs/:id/stream`) は使わない。`claude --print` の長時間ストリーミングは扱いが面倒なので素直にポーリング。

## 検証スイート

`command-runner/docs/validation-checklist.md` の表が真実。**初手で必ずそれを Read** し、表との差分があればこの SKILL.md の方を後段の self-meta check で更新する。

初期スイート (2026-05 時点):

### atomic (10件、所要 ~6分)

| commandId | timeout | parameters | 成功判定 (log に含まれていれば PASS) | 典型失敗 → 修復タグ |
|---|---|---|---|---|
| `x-open-foryou` | 90s | — | 『おすすめ』タブにいる旨の最終レポート / `For You` 等 | `STEPS_SHORT`, `NAV_DETAIL` |
| `x-like-topmost-unliked` | 90s | — | "liked" / "いいね" / "no target visible" (どちらも PASS 扱い) | `NAV_DETAIL`, `VISION_OFF` |
| `x-scroll-one` | 60s | — | スクロール後の最上位投稿者報告 / "スクロール" | `STEPS_SHORT` |
| `x-reply-topmost` | 120s | `{"reply_text":"テスト送信 自動検証中です ! 🤖"}` | "返信" / "ポストしました" / "reply" | `NAV_DETAIL`, `STEPS_SHORT` |
| `x-quote-retweet-topmost` | 120s | `{"comment":"自動検証 引用テスト ! 🤖"}` | "引用" / "ポストしました" / "Quote" | `STEPS_SHORT` |
| `x-back-to-home` | 60s | — | "ホーム" / "おすすめ" タブにいる旨 | `STEPS_SHORT` |
| `x-follow-current-card` | 90s | — | "フォロー" / "no follow button visible" (どちらも PASS 扱い) | `NAV_DETAIL`, `VISION_OFF` |
| `x-open-search-recommended` | 120s | — | "おすすめユーザー" 等の一覧表示報告 | `STEPS_SHORT` |
| `x-open-trending` | 90s | — | "話題" / "Trending" の上位 3 件報告 | `STEPS_SHORT` |
| `x-search-keyword` | 90s | `{"keyword":"#今日の天気"}` | "最新" / "Latest" / 上位投稿の報告 | `STEPS_SHORT` |

### skill フロー (4件、所要 ~30分、atomic 代行実行)

各 skill の SKILL.md を Read してから、内部の擬似コードを orchestrator が atomic 直叩きで再現する。
**子 skill を `POST /api/skill-runs` で起動しない** (mutex で 409)。

| skill | 代行する atomic シーケンス | 成功判定 |
|---|---|---|
| `x-like-spree` | `x-open-foryou` → `(x-like-topmost-unliked → x-scroll-one) × 5` | 5 件いいね達成 (log カウント) または attempts 15 到達 |
| `x-engagement-routine` | `x-like-spree` 相当 + `(x-reply-topmost × 3)` | like 5 + reply 3 達成 or attempts 上限 |
| `x-follow-recommended` | `x-open-search-recommended` → `(x-follow-current-card → x-scroll-one) × 5` | 5 follow 達成 or attempts 12 到達 |
| `x-trending-reply` | ルート B (`x-open-trending` → `x-search-keyword` → `x-reply-topmost`) を 1 件のみ | 1 件 reply 送信 |

> note: `x-trending-reply` のルート A (WebSearch) は orchestrator では使わない (allowed-tools に WebSearch を入れていない / 外部依存を増やしたくない)。

## 判定ルール (FAIL 検知)

PASS = `meta.status == "success"` かつ `exitCode == 0` かつ 上表の「成功判定」キーワードがログにある。
**いずれか欠けたら FAIL** とし、ログから以下の修復タグを抽出して 1 つだけ適用する (複数該当時は最初の 1 つ):

| 修復タグ | 検知 (log substring) | Edit 操作 |
|---|---|---|
| `STEPS_SHORT` | `[exit 0]` の直前に最大 step (`Step N/N`) で完了せず終わっている / `[exit 124]` / `timeout` | 該当 yaml の `steps:` を `+20` (上限 80) |
| `NAV_DETAIL` | "detail" / "投稿詳細" / `system_button back` 連発 / "戻る" 3 回以上 | 該当 yaml の `prompt:` 末尾に `\n  ## 緊急: 詳細画面に入ったら即 back\n  - 投稿本文・画像・ユーザー名はタップ厳禁。誤って入ったら即 system_button back\n` を追記 (既に末尾にあれば追記しない) |
| `VISION_OFF` | `vision: false` の atomic で "判別できません" / "確認できません" / "色が不明" | 該当 yaml の `vision: false` を `vision: true` に置換 |
| `ADB_DOWN` | "device unauthorized" / "no devices" / "device offline" / "device disconnected" / "ECONNREFUSED" | **修復しない**。skill 全体を abort、レポートに "device reconnect required" |
| `PARAM_MISSING` | "parameter ... not provided" / `{{reply_text}}` が prompt に残っている | parameters 未渡しなので **修復しない**。レポートに skill 側のバグとして記録 |
| `UNKNOWN` | 上記いずれにも該当しない | **修復しない**。レポートに log の最終 30 行を抜粋して needs_human |

修復は最大 3 回。3 回失敗で次のケースへ。

## 実行手順

1. **Pre-check**
   ```bash
   curl -fsS "$API/api/device" | jq -r 'if .connected then "ok" else "not connected" end'
   ```
   `not connected` なら即終了。

2. **スイート Read** — `command-runner/docs/validation-checklist.md` を Read。表に新規 commandId/skillId があれば後段の self-meta check で SKILL.md に取り込み候補としてマーク。

3. **atomic 順次実行** — 上表 10 件を順に:
   1. `POST /api/runs` (parameters あれば付与)
   2. `wait_run $id $timeout` で終了待ち
   3. log 取得 → PASS 判定
   4. FAIL → 修復タグ抽出 → Edit (タグが `ADB_DOWN` なら全体 abort、`PARAM_MISSING`/`UNKNOWN` なら skip)
   5. 修復したら再 run。最大 3 回ループ

4. **skill 代行実行** — 上表 4 件を順に:
   1. 子 skill の SKILL.md を Read (擬似コード確認)
   2. atomic を直接順次呼ぶ (PASS した atomic のみ使用、FAIL 残りがある atomic は skill ごと skip + needs_human)
   3. skill ごとに集計 (達成件数 / attempts) を結果 dict に積む

5. **Self-meta check (自己修復)**
   - この SKILL.md を Read
   - スイート表内の `commandId` / `skillId` がすべて実在するか `ls command-runner/commands/X/*.yaml` と `ls .claude/skills/*/SKILL.md` で確認
   - 実在しない参照があれば SKILL.md の該当行を Edit で削除
   - 逆に repo に存在するが SKILL.md のスイートに入っていない命令を発見したら、スイート表に `# unverified` コメント行として追記
   - 今回の検証で「修復タグの検知ルールが空振りした (FAIL なのに UNKNOWN 扱い)」ケースがあれば、判定ルール表に新ルール候補を `<!-- TODO: -->` コメントで追記
   - 「修復したが直らなかった」ケースもログから抜粋を追記
   - **自分の判定/修復セクションを大規模に書き換えない** (ロジックの構造変更は人手 review が必要)。あくまで追記とコメント

6. **Report 出力** — `command-runner/docs/validation-report-<YYYY-MM-DD>.md` に Write:
   - 集計: atomic PASS/FAIL/SKIP, skill PASS/FAIL/SKIP
   - 各ケースの所要秒・修復履歴 (どの yaml をどう Edit したか)
   - `needs_human` リスト (UNKNOWN, 3 回失敗, ADB_DOWN abort)
   - self-meta check で見つかったスイート差分

7. **終了**
   - 修復で yaml/SKILL.md を 1 つでも Edit していれば、最後にユーザーへ「差分レビュー推奨 (`git diff`)」と通知。
   - 自動コミットはしない (誤修復が main に乗るリスクを避ける)

## 並列禁止と他の skill との関係

- orchestrator 起動中は他の skill が `POST /api/skill-runs` で 409 になる。これは仕様 (#8 / #12) で正しい挙動
- orchestrator は内部で `POST /api/skill-runs` を呼ばない。代行実行のみ
- `POST /api/runs` (atomic) は順次で問題なし

## メモリ参照

- `feedback-wsl2-adb-pairing`: device の mDNS 自動探索回りは触らない。手動ペアリング前提
- skill 内部で「mDNS が動かないので改善案を…」のような提案を出さないこと

## 失敗時の典型対応 (人手向けレポートテンプレート)

レポート末尾に必ず以下のセクションを書く:

```md
## needs_human

### <commandId or skillId>
- 修復試行: <タグ>, <タグ>, <タグ>
- 最終 exit: <code> / status=<status>
- log 抜粋 (最後の 30 行):
  ```
  ...
  ```
- 推定原因: <orchestrator の所見>
- 次に試すべきこと: <yaml の steps 増やす / prompt に節追加 / 端末側状態を疑う / etc>
```

## 関連

- スイート定義の真実: `command-runner/docs/validation-checklist.md`
- 並列禁止: #8 / #12 (`feat/single-run-mutex`)
- atomic 全件: `command-runner/commands/X/*.yaml`
- skill 全件: `.claude/skills/x-*/SKILL.md`
- 親 issue: #24, #5
