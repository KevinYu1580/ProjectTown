# ProjectTown — Handoff 文件

> 給執行 agent：這份文件是需求訪談（共 49 題）的完整結論。**所有標示為「決策」的內容都已經由使用者確認，不可擅自更改或增減功能。** 遇到文件沒涵蓋、或與實際環境衝突的情況，先停下來問使用者，不要自行臆測。
>
> 撰寫日期：2026-10-26　｜　使用者：KevinYu1580（GitHub）　｜　工作目錄：`/Users/me/github/ProjectTown`（目前只有這份文件，尚未 `git init`）

---

## 0. 給執行 agent 的工作規範

1. **先讀完整份文件再動手。** 第 15 節是里程碑，請依序完成，每個里程碑都有驗收條件。
2. **溝通語言**：跟使用者溝通用繁體中文；程式碼、識別字、commit message 的技術術語保留英文。
3. **Commit**：使用 Conventional Commits；commit message 與 PR 內文**絕不附加 `Co-Authored-By` 或任何 AI 署名**。
4. **每次 commit 前**必須在本地跑 `make check` 並全數通過（第 12 節）。不使用 git hook，這是 agent 自己要遵守的紀律。
5. **對外動作授權**（使用者已明確授權，不必再問）：
   - 建立 GitHub repo `KevinYu1580/ProjectTown`，**visibility 設為 private**
   - push 分支、開 PR、CI 綠燈後 merge 自己的 PR
   - 完成里程碑後自行打 release tag（第 13 節）
6. **仍需先問使用者的動作**：把 repo 改成 public、刪除 repo／分支以外的任何東西、修改使用者真實的 `~/.claude/settings.json`（hooks 安裝只能由使用者在 app 裡按按鈕觸發；開發測試時一律對暫存檔操作）。
7. **簡單優先**：用最少的程式碼完成需求，不做投機性抽象，不做第 3 節「不做」清單裡的東西。
8. **美術參考**：https://stocktown.kendddchen.workers.dev/ （「台股小鎮」）。**只參考風格，不可複製其程式碼或素材。**

---

## 1. 產品概述

ProjectTown 是一個 **macOS 動態桌布 app**。它把使用者設定的每個專案資料夾畫成一棟 voxel 風格的小鎮建築，把這台 Mac 上正在跑的每個 Claude Code session 畫成一個小人，用小人的位置和動畫表現該 session 的狀態（執行中、等你回應、剛完成、閒置、睡著）。

- 目的：**美觀、好玩**，順便一眼看出哪個專案的 Claude 在等你。
- 平台：只有 macOS 14+。
- 開源：GitHub，MIT License，初期為 private repo。

---

## 2. 決策總表

| # | 主題 | 決策 |
|---|---|---|
| Q1 | 實作方式 | 自製 Swift app：桌面層級、無邊框、滑鼠穿透的 NSWindow，內嵌 WKWebView 跑 Three.js 場景 |
| Q2 | 顯示資訊 | 狀態 + session 名稱 + 最後活動時間；task list 進度不做 |
| Q3 | 專案設定 | 在 app 的 GUI 設定，用 Finder 資料夾選擇窗新增專案；session 的 `cwd` 在專案路徑底下（含 worktree 子目錄）就算該專案 |
| Q4 | 未設定專案的 session | 忽略，不顯示 |
| Q5 | session 範圍 | 只追蹤本機的 session（CLI + 桌面版），不追蹤 cloud session |
| Q6/Q11 | 互動 | 桌布純顯示、滑鼠穿透；所有控制走 menubar。完整的互動模式留到 v2 |
| Q7 | 美術資源 | 全部程式生成 voxel，不用外部模型 |
| Q8/Q15 | FPS | 可調：15 / 30 / 60 / 120，**預設 15**（v1.1.0 起，原為 60）；一律照設定值，用電池時不降速；桌布被完全遮住時暫停渲染 |
| Q9/Q21 | 開源 | MIT；GitHub Releases 放未簽章（ad-hoc）的 `.app` zip；使用 release tag 與 changelog |
| Q10 | 平台 | 只做 macOS，Windows 不做 |
| Q12 | 「等你回應」資料來源 | 設定中提供 hooks 安裝／移除按鈕；沒裝 hooks 時退回只用 sessions 檔（另見 §5.1 新發現） |
| Q13 | 「剛完成」 | busy 轉 idle 後的一段時間內，**預設 30 分鐘**，可調 |
| Q14 | 設定 GUI | SwiftUI 原生視窗（完整欄位見 §9） |
| Q16 | 場景比喻 | 專案 = 建築，session = 小人；狀態對應見 §8.5 |
| Q17/Q23/Q31/Q32 | 日夜 | 兩種模式：「真實時間」（自訂日出、日落時間，預設 06:00 / 18:00）、「固定循環」（週期長度可調、白天比例可調）。日出、日落漸變固定為真實世界約 1 小時的比例，不可調、GUI 不顯示 |
| Q18 | HUD | 左下角半透明面板，顯示各專案的 session 狀態統計，可關閉 |
| Q19 | 版面 | 依設定順序排成街區網格，攝影機自動框住全部專案；超過 12 棟時建築縮小 |
| Q20 | 多螢幕 | v1 只在一台螢幕上顯示，預設主螢幕，可在設定中選擇 |
| Q22 | 資料更新 | 每秒輪詢一次，狀態有變才推給場景 |
| Q24 | Release | SemVer、`CHANGELOG.md`（Keep a Changelog）、push tag 後由 GitHub Actions 自動 build 並發佈 |
| Q25 | 語言 | 介面支援繁體中文與英文（跟隨系統語言）；README 有英文版與繁中版（`README.zh-Hant.md`，2026-10-28 使用者追加），並列出支援語言 |
| Q26 | 最低版本 | macOS 14 Sonoma |
| Q27 | 隱私 | 「隱藏 session 名稱」開關，**預設開啟** |
| Q28/Q33 | 測試 | 場景有 mock 模式；Swift 與 Web 都要有單元測試；Playwright 冒煙測試；本地 `make check` 與 CI 跑相同檢查 |
| Q34 | git hook | **不做** |
| Q35 | Xcode 專案 | XcodeGen（`project.yml`），`.xcodeproj` 不進版控 |
| Q36/Q29 | 建築款式 | 10 種（見 §8.4），依路徑 hash 自動挑選，可手動改 |
| Q37 | session 結束 | 小人走出去、沿街離開後消失 |
| Q38 | 人數過多 | 每棟建築最多畫 6 個小人，其餘在招牌顯示實際的「+N」 |
| Q39 | menubar | 只顯示圖示，不加 badge |
| Q40 | 識別 | repo `KevinYu1580/ProjectTown`；bundle id `io.github.kevinyu1580.ProjectTown` |
| Q41 | 里程碑 | 見 §15 |
| Q42 | 對外動作 | 建立 repo 與 push 不用確認；repo 初期為 **private** |
| Q43 | 文件位置 | `/Users/me/github/ProjectTown/HANDOFF.md` |
| Q44 | 睡著 | 閒置超過門檻（預設 2 小時，可調）就「睡著」：小人回到建築裡，窗戶熄燈並冒出 zZ |
| Q45 | CI 成本 | Web 檢查跑在 ubuntu；Swift 只在相關檔案有變更時才跑 macOS runner |
| Q46 | release tag | agent 完成里程碑後自行打 tag |
| Q47 | 攝影機調整 | menubar「調整視角」模式：小鎮暫時浮到最上層，可用滑鼠操作；另提供 4 個預設角度與重設按鈕 |
| Q48 | 投影與景深 | 透視投影 + 移軸景深（微縮模型感），可關閉，預設開啟 |
| Q49 | 攝影機模式 | 三選一：固定（預設）／定時環繞／自動緩慢環繞（詳見 §8.8） |

---

## 3. 範圍

### v1 要做
§2 表格裡的所有內容。

### v1 不做（不要實作，也不要預留抽象）
- Windows / Linux 支援
- 桌布上的完整互動（hover 顯示詳情、點建築開啟專案）
- task list 進度（例如 3/7）
- cloud session
- 依地理位置計算日出日落
- 多台螢幕同時顯示
- menubar badge
- 本地 git hook
- code signing 與 notarization（只做 ad-hoc 簽章，見 §13）
- 顯示未設定專案的 session

---

## 4. 架構

### 4.1 元件

