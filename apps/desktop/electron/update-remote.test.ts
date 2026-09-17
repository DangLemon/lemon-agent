/**
 * Tests for electron/update-remote.ts — the remote-detection helpers that
 * keep passive update checks off the SSH origin for official installs.
 *
 * Run with: node --test electron/update-remote.test.ts
 * (Wired into npm test:desktop:platforms in package.json.)
 *
 * Why this matters: a public install can carry
 * origin=git@github.com:DangLemon/lemon-agent.git. A background
 * `git fetch origin` then authenticates over SSH and, with a FIDO2/passkey
 * key, triggers an unexplained hardware-touch prompt. isOfficialSshRemote
 * must reliably recognize the official SSH remote (in every URL form,
 * case-insensitively) so the caller can swap in the anonymous HTTPS path —
 * while NOT misclassifying forks, other hosts, or the HTTPS remote (which
 * never prompts and should keep the normal fetch path).
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
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
} from './update-remote'

test('canonicalGitHubRemote normalizes SSH and HTTPS forms to the same value', () => {
  assert.equal(canonicalGitHubRemote('git@github.com:DangLemon/lemon-agent.git'), OFFICIAL_REPO_CANONICAL)
  assert.equal(canonicalGitHubRemote('git@github.com:DangLemon/lemon-agent'), OFFICIAL_REPO_CANONICAL)
  assert.equal(canonicalGitHubRemote('ssh://git@github.com/DangLemon/lemon-agent.git'), OFFICIAL_REPO_CANONICAL)
  assert.equal(canonicalGitHubRemote('https://github.com/DangLemon/lemon-agent.git'), OFFICIAL_REPO_CANONICAL)
  // Case-insensitive: an uppercased owner still canonicalizes to the same repo.
  assert.equal(canonicalGitHubRemote('git@github.com:danglemon/lemon-agent.git'), OFFICIAL_REPO_CANONICAL)
  // Trailing slashes are stripped.
  assert.equal(canonicalGitHubRemote('https://github.com/DangLemon/lemon-agent/'), OFFICIAL_REPO_CANONICAL)
})

test('canonicalGitHubRemote is empty for falsy input', () => {
  assert.equal(canonicalGitHubRemote(''), '')
  assert.equal(canonicalGitHubRemote(null), '')
  assert.equal(canonicalGitHubRemote(undefined), '')
})

test('isSshRemote detects scp-like and ssh:// forms only', () => {
  assert.equal(isSshRemote('git@github.com:DangLemon/lemon-agent.git'), true)
  assert.equal(isSshRemote('ssh://git@github.com/DangLemon/lemon-agent.git'), true)
  assert.equal(isSshRemote('https://github.com/DangLemon/lemon-agent.git'), false)
  assert.equal(isSshRemote(''), false)
  assert.equal(isSshRemote(null), false)
})

test('isOfficialSshRemote is true only for the official repo over SSH', () => {
  assert.equal(isOfficialSshRemote('git@github.com:DangLemon/lemon-agent.git'), true)
  assert.equal(isOfficialSshRemote('git@github.com:DangLemon/lemon-agent'), true)
  assert.equal(isOfficialSshRemote('ssh://git@github.com/DangLemon/lemon-agent.git'), true)
  // Case-insensitive owner/repo match.
  assert.equal(isOfficialSshRemote('git@github.com:danglemon/lemon-agent.git'), true)
})

test('isOfficialSshRemote does NOT match forks, other hosts, or HTTPS', () => {
  // A fork over SSH belongs to the user — fetching it is their own remote,
  // not the official upstream, so the SSH-avoidance swap must not apply.
  assert.equal(isOfficialSshRemote('git@github.com:someuser/lemon-agent.git'), false)
  // Same repo name on a different host is not the official repo.
  assert.equal(isOfficialSshRemote('git@gitlab.com:DangLemon/lemon-agent.git'), false)
  // HTTPS to the official repo never prompts for SSH/FIDO2, so it keeps the
  // normal fetch path — must not be flagged as an official SSH remote.
  assert.equal(isOfficialSshRemote('https://github.com/DangLemon/lemon-agent.git'), false)
  assert.equal(isOfficialSshRemote(''), false)
  assert.equal(isOfficialSshRemote(null), false)
})

test('OFFICIAL_REPO_HTTPS_URL canonicalizes to OFFICIAL_REPO_CANONICAL', () => {
  // Invariant: the URL we substitute in must be the same repo we detect.
  assert.equal(canonicalGitHubRemote(OFFICIAL_REPO_HTTPS_URL), OFFICIAL_REPO_CANONICAL)
})

test('GitHub repository helpers validate and build Lemon source URLs', () => {
  assert.equal(validateGitHubRepositoryIdentity('DangLemon/lemon-agent'), 'DangLemon/lemon-agent')
  assert.equal(githubRepositoryCanonical('DangLemon/lemon-agent'), 'github.com/danglemon/lemon-agent')
  assert.equal(githubRepositoryHttpsUrl('DangLemon/lemon-agent'), 'https://github.com/DangLemon/lemon-agent.git')
  assert.equal(isNonDefaultRepository('acme/custom-agent'), true)
  assert.equal(isNonDefaultRepository('DangLemon/lemon-agent'), false)
})

test('repository remote matching is driven by the configured owner/repo', () => {
  assert.equal(remoteMatchesRepository('https://github.com/DangLemon/lemon-agent.git', 'DangLemon/lemon-agent'), true)
  assert.equal(remoteMatchesRepository('git@github.com:DangLemon/lemon-agent.git', 'DangLemon/lemon-agent'), true)
  assert.equal(
    remoteMatchesRepository('https://github.com/NousResearch/hermes-agent.git', 'DangLemon/lemon-agent'),
    false
  )
  assert.equal(isSshRemoteForRepository('git@github.com:DangLemon/lemon-agent.git', 'DangLemon/lemon-agent'), true)
  assert.equal(
    isSshRemoteForRepository('https://github.com/DangLemon/lemon-agent.git', 'DangLemon/lemon-agent'),
    false
  )
})

test('repository identity rejects URLs and path traversal', () => {
  assert.throws(() => validateGitHubRepositoryIdentity('https://github.com/DangLemon/lemon-agent'), /sourceRepository/)
  assert.throws(() => validateGitHubRepositoryIdentity('../lemon-agent'), /sourceRepository/)
  assert.throws(() => validateGitHubRepositoryIdentity('DangLemon/lemon-agent.git'), /sourceRepository/)
})


test('update origin plan preserves matching SSH origins', () => {
  assert.deepEqual(
    planUpdateOriginRepository({
      originUrl: 'git@github.com:DangLemon/lemon-agent.git',
      sourceRepository: 'DangLemon/lemon-agent',
      updateRootHasGit: true
    }),
    {
      action: 'none',
      originUrl: 'git@github.com:DangLemon/lemon-agent.git',
      repository: 'DangLemon/lemon-agent'
    }
  )
})

test('update origin plan remaps mismatched origins to the configured repository', () => {
  assert.deepEqual(
    planUpdateOriginRepository({
      originUrl: 'https://github.com/NousResearch/hermes-agent.git',
      sourceRepository: 'acme/custom-agent',
      updateRootHasGit: true
    }),
    {
      action: 'set-url',
      args: [
        'remote',
        'set-url',
        'origin',
        'https://github.com/acme/custom-agent.git'
      ],
      expectedUrl: 'https://github.com/acme/custom-agent.git',
      originUrl: 'https://github.com/NousResearch/hermes-agent.git',
      repository: 'acme/custom-agent'
    }
  )
})

test('update origin plan adds a missing origin for a configured repository checkout', () => {
  assert.deepEqual(
    planUpdateOriginRepository({
      originUrl: '',
      sourceRepository: 'acme/custom-agent',
      updateRootHasGit: true
    }),
    {
      action: 'add',
      args: ['remote', 'add', 'origin', 'https://github.com/acme/custom-agent.git'],
      expectedUrl: 'https://github.com/acme/custom-agent.git',
      originUrl: '',
      repository: 'acme/custom-agent'
    }
  )
})

test('passive fetch reads configured source without mutating the checkout origin', async () => {
  const calls: Array<{ args: string[]; options: { cwd: string } }> = []

  const runGit = async (args: string[], options: { cwd: string }) => {
    calls.push({ args, options })

    return { code: 0, stdout: '', stderr: '' }
  }

  const result = await fetchConfiguredRepository({
    branch: 'main',
    cwd: '/workspace/developer-fork',
    runGit,
    sourceRepository: 'DangLemon/lemon-agent'
  })

  assert.deepEqual(calls, [
    {
      args: ['fetch', '--quiet', 'https://github.com/DangLemon/lemon-agent.git', 'main'],
      options: { cwd: '/workspace/developer-fork' }
    }
  ])
  assert.equal(result.repositoryUrl, 'https://github.com/DangLemon/lemon-agent.git')
  assert.equal(calls.some(call => call.args.includes('set-url')), false)
})
