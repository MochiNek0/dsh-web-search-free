#!/usr/bin/env node
/**
 * Publish gate.
 *
 * Every check here guards a failure that can ONLY appear on someone else's
 * machine — the class a local `pnpm build` can never surface, because this
 * package is installed *beside* a dsh profile and must resolve every host
 * service to the ONE instance the running harness already loaded.
 *
 * Run by `prepublishOnly`; also runnable on its own via `pnpm run check`.
 */
const { builtinModules } = require('node:module')
const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join, relative } = require('node:path')

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []

/**
 * `@deepseek-ai/*` packages that may sit in `dependencies`.
 *
 * The bar is: does a second copy of it change behaviour? Schemastery is a pure
 * value transformer — `Config` is handed to the host's `settings.register`,
 * which only ever calls it (`dsh-settings` contains no `instanceof` at all), so
 * two copies of the same version are indistinguishable. The official
 * `dsh-web-search-deepseek` vendors it exactly this way.
 *
 * Everything else in that scope carries Cordis Service identity or a shared
 * error class, and a private copy silently breaks the harness (the
 * `dsh-excel-chat` failure mode dshmarket's diagnostics names: the plugin's
 * copy hoists to the profile root and shadows the host's).
 */
const DEPENDABLE_SCOPED = new Set(['@deepseek-ai/schemastery'])

/** Specifiers the browser module loader answers from its own seed table, never npm. */
const CLIENT_SEED = new Set(['react'])

// 1. No host package may enter `dependencies`.
for (const name of Object.keys(pkg.dependencies ?? {})) {
  if (name.startsWith('@deepseek-ai/') && !DEPENDABLE_SCOPED.has(name)) {
    problems.push(`dependencies: "${name}" is a host package — a private copy shadows the harness's own under a hoisted node_modules. Make it an optional peer, or drop it if nothing imports it.`)
  }
}

// 2. Host peers must be optional, or pnpm auto-installs them (auto-install-peers
//    defaults to true, and a freshly scaffolded dsh profile ships no .npmrc) and
//    we are back at check 1 by another route.
for (const name of Object.keys(pkg.peerDependencies ?? {})) {
  if (!name.startsWith('@deepseek-ai/')) continue
  if (pkg.peerDependenciesMeta?.[name]?.optional !== true) {
    problems.push(`peerDependencies: "${name}" must be marked optional in peerDependenciesMeta — pnpm auto-installs non-optional peers into the profile.`)
  }
}

// 3+4. The built artifacts and the declared dependencies must agree, both ways.
const distFiles = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith('.js')) distFiles.push(path)
  }
}
walk(join(root, 'dist'))

const imported = new Set()
for (const path of distFiles) {
  const source = readFileSync(path, 'utf8')
  for (const match of source.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    // Strip a subpath: "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg".
    const parts = spec.split('/')
    imported.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
  }
}

const declared = new Set(Object.keys(pkg.dependencies ?? {}))
for (const spec of imported) {
  if (spec.startsWith('node:') || builtinModules.includes(spec)) continue
  if (declared.has(spec) || CLIENT_SEED.has(spec)) continue
  problems.push(`dist imports "${spec}" but nothing declares it — it will be missing wherever this is installed.`)
}
for (const name of declared) {
  if (!imported.has(name)) {
    problems.push(`dependencies: "${name}" is declared but never imported by dist — dead weight that still drags its whole tree into every profile.`)
  }
}

// 5. Condition order: "default" always matches, so anything after it is dead.
for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
  if (typeof conditions !== 'object' || conditions === null) continue
  const keys = Object.keys(conditions)
  const fallback = keys.indexOf('default')
  if (fallback !== -1 && fallback !== keys.length - 1) {
    problems.push(`exports["${subpath}"]: "default" must come last — ${keys.slice(fallback + 1).join(', ')} can never be selected.`)
  }
}

// 6. The client half is only loadable if wrap-client.cjs actually ran over it.
if (!readFileSync(join(root, 'dist', 'client.js'), 'utf8').includes('window.__ModuleLoader__.load')) {
  problems.push('dist/client.js is not wrapped for the browser module loader — run the build.')
}

if (problems.length > 0) {
  console.error(`check-package: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.error(`check-package: ok (${distFiles.map((p) => relative(root, p)).length} built files, ${declared.size} runtime dependencies)`)
