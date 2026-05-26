# mobilerun command-runner viewer (dev server)
#
# このイメージは絶対に公開しないこと。compose.yaml で localhost/ プレフィックスを付与している。
#
# 構成:
#   - node:22-bookworm-slim ベース
#   - adb (android-tools-adb) と python3 + uv + mobilerun 本体を同居
#   - mobilerun は /opt/mobilerun-venv に editable install (ホストの ~/.local/bin/mobilerun と同等)
#   - command-runner は /app に bind mount される前提で、image には npm deps だけ焼く
#
# Build context は repo root (../) を想定。compose.yaml 側で dockerfile を指定する。

FROM node:22-bookworm-slim

ARG TZ=Asia/Tokyo
ENV TZ="$TZ"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    python3 \
    python3-venv \
    python3-pip \
    git \
    gh \
    jq \
    ripgrep \
    less \
    sudo \
  && rm -rf /var/lib/apt/lists/*

# Google 公式 platform-tools の adb (mdns サブコマンド対応)。
# Debian の android-tools-adb は古くて `adb mdns services` を知らないため使わない。
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) PT_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip" ;; \
      arm64) PT_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip" ;; \
      *) PT_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip" ;; \
    esac; \
    curl -sSL -o /tmp/pt.zip "$PT_URL"; \
    unzip -q /tmp/pt.zip -d /opt; \
    ln -sf /opt/platform-tools/adb /usr/local/bin/adb; \
    rm /tmp/pt.zip; \
    adb version

# uv を /usr/local/bin にグローバルインストール
RUN curl -LsSf https://astral.sh/uv/install.sh \
    | env UV_UNMANAGED_INSTALL=/usr/local/bin sh

# UID/GID 1000 のユーザーを準備 (node イメージは既に node ユーザーが UID 1000 で存在)
RUN mkdir -p /app /opt/mobilerun-src /opt/mobilerun-venv \
 && chown -R node:node /app /opt/mobilerun-src /opt/mobilerun-venv

# Claude Code CLI 用ディレクトリ。bind mount で上書きされない場合のフォールバック。
# (compose 側で ${HOME}/.claude をマウントすればホスト側の認証がそのまま使える)
RUN mkdir -p /home/node/.claude /home/node/.config/claude \
 && chown -R node:node /home/node/.claude /home/node/.config/claude

# node ユーザーに passwordless sudo を付与
# (Claude Code が apt-get 等を呼ぶケース、コンテナ内デバッグ用)
RUN echo "node ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node

USER node
WORKDIR /opt/mobilerun-src

# mobilerun 本体を editable install
# build context は repo root を想定: pyproject.toml と mobilerun パッケージをコピー
COPY --chown=node:node pyproject.toml setup.py MANIFEST.in README.md ./
COPY --chown=node:node mobilerun/ ./mobilerun/
RUN uv venv /opt/mobilerun-venv \
 && uv pip install --python /opt/mobilerun-venv/bin/python -e ".[anthropic]" \
 && mkdir -p /home/node/.local/bin \
 && ln -sf /opt/mobilerun-venv/bin/mobilerun /home/node/.local/bin/mobilerun

ENV PATH=/home/node/.local/bin:$PATH

# Claude Code CLI をネイティブインストーラーで導入。
# - 認証情報は CLAUDE_CONFIG_DIR (/home/node/.claude) 配下に保存される。
# - compose で ${HOME}/.claude をマウントすればホスト側 (claude /login 済み) の認証を継承可。
# - 未マウント時はコンテナ内で `claude /login` する必要あり (Anthropic OAuth)。
# 参考: https://code.claude.com/docs/ja/setup
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV CLAUDE_CONFIG_DIR=/home/node/.claude

# command-runner の依存をインストール (bind mount で上書きされない node_modules を確保)
WORKDIR /app
COPY --chown=node:node command-runner/package.json command-runner/package-lock.json* ./
RUN npm ci || npm install

# 残りはランタイムで bind mount されるが、image にも一応焼いておく (compose 抜きで動かす時用)
COPY --chown=node:node command-runner/ ./

ENV NODE_ENV=development
ENV ADB_BIN=adb

EXPOSE 3101 3102

CMD ["npm", "run", "dev"]
