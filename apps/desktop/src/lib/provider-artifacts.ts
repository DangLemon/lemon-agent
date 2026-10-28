import type { SessionOwnerScope } from '@/store/session-request-router'

export async function downloadProviderArtifact(
  artifactId: string,
  sessionId: string,
  suggestedName: string,
  owner: SessionOwnerScope
): Promise<{ canceled?: boolean; path?: string; saved: boolean }> {
  const bridge = window.lemonDesktop?.saveProviderArtifact

  if (!bridge) {
    throw new Error('Desktop provider artifact bridge is unavailable')
  }

  if (!owner || owner === null) {
    throw new Error('Provider artifact owner is unavailable')
  }

  const route = typeof owner === 'string'
    ? { connectionId: undefined, profile: owner }
    : { connectionId: owner.connectionId, profile: owner.profile, targetProfile: owner.targetProfile }

  return bridge({
    artifactId,
    connectionId: route.connectionId,
    profile: route.targetProfile || route.profile,
    sessionId,
    suggestedName
  })
}
