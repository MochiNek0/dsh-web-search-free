import * as React from 'react'

/**
 * Must equal the namespace the Host half registers: the Plugins settings tab
 * dispatches `settings.plugin.item` once per served namespace, using it as the
 * keyed slot's entry key.
 */
const NAMESPACE = 'web-search-free'

/** All backends the host half knows about; the order here is the default fallback. */
const PROVIDERS: { key: string; field: string; label: string }[] = [
  { key: 'jina', field: 'jinaApiKey', label: 'Jina AI' },
  { key: 'exa', field: 'exaApiKey', label: 'Exa (Metaphor)' },
  { key: 'tavily', field: 'tavilyApiKey', label: 'Tavily' },
  { key: 'firecrawl', field: 'firecrawlApiKey', label: 'Firecrawl' },
  { key: 'brave', field: 'braveApiKey', label: 'Brave Search' },
]
const DEFAULT_ORDER = PROVIDERS.map((p) => p.key)
const byKey = (key: string) => PROVIDERS.find((p) => p.key === key)!

// `settingsScope.bind` reads `connection` and `remote` off the CALLING context,
// so both must be declared here alongside the services this plugin uses itself.
export const inject = ['slots', 'settingsScope', 'connection', 'remote']

export function apply(ctx: any) {
  const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NAMESPACE,
    inject: () => ({ scope }),
  }, WebSearchFreeCard))
}

type Snapshot = {
  status: 'loading' | 'ready' | 'unavailable'
  value?: { jinaApiKey?: string; exaApiKey?: string; tavilyApiKey?: string; firecrawlApiKey?: string; braveApiKey?: string; providerOrder?: string[] }
  writable?: boolean
}