```
┌──────────────────────── ProjectTown.app (Swift, LSUIElement) ───────────────────────┐
│                                                                                     │
│  MenuBarController ── NSStatusItem（只有圖示）                                         │
│        │                                                                            │
│  SettingsWindow (SwiftUI) ── SettingsStore ── config.json                           │
│        │                                                                            │
│  ProjectTownCore（本地 SPM package，純邏輯，可單元測試）                                 │
│    ├─ SessionReader        讀 ~/.claude/sessions/*.json                              │
│    ├─ ProcessChecker       確認 pid 存活，並防止 pid 被重複使用                           │
│    ├─ HookStateReader      讀 hooks 寫入的狀態檔                                       │
│    ├─ ProjectMatcher       cwd → 專案（最長前綴）                                       │
│    ├─ SessionStateDeriver  推導 running / waiting / finished / idle / sleeping         │
│    ├─ TownStateBuilder     組出要推給場景的 TownState JSON                              │
│    └─ HooksInstaller       合併或移除 ~/.claude/settings.json 裡的 hooks                │
│        │                                                                            │
│  WallpaperWindowController ── NSWindow（桌面層級）── WKWebView                         │
│        │      ▲ evaluateJavaScript: projectTown.update / applySettings / ...          │
│        │      └ webkit.messageHandlers.projectTown（ready / cameraSaved / error）     │
│        │                                                                            │
│  HookCommand：同一個執行檔帶 `hook` 參數啟動時，只處理 hook 輸入就結束，不開 UI             │
└─────────────────────────────────────────────────────────────────────────────────────┘
                   │ 載入 bundle 內的靜態檔
                   ▼
        web/dist（Three.js + TypeScript + Vite）── 場景、HUD、mock 模式
```

### 4.2 技術棧

| 部分 | 選擇 |
|---|---|
| App | Swift 5.10+／Swift 6、SwiftUI（設定畫面）、AppKit（桌布視窗、menubar）、WKWebView |
| 專案檔 | XcodeGen（`project.yml`） |
| Swift 邏輯測試 | 本地 SPM package `ProjectTownCore` + XCTest（用 `swift test` 跑，不需要 app host） |
| 場景 | Three.js、TypeScript（strict）、Vite |
| Web 測試 | Vitest（單元測試）、Playwright（冒煙測試，Chromium） |
| Lint | ESLint（TS）；Swift 不強制加 linter（不增加依賴） |
| 開發用 UI | mock 模式的控制面板可用 `lil-gui`（只在 dev／mock 模式載入） |

所有 npm 依賴都要**釘選精確版本**（`package-lock.json` 進版控）。版本選實作當下的最新穩定版。

### 4.3 Repo 結構

```
ProjectTown/
├─ HANDOFF.md
├─ README.md                 英文（另有 README.zh-Hant.md 繁中版）
├─ CHANGELOG.md              Keep a Changelog 格式
├─ LICENSE                   MIT，Copyright (c) 2026 KevinYu1580
├─ Makefile                  check / dev / app / test-web / test-swift / clean
├─ project.yml               XcodeGen
├─ .gitignore                *.xcodeproj、DerivedData、node_modules、web/dist、build/
├─ app/
│  ├─ Sources/ProjectTown/   App、MenuBar、Settings（SwiftUI）、Wallpaper、HookCommand
│  ├─ Resources/             Assets.xcassets（app icon、menubar 圖示）、Localizable.xcstrings、Info.plist
│  └─ Tests/                 只放必須依賴 AppKit 的少量測試（可能不需要）
├─ Packages/ProjectTownCore/
│  ├─ Package.swift
│  ├─ Sources/ProjectTownCore/
│  └─ Tests/ProjectTownCoreTests/   含 Fixtures/（sessions json 樣本）
├─ web/
│  ├─ package.json / package-lock.json / tsconfig.json / vite.config.ts / eslint.config.js
│  ├─ index.html
│  ├─ src/
│  │  ├─ main.ts             進入點：偵測執行環境（WKWebView 或 mock）
│  │  ├─ bridge.ts           window.projectTown API 與 postMessage
│  │  ├─ types.ts            TownState、SceneSettings（與 Swift 端對齊）
│  │  ├─ scene/              renderer、layout、buildings/（10 款）、characters、sky、camera、postfx
│  │  ├─ hud/                HUD DOM 與 CSS
│  │  ├─ i18n/               zh-Hant.ts、en.ts
│  │  ├─ time/               dayNight.ts（純函式）
│  │  └─ mock/               mock 資料產生器、lil-gui 控制面板
│  ├─ tests/                 Vitest
│  └─ e2e/                   Playwright 冒煙測試
├─ scripts/
│  └─ changelog-section.sh   從 CHANGELOG.md 擷取指定版本的段落
├─ docs/screenshots/         README 用的截圖與 GIF
└─ .github/workflows/
   ├─ ci.yml
   └─ release.yml
```

---

## 5. 資料來源（最關鍵的部分）

### 5.1 `~/.claude/sessions/<pid>.json`（主要來源，未公開格式）

Claude Code（CLI 與桌面版）會為每個存活的互動 session 寫一個以 pid 命名的檔案。旁邊的 `<pid>.<hash>.key` 檔與本專案無關，忽略即可。

**實際觀察到的樣本**（Claude Code 2.1.308，2026-10-26）：

```json
{
  "pid": 10434,
  "sessionId": "941a5c32-62ef-4cc4-ae6d-ee017a605e1f",
  "cwd": "/Users/me/projects/demo",
  "startedAt": 1792924125747,
  "procStart": "Sun Oct 25 10:28:45 2026",
  "version": "2.1.308",
  "kind": "interactive",
  "entrypoint": "claude-desktop",
  "name": "Demo session",
  "nameSource": "user",
  "nameSince": 1792924126412,
  "status": "idle",
  "updatedAt": 1792924794503,
  "statusUpdatedAt": 1792924794503,
  "...": "其他欄位（peerProtocol、messagingSocketPath、bridgeSessionId…）忽略"
}
```

- 時間戳都是 Unix epoch **毫秒**。
- 實際檔案裡看到的 `status` 只有 `"busy"` 和 `"idle"`。
- `name` 可能不存在。這時顯示「(session 無名稱)」（英文：「(unnamed session)」），**不要顯示 session id**。
- 使用者 rename session 時，`name`、`nameSource`、`nameSince` 會更新，下次輪詢就讀得到新名稱（推論，需在 M2 驗收實測）。

**新發現（未驗證，M4 一開始就要驗證）**：檢查 Claude Code 2.1.300 的執行檔字串，發現 session 狀態物件裡可能還有 `status: "waiting"` 和 `waitingFor: "<string>"` 兩個欄位（例如 `"input needed"`）。如果權限提示出現時，sessions 檔真的會寫入 `"waiting"`，就不需要 hooks 也能拿到「等你回應」狀態。

**處理方式**：
- `SessionReader` 一律支援 `status ∈ {"busy","idle","waiting"}`，`waitingFor` 為選用欄位，遇到其他未知值一律當作 `idle`。
- 只要 `status == "waiting"` 或 hooks 回報 waiting，就判定為「等你回應」。
- hooks 功能照原計畫做（使用者已確認）。M4 驗證結果要寫進 README 的「How it works」與 CHANGELOG。如果發現 hooks 完全多餘，**先問使用者**是否保留，不要自行移除。

**解析規則**：
- 用 `Codable`，除了 `pid`、`sessionId`、`cwd`、`status` 之外的欄位都設為 optional，並忽略未知欄位。
- 單一檔案解析失敗時跳過該檔並記錄 log（`os.Logger`，subsystem 為 bundle id），不要影響其他 session。
- 整個目錄不存在或無法讀取時，HUD 顯示「找不到 Claude Code 的 session 資料」（需在地化）。
- 只處理 `kind == "interactive"` 或沒有 `kind` 的檔案。

### 5.2 確認 process 存活（`ProcessChecker`）

session 檔在 process 異常結束時可能殘留，所以每次輪詢都要確認：

1. `kill(pid, 0) == 0`，或失敗時 `errno == EPERM`，都算存活。
2. **防止 pid 被重複使用**：用 `proc_pidinfo(pid, PROC_PIDTBSDINFO, …)` 取得 `pbi_start_tvsec`，與檔案的 `procStart` 比對。`procStart` 是本地時區的 `EEE MMM d HH:mm:ss yyyy`，用 `en_US_POSIX` locale 解析，誤差 2 秒內算同一個 process。缺少 `procStart` 或解析失敗時，只看第 1 點。
3. 做成 protocol（`ProcessChecking`），讓測試可以注入假的實作。

### 5.3 Hooks（補上「等你回應」狀態）

**hook 指令**：直接使用 app 本身的執行檔，不另外寫 shell script（macOS 不一定有 `jq` 和 `python3`；而且不能把 prompt 內容寫到磁碟）。

```
"<目前 app bundle 路徑>/Contents/MacOS/ProjectTown" hook --projecttown-hook
```

