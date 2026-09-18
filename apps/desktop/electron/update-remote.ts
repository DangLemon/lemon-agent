/**
 * Pure helpers for choosing a remote URL during passive update checks.
 *
 * A public install can end up with `origin=git@github.com:DangLemon/lemon-agent.git`.
 * If the user's GitHub SSH key is FIDO2/passkey-backed, a background `git fetch
 * origin` triggers an unexplained hardware-touch prompt. For passive checks
 * against the official repo we substitute the public HTTPS `ls-remote` path,
 * which needs no auth and cannot prompt. Active update/apply flows are left
 * unchanged.
 *
 * Extracted from main.ts so the security-critical remote detection is unit
 * testable without booting Electron (main.ts requires('electron') at load).
 */

const OFFICIAL_REPO_IDENTITY = 'DangLemon/lemon-agent'

const GITHUB_REPOSITORY_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/

function validateGitHubRepositoryIdentity(sourceRepository) {
  if (sourceRepository === undefined || sourceRepository === null || sourceRepository === '') {
    return OFFICIAL_REPO_IDENTITY
  }

  if (typeof sourceRepository !== 'string' || !GITHUB_REPOSITORY_RE.test(sourceRepository)) {
    throw new Error('sourceRepository must be a GitHub owner/repo identity')
  }

  if (
    sourceRepository.includes('..') ||
    sourceRepository.endsWith('.git') ||
    sourceRepository.startsWith('-') ||
    /^(https?:|git@)/i.test(sourceRepository)
  ) {
    throw new Error('sourceRepository must be a safe GitHub owner/repo identity')
  }

  return sourceRepository
}

function githubRepositoryCanonical(sourceRepository) {
  return `github.com/${validateGitHubRepositoryIdentity(sourceRepository)}`.toLowerCase()
}

function githubRepositoryHttpsUrl(sourceRepository) {
  return `https://github.com/${validateGitHubRepositoryIdentity(sourceRepository)}.git`
}

const OFFICIAL_REPO_CANONICAL = githubRepositoryCanonical(OFFICIAL_REPO_IDENTITY)
const OFFICIAL_REPO_HTTPS_URL = githubRepositoryHttpsUrl(OFFICIAL_REPO_IDENTITY)

// Normalize common GitHub remote URL forms to `host/owner/repo` (lowercased,
// no trailing slash, no .git suffix) so SSH and HTTPS forms of the same repo
// compare equal.
function canonicalGitHubRemote(url) {
  if (!url) {
    return ''
  }

  let value = String(url).trim()

  if (value.startsWith('git@github.com:')) {
    value = `github.com/${value.slice('git@github.com:'.length)}`
  } else if (value.startsWith('ssh://git@github.com/')) {
    value = `github.com/${value.slice('ssh://git@github.com/'.length)}`
  } else {
    try {
      const parsed = new URL(value)

      if (parsed.hostname && parsed.pathname) {
        value = `${parsed.hostname}${parsed.pathname}`
      }
    } catch {
      // Leave non-URL forms unchanged.
    }
  }

  value = value.trim().replace(/\/+$/, '')

  if (value.endsWith('.git')) {
    value = value.slice(0, -4)
  }

  return value.toLowerCase()
}

function isSshRemote(url) {
  const value = String(url || '')
    .trim()
    .toLowerCase()

  return value.startsWith('git@') || value.startsWith('ssh://')
}

function isOfficialSshRemote(url) {
  return isSshRemote(url) && canonicalGitHubRemote(url) === OFFICIAL_REPO_CANONICAL
}

function remoteMatchesRepository(url, sourceRepository) {
  return canonicalGitHubRemote(url) === githubRepositoryCanonical(sourceRepository)
}

function isSshRemoteForRepository(url, sourceRepository) {
  return isSshRemote(url) && remoteMatchesRepository(url, sourceRepository)
}

function isNonDefaultRepository(sourceRepository) {
  return githubRepositoryCanonical(sourceRepository) !== OFFICIAL_REPO_CANONICAL
}

function planUpdateOriginRepository({
  originUrl = '',
  sourceRepository,
  updateRootHasGit = true,
  forceRemap = false
}) {
  const repository = validateGitHubRepositoryIdentity(sourceRepository)

  // Public default-repo installs leave origin alone (developer forks, leftover
  // Hermes remotes still fetch via fetchConfiguredRepository). Internal
  // Desktop matches `lemon update`: pin origin to the configured repo even
  // when that repo is DangLemon/lemon-agent.
  if ((!isNonDefaultRepository(repository) && !forceRemap) || !updateRootHasGit) {
    return { action: 'none', originUrl, repository }
  }

  if (remoteMatchesRepository(originUrl, repository)) {
    return { action: 'none', originUrl, repository }
  }

  const expectedUrl = githubRepositoryHttpsUrl(repository)

  return {
    action: originUrl ? 'set-url' : 'add',
    args: originUrl ? ['remote', 'set-url', 'origin', expectedUrl] : ['remote', 'add', 'origin', expectedUrl],
    expectedUrl,
    originUrl,
    repository
  }
}

async function fetchConfiguredRepository({ branch, cwd, runGit, sourceRepository }) {
  const repositoryUrl = githubRepositoryHttpsUrl(sourceRepository)
  const result = await runGit(['fetch', '--quiet', repositoryUrl, branch], { cwd })

  return { repositoryUrl, result }
}

export {
  canonicalGitHubRemote,
  fetchConfiguredRepository,
  githubRepositoryCanonical,
  githubRepositoryHttpsUrl,
  isNonDefaultRepository,
  isOfficialSshRemote,
  isSshRemote,
  isSshRemoteForRepository,
  OFFICIAL_REPO_CANONICAL,
  OFFICIAL_REPO_HTTPS_URL,
  planUpdateOriginRepository,
  remoteMatchesRepository,
  validateGitHubRepositoryIdentity
}
