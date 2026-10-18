# 階段二：真後台

這個資料夾是留給 `SupabaseChatService` 的，**階段一不要在這裡放任何程式，也不要安裝 Supabase 套件**。

階段二要做的事（見 `docs/architecture.md` 第 4、5.5 節）：

1. 在這裡實作 `ChatService`（`src/services/ChatService.ts`）介面的所有方法與事件。
2. 這個資料夾是整個專案**唯一**可以 `import` Supabase 套件的地方。
3. 在 `src/services/index.ts` 把 `VITE_BACKEND=supabase` 指到它。
4. 畫面元件、文字表、樣式都不用改。
