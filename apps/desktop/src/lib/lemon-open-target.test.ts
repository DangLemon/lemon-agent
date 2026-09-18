import { describe, expect, it } from 'vitest'

import {
  normalizeLemonOpenString,
  pathFromLemonDeepLink,
  pathFromOpenDeepLink,
  resolveInternalCompanyOpenPath,
  resolveLemonOpenPath
} from './lemon-open-target'

describe('normalizeLemonOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeLemonOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeLemonOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped lemon:// deep links to the same path', () => {
    expect(normalizeLemonOpenString('lemon://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeLemonOpenString('lemon://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps lemon://open/… deep links by stripping the open host', () => {
    expect(normalizeLemonOpenString('lemon://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeLemonOpenString('lemon://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved lemon kinds and unsafe paths', () => {
    expect(normalizeLemonOpenString('lemon://blueprint/morning-brief')).toBeNull()
    expect(normalizeLemonOpenString('lemon://plugin/install')).toBeNull()
    expect(normalizeLemonOpenString('https://example.com/x')).toBeNull()
    expect(normalizeLemonOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeLemonOpenString('index-network')).toBeNull()
  })
})

describe('resolveLemonOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveLemonOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveLemonOpenPath({ href: 'lemon://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('resolveInternalCompanyOpenPath', () => {
  it('preserves upstream deep links and filters harness routes', () => {
    const upstream = { allowedRoutes: new Set<string>(), mode: 'upstream' as const }
    const harness = { allowedRoutes: new Set(['/', '/artifacts', '/skills']), mode: 'harness' as const }

    expect(resolveInternalCompanyOpenPath('lemon://open/settings/plugins', upstream)).toBe('/settings/plugins')
    expect(resolveInternalCompanyOpenPath('lemon://open/settings/plugins', harness)).toBeNull()
    expect(resolveInternalCompanyOpenPath({ path: '/skills', params: { tab: 'mcp' } }, harness)).toBe('/skills?tab=mcp')
    expect(resolveInternalCompanyOpenPath('/artifacts', harness)).toBe('/artifacts')
  })
})

describe('pathFromLemonDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromLemonDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from lemon://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromLemonDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromLemonDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromLemonDeepLink('plugin', 'install')).toBeNull()
  })
})
