# session-notes

A mod for Claude Code and the Claude desktop app. It adds a stats band above the prompt and a
notes panel.

## What it adds

**Stats band** (above the prompt)

- A context bar, with tokens used out of the window (`48k/1M`).
- A bar for each rate-limit window the account reports (the 5h and 7d windows), filled by the
  share used, with the time left until it resets: decimal hours for 5h, whole days for 7d and
  hours and minutes once under a day.
- Turns, tool calls, last turn time, cost and elapsed session time.
- Notes and Hide buttons.
- Bars turn yellow and red at configurable thresholds.

**Notes panel**

- Stats and Clear buttons on the top row, an add field under them, then the notes.
- Each note has a checkbox. Clear removes every checked note.
- Notes persist across sessions, per repository (per working directory outside a repository).
  Sessions in the same repository share them, including its git worktrees.

## Install

In a terminal session:

```
/plugin install session-notes --marketplace medusalogic/claude-mods
```

Answer `y` to add the marketplace, then choose a scope. The mod is active at once, and in every
session started after at the user scope.

The install command is a terminal session's. A session the desktop app starts for its Code tab
answers that it is not available there; a mod installed from a terminal at the user scope loads
there too and draws for the desktop surface.

## Commands

| Command | What it does |
| --- | --- |
| `/notes` | Opens the notes panel |
| `/notes some text` | Adds a note, and opens the panel |
| `/band` | Shows or hides the stats band |

## Settings

Set in the config menu, or in `settings.json` under `pluginConfigs`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `warnPercent` | 60 | Bars turn yellow at or above this percent |
| `errorPercent` | 85 | Bars turn red at or above this percent |

Spacing between stacked rows is `ROW_GAP` at the top of `hooks/register.tsx`.

## Development

Run it from the folder, for one session:

```
claude --plugin-dir PATH_TO_THIS_FOLDER
```

Check and test it:

```
claude plugin validate .
claude plugin test .
```

The notes and the band are covered by `hooks/register.test.ts`.

## Known limits

- Note text cannot be highlighted in the panel; the surface decides that and the mod has no way to
  turn it on.
- The add row scrolls with the notes. The engine scrolls the whole panel, and a row cannot be
  pinned against that.
- Two sessions open on one repository each hold their own copy of its notes; the last to write
  wins.
