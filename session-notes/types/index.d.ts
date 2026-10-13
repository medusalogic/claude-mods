export type Stats = { turns: number; tools: number; lastSeconds: number | null }

declare module 'claude-code' {
  interface PluginState {
    'session-notes': { stats: Stats; notes: string[]; checked: number[]; isHidden: boolean }
  }
}
