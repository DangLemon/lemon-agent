import { useStore } from '@nanostores/react'
import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router'

import { $internalCompanyCapabilities } from '@/app/internal-company/store'
import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { SIDEBAR_NAV_AREA, type SidebarNavContribution } from '@/app/routes'
import { setSidebarPreviewPointer } from '@/components/pane-shell/tree/store'
import { Codicon } from '@/components/ui/codicon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { TipKeybindLabel } from '@/components/ui/tooltip'
import { useContributions } from '@/contrib/react/use-contributions'
import { matchesQuery } from '@/hooks/use-media-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $panesFlipped, $sidebarOpen } from '@/store/layout'
import { openRouteTile } from '@/store/route-tiles'
import type { SplitDir } from '@/store/session-states'

import {
  type AppView,
  ARTIFACTS_ROUTE,
  CRON_ROUTE,
  internalCompanyRouteAllowed,
  MESSAGING_ROUTE,
  NEW_CHAT_ROUTE,
  SETTINGS_ROUTE,
  SKILLS_ROUTE
} from '../../routes'
import type { SidebarNavItem } from '../../types'

import { CONTEXT_SPLIT_KIT, SplitSubmenu } from './split-submenu'

const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    id: 'chat',
    label: '',
    icon: props => <Codicon name="home" {...props} />,
    route: NEW_CHAT_ROUTE
  },
  {
    id: 'skills',
    label: '',
    icon: props => <Codicon name="symbol-misc" {...props} />,
    route: SKILLS_ROUTE,
    keybindActionId: 'nav.skills'
  },
  {
    id: 'messaging',
    label: '',
    icon: props => <Codicon name="comment" {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging'
  },
  {
    id: 'artifacts',
    label: '',
    icon: props => <Codicon name="files" {...props} />,
    route: ARTIFACTS_ROUTE,
    keybindActionId: 'nav.artifacts'
  },
  {
    id: 'cron',
    label: '',
    icon: props => <Codicon name="watch" {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron'
  }
]

const HARNESS_SIDEBAR_NAV: SidebarNavItem[] = [
  { id: 'chat', label: '', icon: props => <Codicon name="comment-discussion" {...props} />, route: NEW_CHAT_ROUTE },
  {
    id: 'skills',
    label: '',
    icon: props => <Codicon name="symbol-misc" {...props} />,
    route: SKILLS_ROUTE,
    keybindActionId: 'nav.skills'
  },
  {
    id: 'documents',
    label: '',
    icon: props => <Codicon name="files" {...props} />,
    route: ARTIFACTS_ROUTE,
    keybindActionId: 'nav.artifacts'
  },
  {
    id: 'schedule',
    label: '',
    icon: props => <Codicon name="calendar" {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron'
  },
  {
    id: 'settings',
    label: '',
    icon: props => <Codicon name="settings-gear" {...props} />,
    route: SETTINGS_ROUTE,
    keybindActionId: 'nav.settings'
  }
]

export function SidebarNavRail({ currentView, onNavigate }: SidebarNavRailProps) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const internalCompany = useStore($internalCompanyCapabilities)
  const harnessMode = internalCompany.mode === 'harness'
  const sidebarOpen = useStore($sidebarOpen)
  const panesFlipped = useStore($panesFlipped)
  const contributions = useContributions(SIDEBAR_NAV_AREA)

  const onChatPointerEnter = useCallback(() => {
    if (!sidebarOpen && !matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
      setSidebarPreviewPointer(panesFlipped ? 'right' : 'left', true)
    }
  }, [panesFlipped, sidebarOpen])

  const onChatPointerLeave = useCallback(() => {
    if (!sidebarOpen) {
      setSidebarPreviewPointer(panesFlipped ? 'right' : 'left', false)
    }
  }, [panesFlipped, sidebarOpen])

  const contributed = useMemo<SidebarNavItem[]>(
    () =>
      contributions.flatMap(item => {
        const data = item.data as Partial<SidebarNavContribution> | undefined

        return data?.path?.startsWith('/') && data.label && internalCompanyRouteAllowed(data.path, internalCompany)
          ? [
              {
                id: item.id,
                label: data.label,
                icon: props => <Codicon name={data.codicon || 'plug'} {...props} />,
                route: data.path
              }
            ]
          : []
      }),
    [contributions, internalCompany]
  )

  const items = [...(harnessMode ? HARNESS_SIDEBAR_NAV : SIDEBAR_NAV), ...contributed]
    .filter(item => item.id !== 'new-session')
    .filter(item => !item.route || internalCompanyRouteAllowed(item.route, internalCompany))

  return (
    <nav
      aria-label={t.titlebar.navigation}
      className="flex w-16 shrink-0 flex-col items-center overflow-y-auto bg-(--ui-sidebar-surface-background) py-2 [-webkit-app-region:no-drag]"
      data-sidebar-nav-rail=""
    >
      <SidebarMenu className="items-center gap-1">
        {items.map(item => {
          const title = harnessMode
            ? (t.internalWorkspace.nav[item.id as keyof typeof t.internalWorkspace.nav] ??
              t.sidebar.nav[item.id] ??
              item.label)
            : (t.sidebar.nav[item.id] ?? item.label)

          const active =
            (item.id === 'chat' && currentView === 'chat') ||
            (item.id === 'skills' && currentView === 'skills') ||
            (item.id === 'messaging' && currentView === 'messaging') ||
            (item.id === 'artifacts' && currentView === 'artifacts') ||
            (item.id === 'documents' && currentView === 'artifacts') ||
            (item.id === 'cron' && currentView === 'cron') ||
            (item.id === 'settings' && currentView === 'settings') ||
            (Boolean(item.route) && pathname === item.route)

          const button = (
            <SidebarMenuButton
              aria-label={title}
              className={cn(
                'mx-auto size-10 justify-center p-0 [-webkit-app-region:no-drag]',
                active && 'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) text-foreground'
              )}
              data-active={active || undefined}
              onClick={() => onNavigate(item)}
              onPointerEnter={item.id === 'chat' ? onChatPointerEnter : undefined}
              onPointerLeave={item.id === 'chat' ? onChatPointerLeave : undefined}
              tooltip={
                item.keybindActionId && !harnessMode
                  ? { children: <TipKeybindLabel actionId={item.keybindActionId} text={title} /> }
                  : title
              }
              type="button"
            >
              <item.icon className="size-4" />
            </SidebarMenuButton>
          )

          return (
            <SidebarMenuItem className="w-full" key={item.id}>
              {item.route ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                  <ContextMenuContent aria-label={title}>
                    <SplitSubmenu
                      kit={CONTEXT_SPLIT_KIT}
                      label={t.sidebar.row.openInSplit}
                      onSplit={(dir: SplitDir) => openRouteTile(item.route!, dir)}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                button
              )}
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}

interface SidebarNavRailProps {
  currentView: AppView
  onNavigate: (item: SidebarNavItem) => void
}
