# Pull request archive

ProjectTown moved to a fresh repository on 2026-11-08. These are the titles and descriptions of the pull requests from the original repository, kept as a record. The commits themselves are all in this repository's history; the merge commits still say "Merge pull request #N", and #N there means the number below, not a pull request in this repository.

## #1 feat: M1 voxel 小鎮場景與 mock 模式

merged 2026-10-27 · branch `m1-scene`

#### 摘要

HANDOFF §15 的 **M1：場景（mock 模式）**。§8 全部項目都已在瀏覽器的 mock 模式中實作與驗證：

- **版面**：依設定順序排成街區網格，超過 12 棟縮成 0.8、超過 20 棟縮成 0.65。小鎮放在模型底座上，外圍有道路延伸、公園與田野。自動取景時避開左下角 HUD。
- **10 款程式生成建築**：統一 `BuildingHandle` 介面，有可發光窗戶、一樓玻璃店面、門口與招牌錨點，並用專案顏色點綴。
- **voxel 小人與五種狀態**：
  - 執行中：打字，頭上有齒輪。
  - 等你回應：「!」氣泡，是全場最醒目的元素。
  - 剛完成：放一次煙火，之後腳下有綠圈。
  - 閒置：坐長椅，會伸懶腰或張望。
  - 睡著：不畫人，窗戶熄燈並冒出 zZ。
  - 狀態轉換用走路動畫，session 結束時沿街走出去後消失。
- **招牌**：顯示各狀態數量與實際的 `+N`；**HUD**；日夜兩種模式（真實時間、固定循環）；三種攝影機模式與調整視角；移軸景深；FPS 節流與暫停（暫停時完全停止 rAF）；i18n（zh-Hant、en）。
- **mock 模式**：URL 情境、lil-gui 控制面板、可重現的凍結時間截圖。
- **美術**：依 voxel-art skill 的原則優化，包括統一調色盤、植栽與花園，以及環境生命感（風、雲影、燕群、蝴蝶、螢火蟲，皆非人形）。

主視覺截圖（busy 情境夜景）：`docs/screenshots/busy-night.png`

#### 驗證

- 本機 `make check` 全過：
  - typecheck、lint
  - Vitest 136 個測試
  - Playwright e2e 33 個：8 個情境的日夜截圖、無 console error、canvas 變異數、HUD 與招牌內容、狀態轉換無瞬移、凍結時間逐像素可重現
  - `swift test`、`xcodebuild`
- 效能（Apple M4 Pro、GPU Chromium、1512×982 @2x、`many` 25 個專案、非凍結）：measuredFps 穩定 60，每幀約 730 draw calls，GPU 約 8.3 ms。
- 在真實 WKWebView（M2 分支的 app，`loadFileURL`）載入本 PR 的 build：場景正常送出 `ready`，沒有 JS 錯誤。

#### 決策（影響行為或規格解讀）

1. **專案數超過 12／20 時的縮放**：只縮放地塊內容（建築、長椅、地塊上的人），道路寬度、路燈、樹與招牌不縮放。如果整座城一起縮放，自動取景會把它拉回原大小，等於沒有效果。改回方式：`layout.ts` 的 `lotScaleFor` 與 `lot.ts` 的 scale。
2. **路燈光暈**：用發光燈泡、地面暖色光圈貼片和 bloom 呈現，不替每盞燈各放一個 `PointLight`，因為 25 個專案時有上百盞燈。
3. **招牌、氣泡、zZ 與名稱標籤用固定螢幕尺寸**（`sizeAttenuation: false`），桌布上才讀得到。超過 8 個專案時招牌逐步縮小，最小到 0.7。
4. **淺色專案的招牌字**：白字對底色的對比低於 3:1 時（例如 `#ffffff`、`#f2c94c`）改用深色字，和 §8.3 寫的「白字」略有不同。改回方式：把 `sign.ts` 的 `MIN_WHITE_CONTRAST` 設成 1。
5. **陰影**：three 0.186 已移除 `PCFSoftShadowMap`，改用 `PCFShadowMap` 加 radius 做出柔和陰影。
6. **正式 build 是 classic script**（IIFE，沒有 `type="module"`），WKWebView 用 `file://` 載入時不需要任何額外設定。
7. **`?time=` 凍結模式**：同時凍結動畫（dt = 0，人物直接就位、不放煙火），截圖才能每次都一樣。
8. **額外的 mock 情境**：`gallery`（10 款建築各一棟）和 `nodata`（`dataSourceOk = false`）。§8.10 寫的是「至少要有」這 6 個。
9. **TypeScript 用 6.0.3**：typescript-eslint 8.72 只支援 `<6.1`，所以沒有用最新的 7.0.2。
10. **專案顏色只當點綴**：大面積的屋頂用降低飽和的專案色，招牌和 HUD 仍用原色。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：private repo 每月有 2000 分鐘免費額度，macOS runner 以 10 倍計費。所以 `swift` job 只在 Swift 相關路徑有變更時才跑（`app/**`、`Packages/**`、`project.yml`、`Makefile`、`.github/workflows/**`）。本 PR 只動 `web/` 與文件，預期只跑 `web` job。
2. **沒有 branch protection**：GitHub Free 的 private repo 不能設定 branch protection 或 ruleset，所以「CI 失敗就不能 merge」在 private 階段無法由 GitHub 強制。目前由 agent 自律：CI 綠燈後才 merge。repo 改成 public 後，再設定 `main` 必須通過 `web` 與 `swift` 兩個 check（屆時會先詢問使用者）。

#### 已知限制

- 效能只在 M4 Pro 上量過，還沒有 M1 Mac 的數據。滿版 Retina 的成本主要在全螢幕後處理。
- WKWebView 的 rAF 在這台 ProMotion 螢幕上實測約 58 Hz，所以 120 FPS 選項會在 M3 的設定畫面停用（§8.9）。

## #2 feat: M2 Swift 桌布殼與 session 讀取

merged 2026-10-27 · branch `m2-swift-shell`

#### 摘要

HANDOFF §15 的 **M2：Swift 桌布殼 + 讀取 session**。

- **`ProjectTownCore`**（純邏輯，XCTest 覆蓋）：
  - `SessionReader`：寬鬆解析 `~/.claude/sessions/<pid>.json`。未知的 `status` 視為 idle；壞檔與缺欄位的檔案略過；只保留 interactive；列出目錄後才消失的檔案安靜略過。
  - `ProcessChecker`：pid 存活檢查，並比對 `procStart` 避免 pid 重複使用。
  - `ProjectMatcher`：路徑正規化（大小寫、結尾斜線、symlink）後做最長前綴比對。
  - `SessionStateDeriver`、`TownStateBuilder`／`TownEngine`：推導狀態並組成給場景的 `TownState`。
  - `ConfigStore`：讀寫 `config.json`。
  - `SceneSettings`：場景設定。
- **app**：
  - 桌面層級桌布視窗與 `WKWebView`（§7.1），以及暫停渲染（§7.2）：被遮住、螢幕睡眠、切換使用者、使用者手動暫停時都會暫停。
  - menubar（§7.4），「調整視角」先放 disabled 項目。
  - Swift ↔ JS 橋接（§6）與每秒輪詢（§5.6）。
  - 開發用環境變數 `PROJECTTOWN_WEB_URL`（載入 dev server）與 `PROJECTTOWN_MEASURE_RAF`（量測 rAF 頻率）。
- **發佈流程**：`.github/workflows/release.yml` 與 `scripts/changelog-section.sh`（§13）。
- 這個階段的專案清單直接讀 `config.json`；menubar 的「設定…」會打開這個檔案，設定 GUI 在 M3 才做。

#### 驗證

