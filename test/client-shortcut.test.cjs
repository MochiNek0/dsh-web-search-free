const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = readFileSync(join(__dirname, '../src/client.tsx'), 'utf8')
const absent = Symbol('absent')

function eventTarget() {
  const listeners = new Map()
  return {
    innerWidth: 1200,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(fn)
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn)
    },
    dispatch(name, event) {
      for (const fn of listeners.get(name) ?? []) fn(event)
    },
    count(name) {
      return listeners.get(name)?.size ?? 0
    },
  }
}

// A narrow hook harness: no DOM renderer, host services, network, or state files.
function loadClient({ primitives = absent, extraField = false } = {}) {
  let frame
  function hook(init) {
    const index = frame.cursor++
    if (!(index in frame.hooks)) frame.hooks[index] = init()
    return frame.hooks[index]
  }
  const equalDeps = (a, b) =>
    a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  function memo(fn, deps) {
    const cell = hook(() => ({}))
    if (!equalDeps(cell.deps, deps)) {
      cell.value = fn()
      cell.deps = deps
    }
    return cell.value
  }
  function effect(fn, deps) {
    const cell = hook(() => ({}))
    if (!equalDeps(cell.deps, deps)) {
      cell.deps = deps
      frame.effects.push(() => {
        cell.cleanup?.()
        cell.cleanup = fn()
      })
    }
  }
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.length ? children : props?.children ? [props.children] : [],
    }),
    useSyncExternalStore: (_subscribe, read) => read(),
    useCallback: (fn, deps) => memo(() => fn, deps),
    useMemo: memo,
    useRef: value => hook(() => ({ current: value })),
    useState(value) {
      const owner = frame
      const cell = hook(() => ({ value }))
      return [cell.value, next => {
        const resolved = typeof next === 'function' ? next(cell.value) : next
        if (!Object.is(cell.value, resolved)) {
          cell.value = resolved
          owner.dirty = true
        }
      }]
    },
    useEffect: effect,
    useLayoutEffect: effect,
  }
  let input = source
  if (extraField) {
    assert.ok(input.includes('const SHORTCUT_FIELDS ='))
    input = input.replace('const SHORTCUT_FIELDS =',
      'ADVANCED.push({ field: "keylessYoucomSearch", kind: "toggle", def: false });\nconst SHORTCUT_FIELDS =')
  }
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  const window = eventTarget()
  const document = eventTarget()
  vm.runInNewContext(outputText + `
    exports.audit = { ADVANCED, SHORTCUT_FIELDS, shortcutOpen,
      WebSearchShortcutButton, WebSearchShortcutPanel };
  `, {
    exports, window, document,
    require(name) {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives' && primitives !== absent)
        return primitives
      throw new Error(`Missing host seed: ${name}`)
    },
  })
  function component(fn, props) {
    const owner = { hooks: [], cursor: 0, effects: [], dirty: false }
    return {
      render() {
        let tree
        for (let attempt = 0; attempt < 10; attempt++) {
          owner.cursor = 0
          owner.effects = []
          owner.dirty = false
          frame = owner
          tree = fn(props)
          frame = undefined
          for (const run of owner.effects) run()
          if (!owner.dirty) return tree
        }
        throw new Error('Hook harness did not settle')
      },
    }
  }
  return { ...exports, component, window, document }
}

function scope(value = {}) {
  return {
    getSnapshot: () => ({ value }),
    subscribe: () => () => {},
    set: () => { throw new Error('Unexpected host write') },
    unset: () => { throw new Error('Unexpected host write') },
  }
}

function anchor(right) {
  return {
    box: { right, bottom: 40 },
    contains(target) { return target === this },
    getBoundingClientRect() { return this.box },
  }
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  for (const child of tree.children ?? []) {
    const found = find(child, predicate)
    if (found) return found
  }
}

function mountButton(client, element, config = scope()) {
  const view = client.component(client.audit.WebSearchShortcutButton, { scope: config })
  const tree = view.render()
  tree.props.ref(element)
  return {
    view,
    ref: tree.props.ref,
    click() { find(view.render(), node => node.type === 'button').props.onClick() },
    expanded() {
      return find(view.render(), node => node.type === 'button').props['aria-expanded']
    },
  }
}

test('missing Tooltip module or export leaves the client and native button usable', () => {
  for (const primitives of [absent, {}, null]) {
    const client = loadClient({ primitives })
    assert.equal(typeof client.apply, 'function')
    const view = client.component(client.audit.WebSearchShortcutButton, { scope: scope() })
    const tree = view.render()
    const button = find(tree, node => node.type === 'button')
    assert.equal(tree.children[0], button)
    assert.equal(button.props.title, button.props['aria-label'])
    const element = anchor(900)
    tree.props.ref(element)
    button.props.onClick()
    assert.equal(client.audit.shortcutOpen.getAnchor(), element)
  }
})

test('available Tooltip keeps host styling, delay, and a required child', () => {
  const Tooltip = () => null
  const client = loadClient({ primitives: { Tooltip } })
  const view = client.component(client.audit.WebSearchShortcutButton, { scope: scope() })
  const tree = view.render()
  const tooltip = find(tree, node => node.type === Tooltip)
  assert.equal(tooltip.props.side, 'bottom')
  assert.equal(tooltip.props.delayMs, 500)
  assert.equal(tooltip.props.portal, true)
  assert.equal(tooltip.props.children.type, 'button')
  assert.equal(tooltip.props.children.props.title, undefined)
})

