# 実機完遂検証チェックリスト (#5)

## 2026-05-29 更新 — skill 整理と方針転換

実機検証の結果、orchestration skill は atomic を逐次 run するぶん**遅く** (1 run の vision 呼び出しが ~2-6 分、5 件で 30-60 分)、かつ like 系はエージェントが heart 反映を視覚確認できず**過剰タップ→失敗**しがちだった。これに対し、同じ操作を**単一 mobilerun run で直接やる既存コマンドは動作確認済み**で速い。よって「コマンドで代替可能 かつ skill 経由が遅い」skill は削除する方針に転換した:

- ❌ 削除: `x-like-spree` → コマンド `x-like-5` で代替
- ❌ 削除: `x-engagement-routine` → コマンド `x-like-and-reply` で代替
- ❌ 削除: `x-follow-recommended` → コマンド `x-follow-5` で代替
- ❌ 削除: `validate-all` (#24 の自己修復オーケストレータ) / `x-trending-reply`
- ✅ skill は **`command-repair` 1 本のみ** に集約 (#27)。device 操作は commands に寄せ、skill は「コマンドを実機実行→ログ確認→yaml 1 箇所修復→再実行」のトライ&エラー (最大4回・無限ループ無し) を担う。ブラウザから手動起動。修復過程は `command-runner/docs/repair-logs/` に保存。

適用済みの基盤修正 (再発防止):
- コンテナに claude CLI を焼く Dockerfile 行が未ビルドで `spawn claude ENOENT` → image rebuild で解消
- mobilerun の LLM read timeout 30s → host `config.yaml` の全 profile kwargs に `timeout: 120`
- like の heart 命中: host `config.yaml` の `disabled_tools` から `click_at` を有効化 (ゼロ距離スワイプ代替をやめ `input tap` に)
- 長 run の `400 thinking blocks cannot be modified`: `viewer/lib/skill-runs.ts` の spawn env に `CLAUDE_CODE_DISABLE_THINKING=1`

以降の旧記述は履歴として残す。

## 経緯

smoke (短時間タイムアウト下の Step n/N まで到達) は全 8 件 OK だが、自然完遂 (`status=success`, `exitCode=0`) の確認が 4 件未済だった。
原始 issue (#5) の発行時点では「#2 アトミック化が入った後に検証した方が、各単位が小さいぶん再現と切り分けが容易」が結論で parking 扱いになっていた。

#2 (Phase 1〜3) が #15 / #16 / #17 で develop に入ったので、検証は **「atomic 単位 + skill 単位」** で進めるべき状況に変わった。本ドキュメントはそのチェックリスト。

## 自然完遂 確認済み (旧)

- ✅ x-reply (140s, Step 5/40)
- ✅ x-quote-retweet (211s, Step 7/30)
- ✅ x-unfollow-5 (391s, Step 16/50)

## 完遂未確認 (#2 完了後の新方針で再評価)

| 旧コマンド | 新方針 (atomic + skill) | 検証単位 |
|---|---|---|
| x-follow-5 | [[x-follow-recommended]] = x-open-search-recommended + (x-follow-current-card → x-scroll-one) × 5 | atomic 2 種 + skill 1 |
| x-like-and-reply | [[x-engagement-routine]] = x-open-foryou + like spree + (x-reply-topmost × 3) | atomic 3 種 + skill 1 |
| tiktok-lite-agent-scroll | 旧コマンド存続 (atomic 化対象外。LLM agent で 200 step のスクロール検証) | 旧 |
| tiktok-lite-macro-scroll | 同上 (deterministic macro なので atomic 化不要、`max_steps` 小さくして smoke 化が良い) | 旧 |

## 推奨検証手順

1. **atomic 単独** (run-by-run):
   - `x-open-foryou` (~30s) — 完遂 OK / 終了画面が TL なら成功
   - `x-like-topmost-unliked` (~45s)
   - `x-scroll-one` (~10s)
   - `x-reply-topmost` (~60s, `reply_text` を渡して送信)
   - `x-quote-retweet-topmost` (~60s, `comment` を渡して送信)
   - `x-back-to-home` (~30s)
   - `x-follow-current-card` (~30s)
   - `x-open-search-recommended` (~60s)
   - `x-open-trending` (~45s)
   - `x-search-keyword` (~45s, `keyword` を渡す)
2. **skill 全体** (orchestrated, atomic を順に呼ぶ):
   - `x-like-spree` (5 件いいね、所要 5 〜 8 分)
   - `x-engagement-routine` (5 like + 3 reply、所要 10 〜 15 分)
   - `x-follow-recommended` (5 follow、所要 5 〜 10 分)
   - `x-trending-reply` (1 〜 3 reply、所要 5 〜 10 分)
3. **既存長尺コマンドの取り扱い**:
   - 古い `x-like-5.yaml` 等は **当面残す** (実績がある)。新 skill の信頼性が立ち上がったら順次削除して良い

## 並列実行禁止 (#8) との関係

#12 で「同時に 1 run」しか動かないようガード済み。skill が次の atomic を投げる時は、必ず `GET /api/runs/:id` で `status != "running"` を確認してから次を POST すること。

## 自動化 (#24)

このチェックリストを 1 件ずつ手で叩く代わりに、`.claude/skills/validate-all/SKILL.md` を
viewer から起動すると、atomic → skill 代行実行 → 自己修復 (yaml の steps/vision/prompt を
1 箇所だけ Edit して再試行) → レポート出力までを一気通貫で実行する。
レポートは `command-runner/docs/validation-report-<YYYY-MM-DD>.md`。

スイートの真実はこのファイルなので、ケース追加/削除はまずここを直してから
`validate-all` の SKILL.md 内の表を整合させる (self-meta check で差分検知される)。

## 関連

- 関連 issue: #24 (自己実行/自己修復オーケストレータ), #2 (アトミック化), #8 (並列禁止), #3 (exit null 解析の instrumentation 入り)
- 関連 skill: [[x-like-spree]], [[x-engagement-routine]], [[x-follow-recommended]], [[x-trending-reply]], [[validate-all]]
