---
name: command-repair
description: 指定した mobilerun コマンド (commands/X/*.yaml 等) を実機で実行し、実行ログから失敗原因を1つ特定して yaml を1箇所だけ修復→再実行する「トライ&エラー」を最大4回ループする自己修復スキル。完全に直らなくても無限ループはしない。各 run のログと修復過程は repo (command-runner/docs/repair-logs/) に保存する。ブラウザ (viewer の Skills タブ) から手動起動する想定。
when_to_use: ある mobilerun コマンドが実機でうまく完遂しない時に、ユーザが手動で起動して自己修復させたい時。実機接続が前提。複数コマンドの一括検証ではなく「1コマンドを直す」用途。
allowed-tools: Bash(curl *) Bash(jq *) Bash(sleep *) Read Edit Write
---

# command-repair

1 つの mobilerun コマンドを **実機で実行 → ログ確認 → 原因特定 → yaml を1箇所修復 → 再実行** のトライ&エラーで直す。
device 操作そのものは commands に寄せた方針 ([[project-skill-validation-2026-05-28]]) のもとで、唯一残す「修復」用 skill。

## 入力

- 対象コマンド id を **extraInstruction (skill 起動時の追加指示) で受け取る**。例: `x-like-5` / `x-reply-topmost`。
- `commands/X/*.yaml` の任意のコマンドが対象。**件数バリアント** (`x-like-3/10/20`, `x-follow-10/15/20/25`, `x-reply-3/5/10/20`, `x-quote-retweet-3/5/10`) も本スキルで修復・検証する (#27 コメント)。
- 任意で「直したいゴール」も追記可 (例: `x-like-5 — 5件きちんといいねが付くこと`)。
- id が渡されていなければ、何を直すか不明なので **その旨を報告して終了** (推測で別コマンドを触らない)。

## 前提

- viewer が `http://localhost:3102` で稼働、実機が接続済み (TTL 内)
- 並列実行禁止 (#8): 必ず直前の run の終了を待ってから次を投げる
- WSL2 のデバイス接続は手動ペアリング前提 ([[feedback-wsl2-adb-pairing]])

## 修復ループ (擬似コード)

```
cmd = <extraInstruction で渡された command id>
report = "command-runner/docs/repair-logs/<cmd>-<YYYY-MM-DD-HHMM>.md"
max_iters = 4
last_fix = null
for i in 1..max_iters:
  # 1. 実行
  run = POST /api/runs { commandId: cmd }
  # 2. 完了待ち (status != running まで GET /api/runs/:id をポーリング)
  poll until status != "running"
  log, status, exitCode を取得
  # 3. ログとイテレーション記録を repo の report に追記保存 (#27)
  append_to(report, iter=i, status, exitCode, log の要約 + 末尾抜粋)
  # 4. 成功判定
  if status == "success" and ログがゴール達成を示す:
    finalize(report, "SUCCESS at iter i"); STOP
  # 5. 原因を1つ特定して、yaml を1箇所だけ修復
  cause = ログから最も確度の高い失敗原因を1つ選ぶ ("よくある失敗→修復" 参照)
  if cause が repo の yaml で直せる:
    fix = yaml を1箇所 Edit (steps / vision / reasoning / prompt の表現 のどれか1つ)
    if fix == last_fix:   # 同じ修正の繰り返し = 効いていない
      finalize(report, "同一修正で改善せず。打ち切り"); STOP
    last_fix = fix
  else:   # host config (timeout / disabled_tools) 等 repo 外が原因
    finalize(report, "repo 外要因 (config 等)。修復内容を提案して打ち切り"); STOP
# ループを抜けた = max_iters 到達
finalize(report, "max_iters 到達。完全には直らず。現状と次の一手を報告"); STOP
```

## 🛑 停止条件 (ハード — 無限ループ厳禁)

下記のいずれかで**必ず終了**する。直り切らなくてよい:

- コマンドが成功した (status=success かつゴール達成)
- イテレーションが **4 回**に達した
- 同じ修正を 2 回当てても改善しない
- 原因が repo 外 (host `config.yaml` の timeout / disabled_tools 等) → skill では直さず**提案だけ**して終了
- 失敗が `status=failed` で原因がログから特定できない状態が 2 連続

## よくある失敗 → 修復 (今回の検証で判明したパターン)

| ログの兆候 | 原因 | 修復 (skill が触る範囲) |
|---|---|---|
| `Read timed out (read timeout=30.0)` 等 | mobilerun の LLM read timeout が短い | **repo 外 (host config.yaml の profile kwargs `timeout`)。提案のみ**して終了 |
| 同じボタンを何度もタップ→`Reached maximum steps`→failed | いいね等の反映を視覚確認できず過剰タップ | 対象 yaml の prompt に「1回タップしたら再タップ禁止 (再タップは解除)」を追記、or `reasoning: false` で確認ループを抑制 |
| heart 等を `swipe` 同座標で叩くが効かない | タップ系ツールが無効 (`click_at` 等) | **repo 外 (host config.yaml `tools.disabled_tools`)。提案のみ** |
| `no target visible` / 要素が見つからない | prompt の指示が曖昧 or 画面到達前 | prompt の対象記述を具体化、or 先行 atomic (open/scroll) の確認を促す、or `steps` を増やす |
| 1 run が極端に長い / over-run | `steps` 過大 or ゴール未達で粘りすぎ | `steps` を妥当値へ、prompt に「達成したら即終了」を明記 |
| `spawn claude ENOENT` 等 skill 実行基盤側 | コンテナに claude CLI 無し / image 古い | **repo 外 (Dockerfile/image rebuild)。提案のみ** |

**原則: skill が直接 Edit してよいのは repo 内の対象コマンド yaml だけ。** host config / Dockerfile / image が原因なら、直さず「何をどう直すべきか」を report に書いて終了する (取り消しにくい・環境依存のため)。

## ログ/レポートの保存 (#27)

- 実行ログは viewer の `GET /api/runs/:id` (`.log`) から取得できる。これとは別に、**修復セッションの記録を repo に必ず残す**:
  - パス: `command-runner/docs/repair-logs/<cmd>-<YYYY-MM-DD-HHMM>.md`
  - 各イテレーションの: 実行した command / status / exitCode / ログ末尾抜粋 / 特定した原因 / 当てた修正 (diff 要約) / 結果
  - 最後に総括 (成功か、打ち切り理由、残課題、repo 外でやるべき提案)
- `*.log` と `logs/` は gitignore されるので **`.md` で `docs/repair-logs/` 配下**に書くこと (追跡される)。

## 実装メモ

- `POST /api/runs` の戻り `run.id` で `GET /api/runs/:id` をポーリング (`.run.status` が `running` でなくなるまで)。SSE `/api/runs/:id/stream` の `end` でも可。
- yaml 修復は **1 イテレーション1箇所**に限定 (複数同時変更は原因切り分け不能になる)。
- 修復後の再実行で悪化したら、その変更を戻してから次の仮説へ。

## 関連

- 方針: device 操作は commands (`x-like-5` / `x-follow-5` / `x-like-and-reply` / atomic 群)、skill は本 repair のみ
- 参考メモリ: [[project-skill-validation-2026-05-28]], [[feedback-wsl2-adb-pairing]]
- 関連 issue: #27 (本スキル), #5 (実機完遂検証)
