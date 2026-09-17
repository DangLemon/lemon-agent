import { loadHarnessConfigInput } from './internal-desktop-harness.mjs'

const TITLE_PLACEHOLDER = '%LEMON_DESKTOP_APP_TITLE%'
const ICON_PLACEHOLDER = '%LEMON_DESKTOP_APP_ICON%'

export function desktopHtmlTitleForEnv(env = process.env) {
  try {
    return loadHarnessConfigInput(env) ? 'Lemon AI' : 'Lemon AI'
  } catch {
    return 'Lemon AI'
  }
}

export function desktopHtmlTitlePlugin(env = process.env) {
  const title = desktopHtmlTitleForEnv(env)
  const icon = title === 'Lemon AI' ? 'lemon-apple-touch-icon.png' : 'apple-touch-icon.png'

  return {
    name: 'lemon:desktop-html-title',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replaceAll(TITLE_PLACEHOLDER, title).replaceAll(ICON_PLACEHOLDER, icon)
      }
    }
  }
}
