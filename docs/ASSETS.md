# 公開資產盤點

擷取日期：2026-11-05（Asia/Taipei）

## 頁面與程式

- `original/index.original.html`：來源網站公開首頁的完整 HTML 快照。
- `index.html`：將內嵌 CSS/JS 拆分後的入口頁。
- `assets/css/styles.css`：來源頁面的內嵌 CSS。
- `assets/js/app.js`：來源頁面的內嵌 JavaScript，僅將相對資產路徑改到 `assets/`。
- `assets/js/static-mode.js`：本專案新增的靜態相容層與進度匯出／匯入。
- `assets/lib/qrcode.js`：原站公開載入的 QR code 產生器。

## 圖示

- `assets/icons/apple-touch-icon.png`
- `assets/icons/icon-192.png`
- `assets/icons/icon-512.png`
- `assets/icons/maskable-512.png`

## AI 資料

- `base3_weak.json`、`base3_medium.json`、`base3_strong.json`
- `levels.json`
- `combos_general.json`
- `skill_general.json`、`skill_it03000.json`
- `novice_it00160.json`、`novice_it00400.json`
- `mc_stages.json`、`mc_hard.json`（公開測試路線資料；其延伸模型未全部鏡像）

## 音訊

- 核心：`shan.mp3`、`ball.mp3`、`bear.mp3`、`chant.mp3`
- 馬師傅語音：`assets/sfx/ma/`
- 公開測試招式語音：`assets/sfx/mv/` 中已列出的檔案

部分招式語音由執行中的程式依招式名稱動態組出路徑，且缺檔時原站本來就會靜默退回無語音或瀏覽器語音。因此本專案保留同樣的容錯，不宣稱已還原來源站上未被明確引用或不存在的檔案。

## 未納入

- Worker/後端原始碼
- D1/KV/R2 內容或 schema
- OAuth、TURN、API 金鑰與環境變數
- 伺服器上的使用者、排行榜、存檔或遙測資料
- 無法由公開頁面確認來源與授權的額外素材
