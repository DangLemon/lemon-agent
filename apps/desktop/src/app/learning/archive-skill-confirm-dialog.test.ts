import { describe, expect, it, vi } from 'vitest'

import { TRANSLATIONS } from '@/i18n/catalog'
import { lemonAppBrand, upstreamAppBrand } from '@/lib/app-brand'

import { archiveLearningSkill, archiveSkillDialogCopyForBrand } from './archive-skill-confirm-dialog'

vi.mock('@/lemon', () => ({
  deleteLearningNode: vi.fn()
}))

describe('archiveSkillDialogCopyForBrand', () => {
  it('preserves upstream archive copy and the Lemon AI CLI restore command', () => {
    const copy = archiveSkillDialogCopyForBrand(TRANSLATIONS.en, upstreamAppBrand)

    expect(copy.confirmLabel).toBe('Archive')
    expect(copy.description).toBe('The skill is archived and can be restored with `lemon curator restore`.')
    expect(copy.title('research')).toBe('Archive research?')
  })

  it('uses Vietnamese internal copy while preserving the Lemon AI CLI restore command', () => {
    const copy = archiveSkillDialogCopyForBrand(TRANSLATIONS.vi, lemonAppBrand)
    const combined = [copy.confirmLabel, copy.description, copy.failureFallback, copy.title('research')].join('\n')

    expect(copy.confirmLabel).toBe('Lưu trữ')
    expect(copy.description).toContain('`lemon curator restore`')
    expect(copy.title('research')).toBe('Lưu trữ research?')
    expect(combined).not.toContain('Archive')
  })

  it('preserves the skill name when internal archive titles apply Lemon branding', () => {
    const copy = archiveSkillDialogCopyForBrand(TRANSLATIONS.en, lemonAppBrand)

    expect(copy.title('Lemon AI Research')).toBe('Archive Lemon AI Research?')
  })

  it('uses the active Japanese locale for Lemon archive copy', () => {
    const copy = archiveSkillDialogCopyForBrand(TRANSLATIONS.ja, lemonAppBrand)
    const combined = [copy.confirmLabel, copy.description, copy.failureFallback, copy.title('research')].join('\n')

    expect(copy.confirmLabel).toBe('アーカイブ')
    expect(copy.description).toContain('lemon curator restore')
    expect(copy.title('research')).toBe('research をアーカイブしますか？')
    expect(combined).not.toContain('Lưu trữ')
    expect(combined).not.toContain('Archive')
  })

  it.each([
    ['zh-hant', '封存 demo？', '封存失敗'],
    ['ru', 'Отправить demo в архив?', 'Не удалось отправить в архив'],
    ['ar', 'أرشفة demo؟', 'فشلت الأرشفة']
  ] as const)('keeps %s archive dialog copy localized', (locale, title, failureFallback) => {
    const copy = archiveSkillDialogCopyForBrand(TRANSLATIONS[locale], lemonAppBrand)
    const combined = [copy.confirmLabel, copy.description, copy.failureFallback, copy.title('demo')].join('\n')

    expect(copy.title('demo')).toBe(title)
    expect(copy.failureFallback).toBe(failureFallback)
    expect(copy.description).toContain('lemon curator restore')
    expect(combined).not.toContain('Archive')
  })
})

describe('archiveLearningSkill', () => {
  it('preserves backend error messages instead of branding runtime text', async () => {
    const { deleteLearningNode } = await import('@/lemon')

    vi.mocked(deleteLearningNode).mockResolvedValueOnce({
      message: 'Lemon AI backend refused archive',
      ok: false
    })

    await expect(archiveLearningSkill('skill-1', undefined, 'Không thể lưu trữ')).rejects.toThrow(
      'Lemon AI backend refused archive'
    )
  })

  it('uses the provided static fallback when the backend omits a message', async () => {
    const { deleteLearningNode } = await import('@/lemon')

    vi.mocked(deleteLearningNode).mockResolvedValueOnce({ message: '', ok: false })

    await expect(archiveLearningSkill('skill-1', undefined, 'Không thể lưu trữ')).rejects.toThrow('Không thể lưu trữ')
  })
})
