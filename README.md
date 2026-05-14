# gorelo-mcp-all

Full-coverage [Model Context Protocol](https://modelcontextprotocol.io) server for [Gorelo](https://gorelo.io/) — every documented Public API endpoint exposed as an MCP tool, read **and** write.

Generated dynamically from Gorelo's official OpenAPI 3 spec at startup. New endpoints show up automatically when the spec is updated. No hand-maintained tool list.

Same pattern as [`hudu-mcp-all`](https://github.com/peetinc/hudu-mcp-all).

## Coverage

All documented Gorelo Public API tags:

Alerts · Assets · Clients · Contacts · Organization · Tickets

Tool names map to OpenAPI `operationId`s (with method/path fallback when operationId is missing or non-unique).

## Install

```bash
git clone https://github.com/peetinc/gorelo-mcp-all.git
cd gorelo-mcp-all
npm install
npm run build
```

## Configure

```bash
GORELO_BASE_URL=https://api.usw.gorelo.io
GORELO_API_KEY=your-api-key-here
```

Get your API key from **Gorelo → Settings → API Keys**.

### API key sources

Provide **one** of:

| Var | Behavior |
|---|---|
| `GORELO_API_KEY` | Inline key value. Wins if both are set. |
| `GORELO_API_KEY_FILE` | Path to a file containing the key (tilde-expanded). **No default path** — must be explicit. |

Missing key → hard fail at startup.

### Optional knobs

| Variable | Purpose |
|---|---|
| `GORELO_PRESET=crm` | Curated tag bundle. Valid: `all` (default), `readonly`, `crm`, `tickets`, `monitoring`. |
| `GORELO_ENABLE_TAGS=Contacts,Tickets` | Whitelist tags (case-insensitive). |
| `GORELO_DISABLE_TAGS=Alerts` | Subtract tags. |
| `GORELO_READONLY=true` | Block all `DELETE` operations. |
| `GORELO_DISABLED_OPERATIONS=delete_ticket` | Disable specific tools by name. |
| `GORELO_TIMEOUT_MS=30000` | HTTP request timeout. |
| `GORELO_MAX_RETRIES=3` | Retries on HTTP 429; honors `Retry-After`. |
| `GORELO_MAX_RESPONSE_BYTES=1500000` | Response truncation guard. |
| `GORELO_SWAGGER_PATH=/path/to/swagger.json` | Override bundled spec. |

### Presets

| Preset | Tags | Use case |
|---|---|---|
| `all` | every tag | Default. Full surface. |
| `readonly` | every tag, GET only | Safe read agents. |
| `crm` | Contacts, Clients, Organization | Account / contact ops. |
| `tickets` | Tickets, Contacts, Clients | Ticketing workflows. |
| `monitoring` | Alerts, Assets | Device + alert telemetry. |

## Use with Claude Code

```bash
claude mcp add gorelo node /absolute/path/to/gorelo-mcp-all/dist/index.js \
  --scope user \
  -e GORELO_BASE_URL=https://api.usw.gorelo.io \
  -e GORELO_API_KEY_FILE=/path/to/keyfile
```

Or in `~/.claude.json`:

```json
{
  "mcpServers": {
    "gorelo": {
      "command": "node",
      "args": ["/absolute/path/to/gorelo-mcp-all/dist/index.js"],
      "env": {
        "GORELO_BASE_URL": "https://api.usw.gorelo.io",
        "GORELO_API_KEY_FILE": "/path/to/keyfile"
      }
    }
  }
}
```

## Inspect available tools

```bash
npm run list-tools
```

## Updating the spec

`swagger.json` is bundled in the repo. To refresh:

```bash
./scripts/fetch-swagger.sh
npm run build
```

Spec source: `https://api.usw.gorelo.io/swagger/v1/swagger.json` (public, no auth).

## License

MIT
