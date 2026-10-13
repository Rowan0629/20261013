# CLAUDE.md

這是一個不用登入的匿名聊天室(前端放 GitHub Pages,即時傳訊用 Supabase)。

## 規則

- 開始任何工作前,先讀 `docs/architecture.md`。
- 目前在「階段二」:前端已接上 Supabase(階段一的前端與模擬器已完成,模擬器保留,`VITE_BACKEND=mock` 即可切回)。只會用到 Project URL 與 Publishable key(可公開),絕不使用 Secret key。
- 不可以把金鑰檔案 commit 進 git(`.env`、`.env.local` 等)。只有 `.env.example` 可以進 git,且只能放佔位文字。
