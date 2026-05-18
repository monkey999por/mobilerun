---
name: x-engagement-routine
description: X (Twitter) で 1 セッション分のエンゲージメント (いいね 5 + リプライ 3) を実行。リプライ文は Claude が投稿本文から生成して atomic コマンドに parameters で渡す。
---

# x-engagement-routine

1 セッションで「いいね 5 件 + リプライ 3 件」を達成するオーケストレーション。
リプライ文の生成は Claude (このスキル) が担当し、実行は mobilerun atomic に任せる役割分担。

## 前提

- [[x-like-spree]] と同じ前提
- `commands/X/x-reply-topmost.yaml` に parameter `reply_text` が定義されていること (#2 Phase 1 + 2 で完了)

## フロー

1. `x-open-foryou` で TL を整える
2. **いいね 5 件**: [[x-like-spree]] と同じループを 5 回
3. **リプライ 3 件**:
   - 各回:
     a. TL 先頭付近の投稿の本文を確認 (必要なら `x-scroll-one` で前後の文脈を取り、`adb shell uiautomator dump` 等は不要 - viewer 画面で目視 or log で十分)
     b. Claude が以下のルールでリプライ文 (100 文字以内) を生成:
        - 敬語 (です・ます)、ただし軽い崩しは OK
        - **読点『、』を絶対に使わない** (区切りは半角スペースか改行)
        - 『！』を 1〜2 回入れて熱量を出す
        - 絵文字は 0〜2 個
        - 政治・宣伝色強・センシティブ系の投稿はスキップ
     c. `POST /api/runs { commandId: "x-reply-topmost", parameters: { reply_text: "<生成文>" } }`
     d. 終了を待ち、成功なら次へ。失敗なら `x-back-to-home` を挟んで `x-scroll-one` してリトライ
4. 完了レポート: いいねした投稿者と、リプライした投稿者 + 送信文をまとめて報告

## ガード

- 1 セッションで合計 15 回 atomic を呼んだら強制終了 (max_attempts)
- 失敗 3 連続で中断
- 並列実行禁止 (#8): 必ず前の run の `end` を待つ
- WSL2 で動かす場合のデバイス接続は手動ペアリング前提 (memory: feedback-wsl2-adb-pairing)

## 関連

- 下位: [[x-like-spree]]
- atomic: `x-open-foryou`, `x-like-topmost-unliked`, `x-scroll-one`, `x-reply-topmost`, `x-back-to-home`