- 本機 `make check` 全過：
  - typecheck、lint
  - Vitest 150 個測試
  - Playwright e2e 33 個
  - `swift test` 93 個測試
  - `xcodebuild`
- 實機驗收（macOS 26.6.2，Claude Code 2.1.308，外接 P2319H 與內建 Retina 螢幕）：

| 驗收項目 | 結果 |
|---|---|
| 桌面 icon 在小鎮上方，可正常點選、拖曳 | ✅ 使用者在實機確認。另一個動態桌布 app 執行時會蓋住或擠壓桌布視窗，關掉它之後才正常（列為已知限制） |
| 開 session → 1 秒內出現小人；送出 prompt → 執行中 | ✅ |
| 完成 → 剛完成 | ✅ 綠圈出現 |
| 在 Claude 中 rename session → 關閉隱藏名稱後，名稱跟著更新（Q27） | ✅ |
| 結束 session → 小人走出去並消失 | ⏳ 尚未在實機看到：擷取時桌布被其他視窗蓋住，渲染已暫停。狀態差異與離開動畫有單元測試與 e2e 覆蓋 |
| 開啟全螢幕 app → CPU 降到接近 0%；離開後恢復 | ✅ 渲染時約 26%。桌布被完全蓋住並穩定下來後，用 `top` 取樣 8 秒：ProjectTown 0.4–0.5%，WebKit 的 WebContent 與 GPU process 都是 0.0%。先前另一次量測為 4.6%。離開後恢復渲染 |
| 切換 Space → 每個 Space 都看得到小鎮 | ⏳ 尚未實機驗證。視窗設定為 `.canJoinAllSpaces` 加 `.stationary` |
| WKWebView 能否達到 120 FPS（§8.9） | ❌ 見下方 |

#### 實測發現

1. **WKWebView 的 rAF 上限約 60 Hz。** 在 ProMotion MacBook Pro 上用 `PROJECTTOWN_MEASURE_RAF=1` 量測 3 秒，得到 58.3 Hz。所以 M3 的設定畫面會停用 120 FPS 選項，並附上「此顯示器或系統不支援」的說明。
2. **`procStart` 是 UTC，不是 HANDOFF §5.2 寫的本地時區。** 實測 `procStart` 與 `pbi_start_tvsec` 差了整整 8 小時（UTC+8）。`ProcessChecker` 改成 UTC 或本地時區任一讀法與 process 啟動時間相差 2 秒內，就視為同一個 process；無法解析時視為存活，不會誤殺。
3. **桌面層級。** 視窗 level 設為 `CGWindowLevelForKey(.desktopWindow)`，低於 Finder 桌面 icon 視窗的 level，所以 icon 在小鎮上方，可以點選與拖曳。
4. **`file://` 載入。** WKWebView 從 `file://` 載入時不會執行 module script。M1 的正式 build 改成 classic script（IIFE），所以這裡不需要任何私有設定，`loadFileURL(_:allowingReadAccessTo:)` 就能載入。
5. **sessions 檔會寫入 waiting 狀態（M4 第一步的證據）。** 實機觀察到一個 2.1.308 的 session 在權限提示出現時，從 `busy` 變成 `waiting`（`waitingFor: "permission prompt"`）。批准後回到 `busy`，完成後變成 `idle`，桌布上同步出現與消失「!」。依使用者的決定，M4 不做 hooks。

#### 決策

1. **`procStart` 雙時區比對**：見「實測發現」第 2 點。改回方式：`ProcessChecker` 只用一個時區解析。
2. **列出目錄後才消失的 session 檔**（session 剛好在這一秒結束）：安靜略過，不寫錯誤 log。其他讀取或解析錯誤仍會記錄。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：private repo 每月有 2000 分鐘免費額度，macOS runner 以 10 倍計費，所以 `swift` job 只在 Swift 相關路徑有變更時才跑。本 PR 有改到 Swift，兩個 job 都會跑。
2. **沒有 branch protection**：GitHub Free 的 private repo 不能設定 branch protection，所以目前靠 agent 自律，CI 綠燈後才 merge。

#### 已知限制

- 與其他動態桌布 app 同時執行時會互相衝突，請先關掉其他動態桌布 app。

## #3 chore(release): v0.1.0

merged 2026-10-27 · branch `release-v0.1.0`

