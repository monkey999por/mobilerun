---
name: x-like-spree
description: X (Twitter) のおすすめタイムラインで未いいねの通常投稿に上から順にいいねを 5 件付ける。「X でいいねしといて」「いいね 5 件」「like-spree」等のリクエストで起動。
when_to_use: ユーザーが X / Twitter で複数件のいいねをまとめて付けたいと言った時。1 件単独なら mobilerun の x-like-topmost-unliked を直接呼べばよいので使わない。
allowed-tools: Bash(curl *) Bash(jq *) Bash(sleep *)
---

# x-like-spree

X のおすすめタイムラインで「未いいねの通常投稿に上から順にいいね 5 件」を達成する。
1 ステップ = 1 atomic コマンド = mobilerun の短い run、で確実性を稼ぐ。

## 前提

- command-runner viewer が `http://localhost:3102` で動いている
- viewer のデバイス選択で実機が登録済み (TTL 内)
- atomic コマンド (#2 Phase 2) が `commands/X/` に揃っている

## オーケストレーション

擬似コードで書くと:

```
POST /api/runs { commandId: "x-open-foryou" }
liked = 0
attempts = 0
while liked < 5 and attempts < 15:
  attempts += 1
  POST /api/runs { commandId: "x-like-topmost-unliked" }
  # 完了 log で "liked: ..." を含めば liked += 1
  # "no target visible" なら次でスクロール
  if 直前の run が "no target visible" を含む:
    POST /api/runs { commandId: "x-scroll-one" }
  else:
    POST /api/runs { commandId: "x-scroll-one" }   # 連続いいね回避のためどちらでも 1 スクロール
```

## 実装上の注意

- viewer は `1 run = 1 mobilerun process`、並列実行は #8 で禁止済みなので必ず**直前の run の終了を待ってから次を投げる**こと
  - `POST /api/runs` の戻り `run.id` で `GET /api/runs/:id` をポーリングするか SSE `/api/runs/:id/stream` で `end` イベントを待つ
- 失敗 (`status=failed` または `exitCode!=0`) を 3 回連続で出したら中断
- スクロール後に detail page に入ってしまった気配があれば `x-back-to-home` を 1 回挟む

## 関連

- atomic: `x-open-foryou`, `x-like-topmost-unliked`, `x-scroll-one`, `x-back-to-home`
- 上位スキル: [[x-engagement-routine]]
