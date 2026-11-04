// Browsers use the page title as the default file name when saving a PDF, so set it to something unique:
// FBA-ID_Type_YYYY-MM-DD_HHMM, then put the old title back once the print dialog closes.
const pad = (n: number) => String(n).padStart(2, '0')

export function fileStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

export function printAs(...parts: (string | null | undefined)[]) {
  const name = [...parts.filter(Boolean), fileStamp()].join('_').replace(/[\/:*?"<>|\s]+/g, '-')
  const old = document.title
  document.title = name
  const restore = () => {
    document.title = old
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}
