import { useEffect, useId, useMemo, useRef, useState } from 'react'

interface SearchableSelectProps {
  options: string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  // Shows a "None" row at the top so the field can be emptied again.
  allowClear?: boolean
  onAddOption?: (name: string) => void
  addLabel?: string
  'aria-label'?: string
}

// Lists longer than this get a search box; short lists are just a list.
const SEARCH_FROM = 8

// The one dropdown used across the app. Fully keyboard operable:
//   closed:  Enter / Space / ArrowDown / ArrowUp open it, typing a letter opens it and starts a search
//   open:    ArrowUp / ArrowDown / Home / End move, Enter picks, Escape closes (focus returns to the field),
//            Tab closes and moves on
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled,
  allowClear,
  onAddOption,
  addLabel = '+ Add new...',
  'aria-label': ariaLabel
}: SearchableSelectProps) {
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  // Open upward when there is more room above than below.
  const [up, setUp] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const searchable = options.length >= SEARCH_FROM
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const found = options.filter((o) => o.toLowerCase().includes(q))
    return allowClear && !q ? ['', ...found] : found
  }, [options, search, allowClear])

  function openList(seed = '') {
    if (disabled) return
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      setUp(below < 340 && r.top > below)
    }
    setSearch(seed)
    const base = options.filter((o) => o.toLowerCase().includes(seed.toLowerCase()))
    const list = allowClear && !seed ? ['', ...base] : base
    const at = list.indexOf(value)
    setActive(at >= 0 ? at : 0)
    setOpen(true)
  }

  function close(returnFocus = true) {
    setOpen(false)
    setSearch('')
    if (returnFocus) triggerRef.current?.focus()
  }

  function pick(opt: string) {
    onChange(opt)
    close()
  }

  function handleAddNew() {
    const name = window.prompt('Enter new value')
    if (name && name.trim() && onAddOption) {
      onAddOption(name.trim())
      pick(name.trim())
    }
  }

  // outside click closes
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // focus: the search box when there is one, otherwise the list itself
  useEffect(() => {
    if (!open) return
    if (searchable) searchRef.current?.focus()
    else listRef.current?.focus()
  }, [open, searchable])

  // keep the highlighted row in view
  useEffect(() => {
    if (!open) return
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, uid])

  function onListKey(e: React.KeyboardEvent) {
    const last = rows.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => Math.min(last, a + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => Math.max(0, a - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(Math.max(0, last))
        break
      case 'Enter':
        e.preventDefault()
        if (rows.length > 0) pick(rows[Math.min(active, last)])
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation() // do not also close a dialog around this field
        close()
        break
      case 'Tab':
        close(false)
        break
      default:
        // short lists have no search box: typing jumps to the first row that starts with the letter
        if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const at = rows.findIndex((r) => r.toLowerCase().startsWith(e.key.toLowerCase()))
          if (at >= 0) setActive(at)
        }
    }
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    } else if (searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      openList(e.key)
    }
  }

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className="w-full min-h-[44px] px-3 rounded-lg text-[15px] text-left flex items-center justify-between gap-2 bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none disabled:bg-canvas disabled:text-muted"
      >
        <span className={`truncate ${value ? 'text-ink' : 'text-muted'}`}>{value || placeholder}</span>
        <svg className="w-4 h-4 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          className={`absolute z-30 w-full bg-surface rounded-lg shadow-lg ring-1 ring-black/5 overflow-hidden ${
            up ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          {searchable && (
            <div className="p-2 border-b border-line">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onListKey}
                placeholder="Type to search..."
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={rows.length ? `${uid}-opt-${Math.min(active, rows.length - 1)}` : undefined}
                aria-autocomplete="list"
                className="w-full min-h-[44px] px-3 rounded-lg bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink text-[15px] focus:outline-none"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={searchable ? -1 : 0}
            onKeyDown={searchable ? undefined : onListKey}
            aria-label={ariaLabel ?? placeholder}
            aria-activedescendant={!searchable && rows.length ? `${uid}-opt-${Math.min(active, rows.length - 1)}` : undefined}
            className="max-h-60 overflow-y-auto overscroll-contain focus:outline-none"
          >
            {rows.map((opt, i) => (
              <li
                key={opt || '__none'}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={opt === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(opt)}
                className={`px-3 py-2 min-h-[44px] flex items-center justify-between gap-2 text-[15px] cursor-pointer ${
                  i === active ? 'bg-canvas' : ''
                } ${opt === value ? 'font-semibold' : ''} ${opt ? '' : 'text-muted'}`}
              >
                <span className="truncate">{opt || 'None'}</span>
                {opt === value && opt !== '' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
          </ul>
          {onAddOption && (
            <button
              type="button"
              onClick={handleAddNew}
              className="w-full text-left px-3 py-2 min-h-[44px] text-sm font-medium border-t border-line hover:bg-canvas"
            >
              {addLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