- `main` 一開始就檢查參數：若第一個參數是 `hook`，從 stdin 讀 JSON，只取出 `session_id`、`hook_event_name`、`notification_type`、`cwd`，寫入狀態檔後 `exit(0)`。**絕不啟動 NSApplication，也不寫入 prompt、tool_input 等任何內容。**
- `--projecttown-hook` 是標記，移除 hooks 時靠它辨識哪些是我們加的。
- 無論發生什麼錯誤，hook 都必須 `exit(0)`，而且要在 100ms 內結束，不可影響 Claude。
- 每個 handler 設定 `"timeout": 5`。官方文件提到 command hook 支援 `"async": true`（在背景執行）。實作前請閱讀 https://code.claude.com/docs/en/hooks 的「Run hooks in the background」段落，確認語法後再加上；不確定就不要加。

**要註冊的事件**：

| 事件 | matcher | 寫入的狀態 |
|---|---|---|
| `Notification` | `permission_prompt\|elicitation_dialog\|elicitation_url_dialog\|agent_needs_input` | `waiting` |
| `PermissionRequest` | `*` | `waiting` |
| `PostToolUse` | `*` | 清除 waiting（權限已批准、工具已執行） |
| `UserPromptSubmit` | 無 matcher | 清除 waiting |
| `Stop` | 無 matcher | 清除 waiting，並記錄 `lastStopAt` |
| `SessionEnd` | `*` | 刪除該 session 的狀態檔 |

`idle_prompt` **不算** waiting：它只表示 Claude 做完後閒置太久，在我們的模型裡屬於 idle／finished。

**hook 的 stdin 欄位**（引用官方文件）：所有事件都有 `session_id`、`transcript_path`、`cwd`、`hook_event_name`；`Notification` 另有 `message`、`title`、`notification_type`。

**狀態檔**：`~/Library/Application Support/ProjectTown/hook-state/<session_id>.json`。寫入時先寫暫存檔再 rename，確保原子性。

```json
{ "sessionId": "…", "waiting": true, "waitingSince": 1793027470763, "lastStopAt": 1793027000000, "updatedAt": 1793027470763 }
```

app 每次輪詢時順便讀取，並刪除 sessions 檔裡已不存在的 session 所對應的狀態檔。

**安裝與移除（`HooksInstaller`）**：
- 目標檔：`~/.claude/settings.json`。測試時一律注入暫存路徑，**開發過程不可動到使用者真實的檔案**。
- 安裝前先備份成 `settings.json.projecttown-backup-<yyyyMMdd-HHmmss>`。
- 檔案不存在就建立；JSON 無效就**中止**，並在 GUI 顯示錯誤，不可覆寫。
- **合併，不覆蓋**：使用者已經有 `SessionStart`、`SessionEnd`、`Stop` 等 hooks（例如 ccusage-tracker），只能在對應事件的陣列**後面新增** matcher group，不可修改或刪除既有項目。
- 若已安裝（找到含 `--projecttown-hook` 的 command），先移除舊項目再重新安裝。app 搬移路徑後也可以用這個方式更新。
- 移除：只刪除 command 含 `--projecttown-hook` 的 handler；刪除後若 matcher group 變空就刪除該 group，若事件陣列變空就刪除該事件鍵。
- 用 `JSONSerialization` 讀寫，並加上 `.prettyPrinted`、`.withoutEscapingSlashes`。鍵的順序可能改變，這可以接受，但要在 GUI 的安裝說明中提到「會重新排版 settings.json，已自動備份」。
- GUI 顯示目前狀態：未安裝／已安裝／已安裝但路徑過期（command 裡的 app 路徑與目前 bundle 路徑不同）。
- 安裝後提示：「新的 hooks 只會套用到之後啟動的 Claude session」（需在 M4 實測確認是否如此，再決定提示措辭）。

### 5.4 狀態推導（`SessionStateDeriver`）

輸入：sessions 檔、hook 狀態、目前時間（注入 `Clock`）、設定值（`finishedWindow`，預設 30 分鐘；`sleepThreshold`，預設 2 小時）、記憶體中上一輪的狀態。

依以下順序判斷，第一個符合的就是結果：

1. **process 不存活** → 從清單移除（場景播放離開動畫）。
2. **waiting**：`status == "waiting"`，或 hook 狀態 `waiting == true` 且 `waitingSince >= statusUpdatedAt - 2000ms`（避免使用過期的 hook 狀態）。
3. **running**：`status == "busy"`。
4. 以下 `status == "idle"`，令 `idleFor = now - statusUpdatedAt`：
   - **finished**：`idleFor < finishedWindow`，且符合以下任一條件：
     (a) 本 app 在記憶體中觀察到這個 session 從 running 或 waiting 轉成 idle；
     (b) hook 狀態有 `lastStopAt`，且距今小於 `finishedWindow`；
     (c) `statusUpdatedAt - startedAt > 10_000ms`，表示曾經工作過，用來在 app 剛啟動時判斷；新開的空 session 兩者幾乎相等，不會誤判。
   - **sleeping**：`idleFor >= sleepThreshold`。
   - **idle**：其他情況。
5. 設定驗證：`sleepThreshold` 必須大於 `finishedWindow`，GUI 要擋下不合法的值。

`lastActivityAt` 一律使用 `statusUpdatedAt`（沒有時用 `updatedAt`，再沒有用 `startedAt`）。

### 5.5 專案對應（`ProjectMatcher`）

- 專案路徑與 session `cwd` 都先正規化：展開 `~`、`resolvingSymlinksInPath`、`standardizingPath`、移除結尾的 `/`。
- 比對時以**路徑元件**為單位，不能只比字串前綴：`/a/foo` 不可匹配 `/a/foobar`。
- 比對不分大小寫（APFS 預設不分大小寫）。
- 一個 `cwd` 符合多個專案（巢狀路徑）時，選**最長**的那個。
- 「含 worktree 子目錄」用前綴規則就能涵蓋（例如 `<repo>/.claude/worktrees/<name>`）。位於專案路徑外的 git worktree **不算**（v1 不解析 git）。
- 不屬於任何專案的 session 直接丟棄。

### 5.6 輪詢

- 主執行緒以外的 serial queue 上，用 `Timer` 或 `DispatchSourceTimer` 每 1 秒執行一次：讀 sessions 檔、檢查 pid、讀 hook 狀態，再建出 `TownState`。
- 與上一次送出的 `TownState` 比較（用 `Equatable`，不比 `generatedAt`），**有變才** `evaluateJavaScript`。
- 例外：`lastActivityAt` 的相對時間顯示（例如「3 分鐘前」）由 JS 端自己每 30 秒更新，不靠 Swift 推送。

---

## 6. Swift ↔ JS 協定

### 6.1 JS 對外提供的 API（`window.projectTown`）

```ts
interface ProjectTownAPI {
  update(state: TownState): void
  applySettings(settings: SceneSettings): void
  setPaused(paused: boolean): void          // 被遮住、螢幕鎖定或使用者手動暫停時
  enterCameraEdit(): void                   // 顯示調整視角的工具列，啟用 OrbitControls
  exitCameraEdit(save: boolean): void
  setCameraPreset(index: 0 | 1 | 2 | 3): void
  resetCamera(): void
  reload(): void
}
```

### 6.2 JS → Swift（`webkit.messageHandlers.projectTown.postMessage`）

```ts
type ToSwift =
  | { type: 'ready' }                                   // 場景初始化完成，Swift 收到後才推 settings 和 state
  | { type: 'cameraSaved'; camera: CameraBase }         // 調整視角模式結束且有存檔
  | { type: 'cameraEditClosed' }                        // 結束調整模式，Swift 把視窗降回桌面層
  | { type: 'error'; message: string }                  // 寫入 Swift log
```

### 6.3 資料型別（`web/src/types.ts`，與 Swift `Codable` 一一對應）

```ts
type SessionState = 'running' | 'waiting' | 'finished' | 'idle' | 'sleeping'

interface TownState {
  version: 1
  generatedAt: number                 // epoch ms
  dataSourceOk: boolean               // false 時 HUD 顯示錯誤提示
  projects: Array<{
    id: string                        // 正規化路徑的穩定 hash（例如 SHA-256 前 12 碼）
    name: string
    color: string                     // '#RRGGBB'
    buildingStyle: BuildingStyle      // 由 Swift 解析好：自動挑選或使用者指定
    sessions: Array<{
      id: string                      // sessionId
      name: string | null             // null 時由 JS 顯示在地化的「(session 無名稱)」
      state: SessionState
      lastActivityAt: number
    }>
  }>
}

type BuildingStyle =
  | 'office' | 'factory' | 'cafe' | 'bookstore' | 'lab'
  | 'warehouse' | 'radioTower' | 'greenhouse' | 'clockTower' | 'ramenShop'

interface CameraBase { azimuthDeg: number; pitchDeg: number; zoom: number; target: [number, number] }

interface SceneSettings {
  locale: 'zh-Hant' | 'en'
  fps: 15 | 30 | 60 | 120
  hudVisible: boolean
  hideSessionNames: boolean
  theme: 'pastoral' | 'urban'          // 外圍：田園或都會
  depthOfField: boolean
  depthOfFieldStrength: number        // 景深模糊的倍率，1 為預設
  depthOfFieldRange: number           // 畫面上下邊緣模糊帶的高度（螢幕高度的比例），小鎮本身不模糊
  dayNight:
    | { mode: 'realtime'; sunrise: string; sunset: string }          // 'HH:mm'
    | { mode: 'cycle'; periodMinutes: number; dayRatio: number; cycleEpoch: number }
  camera: {
    mode: 'fixed' | 'interval' | 'continuous'
    intervalMinutes: number           // 定時環繞
    continuousPeriodMinutes: number   // 自動緩慢環繞：轉一圈要幾分鐘
    base: CameraBase
  }
}
```