發佈 `v0.1.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [0.1.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 0.1.0、`CURRENT_PROJECT_VERSION` 1

本機 `make check` 全過。merge 後在 `main` 打 `v0.1.0` tag，由 release workflow 建置並發佈。

## #4 feat: M3 設定 GUI、調整視角、開機啟動與顯示器選擇

merged 2026-10-27 · branch `m3-settings-gui`

#### 摘要

HANDOFF §15 的 **M3：設定 GUI + 調整視角**。

- **`ProjectTownCore`**：
  - `AppConfig.validate()`：檢查各欄位範圍，並要求日落晚於日出、睡著門檻大於「剛完成」時長。
  - 新增專案輔助：名稱取資料夾名稱，顏色依序取 8 色預設色盤，用 `ProjectMatcher.normalize` 正規化後判斷重複。
  - 以上皆有 XCTest。
- **`SettingsStore`**：每次變更先驗證；通過就立即存檔，並推給場景與輪詢，不需重新啟動或重新載入。不合法的值會在控制項旁顯示訊息，存下來的設定檔永遠是合法的。設定檔中個別欄位無效時，只把那組欄位重設為預設值。
- **設定視窗**（SwiftUI，§9.2）有四個分頁：
  - **專案**：新增（資料夾選擇窗，可多選）、刪除、改名、改色（8 色預設加自訂）、改建築款式、拖曳排序；路徑重複時擋下；資料夾不存在時顯示警告圖示，不會自動刪除。
  - **外觀**：日夜模式、攝影機模式、調整視角與重設視角、移軸景深、HUD、顯示器、FPS。
  - **狀態**：「剛完成」時長、睡著門檻、隱藏 session 名稱。hooks 區塊依規格先放停用的佔位。
  - **一般**：開機自動啟動、暫停渲染、版本與 GitHub 連結。
- **調整視角**（§7.3）：menubar 的「調整視角」與外觀分頁的按鈕都可以進入。進入後桌布視窗升到 `.floating` 層並接收滑鼠與鍵盤；按完成會存下 `camera.base`；結束後降回桌面層，鍵盤焦點還給原本的 app 或設定視窗。
- **開機自動啟動**（§7.5）：使用 `SMAppService.mainApp`；開關顯示系統的實際狀態，不另外存檔。
- **多螢幕**：用顯示器 UUID 儲存；沒設定或該螢幕不存在時，用有選單列的主螢幕。切換後桌布視窗立即移過去。
- menubar 的「設定…」改成打開設定視窗；暫停渲染的狀態與 menubar 同步。
- 隱藏的主選單補上 Edit 選單，設定視窗的文字欄位才能用 ⌘C、⌘V 等快捷鍵。

#### 驗證

- 本機 `make check` 全過：typecheck、lint、Vitest 150 個、Playwright e2e 33 個、`swift test` 124 個、`xcodebuild`。
- 實機（M3 的 Debug build 已在使用者桌面上執行）：

| 驗收項目 | 結果 |
|---|---|
| 外觀與狀態設定立即反映 | ✅ 使用者實際操作：顯示器改成 P2319H、關閉 HUD、隱藏名稱、FPS 30、攝影機自動環繞，全部即時生效 |
| 三種攝影機模式 | ✅ 自動環繞已實機確認；固定與定時切換由場景 e2e 與單元測試覆蓋 |
| 顯示器選擇 | ✅ 切到外接螢幕後桌布立即移過去 |
| 120 FPS 選項 | ✅ 停用並附說明 |
| GUI 新增、刪除、改名、改色、改款式、排序專案 | ⏳ 尚未逐項實機操作。設定變更走同一條路徑（`SettingsStore.update`），已實機確認會即時推到桌布 |
| 調整視角：旋轉、縮放、平移；完成後存檔，重啟仍保留；取消還原 | ⏳ 尚未實機操作。場景端的編輯模式有 e2e 覆蓋 |
| 不合法的設定值被擋下 | ✅ 單元測試涵蓋每條規則與邊界（例如日落等於日出、睡著門檻等於剛完成時長） |

尚未實機操作的項目，會在 M6 的整體回歸測試中補做。

#### 決策

1. **120 FPS 停用**：M2 實測 WKWebView 的 rAF 上限是 58.3 Hz（§8.9），停用的值集中在 `DisplaySupport.unsupportedFPS` 一個常數。
2. **預設螢幕是有選單列的主螢幕**（`NSScreen.screens.first`），不是 `NSScreen.main`，因為後者會跟著鍵盤焦點變。
3. **設定檔部分損壞**：只重設無效的那組欄位，其他設定保留；整個檔案無法解析時才用預設值，並在設定視窗顯示一次提示。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：`swift` job 只在 Swift 相關路徑有變更時才跑。本 PR 有改到 Swift，兩個 job 都會跑。
2. **沒有 branch protection**：private repo 無法強制，CI 綠燈後才 merge。

## #5 chore(release): v0.2.0

merged 2026-10-27 · branch `release-v0.2.0`

發佈 `v0.2.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [0.2.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 0.2.0、`CURRENT_PROJECT_VERSION` 2

本機 `make check` 全過。merge 後在 `main` 打 `v0.2.0` tag，由 release workflow 建置並發佈。

## #6 refactor: M4 以 sessions 檔的 waiting 狀態取代 hooks

merged 2026-10-27 · branch `m4-waiting-status`

#### 摘要

HANDOFF §15 的 **M4：Hooks**。依「第一步」的驗證結果與使用者的決定，**不實作 hooks**，「等你回應」直接讀 sessions 檔的 `status: "waiting"`。

- 移除設定「狀態」分頁中停用的 Claude hooks 佔位（M3 依規格先放的）。
- 更新 `SessionStateDeriver` 的說明：不需要 hook 狀態。
- README 補上 **How it works**：資料來源、pid 存活檢查與狀態對應，並警告 `~/.claude/sessions` 是未公開格式。

#### 第一步：驗證 §5.1 的新發現

**結論：sessions 檔能可靠地提供 waiting 狀態。**

- **靜態分析**：Claude Code 2.1.300 執行檔中，寫 sessions 檔的程式在對話框（權限提示等）出現時把 `status` 設成 `waiting`，並寫入 `waitingFor`；對話框結束後改回 `busy` 或 `idle`。
- **實機觀察**（Claude Code 2.1.308，唯讀監看腳本每秒讀一次 `~/.claude/sessions/*.json`）：

| 時間 | pid | status | waitingFor |
|---|---|---|---|
| 06:45:44 | 20527 | `busy` | – |
| 06:49:21 | 20527 | `waiting` | `"permission prompt"` |
| 07:15:26 | 20527 | `busy` | – |
| 07:16:47 | 20527 | `idle` | – |

  - 權限提示出現時，Claude Code 寫入 `waiting`（`statusUpdatedAt` 為 06:49:20），監看腳本在下一次讀取（06:49:21）就看到了。
  - 使用者批准後回到 `busy`（07:15:25），完成後變成 `idle`（07:16:47）。
  - 桌布上的「!」在 `waiting` 期間出現，批准後消失。app 每秒輪詢一次，所以延遲最多約 1 秒。

使用者的決定：sessions 檔已能可靠地提供 waiting 狀態，所以**不做 hooks**。因此 §5.3、`HooksInstaller` 與 GUI 的 hooks 區塊都不實作，也不會修改 `~/.claude/settings.json`。

#### 驗證

- 本機 `make check` 全過。
- 改用 sessions 檔後的實機驗收：權限提示出現後「!」出現，批准後回到執行中（見上表）。

#### 決策

1. **不做 hooks**：使用者的決定，理由見上方。改回方式：依 HANDOFF §5.3 實作 `HooksInstaller`，並在 `SessionStateDeriver.derive` 加入 hook 狀態。
2. **已知限制**：如果未來的 Claude Code 版本不再寫入 `waiting`，「等你回應」就不會出現。README 已警告這是未公開格式。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：`swift` job 只在 Swift 相關路徑有變更時才跑。本 PR 有改到 Swift，兩個 job 都會跑。
2. **沒有 branch protection**：private repo 無法強制，CI 綠燈後才 merge。

## #7 chore(release): v0.3.0

merged 2026-10-27 · branch `release-v0.3.0`

發佈 `v0.3.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [0.3.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 0.3.0、`CURRENT_PROJECT_VERSION` 3

本機 `make check` 全過。merge 後在 `main` 打 `v0.3.0` tag，由 release workflow 建置並發佈。

## #8 feat: M5 介面在地化（繁體中文、英文）與隱私檢查

merged 2026-10-27 · branch `m5-l10n`

#### 摘要

HANDOFF §15 的 **M5：在地化與隱私**（§10、§11）。

- **String Catalog**：新增 `app/Resources/Localizable.xcstrings`，來源語言為 `en`，共 82 個 key，每個都有 `en` 與 `zh-Hant`，涵蓋 menubar、設定視窗與錯誤訊息。
  - key 清單用 Xcode 自己的字串擷取產生（`SWIFT_EMIT_LOC_STRINGS` 加 `xcstringstool sync`），避免漏掉。
  - 翻譯用台灣用語，狀態名稱依 §10 對照表，建築款式名稱依 §8.4。
- **`project.yml`**：設定 `developmentLanguage: en`、`SWIFT_EMIT_LOC_STRINGS`，並在 Info.plist 加上 `CFBundleLocalizations`（en、zh-Hant）。
- **場景與介面的語言一致**：場景語言改由 `Bundle.main.preferredLocalizations` 決定，和 Swift 介面走同一套系統規則。原本的寫法只看第一個偏好語言；加入 catalog 後，在某些語言設定下會變成設定視窗是中文、桌布卻是英文。
- **測試**：新增 `LocalizationCatalogTests`（§10），包含：
  - 每個 key 都有非空的 `en` 與 `zh-Hant`。
  - 三者的格式符號一致。
  - `app/Sources` 裡每個 `String(localized: "…")` 字面值都在 catalog 中，新增未翻譯的字串會讓 `make check` 失敗。
- **隱私**：`PROJECTTOWN_WEB_URL` 開發用覆寫改成只在 Debug build 有效，Release 版不會從任何 URL 載入場景。

#### 驗證

- 本機 `make check` 全過。
- 打包後的 `.app` 含有 `en.lproj` 與 `zh-Hant.lproj`，各 82 筆。
- 用 `-AppleLanguages` 分別以 `(zh-Hant)`、`(en)`、`(zh-Hans)` 啟動 Debug build，逐頁截圖設定視窗與桌布：
  - 截圖時用 `CFFIXED_USER_HOME` 指向測試用的家目錄，沒有動到使用者真實的設定檔。
  - **zh-Hant**：設定視窗、HUD（「0 個 session」）、空狀態提示（「從 menubar 開啟設定…」）都是繁體中文。
  - **en**：全部是英文。
  - **zh-Hans**：依規格（§10）全部是英文，設定視窗與桌布一致。
- 場景的招牌、HUD 與名稱標籤：在 mock 模式中以兩種語言截圖確認。`hideSessionNames` 關閉時，名稱標籤顯示「(session 無名稱) · 3 分鐘前」與「(unnamed session) · 3 minutes ago」，開啟時不顯示。
- menubar 選單的 7 個項目：從打包後兩種語言的 `Localizable.strings` 確認，沒有實際點開。

語言對應（`Bundle.preferredLocalizations`）：

| 系統偏好語言 | 結果 |
|---|---|
| zh-Hant、zh-Hant-TW、zh-TW、zh-HK | 繁體中文 |
| zh-Hans-CN、zh-Hans + en、en-US、fr | 英文 |

#### 隱私檢查（§11）

- **Swift**：沒有任何網路 API（URLSession、Network.framework、socket）。唯一的 URL 是 About 與一般分頁中的 GitHub 連結，只有使用者點擊時才會用瀏覽器開啟。
- **場景（`web/dist`）**：沒有 fetch、XHR、WebSocket、EventSource 或 sendBeacon，也沒有外部的 script、樣式或字型。app 用 `loadFileURL` 從 bundle 載入。
- **讀取的檔案**：只有 `~/.claude/sessions/*.json` 與自己的 `config.json`。另外只會檢查專案資料夾是否存在、用 pid 檢查 process，以及透過資料夾選擇窗挑選資料夾。
- **`hideSessionNames`**：預設開啟，有測試覆蓋。

#### 決策

1. **語言規則跟隨 macOS 的標準行為**：系統從偏好語言清單中挑第一個 app 支援的語言。例如偏好語言是 `["ja", "zh-Hant"]` 時，介面與場景都會是繁體中文。若嚴格照 §10「系統語言不是繁體中文就用英文」，這個情況應該是英文，但那樣介面與場景會不一致，或得覆寫系統的語言選擇。兩邊至少一致是最重要的。
2. **隱藏的 Edit 選單**（復原、剪下等）不翻譯：`LSUIElement` app 不會顯示主選單，這些項目只用來提供 ⌘C、⌘V 快捷鍵。
3. **XcodeGen 2.46 無法設定 `knownRegions`**：產生的專案檔中沒有 `zh-Hant`，但打包結果有兩種語言的 lproj，執行時由 `CFBundleLocalizations` 生效。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：`swift` job 只在 Swift 相關路徑有變更時才跑。本 PR 有改到 Swift，兩個 job 都會跑。
2. **沒有 branch protection**：private repo 無法強制，CI 綠燈後才 merge。

## #9 chore(release): v0.4.0

merged 2026-10-27 · branch `release-v0.4.0`

發佈 `v0.4.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [0.4.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 0.4.0、`CURRENT_PROJECT_VERSION` 4

本機 `make check` 全過。這個分支疊在前一個 PR 之上，前面的 PR 依序 merge 後，這裡的 diff 只剩版本變更。merge 後在 `main` 打 `v0.4.0` tag，由 release workflow 建置並發佈。

## #10 feat(scene): 外圍街坊背景建築與小車

merged 2026-10-27 · branch `scene-outskirts`

> 這個分支疊在 M5（#8）與 v0.4.0 之上，前面的 PR 依序 merge 後，這裡的 diff 只剩街坊。

#### 摘要

使用者在實機桌面上覺得小鎮外圍太空，選擇的解法：在小鎮外加一圈背景街坊（沒有招牌、低彩度、比專案建築小、夜晚只有零星燈光），外圍巷道上有小車行駛，背景中沒有任何人形。

- **街坊**：
  - 小鎮的道路網格往外延伸成較窄的巷道。
  - 巷道圍出的街區切成一戶戶庭院，每戶一棟低彩度小房子，有階梯斜屋頂、門窗、煙囪，戶與戶之間用矮樹籬隔開，後院種樹。
  - 其間穿插連排屋、公園和菜園；原本在田野裡的池塘移進街坊，變成池塘公園。
  - 越遠越簡化，顏色也逐漸偏向天空色。最外圈是田野，縮到最小時看到的是自然的收尾。
- **鋪滿畫面**：
  - 街坊範圍依預設視角能看到的最遠處推算，使用 `fitDistance` 與最高的建築。
  - 專案地塊的位置與 `cameraMath.ts` 都沒有改動。
  - 單元測試會模擬攝影機：16:9、16:10、3:2 三種比例，每 10° 環繞一圈，確認畫面邊緣都落在街坊內。
- **小車**：沿三圈巷道雙向靠右行駛，不會開進小鎮；另有少數車停在車道上。
- **夜晚**：
  - 約 45% 的房子亮一到三扇窗，部分門口有燈，車子有車燈，亮度都低於 bloom 門檻。
  - 街坊與延伸道路入夜後一起調暗，小鎮的窗戶、招牌和「!」仍是全場最亮的。
- **效能**：
  - 街坊合併成一個靜態 mesh，窗光、車身、車燈各一個 draw call，不投射陰影。
  - 小車每幀擺位不配置記憶體。
  - 凍結時間（on-demand 模式）時車子停住，不觸發重繪，截圖保持可重現。
- **lite 模式**（軟體繪圖，CI 用）：只保留最近的 220 棟最簡化房子、140 棵樹、內圈 8 台車，不畫窗光與巷道路緣。

依 voxel-art skill 的原則，由 Opus（max effort）設計與實作。

#### 驗證

- 本機 `make check` 全過：Vitest 161 個（新增 11 個街坊配置測試）、Playwright e2e 33 個、`swift test`、`xcodebuild`。
- 街坊配置測試涵蓋：
  - 可重現。
  - 填滿畫面邊緣（刻意把範圍縮小一圈時，測試會失敗）。
  - 不與地塊、綠帶、道路重疊。
  - 隨小鎮大小調整、數量上限。
  - 車子都在巷道上。
- 效能，在 `crowded` 情境、夜晚、1280×800 量測：

| | draw calls | triangles |
|---|---|---|
| GPU | 129 → 133 | 27,709 → 66,299 |
| lite（SwiftShader） | 71 → 73 | 14,881 → 31,309 |

- 幀時間（無頭 Chromium、Metal、M4 Pro，解除 FPS 上限）：
  - 25 個專案、Retina 2×：6.45 → 7.27 ms。
  - 1080p：2.93 → 3.33 ms。
  - 仍遠低於 60 fps 的 16.7 ms。
- e2e 各測試時間加總：129.7 → 136.5 秒（+5%）。
- `docs/screenshots/busy-night.png` 用 GPU 重新產生（e2e 現在走 lite 管線，沒有 bloom）。

#### 決策

1. **底板放大**：預設視角上方兩角原本會看到底板外面，現在看不到了；縮到最小時仍看得到底板邊緣。
2. **延伸道路入夜調暗**：夜晚在小鎮邊緣形成明暗交界，像「燈火通明的區域到此為止」。
3. **修正 `street.ts` 的 `spans()`**：延伸道路依巷道切段後，人行道會穿過整個小鎮，夜晚出現 z-fighting 條紋。加上範圍檢查後修正，原有的呼叫不受影響。
4. **田野植物不投影**：它們本來就在陰影範圍外，畫面沒有變化，省下陰影計算。
5. **計算範圍時假設最高的建築**：專案少時，街坊會比實際需要的略大一點。

#### 已知限制

- 還沒在真正的 WKWebView 桌布、也沒有在 M1 等級的 Mac 上量過幀時間。
- 21:9 超寬螢幕的角落會看到外圍田野。
- 超過 25 個專案時，預設視角最遠的角落會是樹和草地，不是房子。
- lite 模式的 `many` 截圖外圍只有巷道和草地，只影響 CI 截圖。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：本 PR 只動 `web/` 與文件，`swift` job 會被路徑過濾略過。
2. **沒有 branch protection**：private repo 無法強制，CI 綠燈後才 merge。

## #11 docs: M6 README 與截圖

merged 2026-10-27 · branch `m6-v1`

> 這個分支疊在街坊 PR 之上，前面的 PR 依序 merge 後，這裡的 diff 只剩 README 與截圖。

#### 摘要

HANDOFF §15 的 **M6：收尾與 v1.0.0**：完成 §14 的 README，並檢查 CHANGELOG。

- **README**（英文，依 §14 的順序）：
  - 名稱、一句話介紹、夜景主視覺、**Supported languages: 繁體中文, English**。
  - Features：五種狀態的對照表，每種狀態附一張夜景特寫；另有小鎮、日夜、攝影機與省電。
  - Requirements、Install（含 `xattr` 指令與 Finder 右鍵打開）、Usage。
  - How it works：附警告，`~/.claude/sessions` 是未公開格式。
  - Privacy。
  - 額外加一節 Known limitations，對應 §16。
  - Build from source、Development（mock 模式的 URL 參數、`make check`、開發用環境變數、專案結構）、Contributing（§12.4 的兩個限制）。
  - Disclaimer、License。
- **截圖**（`docs/screenshots/`，都在 mock 模式用 GPU 算圖，與 e2e 相同的凍結時間）：
  - `busy-night.png`：主視覺，1280×800。
  - `busy-day.png`：白天，1280×800。
  - `state-*.png`：五種狀態的特寫，各 800×600。
- **CHANGELOG**：`[Unreleased]` 加上 README。另外檢查了各版本：
  - `0.1.0`～`0.4.0` 都有日期與 Added／Changed／Removed 分類。
  - 每個 tag 的 release notes 都已在 Release 頁面確認。

#### 驗證

- 本機 `make check` 全過。
- README 的圖片路徑都指向 `docs/screenshots/` 裡的檔案。

#### CI 的兩個限制（§12.4）

1. **Actions 額度**：本 PR 只動文件與圖片，`swift` job 會被路徑過濾略過。
2. **沒有 branch protection**：private repo 無法強制，CI 綠燈後才 merge。

## #12 chore(release): v1.0.0

merged 2026-10-27 · branch `release-v1.0.0`

發佈 `v1.0.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [1.0.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 1.0.0、`CURRENT_PROJECT_VERSION` 5

本機 `make check` 全過。這個分支疊在前一個 PR 之上，前面的 PR 依序 merge 後，這裡的 diff 只剩版本變更。merge 後在 `main` 打 `v1.0.0` tag，由 release workflow 建置並發佈。

## #13 feat: 田園／都會主題、景深模糊帶、切換桌面時顯示小鎮

merged 2026-10-27 · branch `scene-themes`

#### 摘要

這些是使用者試用 v1.0.0 後提出的調整，都可以在設定畫面切換。

- **兩種主題**（設定 → 外觀 → 顯示 → 主題）
  - **田園**（預設）：
    - 小鎮站在低矮的台地上，四周圍一圈白色木柵欄，三條路從城門出鎮。
    - 近郊是牧草地與羊、兩間小屋、樹叢、野花和池塘，作物田在中景以外。
    - 再往外有河與石橋、鐵橋，穿過隧道的小火車，還有風車、農莊和山丘。
  - **都會**：沿用 v1.0.0 的街坊，但更多樣。
    - 有不同大小與屋頂的住宅、連棟屋、公寓、街角小店、小工廠、學校、教堂、停車場、球場、遊戲場和小廣場。
    - 較高的建築只出現在第三環以外，小鎮仍是焦點。
  - **程式結構**：
    - 外圍拆到 `scene/outskirts/`，兩種主題各有自己的 plan 與 builder。
    - `street.ts` 由兩個主題共用；外圍用 `RoadExit` 告訴街道道路從哪裡出城。
    - 切換主題時會重建外圍並釋放舊的；e2e 確認切回後 geometry 數量回到原值。
- **景深**
  - 改為依深度計算：小鎮所在的深度範圍保持清晰，後方越遠越模糊。最大模糊從螢幕高度的 3.8% 降到 2.4%。
  - 畫面上、下各加一條模糊帶，越靠邊緣越模糊。
  - 小鎮本身永遠清晰：從深度還原每個像素的世界座標，落在小鎮範圍內的不模糊；範圍外 8 m 內漸進變模糊。
  - 設定新增兩個滑桿：
    - 「模糊強度」：25–200%。
    - 「模糊範圍」：上下各 0–45% 的螢幕高度，預設 25%。
- **底板外延伸草地**：兩個主題的底板外都是同色草地，遠處由霧淡入天空，縮小或低俯角時不會再看到底板邊緣。
- **夜間光暈**：調低路燈的地面光圈、燈頭光暈和 bloom。
- **切換桌面時顯示小鎮**（預設開啟）
  - **問題**：切換 Space 或開關指揮中心時，macOS 有時不畫桌面層級的視窗，系統桌布會閃出約 0.2–1 秒。
    - 使用者錄影比對過：提高視窗層級、每個 Space 各放一個視窗，都無法每次都畫出來。
    - 只有系統桌布每次都會畫。
  - **做法**：把小鎮所在螢幕的系統桌布換成小鎮的最新截圖（`WKWebView.takeSnapshot` → JPEG → `setDesktopImageURL`）。
    - 更新時機：小鎮可見後 1.5 秒、之後每 5 分鐘，以及外觀設定改變後。
    - 小鎮被遮住、暫停或在調整視角時不做任何事。
  - **還原**：每個 Space 原本的桌布記在 `Wallpaper/slots.json`，用 slot 對應，不用私有 API。
    - 關閉選項、結束 app，或把小鎮換到另一個螢幕時，換回原本的桌布。
- **新預設值**（依使用者試用後的設定）：15 FPS、HUD 關閉、模糊強度 60%，既有的 `config.json` 不受影響。
- **文件**：更新 README、HANDOFF、CHANGELOG 與截圖。

#### 驗證

- 本機 `make check` 全過（含新預設值）：Vitest 178、Playwright e2e 34、Swift 143、`xcodebuild`。
- 實機（M4 Pro，內建螢幕）：
  - Release build 裝到 `/Applications` 試用。
  - 系統桌布換成 3024×1964 的小鎮截圖，原本的桌布已記錄。
  - 使用者試用主題、模糊強度、模糊範圍、上下模糊帶與草地後確認。
- 效能（GPU、夜間，draw calls / triangles）：
  - 田園：busy 296 / 135k，many 747 / 311k。
  - 都會：busy 294 / 141k，與 v1.0.0 相比 draw calls 相同、triangles 少 11%。

#### 未驗證

- 外接螢幕上的切換桌面效果。
- 動態桌布、Aerial、輪播桌布的還原：只記錄 URL 與縮放方式。
- 結束 app 後，沒切換過去的 Space 仍會顯示截圖，要等下次執行並切過去才會換回。

## #14 chore(release): v1.1.0

merged 2026-10-27 · branch `release-v1.1.0`

發佈 `v1.1.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [1.1.0] - 2026-10-27`
- `project.yml`：`MARKETING_VERSION` 1.1.0、`CURRENT_PROJECT_VERSION` 6

本機 `make check` 全過。這個分支疊在 #13 之上，#13 merge 後這裡的 diff 只剩版本變更。merge 後在 `main` 打 `v1.1.0` tag，由 release workflow 建置並發佈。

## #15 fix(wallpaper): 截圖不再被設到全螢幕 app 的 Space

merged 2026-10-28 · branch `fix-snapshot-fullscreen`

#### 摘要

開著「切換桌面時顯示小鎮」時，若在 app 拍截圖的那約 0.5 秒內切進全螢幕 app 的 Space，截圖會被設成那個全螢幕 Space 的桌布。之後清檔時這張被刪掉，那個 Space 就指向一個不存在的檔案。

全螢幕 Space 的桌布壓在 app 視窗和黑色底板下面，平常看不到。這個 PR 讓 app 不再碰全螢幕 Space，並在文件補上一個修不掉的限制。

#### 原因

- `setDesktopImageURL` 只改得到「當下」的 Space。
- `capture()` 最後一道檢查靠三樣東西：`generation`（Space 切換通知）、`active`（遮擋通知）和 URL 比對。
  - 兩個通知都在 WindowServer 切換之後才送到。
  - 全螢幕 Space 沒有自己的桌布條目時，`desktopImageURL(for:)` 回報的是桌面那張。實測 P2319H 上 Claude 的全螢幕 Space 回報桌面的 `town-2-…942453.jpg`，所以 URL 比對分不出來。
- 證據：
  - 10-27 23:23:39 那筆設定的 `LastSet`，和截圖檔名的時間只差 0.17 秒，所以是 app 自己設的。
  - 實驗確認：在全螢幕 Space 呼叫 `setDesktopImageURL`，只會改到那個 Space 的條目。

#### 修正

- `WallpaperSnapshotter.capture()` 在拍照前和 `setDesktopImageURL` 前各問一次 WindowServer。
  - 用的是 `CGWindowListCopyWindowInfo`（公開 API），只讀視窗編號、圖層和範圍，不需要螢幕錄製權限。
  - 小鎮上方、介於桌面層和桌面圖示層之間，有視窗蓋滿螢幕（全螢幕 Space 的 `Fullscreen Backdrop`）：略過這次。
  - 小鎮下方在螢幕上的視窗（每個 Space 有自己的桌布視窗）和開始時不同：略過這次，並刪掉這張。
  - 讀不到資訊時，維持原本的行為。
- 文件
  - README、HANDOFF：補上「在全螢幕 app 裡結束 ProjectTown 時，桌面會留著最後一張截圖」。
  - HANDOFF：補上新檢查的說明。
  - CHANGELOG：`[Unreleased]` 加上 Fixed。

#### 驗證

- 本機 `make check` 全過：Vitest 178、Playwright e2e 34、Swift 測試、`xcodebuild`。
- 實機：M4 Pro 接三個螢幕，小鎮和 Claude 全螢幕都在 DELL P2319H。
  - 用只在本機建置、不進 repo 的 debug 測試版：不管小鎮看不看得到，都強制每 2 秒拍一次，每張多停 1.5 秒再檢查。
  - 桌面 Space、新檢查開啟：6 次都成功設定，`LastSet` 對得上，沒有誤擋。
  - 回到 Claude 全螢幕、新檢查開啟：5 次都以「a full-screen Space is current」略過，全螢幕 Space 沒有出現條目。
  - 同一位置關掉新檢查（等同舊版）：2 次都寫進全螢幕 Space（`6B32B179 town-2-…834348.jpg @ 10:00:36`），重現原本的問題。
  - 小鎮下方的視窗：在桌面時含桌面的桌布視窗 46479（每次設定後還會多一個暫時的視窗），在全螢幕時換成全螢幕 Space 的桌布視窗 46882。

#### 未驗證

- 自然發生的「拍到一半切換 Space」：這次滑動沒剛好碰上拍照，而原有的 `generation` 檢查多半也會先擋下。
- 「小鎮下方的視窗」包含所有螢幕：其他螢幕剛好在這約 0.5 秒內換桌布時，會略過這次，等下次再拍。
- 在全螢幕 app 裡結束 ProjectTown 時，桌面不會換回原本的桌布。這是 `setDesktopImageURL` 的限制，只補了文件。

## #16 feat(wallpaper): 清掉超過 7 天沒有新截圖的 slot

merged 2026-10-28 · branch `snapshot-cleanup`

#### 摘要

桌布截圖原本每個 slot 留最新 2 張，但 slot 不會被清掉：拔掉的螢幕、不再使用的 Space，或被別的 app 換過桌布的 Space，都會各自留下 2 張，越積越多。這個 PR 讓超過 7 天沒有新截圖的 slot 刪掉它的所有截圖。

> 疊在 #15 上：#15 merge 前，這裡的 diff 也包含 #15 的 commit。

#### 做法

- `WallpaperSnapshotLedger.obsoleteFiles(_:keep:now:)`：一個 slot 最新的截圖如果早於 `now - unusedSlotLifetime`（7 天），這個 slot 的檔案全部列出；其餘 slot 照舊只留最新 2 張。
- `slots.json` 裡的原始桌布不刪，之後切到那個 Space 時仍能換回。
- `WallpaperSnapshotter`：每次設定截圖後清一次（原本就有），app 啟動時也清一次，選項關閉時同樣有效。
- README、HANDOFF、CHANGELOG（`[Unreleased]` → Changed）補上說明。

#### 驗證

- 先寫測試（`testObsoleteFilesDropSlotsWithoutASnapshotForAWeek`）確認失敗，再實作讓它通過：
  - 使用中的 slot 只刪最舊的那張。
  - 最新一張 6.9 天前的 slot 兩張都留。
  - 最新一張 7.1 天前的 slot 全刪。
- 本機 `make check` 全過：Vitest 178、Playwright e2e 34、Swift 測試、`xcodebuild`。

#### 未驗證

- 實機上 7 天後的清理沒有等著看；只靠單元測試和 app 啟動時的呼叫。
- 被清掉檔案、但還沒切回去的 Space，在切換的瞬間 macOS 會畫什麼不確定；切回去後 1.5 秒內會補上新截圖。

## #17 fix(scene): 縮小等待中的「!」，名稱畫在狀態符號之上

merged 2026-10-28 · branch `scene-badges`

#### 摘要

使用者回報兩點：
1. 等待中的「!」太大。
2. 狀態符號擋到名稱：截圖裡，後方 ProjectTown 大樓裡人物的齒輪，飄到前方 systex 招牌上，壓住了專案名稱。

#### 做法

- **縮小「!」**：氣泡和它的光暈、跳動幅度、錯開距離一起縮小約 30%（`BUBBLE_PX` 52 → 36）。人物名稱標籤會依這些數值抬高，所以跟著自動調整。
- **名稱畫在最上層**：招牌（`sign.ts`）和人物名稱標籤（`label.ts`）都是「置頂繪製」的 sprite，先後由 `renderOrder` 決定。
  - 原本：招牌 3、標籤 4，都比齒輪（5）和「!」（1000–1001）早畫，所以會被蓋住。
  - 現在：招牌 1002、標籤 1003，名稱一律畫在所有狀態符號之上。

#### 驗證

- 用跟使用者截圖相同的五個專案（ProjectTown 執行中、team-hub 等待中……），以 GPU Chromium 拍修改前後對照：
  - 預設視角 2：修改前，「!」氣泡蓋住 team-hub 的「!1 zZ2」徽章；修改後，徽章完整顯示在上層，「!」變小、排在徽章下方。
  - 預設視角 1：修改前，ProjectTown 的齒輪壓在 systex 招牌的右端；修改後，招牌完整，齒輪退到招牌後面。
- 本機 `make check` 全過：Vitest 178、Playwright e2e 34、Swift 測試、`xcodebuild`。

#### 取捨

- 狀態符號和名稱重疊時，現在被遮住的是符號。招牌上的計數徽章仍會顯示各狀態的數量。

## #18 feat(scene): 外圍加上路人與更多車，田園加豬並讓動物走動

merged 2026-10-28 · branch `scene-life`

#### 摘要

使用者要求的外圍美術優化：
1. **都會**：汽車多一點，並加上路人。
2. **田園**：也加上路人，但比都會少。
3. **田園**：動物加上豬，而且動物會走動。

後續回饋：
- 路人太小：改成和 session 角色同款，只用顏色區分。
- 路人的路徑太單調：要到處走，也要走進城鎮。

#### 做法

- **共用的路人模組** `outskirts/walkers.ts`
  - 造型：直接用小鎮 session 角色（`characters/person.ts`）的 `PersonParts`，大小相同，手腳擺動和上下起伏也相同。
  - 和 session 只差在顏色：session 穿粉彩上衣，路人穿偏灰的深色上衣和褲子；路人沒有名牌和狀態符號。
  - 路網：
    - 城鎮內：每塊地四周的人行道、城鎮外圈人行道，以及斑馬線。
    - 都會外圍：從城鎮延伸出去的道路人行道，走到盡頭可以過馬路到對面。
    - 田園外圍：出城門的路依序是人行道、城門口、坡道（東門是石橋）、小路，一路通到農場。
    - 行道樹的樹冠太低，種了樹的那段人行道不走。
  - 路線：
    - 每人從起點出發，挑幾個隨機地點走最短路過去。時間不夠再去下一個地點時，就隨意逛，最後走最短路回到起點。
    - 一輪固定 5 分鐘，速度與停留時間依路線長短調整。
    - 走路靠右，過馬路前有時會在路緣停一下，遇到死路會掉頭，轉角時身體會平順轉向。
  - 不相撞：
    - 每人一輪都是 5 分鐘，所以整群人每 5 分鐘完全重複一次。規劃時逐一檢查一整輪，會撞到別人的路線就換一條。
    - 迎面錯身時兩人各自靠右，允許通過。
    - 路網放不下時就少放幾個人，例如很小的都會小鎮約 10 人。
  - 田園：
    - 三條農場小路的盡頭各有一個人從那裡出發，所以每座農場都有人走到。
    - 出城的路被選為目的地的機率，提高到和整個城鎮差不多。
  - 路人改用自己的材質並投下影子，在城鎮裡和 session 角色看起來一致。外圍的材質黃昏時會變色，路人不跟著變。
  - 天黑（光線 ≤ 0.3）時收起來；lite 模式不顯示。
  - `person.ts` 匯出 `SKINS` 和關節位置 `JOINTS`，`Person` 改用 `JOINTS`，數值不變。
- **都會**
  - 路人最多 30 人，走城鎮人行道、斑馬線，以及城鎮道路延伸出去 24–60 單位內的人行道。
  - 車：行駛中 34 → 56 台、停放 36 → 50 台，同車道車距 30 → 20。
- **田園**
  - 路人 8 人，走城鎮，也會出城門走到農場。
  - 豬：牧場用同一次亂數決定放牛、豬或羊，牛的比例不變，部分羊群改成豬群。豬有兩種粉紅色，鼻子、耳朵、腳和尾巴稍深。
  - 動物走動：
    - 每隻在自己的牧場裡（離邊緣 1.3、避開遮蔭樹）或自己那層台地上，繞 3–5 個點吃草。
    - 每個點停 3–12 秒，停的最後 0.8 秒轉向下一段；走路時身體會輕微起伏。
  - 山丘台地是十字形：
    - 路線每 0.25 單位檢查一次，免得切過內凹的轉角。
    - 也避開重疊的另一座更高山丘。這順便修正了一個既有問題：原本可能把羊放進別座山丘的台階裡。
  - 動物原本合併在靜態幾何裡，現在改成每種一個 `InstancedMesh`。
  - 拿掉 `facing` 欄位，但保留原本那次亂數抽取，所以牧場、樹等其他東西的位置都不變。
- **文件**：更新 README 和 CHANGELOG。README 原本寫「外圍沒有招牌也沒有人，所以不會被誤認成專案」，已改寫成路人靠衣服顏色和 session 區分。

#### 驗證

- 路人測試（`tests/walkers.test.ts`），兩種主題、多種小鎮大小都檢查：
  - 任何時刻整個身體都在鋪面上（人行道、斑馬線、出城道路、田園小路與石橋），也不碰到行道樹。
  - 在坡道和小路上，腳都踩在地面高度。
  - 一整輪 5 分鐘內任兩人不相撞，只有迎面錯身時允許靠近；因為整群人每 5 分鐘重複，這等於永遠不相撞。
  - 每個人走的路線都不同，有人從外面走進城鎮再出去，在城鎮裡的時間超過一成；田園三條小路的遠端都有人走到。
  - 移動平順不跳動；都會人數多、田園少，lite 模式沒有路人。
- 其他新增測試：都會大鎮的車流會達到上限；田園動物任何時刻都在自己的牧場或同一層台地上（已考慮山丘重疊）、有豬、走動平順。
- 本機 `make check` 全過：Vitest 187、Playwright e2e 34、Swift 測試、`xcodebuild`。
- 用 GPU Chromium 拍白天截圖並放大確認：
  - 都會：路人走在城鎮人行道、斑馬線，也走在外圍道路上。
  - 田園：路人走在城鎮裡、城門口，也走在坡道和農場小路上，身體有影子。
- 效能（busy 情境、GPU、白天）：

  | 主題 | 繪製次數 | 三角形 |
  |---|---|---|
  | 都會 | 283 → 291 | 139.8k → 150.8k |
  | 田園 | 286 → 297 | 136.1k → 139.4k |

  路人的影子多 4 次繪製。路線在換版面時規劃一次，最多約 50 ms。

#### 取捨與未驗證

- **路人進城鎮**：
  - 路人和 session 同款同尺寸，只靠衣服顏色（偏灰深色對粉彩）、沒有名牌和符號、夜裡收起來來區隔，乍看之下仍可能吸引目光。
  - session 角色離開時走在路中央，偶爾可能和過馬路的路人交會。
- **人行道只有 1.5 寬**：小鎮 12 個專案以內時人物最大，兩人迎面錯身會肩膀略為重疊。
- **城鎮角落的出城道路**：外側那條人行道在轉角處太窄，不走。
- **README 截圖沒有重拍**：busy-day、busy-night 會多出路人和豬，下次發版時一起重拍。
- **可能的短暫重疊**：路人穿越側巷時可能和車重疊一下；同一牧場的動物各走各的，也可能互相重疊一下。

## #19 chore(release): v1.2.0

merged 2026-10-28 · branch `release-v1.2.0`

發佈 `v1.2.0`（HANDOFF §13）：

- `CHANGELOG.md`：`[Unreleased]` 的內容移到 `## [1.2.0] - 2026-10-28`
- `project.yml`：`MARKETING_VERSION` 1.2.0、`CURRENT_PROJECT_VERSION` 7
- `docs/screenshots/`：重拍 README 截圖。busy 日夜景多了路人和豬，等待中的「!」變小，名稱不再被狀態符號擋住（#17、#18）。

本機 `make check` 全過。merge 後在 `main` 打 `v1.2.0` tag，由 release workflow 建置並發佈。

## #20 docs: 修正 README、新增繁中版與客製化說明、重拍狀態截圖

merged 2026-10-28 · branch `docs-readme-zh`

#### 變更

- **狀態截圖**：五張狀態圖改為白天，以實際桌布鏡頭（預設縮放、1440×900 Retina、六棟建築版面）渲染後裁切單棟建築。狀態圖示是固定螢幕像素大小，用這種拍法圖示與小人的比例才和桌面上一致。
- **README.md**：主圖改用白天、Day and Night 段落改放夜景；移除 Development；新增 Customization（各分頁選項、範圍、預設值）與 Language 說明；攝影機模式名稱、調整視角、120 FPS 說明對齊實際介面。
- **README.zh-Hant.md**：新增繁中版，與英文版互相連結。
- **HANDOFF.md**：Q25 改為 README 有英文與繁中兩版。

#### 檢查

- 本地 `make check` 通過。
- 只改文件與圖片，沒有程式碼變更。

## #21 feat(app): 新增 App 圖示與同款選單列圖示

merged 2026-10-30 · branch `feat-app-icon`

#### 變更

- **App 圖示**：新增 `app/Resources/AppIcon.icon`（Icon Composer 格式），草地綠（`#84ae5f`）底上一棟等角 voxel 小屋，取代 Finder、Dock、「關於」視窗的系統預設圖示。用 `.icon` 格式是為了讓新版 macOS 不把圖示套進灰色外框；Xcode 會另外產生 macOS 14/15 用的 `AppIcon.icns`。
- **project.yml**：把 `AppIcon.icon` 加進 resources，並設定 `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon`。
- **選單列圖示**：由 SF Symbol `house.fill` 改為程式繪製的同款小屋 template 圖示（屋頂與右牆實心、左牆較淡、門鏤空），對應 HANDOFF §7.4 的「自製小房子 template image」。
- **CHANGELOG**：Unreleased 新增一條 Added。

#### 檢查

- `xcodebuild` Debug build 通過；產出的 App 含 `AppIcon.icns`、`Assets.car`，`Info.plist` 有 `CFBundleIconName = AppIcon`。
- 以 `actool` 編譯 `.icon` 並拆出 PNG 確認渲染；選單列圖示另以放大渲染檢查淺色、深色兩種選單列。
- 尚未在實機上開啟 App 檢查 Finder、Dock、選單列的實際顯示。

## #22 fix: 鎖定畫面顯示原本桌布、拔插外接螢幕後不再換錯桌布

merged 2026-10-30 · branch `wallpaper-restore-fixes`

#### 摘要

兩個與「切換桌面時顯示小鎮」（`wallpaperSnapshot`）有關的問題，各一個 commit。

##### 1. 拔插外接螢幕後桌布被換錯（`84a38b3`）

拔掉再插回外接螢幕後，內建螢幕有時會變成另一台螢幕的原始桌布。原因：換回原本桌布時只看 Space 回報的桌布網址，但
- 沒有自己桌布的全螢幕 Space 會回報桌面的桌布（看起來像我們的截圖），換回時會把別的 Space 的原始桌布寫進去，之後跟著 app 換螢幕；
- 螢幕拔插時 macOS 會把 Space 在螢幕之間搬動，期間回報的桌布不可靠。

修正：
- 換回前先問 WindowServer 那台螢幕目前是不是全螢幕 Space，是就跳過（判斷改成可用於任何螢幕）；
- 螢幕變動後 2 秒內不截圖也不換回，之後統一換回其他螢幕並重新截圖。小鎮換螢幕也走同一流程。

##### 2. 鎖定畫面改為顯示原本的桌布（`4196421`）

macOS 26 的鎖定畫面直接顯示每台螢幕的系統桌布，所以原本會顯示小鎮截圖。改為收到 `com.apple.screenIsLocked` 時停止截圖並換回原本的桌布，`com.apple.screenIsUnlocked` 後小鎮可見時再重新截圖。全螢幕 Space 同樣跳過。

文件：
- HANDOFF §7.2 改正：鎖定不會送 `sessionDidResignActive`，暫停靠遮擋判斷（實機量過，鎖定後數秒內 CPU 降到接近 0）；§9.1 補上全螢幕、拔插、鎖定的處理。
- README（中英）補上鎖定畫面的行為，以及與其他自動換桌布工具並用的注意事項。
- CHANGELOG `[Unreleased]` 各一筆。

#### 驗證

- `swift test`：144 個測試全過；Debug build 通過。
- 實機（內建 + P2319H + S2721NX，小鎮在 P2319H），以記錄每台螢幕桌布變化的腳本觀察：
  - 鎖定 0.7 秒後 P2319H 換回原本桌布，鎖定畫面確認顯示原本桌布；解鎖 1.8 秒後換回新截圖。
  - 拔掉外接螢幕：約 4 秒後小鎮截圖設到內建螢幕；插回 2.5 秒後內建螢幕正確換回原本桌布。
  - 切到全螢幕 Space 再切回：沒有寫入全螢幕 Space，回到桌面後正常截圖。

## #23 chore(release): v1.3.0

merged 2026-10-30 · branch `release-v1.3.0`

版本號改為 1.3.0（build 8），CHANGELOG 的 Unreleased 內容歸到 `[1.3.0] - 2026-10-30`：新的 App 圖示（#21）、鎖定畫面顯示原本桌布與拔插外接螢幕的桌布修正（#22）。

## #24 fix(app): 動態或空拍桌布不再被換成 macOS 預設桌布

merged 2026-11-04 · branch `fix-dynamic-wallpaper`

#### 問題
拔掉所有外接螢幕再接回後，用 macOS 動態或空拍桌布的螢幕（例如內建螢幕）會變成 macOS 預設桌布。

#### 原因
系統把動態與空拍桌布都回報成 `/System/Library/CoreServices/DefaultDesktop.heic`。小鎮移到那台螢幕時，ProjectTown 把這個檔案記成原本桌布，之後還原就設成預設圖片。

#### 修正
- `WallpaperSnapshotLedger.canRestore(_:)`：辨識這種無法從 URL 還原的桌布。
- `WallpaperSnapshotter.capture()`：遇到這種桌布就不替那台螢幕換小鎮截圖。代價是那台螢幕切換桌面時仍可能閃一下原本桌布。

#### 驗證
- 新增單元測試，ProjectTownCore 145 個測試全過；app 建置成功。
- 真機：拔插所有外接螢幕，內建螢幕維持空拍桌布，DELL P2319H 照常換成小鎮截圖。

## #25 chore(release): v1.3.1

merged 2026-11-04 · branch `release-v1.3.1`

版本升到 1.3.1（build 9），CHANGELOG 加上 1.3.1 段落。內容：KevinYu1580/ProjectTown#24 動態或空拍桌布不再被換成 macOS 預設桌布。

## #26 feat: app 內自動更新與 Ko-fi 贊助入口

merged 2026-11-08 · branch `feat-support-and-updates`

#### 內容

- **自動更新**：每天查詢 GitHub `releases/latest`，有新版時在選單列與設定 → 一般顯示「更新到 X.Y.Z 並重新啟動」。會下載 zip、用內建公鑰驗證 Ed25519 簽名、檢查 bundle ID 與版本、把舊版移到垃圾桶、放上新版並重新啟動。程式下載的檔案沒有隔離標記，ad-hoc 簽章也能直接啟動。
- **發版**：`release.yml` 用 `UPDATE_SIGNING_KEY` secret 簽署 zip 並一併上傳 `.sig`；沒有 `.sig` 的 release 不會被提供更新。
- **贊助**：選單列「贊助 ProjectTown…」、設定 → 一般的 Ko-fi 連結、首次啟動與每次更新後顯示一次的非阻塞提示，以及 README 和 `FUNDING.yml`。
- 新設定 `checkForUpdates`（預設開啟）。

#### 驗證

- `make check` 全數通過；新增 `UpdateOfferTests`、`UpdateSignatureTests`。
- 本機端到端測試：用本機 HTTP 伺服器提供假的 v9.9.9 release，Debug 版成功下載、驗簽、替換並重新啟動，重新啟動後的 app 也能正常運作。

#### 合併前

- [x] 設定 repo secret `UPDATE_SIGNING_KEY`
- [x] 確認 Ko-fi 連結（ko-fi.com/kevinyu1580）
- [ ] repo 改為 public 後，app 才能不帶 token 讀到 Releases API

## #27 chore: 刪除 HANDOFF.md 與程式註解裡的章節參照

merged 2026-11-08 · branch `chore-remove-handoff`

HANDOFF.md 是開發初期的需求訪談紀錄，公開 repo 後其他人不需要看，因此刪除。

- 刪除 `HANDOFF.md`
- 20 個檔案裡「(HANDOFF §x)」之類的章節參照改掉，需要時補上原本章節表達的意思
- 兩個 web 測試名稱拿掉章節編號
- 只改註解與測試名稱，不改行為

驗證：`make check` 全數通過。
