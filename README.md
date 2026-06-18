# pi-token-stats

Visualize your **pi coding agent** token consumption with a GitHub-style heatmap.

![](docs/screenshot.png)

## What it does

Reads your local pi session logs at `~/.pi/agent/sessions/**/*.jsonl` and presents:

- 📊 Summary cards (total cost, total tokens, sessions, messages)
- 🟩 GitHub-style daily activity heatmap (last 12 months)
- 🤖 Breakdown by model and provider
- 📁 Breakdown by project

All data stays on your machine — no telemetry, no cloud.

## Install

```bash
npm install -g pi-token-stats
```

## Usage

```bash
pi-tokens
```

Opens a dashboard in your browser at `http://127.0.0.1:<random-port>`.

### Options

```
pi-tokens [options]

  -p, --port <n>         server port (default: random)
  --no-open              don't open browser
  --session-dir <path>   pi sessions dir (default: ~/.pi/agent/sessions)
  -h, --help             show this help
  -v, --version          show version
```

## How it works

Pi records each assistant message's `usage` block in JSONL session logs. This tool simply parses and aggregates them — zero dependencies on pi internals beyond the on-disk format.

```json
{
  "type": "message",
  "message": {
    "provider": "deepseek",
    "model": "deepseek-v4-pro",
    "usage": {
      "input": 808,
      "output": 1834,
      "cacheRead": 75648,
      "cacheWrite": 0,
      "cost": { "total": 0.002221 }
    }
  }
}
```

## License

MIT
