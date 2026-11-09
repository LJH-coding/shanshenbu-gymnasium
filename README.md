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

## Gymnasium 強化學習環境

需要 Python 3.10 以上和 Node.js 22 以上。請確認終端能執行 `node --version`，再從專案目錄安裝：

```sh
python -m pip install .
```

```python
import gymnasium as gym
import shanshenbu_gym  # 註冊 Shanshenbu-v0

with gym.make("Shanshenbu-v0", difficulty="medium") as env:
    observation, info = env.reset(seed=42)
    env.action_space.seed(42)
    while True:
        action = env.action_space.sample()  # 換成演算法選出的動作
        observation, reward, terminated, truncated, info = env.step(action)
        if terminated or truncated:
            print(info["winner"], info["reason"], reward)
            break
```

| `difficulty` | 對應「馬上玩」 | CPU |
| --- | --- | --- |
| `weak`（預設） | 弱 | 手寫規則 |
| `medium` | 中 | `base3_weak.json` |
| `strong` | 強 | `base3_medium.json` |

`reset(options={"difficulty": "strong"})` 可覆寫單個 episode 的難度。每個 episode 直接開打一回合，重設雙方狀態和 CPU 的決策歷史。雙方各有 200 HP，KO 或 60 秒遊戲倒數結束會回傳 `terminated=True`。勝、負、和局分別給 `+1`、`-1`、`0`，過程中回饋為 `0`。如需額外步數上限，可在 `gym.make()` 傳入 `max_episode_steps`，由 Gymnasium 處理 `truncated`。

觀測是從玩家視角看的 58 維 `float32` 向量，順序與原版三招 AI 相同。前 38 維是雙方的角色狀態，接著是相對距離、牆距與倒數，最後 15 維是最近三個飛行物。每個動作最多推進 4 個 60 Hz 模擬幀。方向和向上瞄準維持這 4 幀，跳躍和出招只在首幀觸發。

| 按鍵 | 後退 | 原地 | 前進 |
| --- | ---: | ---: | ---: |
| 空按 | 0 | 1 | 2 |
| 跳 | 3 | 4 | 5 |
| 閃身步 | 6 | 7 | 8 |
| 浪子踢球 | 9 | 10 | 11 |
| 狗熊哆嗦毛 | 12 | 13 | 14 |
| 上＋閃身步 | 15 | 16 | 17 |

訓練端透過標準輸入與輸出連到本機 Node 子程序，可在 Windows、macOS 和 Linux 上以 `render_mode=None` 運行。SSH 或叢集作業只需讓 Python 與 Node 在作業環境的 `PATH` 上。若叢集提供獨立的 Node 路徑，可在 `gym.make()` 傳入 `node_executable`。模型隨 Python 套件安裝，訓練時可離線載入。

平行收集經驗可使用 Gymnasium 的 `AsyncVectorEnv`，設定 `context="spawn"`，並在 `if __name__ == "__main__":` 區塊啟動。每個環境有自己的對戰狀態與 Node 子程序。每個 worker 指定不同 seed，並在用完後呼叫 `close()`。在專案目錄執行 `python -m unittest discover -s tests -v` 可驗證環境。

### 兩個 agent 對戰

`ShanshenbuSelfplay-v0` 讓兩個 agent 各控制一邊，每個 episode 打一回合。兩邊都取得從自己視角編碼的 58 維觀測，並各自選一個原本的 18 種動作。對戰迴圈把兩個動作一起傳給 `step([action_1, action_2])`。已用「馬上玩」環境訓練的策略可以直接使用各自那份觀測。

```python
import gymnasium as gym
import shanshenbu_gym


def play_round(policy_1, policy_2, seed=42):
    with gym.make("ShanshenbuSelfplay-v0") as env:
        obs, info = env.reset(seed=seed)
        while True:
            actions = [
                int(policy_1(obs["player_1"])),
                int(policy_2(obs["player_2"])),
            ]
            obs, _, terminated, truncated, info = env.step(actions)
            if terminated or truncated:
                return info


# 用原地踢球和站著不動示範。可換成兩個接收觀測並回傳動作的模型。
result = play_round(lambda obs: 10, lambda obs: 1)
print(result["winner"], result["rewards"])
```

`info["winner"]` 在回合結束時會是 `"player_1"`、`"player_2"` 或 `"draw"`。Gymnasium 的標量獎勵以 `player_1` 為視角，兩邊各自的獎勵可從 `info["rewards"]` 讀取。比較模型時，可交換先後順序再跑一輪，讓兩個模型各打一遍兩側。這個環境也可在無畫面的 SSH 或叢集上執行。

### 錄製和觀看評估回放

在要錄製的環境加上 `record_replay=True`，並在下一次 `reset()` 前儲存。兩個環境 ID 都支援回放，預設關閉錄製，適合讓大部分訓練照常執行。

```python
import gymnasium as gym
import shanshenbu_gym

with gym.make("ShanshenbuSelfplay-v0", record_replay=True) as env:
    obs, info = env.reset(seed=42)
    while True:
        # 示範用固定動作。評估時替換成兩個模型各自選出的動作。
        obs, _, terminated, truncated, info = env.step([10, 1])
        if terminated or truncated:
            path = env.unwrapped.save_replay("match.json")
            print(path)
            break
```

在本機啟動上面的 HTTP 預覽，從遊戲左上角選「☰ → 訓練對戰回放」，也可直接開啟 `http://127.0.0.1:8080/?replay=1`。選取 `match.json` 後按「播放」，可暫停、拖曳時間軸和調整速度。遠端評估產生的 JSON 可以複製到本機再開啟。檔案由瀏覽器在本機讀取。

回放每個模擬幀記錄角色和飛行物的位置、出招進度、血量及遊戲時間。播放器讀取這些狀態並用原本的 Canvas 畫出戰鬥，包含擊中時的停頓。按「播放」會依錄下的出招與命中狀態播放遊戲音效，按「音效：開」可靜音。也可在回放網址加上 `&mute=1`，預設以靜音開啟。

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
