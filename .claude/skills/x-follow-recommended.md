---
name: x-follow-recommended
description: X (Twitter) の『おすすめのユーザー』ページから上から順に 5 人フォローする。x-open-search-recommended → x-follow-current-card × 5 を回す。
---

# x-follow-recommended

X の検索→『おすすめユーザー』ページに遷移し、上から 5 アカウントを順にフォローする。

## 前提

- command-runner viewer が動いていてデバイス登録済み
- atomic: `x-open-search-recommended`, `x-follow-current-card`, `x-scroll-one`

## フロー

```
POST /api/runs { commandId: "x-open-search-recommended" }
followed = 0
attempts = 0
while followed < 5 and attempts < 12:
  attempts += 1
  res = POST /api/runs { commandId: "x-follow-current-card" }
  if res.log に "no follow button visible":
    POST /api/runs { commandId: "x-scroll-one" }
  else:
    followed += 1
    POST /api/runs { commandId: "x-scroll-one" }
```

## 注意

- 検索キーワードでおすすめページに辿り着けなかった場合 (`x-open-search-recommended` が "could not open recommended users page" を返したら) 即終了して報告
- `x-follow-current-card` は同じ画面で複数件フォローしないので、毎回 scroll を挟むと自然と次の人になる
- 並列実行禁止 (#8) を遵守

## 関連

- atomic: `x-open-search-recommended`, `x-follow-current-card`, `x-scroll-one`
