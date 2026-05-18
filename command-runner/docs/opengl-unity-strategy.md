# OpenGL / Unity アプリ向けの動かし方 (#6)

## 背景

`battlecats-daily-login` (にゃんこ大戦争, `jp.co.ponos.battlecats`) を運用しようとして判明:

- Unity / OpenGL で描画しているアプリは Android のアクセシビリティツリーに `FrameLayout` 1 枚しか露出しない
- そのため mobilerun の通常 agent は毎 step screenshot → vision 判断、で 1 step ≒ 25 秒
- step=60 でも 10 分以内の完遂が困難で、コスト的に既存のままだと割に合わない

`battlecats-daily-login` は一旦 `0872bbc` で削除済み。

## 決定 — ハイブリッド方針

**「scripted 座標 + ピンポイント vision」を組み合わせる**。理由は速度と頑健性のバランス:

| 案 | 採否 | 理由 |
|---|---|---|
| A. 座標ベタ書きの scripted コマンド | **採用 (一次手段)** | 確定タップ点は座標で打つのが圧倒的に速い。Unity アプリは UI 自動配置の自由度が低く、解像度を固定すれば位置が安定する |
| B. 画像テンプレマッチング | 保留 | mobilerun 側の action 拡張が必要。実装コスト高く、まずは A だけで足りるかを見極める |
| C. vision_only の見直し | **採用 (二次手段)** | A で詰まる箇所 (ログボや確率的ダイアログ) だけに vision を入れる。 #2 のアトミック化と組み合わせ「座標 atomic + vision atomic」で構成する |
| D. accessibility 改善を端末/アプリ側で | 不可 | Unity 側の制約。変えられない |

## 推奨実装パス

1. **マクロ JSON 拡張**: `command-runner/macros/` には既に座標+swipe ベースの JSON が走っており、これを流用する。座標は `1080x1920` 基準で書き、`mobilerun macro replay` で実行
2. **ハイブリッド構成**: macro 内で「vision 判断が必要なステップ」は atomic コマンドを呼び出す形にする。具体的には:
   - 既存の macro JSON (deterministic 連打) + 中間に `mobilerun run --vision --reasoning --steps 5 "ログインボーナス画面ならOKをタップ"` 的な短い run を差し込む
   - これにより 1 step ≒ 25 秒の vision 判断を「ボーナス到達後の 1 step だけ」に局所化できる
3. **解像度依存の管理**: 座標を書く YAML には対象端末の `width x height` を `notes` か新規 `target_resolution` フィールドで明示する (将来別解像度に切り替える時の改修ポイントを明確にするため)

## 適用例 (にゃんこ大戦争デイリーログイン)

実機確認済みフロー:

1. アプリ起動 → イントロ再生
2. 右下「skip」(座標 ~ (1800, 1900) at 1080×1920) タップ
3. 中央「ゲームスタート」 (~ (540, 960)) タップ
4. ログインボーナス画面で「受け取る」 (位置はランダム性あり → vision atomic で判定)
5. その後の OK / ニュースの × / 戻るアイコン (位置安定 → 座標)

= macro (deterministic) + ログボのみ短い run (vision) のハイブリッド構成で、step ≒ 5 vision で済む見込み。

## 関連

- 関連 issue: #2 (アトミック化), #5 (検証残)
- 既存資産: `command-runner/macros/tiktok_lite_scroll*.json` (deterministic macro の前例)
- 削除済みコマンド: `battlecats-daily-login` (再導入時はこの方針に則って書き直す)
