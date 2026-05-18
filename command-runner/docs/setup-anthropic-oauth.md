# mobilerun を Claude OAuth で動かす設定 (command-runner viewer 経由)

## 前提

- Claude Code (CLI) で使っているのと同じ Anthropic OAuth subscription を、コンテナ内の mobilerun でも使いたい
- 「`GOOGLE_API_KEY` を払う / API key 管理する」をやらずに済ませたい

## 初回セットアップ手順

### 1. OAuth ログイン

```bash
docker compose -f command-runner/compose.yaml exec viewer mobilerun anthropic login
```

ターミナルに URL → Windows 側ブラウザで開いてログイン → 戻ってきたコードをターミナルに貼る。トークンは `~/.config/droidrun/credentials/auth-profiles.json` (host の `~/Library/Application Support/droidrun/credentials/auth-profiles.json` に bind mount される) に保存される。

### 2. `~/.config/droidrun/config.yaml` を編集

mobilerun は初回起動時にデフォルト config を生成するが、それは `GoogleGenAI` (= Gemini) が選ばれている。下記 3 点を直さないと動かない。

#### A. `agent.streaming` を false に

```yaml
agent:
  ...
  streaming: false   # AnthropicOAuthLLM は streaming 未実装。true のままだと NotImplementedError
```

#### B. `llm_profiles` の全 5 profile を anthropic_oauth に

`manager`, `executor`, `fast_agent`, `app_opener`, `structured_output` それぞれを:

```yaml
  manager:
    provider: anthropic_oauth
    model: claude-sonnet-4-6        # または claude-haiku-4-5 (token 節約)
    temperature: 0.2
    api_key_source: auto
    base_url: null
    api_base: null
    provider_family: anthropic
    auth_mode: oauth
    credential_path: null            # null で auth-profiles.json をデフォ参照
    kwargs:
      max_tokens: 4096               # Anthropic Messages API は max_tokens 必須。
                                     # 空 dict のままだと 400 Bad Request
```

#### C. token 節約したい場合

- `manager` / `executor` / `fast_agent` は判断系なので `claude-sonnet-4-6` (or opus)
- `app_opener` / `structured_output` は小タスクが多いので `claude-haiku-4-5` に下げてよい

## トラブルシュート

| エラー | 原因 | 直し方 |
|---|---|---|
| `No API key found for provider 'GoogleGenAI'` | config の provider が未切替 (= デフォルト Gemini) | 手順 2-B |
| `Streaming is not implemented for AnthropicOAuthLLM yet` | `agent.streaming: true` | 手順 2-A |
| `400 Client Error: Bad Request for url: https://api.anthropic.com/v1/messages` | `max_tokens` 欠落 | 手順 2-B の `kwargs.max_tokens` |
| 401 / 403 系 | OAuth トークン期限切れ or invalidate | `mobilerun anthropic login` をやり直し |

## なぜ自動化していないか

`config.yaml` は host のユーザー領域 (`~/Library/Application Support/droidrun/config.yaml`) にあり、repo の管轄外。`mobilerun configure` wizard で対話的にセットするのが本来の入口で、wizard が `kwargs.max_tokens` を自動で入れてくれる ([mobilerun/cli/configure_wizard.py:259](../../mobilerun/cli/configure_wizard.py))。fresh インストールで wizard をスキップして直接走らせるとこのドキュメントの罠を踏むので、それを記録しておく。