test('shortcut fields derive from ADVANCED and include future non-domain fields', () => {
  for (const extraField of [false, true]) {
    const { audit } = loadClient({ extraField })
    assert.deepEqual(
      Array.from(audit.SHORTCUT_FIELDS, spec => spec.field),
      Array.from(audit.ADVANCED).filter(spec => spec.kind !== 'domains').map(spec => spec.field),
    )
    assert.equal(audit.SHORTCUT_FIELDS.some(spec => spec.field === 'keylessYoucomSearch'), extraField)
    assert.equal(audit.ADVANCED.find(spec => spec.field === 'headerButton').def, true)
  }
  const client = loadClient({ extraField: true })
  const button = mountButton(client, anchor(900))
  const panel = client.component(client.audit.WebSearchShortcutPanel, { scope: scope() })
  button.click()
  assert.ok(find(panel.render(), node => node.props?.key === 'keylessYoucomSearch'))
})

test('click selects its own column, switches owners, and updates expanded state', () => {
  const client = loadClient()
  const a = anchor(500), b = anchor(1000)
  const first = mountButton(client, a), second = mountButton(client, b)
  assert.equal(client.audit.shortcutOpen.getAnchor(), null)
  first.click()
  assert.equal(client.audit.shortcutOpen.getAnchor(), a)
  assert.equal(first.expanded(), true)
  assert.equal(second.expanded(), false)
  second.click()
  assert.equal(client.audit.shortcutOpen.getAnchor(), b)
  assert.equal(first.expanded(), false)
  assert.equal(second.expanded(), true)
  second.click()
  assert.equal(client.audit.shortcutOpen.getAnchor(), null)
})

test('only detaching the active button closes the panel and emits a change', () => {
  const client = loadClient()
  const a = anchor(500), b = anchor(1000)
  const first = mountButton(client, a), second = mountButton(client, b)
  let changes = 0
  const unsubscribe = client.audit.shortcutOpen.subscribe(() => changes++)
  first.click()
  second.ref(null)
  second.ref(b)
  assert.equal(client.audit.shortcutOpen.getAnchor(), a)
  assert.equal(changes, 1)
  first.ref(null)
  assert.equal(client.audit.shortcutOpen.getAnchor(), null)
  assert.equal(changes, 2)
  unsubscribe()
  second.click()
  assert.equal(changes, 2)
})

test('panel remeasures on owner switch, resize, and scroll; close cleans listeners', () => {
  const client = loadClient()
  const a = anchor(500), b = anchor(1000)
  const first = mountButton(client, a), second = mountButton(client, b)
  const panel = client.component(client.audit.WebSearchShortcutPanel, { scope: scope() })
  assert.equal(panel.render(), null)
  first.click()
  assert.equal(panel.render().props.style.right, 700)
  second.click()
  const tree = panel.render()
  assert.equal(tree.props.style.right, 200)
  assert.equal(tree.props.style.visibility, 'visible')
  assert.equal(client.window.count('resize'), 1)
  b.box = { right: 1100, bottom: 70 }
  client.window.dispatch('resize')
  assert.equal(panel.render().props.style.right, 100)
  b.box.bottom = 80
  client.window.dispatch('scroll')
  assert.equal(panel.render().props.style.top, 86)
  second.ref(null)
  assert.equal(panel.render(), null)
  assert.equal(client.window.count('resize'), 0)
  assert.equal(client.window.count('scroll'), 0)
  assert.equal(client.document.count('mousedown'), 0)
  assert.equal(client.document.count('keydown'), 0)
})

test('outside press can transfer to another button; active anchor and panel are exempt', () => {
  const client = loadClient()
  const a = anchor(500), b = anchor(1000)
  const first = mountButton(client, a), second = mountButton(client, b)
  const panel = client.component(client.audit.WebSearchShortcutPanel, { scope: scope() })
  first.click()
  const tree = panel.render()
  const panelElement = anchor(0)
  tree.props.ref.current = panelElement
  client.document.dispatch('mousedown', { target: a })
  client.document.dispatch('mousedown', { target: panelElement })
  assert.equal(client.audit.shortcutOpen.getAnchor(), a)
  client.document.dispatch('mousedown', { target: b })
  assert.equal(client.audit.shortcutOpen.getAnchor(), null)
  second.click()
  assert.equal(panel.render().props.style.right, 200)
  client.document.dispatch('keydown', { key: 'Escape' })
  assert.equal(panel.render(), null)
})

test('draft strategy survives close and controls parallel-engine visibility', () => {
  const client = loadClient()
  const button = mountButton(client, anchor(900))
  const panel = client.component(client.audit.WebSearchShortcutPanel, { scope: scope() })
  button.click()
  let tree = panel.render()
  const byId = id => node => node.props?.id === id
  assert.equal(find(tree, byId('wsf-pop-parallelEngines')), undefined)
  find(tree, byId('wsf-pop-searchStrategy')).props.onChange({ target: { value: 'race' } })
  tree = panel.render()
  assert.ok(find(tree, byId('wsf-pop-parallelEngines')))
  button.click()
  assert.equal(panel.render(), null)
  button.click()
  tree = panel.render()
  assert.equal(find(tree, byId('wsf-pop-searchStrategy')).props.value, 'race')
})

test('stored headerButton false hides the button, while an unset value defaults on', () => {
  const client = loadClient()
  const hidden = client.component(client.audit.WebSearchShortcutButton, {
    scope: scope({ headerButton: false }),
  })
  assert.equal(hidden.render(), null)
  const visible = client.component(client.audit.WebSearchShortcutButton, { scope: scope() })
  assert.ok(find(visible.render(), node => node.type === 'button'))
})
