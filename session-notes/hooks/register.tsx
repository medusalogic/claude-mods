import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Stats } from '../types'

const PANE = 'session-notes'
const stats = atom(
  { plugin: 'session-notes', key: 'stats' } as const,
  { turns: 0, tools: 0, lastSeconds: null } as Stats,
)
const notes = atom({ plugin: 'session-notes', key: 'notes' } as const, [] as string[])
// Indexes into `notes` the person has ticked; emptied whenever notes are removed.
const checked = atom({ plugin: 'session-notes', key: 'checked' } as const, [] as number[])
const isHidden = atom({ plugin: 'session-notes', key: 'isHidden' } as const, false)

// Notes before they were per project lived under this one key.
const LEGACY_KEY = 'notes'

const asNotes = (value: unknown) =>
  Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : null

const storeKey = (dir: string) => {
  const path = dir.split('\\').join('/').replace(/\/+$/, '')
  return `notes:${/^[a-zA-Z]:/.test(path) ? path.toLowerCase() : path}`
}

// One store key per project: the repository root (the main tree's, for a worktree),
// else the working directory. Slashes and a Windows drive letter's case are normalised.
const projectKey = async ($: EngineInterface) => {
  const repo = await $.session.repo()
  return storeKey(repo?.root ?? (await $.session.cwd()))
}

// Every note change goes through here so the cross-session store never lags the live list.
const saveNotes = async ($: EngineInterface, fn: (list: string[]) => string[]) => {
  await update($, notes, fn)
  await $.store.set(await projectKey($), await read($, notes))
}

