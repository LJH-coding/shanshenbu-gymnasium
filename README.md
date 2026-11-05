# 閃身步大亂鬥｜可自行管理的靜態網頁版

這個專案是從公開網站 `https://shanshenbu.wei-chuang8666.workers.dev/` 整理出的 GitHub-ready 靜態版本。公開頁面於 2026-11-05 擷取；畫面、文案、遊戲程式與可公開讀取的資產盡量原樣保留。

## 現況

- 可用：首頁、馬上玩、單機對戰、本地雙人、練習場、闖關邏輯、本機進度、音效、PWA 安裝與大部分 AI 模型。
- 靜態替代：排行榜顯示為本機空榜；進度只存於瀏覽器，並新增「下載進度備份／匯入進度備份」。
- 需要後端：線上房間、四人網路合作、觀戰、排位配對、TURN、中繼、伺服器排行榜、跨裝置雲端存檔、Google 綁定、統計上傳。

完整缺口與端點盤點請看 [docs/BACKEND-GAPS.md](docs/BACKEND-GAPS.md)。靜態相容處理在 `assets/js/static-mode.js`，沒有猜測或重建原站的私有 Worker、KV、D1、金鑰或資料。

## 本機預覽

瀏覽器的 PWA、音訊與 `fetch()` 需要 HTTP 伺服器；不要直接雙擊 `index.html`。

```bash
cd shanshenbu-web
python3 -m http.server 8080
```

接著開啟 `http://localhost:8080/`。停止預覽可在終端按 `Ctrl+C`。

## 部署到 GitHub Pages

1. 在 GitHub 建立一個空白 repository；不要勾選自動建立 README。
2. 在本資料夾執行：

   ```bash
   git init
   git add .
   git commit -m "Initial static website"
   git branch -M main
   git remote add origin https://github.com/你的帳號/你的-repo.git
   git push -u origin main
   ```

3. 到 repository 的 **Settings → Pages**，將 Source 設為 **GitHub Actions**。
4. 專案內的 `.github/workflows/pages.yml` 會在推送 `main` 時發布靜態網站。

工作流程依照 [GitHub 官方的 Pages 自訂工作流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 設定。自訂網域需另外在 repository 的 Pages 設定中指定；只新增 `CNAME` 檔不等於完成網域設定。

## 目錄

```text
.
├── index.html
├── manifest.webmanifest
├── sw.js
├── assets/
│   ├── css/styles.css
│   ├── js/app.js
│   ├── js/static-mode.js
│   ├── ai/
│   ├── icons/
│   ├── lib/
│   └── sfx/
├── docs/
│   ├── ASSETS.md
│   └── BACKEND-GAPS.md
├── original/index.original.html
└── .github/workflows/pages.yml
```

## 維護方式

- 外觀：`assets/css/styles.css`
- 遊戲程式：`assets/js/app.js`
- 靜態相容與本機備份：`assets/js/static-mode.js`
- PWA 快取：`sw.js`
- 原始公開頁快照：`original/index.original.html`（供比對，不建議直接修改）

## 內容與授權提醒

本專案只整理公開端可取得的內容，未包含原站 Worker 原始碼、KV/D1 資料、OAuth/TURN 金鑰或其他私有內容。公開可下載不等於自動取得再散布授權；在公開 repository 或商業使用前，請確認你對網站程式、文案、音訊、人物名稱與其他素材擁有適當權利。本專案不替來源內容推定任何授權。