`cycleEpoch`：app 啟動時的 epoch ms，固定循環從這一刻開始算白天的起點（見 §8.7）。

### 6.4 載入方式

- `WKWebView.loadFileURL(<bundle>/Resources/web/index.html, allowingReadAccessTo: <bundle>/Resources/web/)`。
- Vite 設定 `base: './'`，確保在 `file://` 下的相對路徑正確。
- `WKWebView` 背景透明不重要（場景會畫滿），但要設定 `setValue(false, forKey: "drawsBackground")`，避免載入時閃白。
- 開發時可用環境變數 `PROJECTTOWN_WEB_URL=http://localhost:5173` 讓 app 改載 Vite dev server，方便熱更新。

---

## 7. 桌布視窗與 menubar（Swift）

### 7.1 桌布視窗

- `NSWindow(styleMask: .borderless)`，大小等於目標螢幕的 `frame`。
- `level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))`。**驗收**：桌面 icon 仍在小鎮上方，可正常點選與拖曳；系統原本的桌布圖片被蓋住。若 macOS 26 上 icon 被蓋住或無法點選，改試 `desktopWindow + 1` 或 `desktopIconWindow - 1`，並把結論記在程式註解裡。
- `ignoresMouseEvents = true`、`collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]`、`isOpaque = true`、`hasShadow = false`。
- 監聽 `NSApplication.didChangeScreenParametersNotification`，螢幕解析度或排列改變時重新設定 frame。
- 目標螢幕：設定中選擇的螢幕，以 `CGDisplayCreateUUIDFromDisplayID` 的 UUID 儲存；找不到該螢幕時改用 `NSScreen.main`。

### 7.2 暫停渲染

以下任一情況成立就呼叫 `setPaused(true)`：
- `window.occlusionState` 不含 `.visible`（全螢幕 app 或視窗完全蓋住桌面）
- `NSWorkspace.screensDidSleepNotification`、`sessionDidResignActiveNotification`（螢幕關閉、鎖定、切換使用者）
- 使用者在 menubar 選「暫停渲染」

條件解除後恢復渲染。JS 端暫停時要完全停止 `requestAnimationFrame` 迴圈，不能只是不畫。

**驗收**：開一個全螢幕 app 時，Activity Monitor 裡 ProjectTown（含 WebContent process）的 CPU 用量接近 0%。

### 7.3 調整視角模式（Q47）

1. menubar 選「調整視角」→ Swift 把視窗 `level` 改為 `.floating`、`ignoresMouseEvents = false`、`makeKeyAndOrderFront`。borderless 視窗預設不能成為 key window，需要建立 `NSWindow` 子類別並覆寫 `canBecomeKey = true`。
2. 呼叫 `enterCameraEdit()`。JS 顯示頂部置中的半透明工具列：預設角度 1–4、重設、取消、完成，並附操作說明（拖曳旋轉、捲動縮放、右鍵或雙指拖曳平移）。
3. 用 Three.js `OrbitControls`，限制俯角 20°–70°、縮放 0.5×–3×（相對於自動框住全部建築時的距離）、平移範圍不超出小鎮邊界加 20%。
4. 按「完成」或 Esc → `exitCameraEdit(true)` → JS 送出 `cameraSaved` 與 `cameraEditClosed`。按「取消」→ 還原視角，只送 `cameraEditClosed`。
5. Swift 收到 `cameraEditClosed` 後把視窗降回桌面層，並恢復 `ignoresMouseEvents = true`。
6. 調整視角期間暫停環繞動畫；結束後從新的 `base` 繼續。

### 7.4 menubar

- `NSStatusItem` 只有一個圖示（自製的 template image，小房子造型；暫時可用 SF Symbol `house.fill`）。**不加 badge 或數字。**
- 選單項目（需在地化）：
  - 開啟設定…（⌘,）
  - 調整視角
  - 暫停渲染／恢復渲染
  - 重新載入場景
  - 關於 ProjectTown（顯示版本號與 GitHub 連結）
  - 結束 ProjectTown（⌘Q）
- `Info.plist` 設定 `LSUIElement = YES`，不在 Dock 顯示圖示。

### 7.5 開機自動啟動

用 `SMAppService.mainApp.register()` / `unregister()`；設定畫面的開關以 `SMAppService.mainApp.status` 為準，不另外儲存。

---

## 8. 場景（Three.js）

### 8.1 美術風格（參考台股小鎮）

參考畫面的特徵（照這個方向做，但要是自己的作品）：
- 等角感的透視視角，俯角約 35°–45°，像在看一座微縮模型。
- **Voxel／low-poly**：建築、樹、路燈、長椅、小人全都是方塊拼成。沒有貼圖，只用純色材質（`MeshStandardMaterial`，roughness 偏高）。
- **夜景是重點**：深藍偏灰的環境色；暖黃色路燈有光暈（點光源加上 emissive 材質，可加輕微 bloom）；建築窗戶亮燈；建築招牌或螢幕會發光。
- 白天：暖色陽光、柔和陰影、天空偏淡藍灰。
- 地面：灰色道路、白色斑馬線、人行道、零星的 low-poly 樹（方塊或錐體）、長椅、路燈。
- 小人：大約 3–4 個方塊（頭、身體、腿），衣服顏色依 session id 的 hash 決定，從約 12 色的柔和色盤中挑選。
- **移軸景深**：畫面上下邊緣模糊，中央清晰（微縮模型感）。
- UI 面板：深色半透明、圓角、細邊框、白字，數字使用等寬字型。

### 8.2 版面（Q19）

- 每個專案佔一塊方形地塊，依設定順序由左到右、由上到下排成網格：`cols = ceil(sqrt(n))`。地塊之間是道路與人行道。
- 每塊地上放一棟建築，門口有長椅（最多 3 張，每張可坐 2 人）。
- 道路上的路燈與樹依地塊座標決定固定位置，每次載入都一樣。
- 專案數 > 12 時，建築與地塊縮放為 0.8（> 20 時為 0.65）。專案數沒有上限。
- 自動取景：算出所有地塊的 bounding box，調整攝影機距離讓 bounding box 剛好在畫面中（留 10% 邊距）。`CameraBase.zoom` 是相對於這個距離的倍率。
- **HUD 避讓**：HUD 在左下角；桌面 icon 預設在右側。自動取景時把小鎮中心稍微往右上偏移，避免被 HUD 擋住。
- 沒有任何專案時，顯示一塊空地與提示文字「從 menubar 開啟設定，新增你的第一個專案」（需在地化）。

### 8.3 招牌（每棟建築上方）

- 第一行：專案名稱（白字，背景為專案顏色，整塊發光）。
- 第二行：各狀態的數量圖示，只顯示數量 > 0 的狀態，例如 `⚙ 2  ! 1  ✓ 1  zZ 3`。
- 有小人沒畫出來時（見 §8.5），加上 `+N`，**N 是實際沒畫出來的人數**。
- 文字用 `CanvasTexture` 繪製；所有招牌都面向攝影機（billboard），解析度要考慮 Retina（devicePixelRatio）。
- 招牌也要受日夜影響：夜晚發光較明顯。

### 8.4 建築款式（10 種，Q36）

| key | 名稱 | 特徵 |
|---|---|---|
| `office` | 辦公大樓 | 4–5 層、規則的窗格 |
| `factory` | 工廠 | 鋸齒屋頂、煙囪（執行中時冒煙） |
| `cafe` | 咖啡店 | 1–2 層、條紋遮陽棚、門口有桌椅 |
| `bookstore` | 書店 | 2 層、大面櫥窗、書架色塊 |
| `lab` | 實驗室 | 屋頂有圓頂（用方塊堆出近似圓頂） |
| `warehouse` | 倉庫 | 寬而矮、捲門、門口有棧板與箱子 |
| `radioTower` | 電台塔 | 小建築加上高格子塔，塔頂有閃爍紅燈 |
| `greenhouse` | 溫室 | 半透明綠色玻璃方塊、裡面有植物 |
| `clockTower` | 鐘樓 | 高塔、四面鐘面（指針跟著場景時間走） |
| `ramenShop` | 拉麵店 | 1 層、門口有暖簾、紅燈籠 |

