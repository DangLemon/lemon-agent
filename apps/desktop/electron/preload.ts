import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.lemonDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('lemon:translucency:support')
const hudWindowing = ipcRenderer.sendSync('lemon:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true
const launchFlags = ipcRenderer.sendSync('lemon:launch-flags')

contextBridge.exposeInMainWorld('lemonDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  getConnection: profile => ipcRenderer.invoke('lemon:connection', profile),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('lemon:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('lemon:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('lemon:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('lemon:backend:touch', profile),
  getPoolLimits: () => ipcRenderer.invoke('lemon:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('lemon:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('lemon:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('lemon:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('lemon:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('lemon:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('lemon:window:openInTerminal', sessionId, opts),
  openWindow: () => ipcRenderer.invoke('lemon:window:openInstance'),
  openBrowserWindow: tabId => ipcRenderer.invoke('lemon:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('lemon:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('lemon:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('lemon:ambient:claim', key),
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('lemon:wake-indicator:get'),
    setState: state => ipcRenderer.send('lemon:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('lemon:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('lemon:wake-indicator:state', listener)
    }
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('lemon:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('lemon:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('lemon:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('lemon:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('lemon:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('lemon:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('lemon:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('lemon:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('lemon:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('lemon:hud:open', request),
    close: () => ipcRenderer.invoke('lemon:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('lemon:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('lemon:hud:begin-move'),
    endMove: () => ipcRenderer.send('lemon:hud:end-move'),
    moveBy: delta => ipcRenderer.send('lemon:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('lemon:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('lemon:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('lemon:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('lemon:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('lemon:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('lemon:hud:goto', listener)

      return () => ipcRenderer.removeListener('lemon:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('lemon:hud:changed', listener)

      return () => ipcRenderer.removeListener('lemon:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('lemon:hud:cursor', listener)

      return () => ipcRenderer.removeListener('lemon:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('lemon:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('lemon:hud:game-overlay', listener)
    }
  },
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('lemon:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('lemon:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('lemon:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('lemon:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('lemon:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('lemon:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('lemon:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('lemon:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('lemon:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('lemon:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('lemon:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('lemon:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('lemon:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('lemon:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('lemon:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('lemon:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('lemon:connections:list'),
    save: payload => ipcRenderer.invoke('lemon:connections:save', payload),
    remove: id => ipcRenderer.invoke('lemon:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('lemon:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('lemon:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('lemon:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('lemon:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('lemon:connections:update-managed', id),
    // Fan out `lemon update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('lemon:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:connections:changed', listener)

      return () => ipcRenderer.removeListener('lemon:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('lemon:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('lemon:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('lemon:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('lemon:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('lemon:connection-config:oauth-logout', remoteUrl),
  // Lemon AI Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('lemon:cloud:status'),
    login: () => ipcRenderer.invoke('lemon:cloud:login'),
    logout: () => ipcRenderer.invoke('lemon:cloud:logout'),
    discover: org => ipcRenderer.invoke('lemon:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('lemon:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    get: () => ipcRenderer.invoke('lemon:profile:get'),
    remember: name => ipcRenderer.invoke('lemon:profile:remember', name),
    set: name => ipcRenderer.invoke('lemon:profile:set', name)
  },
  api: request => ipcRenderer.invoke('lemon:api', request),
  notify: payload => ipcRenderer.invoke('lemon:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('lemon:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('lemon:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('lemon:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('lemon:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('lemon:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('lemon:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('lemon:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('lemon:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('lemon:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('lemon:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('lemon:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('lemon:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('lemon:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('lemon:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('lemon:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('lemon:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('lemon:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('lemon:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('lemon:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('lemon:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('lemon:capturePreview', payload),
  saveClipboardImage: () => ipcRenderer.invoke('lemon:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('lemon:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('lemon:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('lemon:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('lemon:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('lemon:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('lemon:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('lemon:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('lemon:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('lemon:keep-awake', on),
  setDisableF12: blocked => ipcRenderer.send('lemon:devtools:disable-f12', blocked),
  setPreviewShortcutActive: active => ipcRenderer.send('lemon:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('lemon:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: options => ipcRenderer.invoke('lemon:mcp-oauth:listen', options),
    wait: (id, timeoutMs) => ipcRenderer.invoke('lemon:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('lemon:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('lemon:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('lemon:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('lemon:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('lemon:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('lemon:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('lemon:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('lemon:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('lemon:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('lemon:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('lemon:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('lemon:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:zoom:changed', listener)

      return () => ipcRenderer.removeListener('lemon:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('lemon:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('lemon:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('lemon:logs:renderer-error', report),
  readDir: dirPath => ipcRenderer.invoke('lemon:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('lemon:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('lemon:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('lemon:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('lemon:fs:desktopPluginsRoot'),
  logsRoot: () => ipcRenderer.invoke('lemon:fs:logsRoot'),
  agentPluginsRoot: () => ipcRenderer.invoke('lemon:fs:agentPluginsRoot'),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('lemon:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('lemon:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('lemon:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('lemon:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('lemon:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('lemon:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('lemon:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('lemon:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('lemon:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('lemon:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('lemon:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('lemon:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('lemon:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('lemon:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('lemon:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('lemon:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('lemon:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('lemon:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('lemon:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('lemon:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('lemon:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('lemon:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('lemon:git:review:prList', repoPath, branches, numbers),
      fetchPrComment: (repoPath, url) => ipcRenderer.invoke('lemon:git:review:fetchPrComment', repoPath, url),
      createPr: repoPath => ipcRenderer.invoke('lemon:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('lemon:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('lemon:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('lemon:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('lemon:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('lemon:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('lemon:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `lemon:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `lemon:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('lemon:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('lemon:preview-nav', listener)

    return () => ipcRenderer.removeListener('lemon:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('lemon:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:open-updates', listener)

    return () => ipcRenderer.removeListener('lemon:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:deep-link', listener)

    return () => ipcRenderer.removeListener('lemon:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('lemon:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('lemon:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('lemon:plugin:installDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:window-state-changed', listener)

    return () => ipcRenderer.removeListener('lemon:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('lemon:focus-session', listener)

    return () => ipcRenderer.removeListener('lemon:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:notification-action', listener)

    return () => ipcRenderer.removeListener('lemon:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:notification-activate', listener)

    return () => ipcRenderer.removeListener('lemon:notification-activate', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('lemon:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:backend-exit', listener)

    return () => ipcRenderer.removeListener('lemon:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:connection:applied', listener)

    return () => ipcRenderer.removeListener('lemon:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:power-resume', listener)

    return () => ipcRenderer.removeListener('lemon:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('lemon:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('lemon:power-battery', listener)

    return () => ipcRenderer.removeListener('lemon:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:boot-progress', listener)

    return () => ipcRenderer.removeListener('lemon:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('lemon:bootstrap:get'),
  continueBootstrapLocal: () => ipcRenderer.invoke('lemon:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('lemon:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('lemon:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('lemon:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('lemon:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lemon:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('lemon:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('lemon:version'),
  relaunchApp: () => ipcRenderer.invoke('lemon:app:relaunch'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('lemon:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('lemon:uninstall:summary'),
    run: mode => ipcRenderer.invoke('lemon:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('lemon:updates:check'),
    apply: opts => ipcRenderer.invoke('lemon:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('lemon:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('lemon:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('lemon:updates:progress', listener)

      return () => ipcRenderer.removeListener('lemon:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('lemon:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('lemon:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('lemon:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('lemon:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('lemon:found-in-page', listener)

    return () => ipcRenderer.removeListener('lemon:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('lemon:open-find-bar', listener)

    return () => ipcRenderer.removeListener('lemon:open-find-bar', listener)
  }
})
