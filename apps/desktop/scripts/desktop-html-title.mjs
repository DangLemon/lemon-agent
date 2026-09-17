import { loadHarnessConfigInput } from './internal-desktop-harness.mjs'

const TITLE_PLACEHOLDER = '%LEMON_DESKTOP_APP_TITLE%'
const ICON_PLACEHOLDER = '%LEMON_DESKTOP_APP_ICON%'
const TITLE = 'Lemon AI'
const ICON = 'lemon-apple-touch-icon.png'

export function desktopHtmlTitleForEnv(env = process.env) {
  try {
    loadHarnessConfigInput(env)
  } catch {
    // Invalid harness input fails closed to the public Lemon AI title.
  }

  return TITLE
}

export function desktopHtmlTitlePlugin(env = process.env) {
  const title = desktopHtmlTitleForEnv(env)

  return {
    name: 'lemon:desktop-html-title',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replaceAll(TITLE_PLACEHOLDER, title).replaceAll(ICON_PLACEHOLDER, ICON)
      }
    }
  }
}
