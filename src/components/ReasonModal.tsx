import { useState } from 'react'
import { errText } from '../lib/supabase'
import { Btn, ErrorBox, Modal } from './ui'

export interface Change {
  label: string
  from: string
  to: string
}

// Second step of every edit: shows exactly what will change, and only then
// writes. Nothing is saved from the first step alone.
export function ReviewStep({
  changes,
  confirmLabel,
  tone = 'ink',
  onBack,
  onConfirm
}: {
  changes: Change[]
  confirmLabel: string
  tone?: 'ink' | 'danger'
  onBack?: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <div>
      {changes.length > 0 && (
        <ul className="border border-line rounded-lg bg-surface mb-4 overflow-hidden">
          {changes.map((c) => (
            <li key={c.label} className="px-3 py-2.5 border-t first:border-t-0 border-line text-sm">
              <span className="block text-muted text-[13px]">{c.label}</span>
              <span className="line-through text-muted">{c.from || 'empty'}</span> <span className="mx-1">to</span>
              <b>{c.to || 'empty'}</b>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2 mt-2">
        {onBack && (
          <Btn tone="line" onClick={onBack} disabled={busy}>
            Back
          </Btn>
        )}
        <Btn tone={tone} onClick={go} disabled={busy} className="flex-1">
          {busy ? 'Saving…' : confirmLabel}
        </Btn>
      </div>
    </div>
  )
}

// A plain confirm for one-tap actions (clear hold, cancel, reopen).
export function ConfirmModal({
  title,
  intro,
  confirmLabel,
  tone,
  onConfirm,
  onClose
}: {
  title: string
  intro?: string
  confirmLabel: string
  tone?: 'ink' | 'danger'
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {intro && <p className="text-sm mb-4">{intro}</p>}
      <ReviewStep
        changes={[]}
        confirmLabel={confirmLabel}
        tone={tone}
        onConfirm={async () => {
          await onConfirm()
          onClose()
        }}
      />
    </Modal>
  )
}
