# 匿名聊天室

不用登入的匿名聊天室。前端放 GitHub Pages，即時傳訊用 Supabase。

- 需求：`docs/requirements.md`
- 架構與技術選擇：`docs/architecture.md`
- 畫面設計：`docs/design.md`

**目前在階段一**：只有前端，後台是「假後台」（模擬的），還沒接 Supabase。

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

## 切換成真後台（階段二）

見 `docs/architecture.md` 第 4、8 節。設定檔看 `.env.example`；**金鑰不可以 commit**。

## 部署

推到 `main` 後，`.github/workflows/deploy.yml` 會自動打包並發布到 GitHub Pages。
第一次使用，要到 repo 的 Settings → Pages，把 Source 選成 **GitHub Actions**。
網址：https://hannah-061.github.io/Homework2/
