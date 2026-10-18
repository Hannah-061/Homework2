# 匿名聊天室

不用登入的匿名聊天室。前端放 GitHub Pages，即時傳訊用 Supabase。

- 需求：`docs/requirements.md`
- 架構與技術選擇：`docs/architecture.md`
- 畫面設計：`docs/design.md`

**目前在階段二**：前端有兩種後台可選。`VITE_BACKEND=mock` 是模擬的假後台（階段一），`VITE_BACKEND=supabase` 是真的 Supabase 後台。

## 本機執行

```bash
npm install
npm run dev        # 開發用，網址 http://localhost:5173/
npm test           # 單元測試
npm run build      # 打包（輸出到 dist/）
npm run preview    # 預覽打包結果，網址 http://localhost:4173/Homework2/
```

## 階段一怎麼測試

假後台把資料存在瀏覽器裡：

- **一個分頁 = 一個人。** 同一個瀏覽器開兩個分頁，用不同代號進去，就能互相聊天、互相看到進出。
- 另外有幾個機器人（小美、阿哲、Leo、Momo）會定時說話、進進出出。它們的名字也算「已有人在用」，輸入 `小美` 會被擋下。
- 網址後面加參數可以觸發特殊狀況：

| 網址參數 | 效果 |
|---|---|
| `?mock=full` | 聊天室已滿（進入時顯示「已滿」＋重試） |
| `?mock=offline` | 進入 4 秒後斷線 8 秒，再恢復 |
| `?mock=translate-fail` | 按「翻譯」一定失敗 |
| `?mock=translate-quota` | 按「翻譯」顯示今天額度用完 |
| `?mock=send-fail` | 送出訊息一定失敗（可測「重新傳送」） |

多個參數用逗號隔開，例如 `?mock=translate-fail,offline`。

想把假資料清掉重來：在瀏覽器開發者工具的 Application → Local Storage 刪掉 `anonchat.mock.*`。

## 真後台（階段二）

- 設定步驟：`docs/architecture.md` 4.1 節（SQL 與 Edge Function 放在 `supabase/`，在 Supabase 後台網頁貼上，不使用命令列工具）。
- 本機：複製 `.env.example` 成 `.env.local`，填入 Project URL 與 Publishable key，`VITE_BACKEND=supabase`。
- 整合測試（會真的連到 Supabase）：`npm run test:integration`。
- **金鑰不可以 commit**。只有 Project URL 和 Publishable key 是公開的。

## 部署

線上網站使用**真後台**：GitHub repo 的 Actions Variables 設了 `VITE_BACKEND=supabase`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`（都是公開的值）。想讓線上網站回到假後台，把 `VITE_BACKEND` 改成 `mock` 再重新部署。

推到 `main` 後，`.github/workflows/deploy.yml` 會自動打包並發布到 GitHub Pages。
第一次使用，要到 repo 的 Settings → Pages，把 Source 選成 **GitHub Actions**。
網址：https://hannah-061.github.io/Homework2/