- 自動挑選：`styles[hash(正規化路徑) % 10]`。
- 每款建築都要有：可發光的窗戶（數量 ≥ 6，供睡著的 session 使用）、一樓的玻璃店面（讓執行中的小人看得見）、門口位置、招牌錨點。
- 頂樓或屋簷用專案顏色做點綴，讓同款建築也能區分。
- 每款建築做成獨立模組 `buildings/<key>.ts`，對外介面一致：`build(color): BuildingHandle`，`BuildingHandle` 提供窗戶、店面座位、門口、招牌錨點等位置，以及 `setLit(on)`、`setWindowState(i, 'off'|'lit'|'sleep')` 等方法。
- 為了效能，同一款建築的重複幾何可用 `InstancedMesh` 或合併 geometry，但不必過早優化：v1 的目標是 20 棟建築在 M1 Mac 上能穩定 60fps。

### 8.5 小人與狀態（Q16、Q37、Q38、Q44）

| 狀態 | 位置 | 動畫與效果 |
|---|---|---|
| `running` 執行中 | 一樓玻璃店面後方的工作桌 | 打字動畫；頭上有旋轉的齒輪圖示；建築窗戶輕微閃爍 |
| `waiting` 等你回應 | 站在門口 | 頭上有黃色「!」氣泡上下跳動，**是全場最醒目的元素**（夜間也要清楚可見） |
| `finished` 剛完成 | 門口附近站著 | 進入這個狀態的瞬間在建築上方放一次小煙火（約 3 秒）；之後腳下持續有綠色光圈，直到時限結束 |
| `idle` 閒置 | 坐在門口的長椅 | 偶爾伸懶腰或左右張望（隨機間隔 10–30 秒） |
| `sleeping` 睡著 | 不畫小人；改用一扇窗戶 | 該窗熄燈，旁邊冒出緩緩飄動的「zZ」 |
| 離開（process 結束） | 從目前位置走到最近的道路，再沿道路走向地圖邊緣 | 約 4 秒後淡出並移除；若原本是睡著，就只把那扇窗的 zZ 淡出 |

- **畫面上的小人上限**：每棟建築最多 6 個（`sleeping` 不佔名額）。超過時依優先順序 `waiting > running > finished > idle` 挑選，同狀態內較近期活動的優先；其餘人數計入招牌的 `+N`。
- 睡著的 session 若多於窗戶數，多出的只反映在招牌的 `zZ` 數量上。
- 狀態改變時，小人用走路動畫移到新位置（約 1.5 秒），不要瞬間移動。
- 專案沒有任何 session 時，整棟建築熄燈（窗戶、招牌暗下，但專案名稱仍看得到）。
- **小人頭上的名稱標籤**：顯示 session 名稱與相對時間（例如「Issue #43 backend・3 分鐘前」）。`hideSessionNames == true`（預設）時完全不顯示名稱標籤，只保留狀態圖示。`name == null` 時顯示「(session 無名稱)」／「(unnamed session)」。

### 8.6 HUD（Q18）

- 左下角，距離畫面邊緣 24px，並避開 Dock 可能出現的高度（底部至少保留 96px，或讀取 `NSScreen.visibleFrame` 換算後透過 settings 傳入，擇一即可，選簡單的）。
- 深色半透明圓角面板，最大寬度 360px。內容：
  - 標題列：`ProjectTown`，右側顯示總數，例如「5 個 session」
  - 每個專案一列：色點、專案名稱、各狀態的數量（圖示 + 數字，只顯示 > 0 的）
  - 專案超過 8 個時，只列出有 session 的專案；仍超過 8 個時，列出前 8 個並加上「還有 N 個專案」
  - `dataSourceOk == false` 時，面板頂部顯示錯誤提示
- `hudVisible == false` 時完全隱藏。
- HUD 用 DOM + CSS 實作（不畫在 WebGL 裡），字型使用系統字型 `-apple-system`，數字加上 `font-variant-numeric: tabular-nums`。

### 8.7 日夜（Q17、Q23、Q31、Q32）

把邏輯寫成純函式 `web/src/time/dayNight.ts`，以便單元測試：

```ts
// 回傳 0 = 深夜、1 = 正午般的全亮，以及目前的時段標籤
function lightLevel(nowMs: number, settings: SceneSettings['dayNight']): { level: number; phase: 'night' | 'dawn' | 'day' | 'dusk' }
```

**真實時間模式**：
- 使用者設定日出、日落時間（`HH:mm`，預設 06:00、18:00），使用本機時區。
- 漸變長度固定為 **60 分鐘**，以日出、日落時刻為中心（日出 06:00 時，05:30–06:30 從夜漸變到晝）。
- 日落時間早於或等於日出時間時，GUI 要擋下。

**固定循環模式**：
- `periodMinutes`：5–1440，預設 60。
- `dayRatio`：白天佔整個週期的比例，0.1–0.9，預設 0.5（GUI 用滑桿顯示百分比）。
- 漸變長度固定為 `period / 24`（等同真實世界 24 小時中約 1 小時，約 4.2%），日出、日落各一段，**不可調、GUI 不顯示**。
- 週期起點 `cycleEpoch` = app 啟動時間，起點落在「日出漸變結束」的那一刻，所以一啟動就是白天。
- 時間軸（以週期內的位置 `p ∈ [0, period)` 表示，`T = period/24`、`D = dayRatio × period`）：
  - `[0, D - T)`：白天（level = 1）
  - `[D - T, D)`：日落漸變
  - `[D, period - T)`：夜晚（level = 0）
  - `[period - T, period)`：日出漸變（結束時回到下一個週期的 `p = 0`）
  - 白天長度以「日出漸變中點」到「日落漸變中點」計算，恰好等於 `D`；黑夜等於 `period - D`。實作時把這個定義寫進測試（例如 period 60、dayRatio 0.7 時，白天中點到中點為 42 分鐘）。dayRatio 限制在 0.1–0.9，可保證每一段長度都不為負。

**`level` 影響的元素**（都用 `level` 內插）：
- 天空背景色、霧色、環境光強度、太陽（`DirectionalLight`）的強度與角度
- 路燈：`level < 0.5` 時亮
- 建築窗戶：有 session 的建築在夜晚亮燈較明顯，白天窗戶仍有淡淡的光
- 漸變期間加入暖橘色調（黃昏或清晨）

**陰影**：只有太陽投射陰影；陰影貼圖 2048，`PCFSoftShadowMap`。

### 8.8 攝影機（Q47、Q48、Q49）

- `PerspectiveCamera`，fov 約 30°（較窄的 fov 讓透視感接近等角，更像微縮模型）。
- `CameraBase`：`azimuthDeg`（水平角度）、`pitchDeg`（俯角 20–70）、`zoom`（0.5–3）、`target`（平移中心 `[x, z]`）。預設值：`{ azimuthDeg: 45, pitchDeg: 40, zoom: 1, target: [0, 0] }`。
- **4 個預設角度**：azimuth 45°、135°、225°、315°，俯角與縮放沿用目前值。
- **重設**：回到預設值。
- **三種模式**（一次只能選一種）：

| 模式 | 行為 | 可調參數 |
|---|---|---|
| `fixed` 固定（預設） | 停在 `base` | 無 |
| `interval` 定時環繞 | 每 `intervalMinutes` 分鐘，用 3 秒（ease-in-out）把 azimuth 平滑加 90°，然後停住 | `intervalMinutes`：1–60，預設 10 |
| `continuous` 自動緩慢環繞 | 持續公轉，角速度 = 360° / `continuousPeriodMinutes` | `continuousPeriodMinutes`：2–60，**預設 60**（最快 2 分鐘一圈，避免太快） |

- 三種模式都只改變 azimuth，pitch、zoom、target 以 `base` 為準。
- 環繞過程中的 azimuth **不寫回** `base`（重新啟動後從 `base.azimuthDeg` 開始）。
- **移軸景深**（`depthOfField`，預設開啟）：自己寫一個後處理 shader pass，依螢幕 y 座標離中央帶的距離做水平與垂直兩次高斯模糊，中央約 40% 的高度保持清晰。不要用 `BokehPass`（太重）。關閉時完全跳過這個 pass。

### 8.9 FPS 控制（Q8）

