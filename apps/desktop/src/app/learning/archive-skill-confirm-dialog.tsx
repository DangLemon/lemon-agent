import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { deleteLearningNode, type ProfileScope } from '@/lemon'
import { type Translations, useI18n } from '@/i18n'
import { type AppBrand, appBrandForEnv, replaceLemonBrandTerms } from '@/lib/app-brand'
import { notify } from '@/store/notifications'

export function notifySkillArchived(t: Translations): void {
  notify({ kind: 'success', message: t.skills.skillArchivedMessage, title: t.skills.skillArchivedTitle })
}

interface ArchiveSkillDialogCopy {
  confirmLabel: string
  description: string
  failureFallback: string
  title: (skillName: string) => string
}

export function archiveSkillDialogCopyForBrand(
  t: Translations,
  brand: AppBrand = appBrandForEnv()
): ArchiveSkillDialogCopy {
  const text = (value: string): string => replaceLemonBrandTerms(value, brand)

  if (brand.mode === 'upstream') {
    return {
      confirmLabel: t.skills.archive,
      description: t.skills.archiveSkillConfirmDescription,
      failureFallback: t.skills.archiveSkillFailed,
      title: t.skills.archiveSkillConfirmTitle
    }
  }

  return {
    confirmLabel: text(t.skills.archive),
    description: text(t.skills.archiveSkillConfirmDescription),
    failureFallback: text(t.skills.archiveSkillFailed),
    title: name => replaceLemonBrandTerms(t.skills.archiveSkillConfirmTitle(name), brand, [name])
  }
}

export async function archiveLearningSkill(
  id: string,
  profile?: ProfileScope,
  failureFallback = 'Archive failed'
): Promise<void> {
  const res = await deleteLearningNode(id, profile)

  if (!res.ok) {
    throw new Error(res.message || failureFallback)
  }
}

/** Fire-and-forget a mutation whose UI already applied optimistically; a failure just rolls it back + reports. */
export function fireOptimistic(action: Promise<void>, rollback: () => void, onFailure: (err: unknown) => void): void {
  void action.catch(err => {
    rollback()
    onFailure(err)
  })
}

interface ArchiveSkillConfirmDialogProps {
  /** Apply optimistic UI updates; return rollback if the background archive fails. */
  onApply: () => () => void
  onClose: () => void
  onFailure?: (err: unknown, skillName: string) => void
  onSuccess?: () => void
  open: boolean
  /** Capabilities profile-scope override — archive against THIS profile's
   *  backend; undefined/null keeps the app-wide active profile. */
  profile?: ProfileScope
  skillId: string
  skillName: string
}

/** Shared archive confirm for learned skills (capabilities page + memory graph). */
export function ArchiveSkillConfirmDialog({
  onApply,
  onClose,
  onFailure,
  onSuccess,
  open,
  profile,
  skillId,
  skillName
}: ArchiveSkillConfirmDialogProps) {
  const { t } = useI18n()
  const copy = archiveSkillDialogCopyForBrand(t)

  return (
    <ConfirmDialog
      confirmLabel={copy.confirmLabel}
      description={copy.description}
      destructive
      dismissOnConfirm
      onClose={onClose}
      onConfirm={() => {
        const rollback = onApply()

        fireOptimistic(
          archiveLearningSkill(skillId, profile, copy.failureFallback).then(() => {
            notifySkillArchived(t)
            onSuccess?.()
          }),
          rollback,
          err => onFailure?.(err, skillName)
        )
      }}
      open={open}
      title={copy.title(skillName)}
    />
  )
}