const fmt = (ms: number) => {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

type Bar = { label: string; percent: number; width: number; text: string; color: string }

// Only a bar the reader cannot place from its text keeps a label: the context bar and the 5h/7d windows have none.
const LIMIT_LABELS: Record<string, string> = { spend_limit: 'spend' }
// Space between stacked rows, in lines (0.5 is half a line where the surface supports fractions).
const ROW_GAP = 0.5
const WIDTH = 12
const WINDOW_WIDTH = 6

const drawBar = (percent: number, width: number) => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
const tone = (percent: number, warn = 60, error = 85) =>
  percent >= error ? 'error' : percent >= warn ? 'warning' : 'success'

const threshold = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const left = (ms: number) => {
  const mins = Math.max(0, Math.ceil(ms / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}
const DAY_MS = 24 * 3600_000
const decimal = (n: number) => String(Number(n.toFixed(1)))

// 5h window: decimal hours. 7d window: whole days, hours and minutes once under a day.
const remainingText = (kind: string, ms: number) => {
  if (kind === 'five_hour') return `${decimal(ms / 3600_000)}h`
  if (kind === 'seven_day' && ms >= DAY_MS) return `${Math.floor(ms / DAY_MS)}d`
  return left(ms)
}
const kilo = (n: number) => {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export const register: Register = (on, options) => {
  const warn = threshold(options.warnPercent, 60)
  const critical = threshold(options.errorPercent, 85)

  let turnStart = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'notes',
      description: 'Open the notes panel; `/notes text` adds a note',
    })

    await $.command.register({
      name: 'band',
      description: 'Show or hide the session stats band',
    })

    const key = await projectKey($)
    let saved = asNotes(await $.store.get(key))
    if (saved === null) {
      // Notes keyed by a subfolder before the key became the repository root move up once.
      const cwdKey = storeKey(await $.session.cwd())
      const fromCwd = cwdKey === key ? null : asNotes(await $.store.get(cwdKey))
      if (fromCwd !== null) {
        saved = fromCwd
        await $.store.set(key, fromCwd)
        await $.store.delete(cwdKey)
      }
    }
    if (saved === null) {
      // The first project to load adopts the old global notes, once.
      const legacy = asNotes(await $.store.get(LEGACY_KEY))
      if (legacy !== null) {
        saved = legacy
        await $.store.set(key, legacy)
        await $.store.delete(LEGACY_KEY)
      }
    }
    await update($, notes, () => saved ?? [])
    await update($, checked, () => [])

    return next(e)
  })

  on('command.run', { command: 'band' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)

    return { text: hidden ? 'Stats band shown.' : 'Stats band hidden.' }
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const text = e.args.trim()
    if (text) {
      await saveNotes($, list => [...list, text])
    }
    await $.ui.open({ id: PANE, title: 'Notes' })

    return { text: text ? 'Note added.' : 'Notes panel opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    turnStart = await $.clock.now()

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, stats, s => ({ ...s, tools: s.tools + 1 }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const seconds = turnStart ? Math.round(((await $.clock.now()) - turnStart) / 1000) : null
    await update($, stats, s => ({ ...s, turns: s.turns + 1, lastSeconds: seconds }))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const s = await read($, stats)
    const usage = await $.session.usage()
    const elapsed = fmt((await $.clock.now()) - usage.startedAt)
    const { context } = usage
    const now = await $.clock.now()
    const bars: Bar[] = []

    if (context.percent !== undefined) {
      const used = context.tokens === undefined ? '' : ` ${kilo(context.tokens)}/${kilo(context.window)}`
      bars.push({
        label: '',
        percent: context.percent,
        width: WIDTH,
        text: `${Math.round(context.percent)}%${used}`,
        color: tone(context.percent, warn, critical),
      })
    }
    for (const limit of usage.rateLimits) {
      if (!limit.resetsAt) continue
      const remaining = Math.max(0, Date.parse(limit.resetsAt) - now)
      bars.push({
        label: LIMIT_LABELS[limit.kind] ?? '',
        percent: limit.percentUsed,
        width: WINDOW_WIDTH,
        text: remainingText(limit.kind, remaining),
        color: tone(limit.percentUsed, warn, critical),
      })
    }

    const parts = [
      `${s.turns} turns`,
      `${s.tools} tool calls`,
      s.lastSeconds === null ? null : `last ${s.lastSeconds}s`,
      usage.cost ? `$${usage.cost.usd.toFixed(2)}` : null,
      elapsed,
    ].filter(Boolean)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" rowGap={ROW_GAP}>
        {bars.length > 0 && (
          <Box>
            {bars.map((bar, i) => (
              <Text key={`bar${i}`}>
                {bar.label !== '' && <Text dimColor>{bar.label} </Text>}
                <Text color={bar.color}>{drawBar(bar.percent, bar.width)} </Text>
                <Text>{bar.text}   </Text>
              </Text>
            ))}
          </Box>
        )}
        <Box justifyContent="space-between" width="100%">
          <Text dimColor>{parts.join(' · ')}</Text>
          <Box>
            <Button key="notes" label="Notes" onPress={() => $.ui.open({ id: PANE, title: 'Notes' })} />
            <Text> </Text>
            <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Input = 'Input' in els ? els.Input : null
    const list = await read($, notes)
    const ticked = await read($, checked)

    const clearChecked = async () => {
      const gone = await read($, checked)
      if (gone.length === 0) return
      await saveNotes($, l => l.filter((_, j) => !gone.includes(j)))
      await update($, checked, () => [])
    }

    // The whole tree is the pane's body: the engine scrolls it, so there is no window of my own.
    return (
      <Box flexDirection="column" rowGap={ROW_GAP} paddingY={1}>
        <Box>
          <Button key="toggle" label="Stats" onPress={() => update($, isHidden, h => !h)} />
          <Text> </Text>
          <Button key="clear" label="Clear" onPress={clearChecked} />
        </Box>
        {Input && (
          <Input
            // A new key per note count remounts the field empty after each add.
            key={`add${list.length}`}
            value=""
            placeholder="Add a note"
            submitLabel="+"
            onSubmit={(value: string) => {
              const text = value.trim()
              if (text) void saveNotes($, l => [...l, text])
            }}
          />
        )}
        {list.length === 0 && <Text dimColor>No notes yet.</Text>}
        {list.map((note, i) => (
          <Box key={`n${i}`}>
            <Button
              key={`box${i}`}
              plain
              label={ticked.includes(i) ? '✅' : '⬜'}
              onPress={() =>
                update($, checked, c => (c.includes(i) ? c.filter(j => j !== i) : [...c, i]))
              }
            />
            <Text>{note}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