- `requestAnimationFrame` 迴圈中依目標 FPS 節流：累積時間 ≥ `1000 / fps` 才 render，並扣掉一個 frame 間隔（不要直接歸零，避免累積誤差）。
- 動畫一律以實際經過的時間（delta time）計算，不可依 frame 數計算，讓 FPS 改變時動畫速度不變。
- **120 FPS 的風險**：WKWebView 的 `requestAnimationFrame` 在 macOS 上可能被限制在 60Hz。M1 時在 WKWebView 中實測（M2 才有 WKWebView，所以在 M2 驗證）：若達不到 120，GUI 中的 120 選項要停用，並附說明「此顯示器或系統不支援」。不要為了 120 改寫渲染架構。
- 設定變更後立即套用，不需要重新載入。

### 8.10 Mock 模式（Q28）

- `main.ts` 偵測 `window.webkit?.messageHandlers?.projectTown` 是否存在；不存在時進入 mock 模式。
- URL 參數：
  - `?scenario=<name>`：載入預設情境，至少要有 `empty`（沒有專案）、`single`（1 個專案、每種狀態各 1 人）、`busy`（6 個專案、混合狀態）、`crowded`（1 棟建築 10 人，用來測 +N）、`many`（25 個專案）、`unnamed`（session 沒有名稱）
  - `?lang=en|zh-Hant`
  - `?time=<epoch ms>`：凍結場景時間（截圖測試用，讓畫面每次都一樣）
  - `?seed=<n>`：固定隨機數種子
  - `?gui=0`：隱藏 lil-gui 面板（截圖用）
- lil-gui 面板：可切換任一 session 的狀態、新增或移除專案與 session、調整所有 `SceneSettings`、拖曳時間軸、觸發調整視角模式。
- 場景中所有隨機元素（小人衣服、閒置動畫的間隔）都使用可注入種子的 PRNG，確保截圖可重現。

---

## 9. 設定 GUI 與設定檔

### 9.1 設定檔

- 路徑：`~/Library/Application Support/ProjectTown/config.json`
- 由 `SettingsStore`（`ObservableObject`）讀寫；任何變更立即寫檔，並把對應的 `SceneSettings` 推給場景。
- 檔案有 `"version": 1`，以便日後遷移。讀取失敗時，把壞檔改名為 `config.json.broken-<timestamp>`，再用預設值重建，並在設定畫面上提示一次。

```json
{
  "version": 1,
  "projects": [
    { "path": "/Users/me/github/ProjectTown", "name": "ProjectTown", "color": "#5B8DEF", "buildingStyle": "auto" }
  ],
  "fps": 15,
  "hudVisible": false,
  "hideSessionNames": true,
  "theme": "pastoral",
  "depthOfField": true,
  "depthOfFieldStrength": 0.6,
  "depthOfFieldRange": 0.25,
  "wallpaperSnapshot": true,
  "finishedWindowMinutes": 30,
  "sleepThresholdMinutes": 120,
  "dayNight": { "mode": "realtime", "sunrise": "06:00", "sunset": "18:00", "cyclePeriodMinutes": 60, "dayRatio": 0.5 },
  "camera": { "mode": "fixed", "intervalMinutes": 10, "continuousPeriodMinutes": 60,
              "base": { "azimuthDeg": 45, "pitchDeg": 40, "zoom": 1, "target": [0, 0] } },
  "displayUUID": null
}
```

`buildingStyle` 是 `"auto"` 或 §8.4 的其中一個 key。`depthOfFieldStrength` 範圍 0.25–2.0；`depthOfFieldRange` 範圍 0–0.45。

`wallpaperSnapshot` 只在 Swift 端使用（不送給場景）：macOS 在切換 Space、進出指揮中心時偶爾不畫桌面層級的視窗，會閃出系統桌布。開啟時，小鎮視窗在桌面 Space 上可見約 1.5 秒後、之後每 5 分鐘、以及改變外觀的設定之後，用 `WKWebView.takeSnapshot` 截圖存成 `Wallpaper/town-<slot>-<n>.jpg`，再以 `setDesktopImageURL` 設為小鎮所在螢幕「目前 Space」的系統桌布。被遮住、暫停或調整視角時不做事。Space 切換與遮擋的通知可能比實際切換晚到，所以設定前會直接問 WindowServer：小鎮下方在螢幕上的視窗（每個 Space 有自己的桌布視窗）必須和開始截圖時相同，而且沒有全螢幕 app 的底板蓋住小鎮；否則截圖可能被設到剛切過去的全螢幕 Space。每個 Space 原本的桌布依 slot 記在 `Wallpaper/slots.json`（`WallpaperSnapshotLedger`）；關閉選項、結束 app、把小鎮移到別的螢幕時，以及之後切換到仍顯示我們截圖的 Space 時，換回原本的桌布。`setDesktopImageURL` 只改得到目前的 Space：在全螢幕 app 裡結束 app 時，原本的桌布只會寫到那個全螢幕 Space，桌面會留著最後一張截圖，直到下次執行。截圖檔每個 slot 只留最新 2 張；超過 7 天沒有新截圖的 slot（例如拔掉的螢幕、不再使用的 Space）會刪掉全部截圖，`slots.json` 裡的原始桌布則保留，之後仍能換回。每次設定截圖後和 app 啟動時各清一次。

### 9.2 設定視窗（SwiftUI，`Settings` scene 或獨立 `Window`，約 640×480）

使用分頁（`TabView`）：

**專案**
- 列表：色點、名稱、路徑（灰字，過長時中間省略）、建築款式
- 「＋」按鈕：開啟 `NSOpenPanel`（`canChooseDirectories = true`、`canChooseFiles = false`、`allowsMultipleSelection = true`）。名稱預設為資料夾名稱；顏色從 8 色預設色盤中依序取用；建築款式預設為「自動」
- 拖曳排序（決定網格順序）
- 選取一列後可編輯：名稱、顏色（8 色預設色盤 + `ColorPicker` 自訂）、建築款式（「自動」+ 10 款）、刪除
- 路徑重複時不可新增，並顯示提示
- 路徑不存在時（例如資料夾被刪除），該列顯示警告圖示，但不自動刪除

**外觀**
- 日夜模式：真實時間／固定循環
  - 真實時間：日出時間、日落時間（`DatePicker`，只選時與分）
  - 固定循環：週期長度（5 分鐘–24 小時）、白天比例滑桿（10%–90%）
- 攝影機模式：固定／定時環繞（間隔 1–60 分鐘）／自動緩慢環繞（一圈 2–60 分鐘，預設 60）
- 「調整視角…」按鈕（等同 menubar 的項目）、「重設視角」按鈕
- 主題：田園／都會（分段選擇器）
- 景深模糊：開關；模糊強度滑桿（25%–200%，間隔 5%）與模糊範圍滑桿（上下各 0%–45% 的螢幕高度，間隔 5%），景深關閉時兩者停用
- HUD：開關
- 顯示器：下拉選單（`NSScreen.screens` 的 `localizedName`）
- FPS：15／30／60／120（分段選擇器）
- 切換桌面時顯示小鎮：開關，預設開啟（`wallpaperSnapshot`，見 §9.1）

**狀態**
- 「剛完成」持續時間：1–240 分鐘，預設 30
- 睡著門檻：10 分鐘–24 小時，預設 120 分鐘；必須大於「剛完成」持續時間
- 隱藏 session 名稱：開關，預設開啟
- Claude hooks：狀態文字、「安裝」或「重新安裝」按鈕、「移除」按鈕，以及說明（hooks 的用途、會修改 `~/.claude/settings.json`、已自動備份、只影響之後啟動的 session）

**一般**
- 開機時自動啟動：開關
- 暫停渲染：開關（與 menubar 同步）
- 版本號與 GitHub 連結

---

## 10. 在地化（Q25）

- 支援 `zh-Hant`（繁體中文）與 `en`（英文），跟隨系統語言；系統語言不是繁體中文時一律用英文（簡體中文也用英文）。
- Swift：`Localizable.xcstrings`（String Catalog），包含 menubar、設定畫面、錯誤訊息。
- JS：`web/src/i18n/zh-Hant.ts`、`en.ts`，用同一組 key；語言由 `SceneSettings.locale` 傳入。
- 相對時間使用 `Intl.RelativeTimeFormat`。
- 專門用語對照：

| key | zh-Hant | en |
|---|---|---|
| state.running | 執行中 | Running |
| state.waiting | 等你回應 | Needs you |
| state.finished | 剛完成 | Just finished |
| state.idle | 閒置 | Idle |
| state.sleeping | 睡著 | Sleeping |
| session.unnamed | (session 無名稱) | (unnamed session) |

- 測試要確認兩種語言的 key 完全一致（Vitest：比對兩個字典的 key 集合；Swift：確認 String Catalog 中每個 key 都有兩種語言的翻譯）。

---

## 11. 隱私與安全

