---
name: x-trending-reply
description: いま X で「バズっている」投稿を WebSearch か X 内 Trending で探し、選んだ投稿に Claude が生成したリプライを送る。x-reply-topmost atomic に parameters でリプライ文を渡す。
when_to_use: 「X でバズってる投稿にリプライ」「トレンドにリプライしといて」のように、対象が事前に決まっていない・話題から拾って欲しい時。
argument-hint: "[topic-hint] [n_replies]"
allowed-tools: Bash(curl *) Bash(jq *) Bash(sleep *) WebSearch
---

# x-trending-reply

X で話題になっている投稿を見つけて、自然なリプライを 1〜3 件送る。

## 入力 (呼び出し時に決める)

- `n_replies` : リプライ件数 (デフォルト 1)
- `topic_hint` : 任意。トピックを絞りたい時 (例: 「サッカー」「新作ゲーム」)

## 戦略の選び方

並列に両方走らせる必要はない。状況に応じて切り替える。

### ルート A — Web search で外から探す (推奨デフォルト)

外部の最新性を取り込めるので、X 内のフィルタに影響されにくい。

1. WebSearch で次のクエリを投げる:
   - `topic_hint` が空: `今日 X トレンド site:x.com OR site:twitter.com`
   - `topic_hint` あり: `{topic_hint} X 話題 site:x.com OR site:twitter.com`
2. 結果から、URL に `/status/<id>` を含む実際の投稿 (まとめサイトではない) を上位 3 件選ぶ
3. ユーザー名 (`@xxx`) と本文要約を控える
4. mobilerun atomic でその投稿に辿り着くため、ユーザー名を `x-search-keyword` の keyword として渡す:
   - `POST /api/runs { commandId: "x-search-keyword", parameters: { keyword: "@<username>" } }`
5. 検索結果の最新タブで対象本文に近い投稿が最上位にあれば `x-reply-topmost` で送信 (下記「リプライ文ルール」)。違う投稿が最上位にあれば `x-scroll-one` を 1〜2 回挟む。3 回試して見つからなければ次の候補へ

### ルート B — X 内のトレンドからピックする

外部 API を叩きたくない時。

1. `x-open-trending` でトレンド一覧表示
2. 上位 3 件のトピック名から `topic_hint` に近いものを 1 つ選択
3. そのトピック名を `x-search-keyword` の keyword に渡し、最新タブの一覧から `x-reply-topmost` でリプライ

## リプライ文ルール (再掲)

[[x-engagement-routine]] と同じ:

- 敬語ベース、軽い崩しは可
- **読点『、』を使わない**。区切りは半角スペースか改行
- 100 文字以内
- 『！』を 1〜2 回入れて熱量を出す
- 政治・センシティブ・誹謗中傷・宣伝色強はスキップ
- 絵文字は 0〜2 個

## ガード

- 1 セッション合計の atomic 呼び出し上限を 20 に
- 並列実行禁止 (#8): 必ず前の run の `end` を待ってから次を投げる
- WSL2 ではデバイスペアリングは手動フロー前提 (memory: feedback-wsl2-adb-pairing)

## 関連

- atomic: [[x-open-trending]], `x-search-keyword`, `x-scroll-one`, `x-reply-topmost`, `x-back-to-home`
- 関連スキル: [[x-engagement-routine]]
