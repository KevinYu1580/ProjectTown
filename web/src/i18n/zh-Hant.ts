import type { MessageKey } from './index'

export const zhHant: Record<MessageKey, string> = {
  'state.running': '執行中',
  'state.waiting': '等你回應',
  'state.finished': '剛完成',
  'state.idle': '閒置',
  'state.sleeping': '睡著',
  'session.unnamed': '(session 無名稱)',
  'hud.sessionCount': '{n} 個 session',
  'hud.sessionCount.one': '{n} 個 session',
  'hud.moreProjects': '還有 {n} 個專案',
  'hud.moreProjects.one': '還有 {n} 個專案',
  'hud.dataSourceError': '找不到 Claude Code 的 session 資料',
  'empty.hint': '從 menubar 開啟設定，新增你的第一個專案',
  'camera.preset': '視角 {n}',
  'camera.reset': '重設',
  'camera.cancel': '取消',
  'camera.done': '完成',
  'camera.help': '拖曳旋轉・捲動縮放・右鍵或雙指拖曳平移',
}