- app 只讀取本機的 `~/.claude/sessions/*.json` 和自己的 hook 狀態檔，**不讀取 transcript，不做任何網路連線**。README 要寫明這一點。
- hook 指令只寫入 `session_id`、事件名稱和時間戳，絕不寫入 prompt、工具輸入或訊息內容。
- `hideSessionNames` 預設開啟。
- 不可使用 Anthropic 或 Claude 的 logo。README 加上聲明：本專案與 Anthropic 無關，「Claude」是 Anthropic 的商標。

---

## 12. 測試與 CI（Q28、Q33、Q45）

### 12.1 Swift（`Packages/ProjectTownCore`，`swift test`）

必須涵蓋：
- `SessionReader`：解析 fixture（含上面的真實樣本、缺少 `name`、未知 `status`、損壞的 JSON、多餘欄位）
- `ProcessChecker`：用假實作測試 pid 重複使用的判斷；`procStart` 字串解析
- `ProjectMatcher`：路徑元件比對（`/a/foo` vs `/a/foobar`）、巢狀專案取最長、symlink、大小寫、結尾斜線、worktree 子目錄
- `SessionStateDeriver`：每個狀態的邊界條件（剛好 30 分鐘、剛好 2 小時）、app 剛啟動時的 finished 判斷、過期的 hook waiting
- `HooksInstaller`：對暫存目錄裡的 settings.json 操作。需涵蓋空檔案、不存在、無效 JSON（必須中止且不改檔）、已有其他 hooks（必須保留，並逐一比對前後內容）、重複安裝、移除後恢復原狀、路徑過期偵測、備份檔確實產生
- Hook 指令的 stdin 處理：只寫出允許的欄位
- `TownStateBuilder`：差異比對（相同狀態不觸發推送）
- 設定檔：讀寫、預設值、壞檔處理、驗證規則（日落早於日出、睡著門檻 ≤ 剛完成時長）

所有時間都透過注入的 `Clock` 取得；所有檔案路徑都可注入。

### 12.2 Web（`web/`）

- `npm run typecheck`（`tsc --noEmit`）
- `npm run lint`（ESLint）
- `npm test`（Vitest）：`dayNight.ts`（兩種模式、漸變邊界、比例正確、跨午夜）、版面（網格大小、縮放級距）、建築款式 hash（同一路徑結果穩定、分布合理）、小人名額挑選與 `+N` 計算、FPS 節流邏輯、i18n key 一致、攝影機環繞的角度計算
- `npm run e2e`（Playwright，Chromium）：用 `vite preview` 啟動，對每個 mock 情境以 `?time=…&seed=1&gui=0` 載入，確認：
  - 沒有 console error
  - canvas 不是全黑或全白（取樣像素計算變異數）
  - HUD 內容正確（例如 `crowded` 情境顯示 `+4`）
  - 每個情境的白天與夜晚各截一張圖，存為 CI artifact（不做像素比對，避免 GPU 差異造成不穩定）
- Playwright 在 CI 上用軟體渲染的 WebGL（SwiftShader）。若 headless 的 WebGL 不穩，加上 `--use-angle=swiftshader` 等參數，**不要因此跳過測試**。

### 12.3 本地

`Makefile`：

```
make dev          # cd web && npm run dev（mock 模式）
make test-web     # typecheck + lint + vitest + e2e
make test-swift   # swift test（ProjectTownCore）+ xcodegen + xcodebuild build
make check        # test-web + test-swift，與 CI 完全相同
make app          # 建置 web → xcodegen → xcodebuild → 開啟 build/ProjectTown.app
make clean
```

`xcodebuild build` 要把 `web/dist` 複製進 bundle 的 `Resources/web/`：在 `project.yml` 加一個 build phase 檢查 `web/dist` 是否存在，沒有就報錯並提示先跑 `npm run build`（不要在 Xcode build phase 裡跑 npm）。`make app` 和 CI 會先跑 `npm run build`。

### 12.4 GitHub Actions（`.github/workflows/ci.yml`）

- 觸發：`pull_request`、`push` 到 `main`
- **job `changes`**（ubuntu）：用 `dorny/paths-filter` 判斷是否有 Swift 相關變更（`app/**`、`Packages/**`、`project.yml`、`Makefile`、`.github/workflows/**`）
- **job `web`**（ubuntu-latest）：Node LTS、`npm ci`、typecheck、lint、vitest、Playwright 安裝 Chromium、e2e、上傳截圖 artifact
- **job `swift`**（macos-latest，`needs: changes`，只在有 Swift 相關變更時執行）：`brew install xcodegen`、建置 web（因為 app build 需要 `web/dist`）、`swift test`、`xcodegen`、`xcodebuild build`
- 快取：npm 快取、Playwright browser 快取
- **注意兩個限制**，請在 README 的 Contributing 段落和第一個 PR 的描述中說明：
  1. private repo 的 Actions 每月有免費額度（2000 分鐘），macOS runner 以 10 倍計費，所以 Swift job 只在必要時才跑。
  2. GitHub Free 方案的 **private repo 無法設定 branch protection 或 ruleset**，因此「CI 失敗就不能 merge」在 private 階段**無法由 GitHub 強制執行**。替代做法：agent 必須等 CI 綠燈才 merge 自己的 PR。repo 改為 public 後，再設定 `main` 的 branch protection，要求 `web` 與 `swift` 兩個 check 都通過（屆時要先問使用者）。

---

## 13. Release 流程（Q21、Q24、Q46）

- 版號：SemVer。tag 格式 `vX.Y.Z`。
- `project.yml` 的 `MARKETING_VERSION` 必須與 tag 一致（release workflow 會檢查，不一致就失敗）；`CURRENT_PROJECT_VERSION` 每次發佈遞增。
- `CHANGELOG.md` 使用 Keep a Changelog 格式：每個版本有 `## [X.Y.Z] - YYYY-MM-DD`，底下分 `Added`／`Changed`／`Fixed`／`Removed`；最上方保留 `## [Unreleased]`。changelog 內容用英文。
- **`.github/workflows/release.yml`**：
  - 觸發：`push` tags `v*`
  - runner：macos-latest
  - 步驟：建置 web → `xcodegen` → `xcodebuild` Release，`ARCHS="arm64 x86_64"`（universal），使用 **ad-hoc 簽章**（`CODE_SIGN_IDENTITY="-"`；Apple Silicon 上沒有任何簽章的 app 無法執行）→ `ditto -c -k --keepParent ProjectTown.app ProjectTown-vX.Y.Z.zip` → 用 `scripts/changelog-section.sh vX.Y.Z` 擷取 release notes（找不到該版本的段落就失敗）→ `gh release create vX.Y.Z ProjectTown-vX.Y.Z.zip --notes-file notes.md --title "vX.Y.Z"`
  - 權限：`contents: write`
- 發佈格式參考：https://github.com/mattpocock/skills/releases/tag/v1.3.1 （release 頁面上呈現該版本的變更清單）。
- **agent 的發佈步驟**（每個要發佈的里程碑）：
  1. 把 `[Unreleased]` 的內容移到新版本的段落並填上日期
  2. 更新 `MARKETING_VERSION`
  3. commit `chore(release): vX.Y.Z`，PR、CI 綠燈後 merge
  4. 在 `main` 上打 tag 並 push：`git tag vX.Y.Z && git push origin vX.Y.Z`
  5. 確認 release workflow 成功，Release 頁面上有 zip 與正確的 notes
  6. 下載 zip，解壓後在本機確認 app 可以啟動（需先 `xattr -dr com.apple.quarantine`）

---

## 14. README 要求（英文）

依序包含：
1. 名稱、一句話介紹、主視覺截圖或 GIF（夜景，`docs/screenshots/`）
2. **Supported languages: 繁體中文, English**（照這個格式寫在顯眼位置）
3. Features：狀態對應表（五種狀態各附小截圖或說明）、日夜模式、攝影機模式、隱私開關
4. Requirements：macOS 14+、Claude Code（註明撰寫時測試的版本 2.1.308）
5. Install：從 Releases 下載 zip → 拖到 `/Applications` → 因為沒有 notarize，需要執行：
   ```bash
   xattr -dr com.apple.quarantine /Applications/ProjectTown.app
   ```
   或在 Finder 中右鍵選「打開」
6. Usage：從 menubar 開啟設定 → 新增專案資料夾 → （選用）安裝 hooks 以顯示「Needs you」狀態
7. How it works：讀取 `~/.claude/sessions/*.json`、pid 存活檢查、hooks 的作用；**明確警告**：`~/.claude/sessions` 是 Claude Code 未公開的內部格式，可能隨 Claude Code 更新而失效
8. Privacy：所有資料只在本機讀取，沒有網路連線，不讀取對話內容
9. Build from source：需求（Xcode 版本、Node LTS、XcodeGen）與 `make app`
10. Development：`make dev`（mock 模式與 URL 參數）、`make check`、專案結構簡介
11. Contributing：CI 說明（含 §12.4 的兩個限制）
12. Disclaimer：與 Anthropic 無關、Claude 是 Anthropic 的商標
13. License：MIT

