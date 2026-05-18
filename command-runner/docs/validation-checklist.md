# 実機完遂検証チェックリスト (#5)

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

## 関連

- 関連 issue: #2 (アトミック化), #8 (並列禁止), #3 (exit null 解析の instrumentation 入り)
- 関連 skill: [[x-like-spree]], [[x-engagement-routine]], [[x-follow-recommended]], [[x-trending-reply]]
