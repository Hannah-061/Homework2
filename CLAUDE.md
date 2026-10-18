# 匿名聊天室

一個不用登入、所有人在同一間的匿名聊天室，前端放 GitHub Pages，即時傳訊用 Supabase。

## 規則

- 開始任何工作前，先讀 `docs/architecture.md`（需求在 `docs/requirements.md`）。
- 目前在**階段二**：前端已完成，Supabase 後台已設定好（不使用 Supabase CLI，設定步驟見 `docs/architecture.md` 4.1 節）。本機用 `VITE_BACKEND=supabase`（看 `.env.local`），線上的網站在接好前先用假後台（`mock`）。
- 不可以把金鑰檔案 commit 進 git（`.env`、`.env.*`，以及任何含 `sb_secret_`、`sk-ant-` 的內容）。只有 `.env.example`（不含真實值）可以進 repo。
