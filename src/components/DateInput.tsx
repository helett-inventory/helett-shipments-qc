import { inputCls } from './ui'

// The browser's own date / date-and-time input, with one change: pressing anywhere
// on the field opens the calendar, not just the small calendar icon.
export function DateInput({
  value,
  onChange,
  withTime,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  withTime?: boolean
  disabled?: boolean
}) {
  return (
    <input
      type={withTime ? 'datetime-local' : 'date'}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => {
        try {
          e.currentTarget.showPicker()
        } catch {
          /* not supported or not allowed here: the icon still works */
        }
      }}
      className={`${inputCls} cursor-pointer`}
    />
  )
}
