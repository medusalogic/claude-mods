import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'session-notes'

// The engine's session answers a real session would give, so the band and the store key resolve.
const answerSession = (on: On) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: 'E:/proj' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({
    value: {
    startedAt: 0,
    context: { tokens: 48_000, window: 1_000_000, percent: 5 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41, resetsAt: new Date(3 * 3600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 9, resetsAt: new Date(5.5 * 24 * 3600_000).toISOString() },
    ],
    cost: { usd: 0.42 },
    },
  }))
}

test('notes: add, tick and clear', async ($, on) => {
  answerSession(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: {} as never,
      requestId: PLUGIN,
    })

    // The add field's key changes with the note count, which is what clears it.
    const field = async () => (await ui.find({ type: 'Input' }))?.key as string
    const first = await field()
    await ui.input({ key: first, text: 'buy milk' })
    expect(await field()).not.toBe(first)
    await ui.input({ key: await field(), text: 'call mum' })

    expect((await ui.find({ key: 'box0' }))?.props.label).toBe('⬜')
    expect(await ui.find({ type: 'Text', text: /buy milk/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /call mum/ })).toBeDefined()

    await ui.press({ key: 'box0' })
    expect((await ui.find({ key: 'box0' }))?.props.label).toBe('✅')

    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /buy milk/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /call mum/ })).toBeDefined()

    await ui.press({ key: 'box0' })
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /call mum/ })).toBeUndefined()

    await ui.unmount()
  }
})

test('band: bars and stats row render', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 } as never,
  })

  expect(await ui.find({ type: 'Text', text: /turns/ })).toBeDefined()
  expect(await ui.find({ key: 'notes' })).toBeDefined()
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()
})

test('add row sits under Stats and Clear, above the notes', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'Pane',
    props: {} as never,
    requestId: PLUGIN,
  })
  const field = async () => (await ui.find({ type: 'Input' }))?.key as string
  await ui.input({ key: await field(), text: 'first note' })
  await ui.input({ key: await field(), text: 'second note' })

  const tree = JSON.stringify(await ui.drawn())
  const at = (needle: string) => tree.indexOf(needle)
  expect(at('"key":"toggle"')).toBeLessThan(at('"type":"Input"'))
  expect(at('"key":"clear"')).toBeLessThan(at('"type":"Input"'))
  expect(at('"type":"Input"')).toBeLessThan(at('first note'))
  expect(at('first note')).toBeLessThan(at('second note'))
  await ui.unmount()
})
