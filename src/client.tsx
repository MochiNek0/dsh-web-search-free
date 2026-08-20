import React, { useState, useEffect, useSyncExternalStore } from 'react'

export const inject = ['settings.plugin.item', 'settingsScope']

export function apply(ctx: any) {
  const scope = ctx.settingsScope.bind({ namespace: 'web-search-free' })

  ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'web-search-free',
    order: 60,
  }, () => {
    return React.createElement(WebSearchFreeCard, { scope })
  })
}

function WebSearchFreeCard({ scope }: { scope: any }) {
  const snapshot = useSyncExternalStore(
    (l: any) => scope.subscribe(l),
    () => scope.getSnapshot()
  )

  const [jina, setJina] = useState('')
  const [tavily, setTavily] = useState('')
  const [firecrawl, setFirecrawl] = useState('')
  const [exa, setExa] = useState('')
  const [brave, setBrave] = useState('')

  useEffect(() => {
    if (snapshot.value) {
      setJina(snapshot.value.jinaApiKey || '')
      setTavily(snapshot.value.tavilyApiKey || '')
      setFirecrawl(snapshot.value.firecrawlApiKey || '')
      setExa(snapshot.value.exaApiKey || '')
      setBrave(snapshot.value.braveApiKey || '')
    }
  }, [snapshot.value])

  if (snapshot.status === 'unavailable') return null
  if (snapshot.status === 'loading') return React.createElement('div', null, 'Loading settings...')

  const handleSave = () => {
    jina ? scope.set('jinaApiKey', jina) : scope.unset('jinaApiKey')
    tavily ? scope.set('tavilyApiKey', tavily) : scope.unset('tavilyApiKey')
    firecrawl ? scope.set('firecrawlApiKey', firecrawl) : scope.unset('firecrawlApiKey')
    exa ? scope.set('exaApiKey', exa) : scope.unset('exaApiKey')
    brave ? scope.set('braveApiKey', brave) : scope.unset('braveApiKey')
  }

  return React.createElement('div', { 
      style: { border: '1px solid var(--dsh-border, #e0e0e0)', padding: '16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--dsh-background, #fff)' } 
    },
    React.createElement('div', null, 
      React.createElement('h3', { style: { margin: '0 0 8px 0', fontSize: '16px' } }, 'Web Search Free'),
      React.createElement('p', { style: { margin: 0, fontSize: '13px', color: 'var(--dsh-text-secondary, #666)' } }, '配置各搜索引擎的 API Key')
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      renderInput('Jina API Key', jina, setJina),
      renderInput('Tavily API Key', tavily, setTavily),
      renderInput('Firecrawl API Key', firecrawl, setFirecrawl),
      renderInput('Exa API Key', exa, setExa),
      renderInput('Brave API Key', brave, setBrave)
    ),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } },
      React.createElement('button', { 
        onClick: handleSave,
        style: { padding: '6px 16px', background: 'var(--dsh-primary, #0066cc)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }
      }, '保存')
    )
  )
}

function renderInput(label: string, value: string, onChange: (v: string) => void) {
  return React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' } },
    React.createElement('span', null, label),
    React.createElement('input', {
      type: 'password',
      value,
      onChange: (e: any) => onChange(e.target.value),
      placeholder: '未配置',
      style: { padding: '8px', border: '1px solid var(--dsh-border, #ccc)', borderRadius: '4px' }
    })
  )
}
