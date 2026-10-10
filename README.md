# HZ Workbench

Manage your daily journal, tasks, and projects from a single, draggable dashboard inside Obsidian. Built for PARA-style vaults, with full desktop and mobile support.

HZ Workbench is an Obsidian plugin that brings daily journaling, time tracking, expense logging, task lists, and project Gantt charts together in one draggable, modular workbench.

> This plugin started as a personal tool and evolves with my workflow. Feel free to use it, but features may change between releases.

## Features

- **Draggable workbench** — Modular dashboard with zoom, snap-to-grid panels, and free dragging on desktop.
- **Daily capture** — Log time entries, expenses, quick notes, and meditation from a single "Capture today" dialog.
- **Journal carousel** — A 3D carousel of recent journal entries with a streak heatmap.
- **Tasks** — Today's must-do list and task list, with read-only import from the TickTickSync plugin's local cache (never writes back to TickTick).
- **Projects** — Project stage Gantt charts and progress views.
- **Color themes** — 6 built-in color schemes (Deep Forest Emerald, Deep Sea Ice Blue, Charcoal Amber, Midnight Star Purple, Ink Monochrome, Prism Glass Blue-Gold) with automatic light/dark mode switching.
- **Mobile optimized** — Reorganized mobile layout, touch gestures, and 44px touch targets.

## Commands

| Command | Description |
|---|---|
| Open personal workbench | Open the workbench view |
| Refresh personal workbench data | Refresh all data |
| Capture today | Open the daily capture dialog |
| Open today's journal | Jump to today's journal entry |
| Stop current timer | Stop the running timer |
| Log past time | Backfill a time entry |
| Log expense | Record an expense |
| Quick note | Jot down a quick thought |
| Log meditation | Record today's meditation |

## About the weather module

The weather area on the left rail is currently **disabled by default** and kept as a reserved placeholder. You can re-enable it in *Settings → HZ Workbench → Weather* if you want.

The weather feature uses the free [Open-Meteo](https://open-meteo.com/) service (no API key required), licensed under CC BY 4.0. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for details.

## Installation

### From the Community Plugins directory

Search for "HZ Workbench" in *Settings → Community plugins → Browse* and install.

### Manual installation

1. Download the latest `main.js`, `styles.css`, and `manifest.json` from [Releases](../../releases).
2. Copy the three files into `<vault>/.obsidian/plugins/hz-workbench/`.
3. Enable "HZ Workbench" in *Settings → Community plugins*.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## License

This plugin is licensed under the [MIT License](./LICENSE).

The "Prism Glass Blue-Gold" color scheme is inspired by [Prism Glass](https://github.com/csuyincs-creator/prism-glass) (Apache License 2.0). See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md), [`LICENSE-prism-glass.txt`](./LICENSE-prism-glass.txt), and [`NOTICE-prism-glass.txt`](./NOTICE-prism-glass.txt).
