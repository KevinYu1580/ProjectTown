import { hasWebKitHost, installBridge, installErrorForwarding, postToSwift } from './bridge'
import { SceneClock } from './scene/clock'
import { TownApp } from './scene/app'
import { DEFAULT_SCENE_SETTINGS } from './types'

const root = document.getElementById('app')
if (!root) throw new Error('#app not found')

if (hasWebKitHost()) {
  // WKWebView wallpaper: wait for Swift to push settings and state after `ready`.
  installErrorForwarding() // before TownApp, whose constructor throws when WebGL is unavailable
  const app = new TownApp({
    root,
    clock: new SceneClock(),
    seed: 1,
    settings: DEFAULT_SCENE_SETTINGS,
    onMessage: postToSwift,
  })
  installBridge(app)
  app.onFirstFrame = () => postToSwift({ type: 'ready' })
  app.start()
} else {
  void import('./mock/mockHost').then((m) => m.startMock(root))
}