---

## 15. 里程碑

每個里程碑都在自己的分支 `m<N>-<slug>` 上開發，完成後開 PR，CI 綠燈才 merge 到 `main`。里程碑內可以有多個 commit。

### M0 — 專案骨架
- `git init`、`.gitignore`、`LICENSE`、`README.md`（先寫骨架）、`CHANGELOG.md`（只有 `[Unreleased]`）、`Makefile`
- `web/`：Vite + TS + Three.js 空場景（只有地面與一個方塊）、ESLint、Vitest（1 個範例測試）、Playwright（1 個載入測試）
- `Packages/ProjectTownCore`：空 package 與 1 個範例測試
- `project.yml`：可以 build 出一個空的 menubar app
- `.github/workflows/ci.yml`
- 用 `gh repo create KevinYu1580/ProjectTown --private --source . --push` 建立 repo 並 push
- **驗收**：本地 `make check` 通過；GitHub 上 CI 的 `web` 與 `swift` 兩個 job 都是綠燈

### M1 — 場景（mock 模式）
- §8 全部內容：版面、10 款建築、小人與五種狀態、離開動畫、招牌與 `+N`、HUD、日夜兩種模式、三種攝影機模式（瀏覽器中以 OrbitControls 模擬調整視角）、移軸景深、FPS 節流、i18n、`hideSessionNames`、mock 情境與 lil-gui
- **驗收**：
  - `make test-web` 通過；§12.2 列出的單元測試都存在
  - Playwright 為每個情境產生白天與夜晚的截圖；把 `busy` 情境的夜景截圖存到 `docs/screenshots/`
  - 自我檢查截圖：風格接近 §8.1 的描述（voxel、夜景暖光、移軸模糊）、「!」氣泡在夜間清楚可見、`crowded` 情境顯示正確的 `+N`
  - 在瀏覽器中用 lil-gui 逐一切換狀態，動畫轉換流暢，沒有瞬間移動
  - 25 個專案時，Chrome DevTools 顯示在開發機上可穩定 60fps
- **不打 tag**（還沒有可執行的 app）

### M2 — Swift 桌布殼 + 讀取 session
- `ProjectTownCore`：`SessionReader`、`ProcessChecker`、`ProjectMatcher`、`SessionStateDeriver`（先不含 hook 狀態）、`TownStateBuilder`，以及 §12.1 的對應測試
- 桌布視窗（§7.1）、暫停渲染（§7.2）、menubar（§7.4，「調整視角」先放 disabled 項目）、Swift ↔ JS 橋接（§6）、每秒輪詢（§5.6）
- 這個階段的專案清單先直接讀 `config.json`（手動編輯），GUI 在 M3 才做
- `.github/workflows/release.yml`、`scripts/changelog-section.sh`
- **驗收**（實機）：
  - 桌面 icon 在小鎮上方，可正常點選、拖曳
  - 在設定的專案路徑下開一個 Claude session → 1 秒內出現小人；送出 prompt → 變成執行中；完成 → 剛完成（煙火 + 綠圈）
  - **在 Claude 中 rename session → 關閉隱藏名稱後，桌布上的名稱跟著更新**（Q27 驗證）
  - 結束 session → 小人走出去並消失
  - 開啟全螢幕 app → CPU 用量降到接近 0%；離開全螢幕 → 恢復
  - 切換 Space → 小鎮在每個 Space 都看得到
  - 測試 WKWebView 能否達到 120 FPS（§8.9），把結論寫進 PR 描述
- **發佈 `v0.1.0`**

### M3 — 設定 GUI + 調整視角
- §9 全部（hooks 區塊先放 disabled 的佔位）、§7.3 調整視角模式、§7.5 開機啟動、多螢幕選擇
- **驗收**：
  - 用 GUI 新增、刪除、改名、改色、改建築款式、拖曳排序專案，桌布立即反映
  - 所有外觀與狀態設定立即反映在桌布上
  - 調整視角：可以旋轉、縮放、平移；完成後存檔，重新啟動 app 仍保留；取消會還原
  - 三種攝影機模式行為符合 §8.8
  - 不合法的設定值會被擋下
- **發佈 `v0.2.0`**

### M4 — Hooks
- **第一步：驗證 §5.1 的新發現。** 在測試專案中觸發權限提示（例如在 default permission mode 下要求執行一個未被允許的 Bash 指令），同時觀察 `~/.claude/sessions/<pid>.json` 的 `status` 與 `waitingFor` 是否改變。把結果寫進 PR 描述。若 sessions 檔已能可靠地提供 waiting 狀態，**先問使用者**是否仍要保留 hooks 功能，再繼續。
- §5.3 全部內容、`SessionStateDeriver` 加入 hook 狀態、GUI 的 hooks 區塊
- **驗收**：
  - 單元測試涵蓋 §12.1 列出的所有 `HooksInstaller` 案例
  - 實機（**需由使用者本人在 GUI 中按下安裝**，agent 要請使用者操作）：安裝後，原本的 ccusage-tracker hooks 仍完整保留；觸發權限提示 → 1 秒內出現「!」；批准後 → 回到執行中；移除後，`settings.json` 的 hooks 與安裝前一致（備份檔仍在）
- **發佈 `v0.3.0`**

### M5 — 在地化與隱私
- §10、§11 全部內容；檢查所有使用者看得到的字串都已在地化
- **驗收**：系統語言切換成英文與繁體中文時，menubar、設定畫面、HUD、招牌、名稱標籤都正確顯示；`hideSessionNames` 的開關行為正確；i18n key 一致性測試通過
- **發佈 `v0.4.0`**

### M6 — 收尾與 v1.0.0
- 完成 §14 的 README（含截圖或 GIF）、檢查 CHANGELOG 完整性、確認 CI 與 release 流程都正常
- 整體回歸測試：跑一次 M2–M5 的實機驗收項目
- **發佈 `v1.0.0`**
- 回報使用者：完成的內容、已知限制（§16）、repo 仍為 private，詢問是否要改成 public

---

## 16. 已知風險與限制

| 風險 | 影響 | 處理方式 |
|---|---|---|
| `~/.claude/sessions` 是未公開格式 | Claude Code 更新後可能讀不到資料 | 寬鬆解析、未知值有預設處理、HUD 顯示錯誤提示、README 警告 |
| 桌面層級視窗在 macOS 26 的行為 | icon 可能被蓋住，或與桌面小工具衝突 | M2 實機驗證，必要時調整 level |
| WKWebView 的 rAF 可能被限制在 60Hz | 120 FPS 選項無效 | M2 驗證，達不到就停用該選項 |
| 常駐 3D 渲染的耗電 | 筆電續航變差 | 被遮住時暫停；使用者可自行調低 FPS |
| 修改使用者的 `~/.claude/settings.json` | 可能破壞使用者既有的設定 | 備份、只合併不覆蓋、無效 JSON 時中止、完整的單元測試 |
| ad-hoc 簽章、未 notarize | 使用者要手動解除 quarantine | README 說明 |
| private repo 的 Actions 額度 | macOS runner 很貴 | Swift job 依路徑過濾 |
| private repo 無法設定 branch protection | 無法強制 CI 擋 merge | agent 自律；改成 public 後再設定 |
| pid 被重複使用 | 誤判已結束的 session 仍存活 | 比對 `procStart` |
| 新安裝的 hooks 可能不套用到已在執行的 session | 安裝後舊 session 沒有 waiting 狀態 | M4 實測，GUI 中說明 |

---

## 17. 已驗證與待驗證的事實

**已驗證**（2026-10-26，使用者的機器）：
- macOS 26.6.2、內建 3024×1964 Retina 螢幕（單螢幕）
- `~/.claude/sessions/<pid>.json` 的格式如 §5.1；同時有 11 個存活的 session，其中 10 個 idle、1 個 busy
- 使用者的 `~/.claude/settings.json` 已有 ccusage-tracker 的 `SessionStart`、`SessionEnd`、`Stop` hooks
- GitHub 帳號：`KevinYu1580`；`gh` CLI 已登入
- Claude Code 版本：2.1.308；執行檔位於 `~/.local/bin/claude`
- hooks 的 stdin 欄位與 `Notification` matcher 值：依 https://code.claude.com/docs/en/hooks

**待驗證**（在指定的里程碑中處理）：
- sessions 檔的 `status: "waiting"` 與 `waitingFor`（M4 第一步）
- rename session 後名稱的更新時機（M2）
- 桌面層級視窗與 icon 的上下關係（M2）
- WKWebView 能否達到 120 FPS（M2）
- hooks 的 `async: true` 語法（M4，閱讀官方文件）
- 新安裝的 hooks 是否套用到已在執行的 session（M4）
