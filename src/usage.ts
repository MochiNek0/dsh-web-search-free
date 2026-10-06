/** One (engine, key)'s record for one capability. */
export interface Tally {
  calls: number
  ok: number
  failed: number
  /** Sum over every call, for the average the card shows. */
  totalMs: number
  lastOkAt?: number
  lastError?: string
  lastErrorAt?: number
}

const emptyTally = (): Tally => ({ calls: 0, ok: 0, failed: 0, totalMs: 0 })

/**
 * Call counts per (engine, key) since this plugin instance started, kept in
 * memory only — the card labels them "since start", and a restart or reload
 * resets them. Raw keys are map keys here and never leave this process: the
 * snapshot the card receives carries masked keys only.
 */
export class UsageStats {
  readonly since = Date.now()
  readonly cacheHits = { search: 0, fetch: 0 }
  private readonly entries = new Map<string, { search: Tally; fetch: Tally }>()

  /**
   * Count one finished attempt.
   * @param error - the failure message; absent for a success.
   */
  record(engine: string, key: string, kind: 'search' | 'fetch', ms: number, error?: string): void {
    const id = `${engine}:${key}`
    let entry = this.entries.get(id)
    if (!entry) this.entries.set(id, (entry = { search: emptyTally(), fetch: emptyTally() }))
    const tally = entry[kind]
    tally.calls += 1
    tally.totalMs += ms
    if (error === undefined) {
      tally.ok += 1
      tally.lastOkAt = Date.now()
    } else {
      tally.failed += 1
      tally.lastError = error
      tally.lastErrorAt = Date.now()
    }
  }

  cacheHit(kind: 'search' | 'fetch'): void {
    this.cacheHits[kind] += 1
  }

  has(engine: string, key: string): boolean {
    return this.entries.has(`${engine}:${key}`)
  }

  /** Both tallies for one (engine, key), zeroed when it has not been called yet. */
  tallies(engine: string, key: string): { search: Tally; fetch: Tally } {
    const entry = this.entries.get(`${engine}:${key}`)
    return entry
      ? { search: { ...entry.search }, fetch: { ...entry.fetch } }
      : { search: emptyTally(), fetch: emptyTally() }
  }
}