function WebSearchFreeCard({ scope }: { scope: any }) {
  const snapshot: Snapshot = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => scope.subscribe(listener), [scope]),
    () => scope.getSnapshot(),
  )
  const [open, setOpen] = React.useState(false)
  const [keyDrafts, setKeyDrafts] = React.useState<Record<string, string>>({})
  const [orderDraft, setOrderDraft] = React.useState<string[] | null>(null)
  const [dragKey, setDragKey] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState('')

  const storedKey = (field: string) => {
    const value = snapshot.value?.[field as keyof NonNullable<Snapshot['value']>]
    return typeof value === 'string' ? value : ''
  }
  const storedOrder = (): string[] => {
    const raw = snapshot.value?.providerOrder
    if (Array.isArray(raw) && raw.length > 0) return raw.filter((k) => PROVIDERS.some((p) => p.key === k))
    return DEFAULT_ORDER
  }
  const order = orderDraft ?? storedOrder()

  const keyDirty = PROVIDERS.filter((p) => p.field in keyDrafts && keyDrafts[p.field].trim() !== storedKey(p.field))
  const orderDirty = orderDraft !== null && JSON.stringify(orderDraft) !== JSON.stringify(storedOrder())
  const dirty = keyDirty.length > 0 || orderDirty
  const disabled = saving || snapshot.writable === false

  const save = async () => {
    setSaving(true)
    setFailed('')
    const pending = keyDirty.map((p) => ({ field: p.field, value: keyDrafts[p.field].trim() }))
    for (const { field, value } of pending) {
      if (value === '') await scope.unset(field)
      else await scope.set(field, value)
    }
    if (orderDirty && orderDraft !== null) await scope.set('providerOrder', orderDraft)
    // Writes swallow wire and revision failures and reload instead of throwing,
    // so the Host's readback is the only authority on what actually landed.
    const after = scope.getSnapshot()
    const rejectedKeys = pending.filter(({ field, value }) => (after.value?.[field as keyof NonNullable<Snapshot['value']> as string] ?? '') !== value)
    const orderLanded = JSON.stringify(after.value?.providerOrder ?? DEFAULT_ORDER) === JSON.stringify(orderDraft ?? storedOrder())
    setKeyDrafts(Object.fromEntries(rejectedKeys.map(({ field, value }) => [field, value])))
    if (!orderLanded) setOrderDraft(null)
    if (rejectedKeys.length > 0 || !orderLanded) setFailed('部分字段未保存成功，请重试。')
    setSaving(false)
  }

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrderDraft(next)
  }
  const indexOfKey = (key: string) => order.indexOf(key)

  const cardBody = () => {
    if (snapshot.status === 'loading') return [text('正在读取设置…')]
    if (snapshot.status === 'unavailable') return [text('该连接不同步设置，无法在此配置。')]
    const children: React.ReactNode[] = []
    children.push(
      React.createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } },
        '拖动每一行调整调用顺序：排在前面的引擎优先调用，失败则 fallback 到下一个。未填 Key 的引擎不进入调用链。'),
    )
    // One row per provider; the row's vertical position IS providerOrder, so the
    // key inputs double as the order controls — no separate list to render.
    children.push(
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        ...order.map((key, index) => {
          const provider = byKey(key)
          const hasKey = storedKey(provider.field) !== ''
          const isDragging = dragKey === key
          const isDropTarget = dropTarget === key
          return React.createElement('div', {
            key,
            draggable: !disabled,
            onDragStart: (e: any) => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; },
            onDragEnd: () => { setDragKey(null); setDropTarget(null) },
            onDragOver: (e: any) => { e.preventDefault(); if (dragKey && dragKey !== key) setDropTarget(key) },
            onDrop: (e: any) => {
              e.preventDefault()
              if (dragKey && dragKey !== key) reorder(indexOfKey(dragKey), index)
              setDragKey(null); setDropTarget(null)
            },
            style: {
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              borderRadius: 8, padding: '8px 10px',
              border: isDropTarget ? '1px dashed var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l2)',
              background: isDragging ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
              opacity: isDragging ? 0.5 : 1,
              cursor: disabled ? 'default' : 'grab',
            },
          },
            React.createElement('span', {
              style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, userSelect: 'none' },
            }, '⋮⋮'),
            React.createElement('span', {
              style: {
                whiteSpace: 'nowrap', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 500, lineHeight: '17px', flex: 'none',
                ...(hasKey
                  ? { background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)' }
                  : { color: 'var(--dsw-alias-label-tertiary)' }),
              },
            }, hasKey ? `#${index + 1}` : '—'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } },
              React.createElement('span', { style: { color: hasKey ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)', fontWeight: 500 } }, provider.label),
              React.createElement('input', {
                type: 'password',
                autoComplete: 'off',
                value: keyDrafts[provider.field] ?? storedKey(provider.field),
                disabled,
                placeholder: '未配置',
                onChange: (event: any) => setKeyDrafts({ ...keyDrafts, [provider.field]: event.target.value }),
                style: { ...inputStyle, height: 30 },
              }),
            ),
          )
        }),
      ),
    )
    children.push(
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 } },
        failed === '' ? null : React.createElement('span', {
          style: { flex: 1, minWidth: 0, fontSize: 12, color: 'var(--dsw-alias-label-error)' },
        }, failed),
        React.createElement('button', {
          type: 'button',
          disabled: disabled || !dirty,
          onClick: () => { setKeyDrafts({}); setOrderDraft(null); setFailed('') },
          style: { ...btnOutlineStyle, ...(disabled || !dirty ? { opacity: 0.4, cursor: 'default' } : {}) },
        }, '放弃'),
        React.createElement('button', {
          type: 'button',
          disabled: disabled || !dirty,
          onClick: save,
          style: { ...btnPrimaryStyle, ...(disabled || !dirty ? { opacity: 0.4, cursor: 'default' } : {}) },
        }, '保存'),
      ),
    )
    return children
  }

  return React.createElement('li', {
    style: {
      listStyle: 'none',
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
      transition: 'border-color .16s, background .16s',
    },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => setOpen(!open),
      style: {
        appearance: 'none', width: '100%', font: 'inherit', textAlign: 'left', cursor: 'pointer',
        background: 'none', border: '0', borderRadius: 12, color: 'inherit',
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
      },
    },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 2, minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, 'Web Search Free'),
          dirty ? React.createElement('span', {
            style: { whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 500, lineHeight: '17px' },
          }, '未保存') : null,
        ),
        React.createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, '免费多引擎 Web Search（拖动排序 · 按 providerOrder 顺序 fallback）'),
      ),
      React.createElement('span', {
        style: { color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s', transform: open ? 'rotate(180deg)' : 'none' },
      }, '▾'),
    ),
    open ? React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 16, margin: '0 16px 4px', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 },
    }, ...cardBody()) : null,
  )
}

const inputStyle = {
  height: 34,
  padding: '0 12px',
  font: 'inherit',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
}

const btnOutlineStyle = {
  font: 'inherit', fontSize: 13, padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
}

const btnPrimaryStyle = {
  font: 'inherit', fontSize: 13, padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid transparent', background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}

function text(value: string) {
  return React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, value)
}
