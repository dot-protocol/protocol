# @dot-protocol/kin

> DOT Protocol as MCP tools. Any AI agent. One import.

```bash
npm install -g @dot-protocol/kin
```

## What it is

Kin is the MCP server that wraps the DOT engine. It turns DOT physics into tools any AI can call — Claude, GPT, Gemini, local Ollama. The engine handles signing, chaining, compression, encryption. The tools are the interface.

## Tools

| Tool | What it does |
|------|-------------|
| `dot_boot` | Boot engine, create/load Ed25519 identity |
| `dot_create` | Create a signed DOT (physics auto-apply) |
| `dot_verify` | Verify signature + chain position |
| `dot_chain` | Current chain state |
| `dot_peers` | Discovered peers |
| `dot_send` | Send encrypted DOT to a peer |
| `dot_stats` | Live engine telemetry |
| `dot_seal` | BLS12-381 batch proof (48 bytes) |
| `dot_health` | Self-healing status report |
| `kin_publish` | Publish a signed claim to the relay |
| `kin_subscribe` | Subscribe to incoming DOTs |

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dot-kin": {
      "command": "node",
      "args": ["/path/to/dot-protocol/packages/kin/dist/index.js"],
      "env": {
        "DOT_RELAY_URL": "wss://dotdotdot.rocks"
      }
    }
  }
}
```

Or for local testing with offline mode:
```json
{
  "mcpServers": {
    "dot-kin": {
      "command": "node",
      "args": ["/path/to/dot-protocol/packages/kin/dist/index.js"],
      "env": {
        "DOT_OFFLINE": "true"
      }
    }
  }
}
```

## Quick start (any MCP client)

```
1. Call dot_boot           → get your DID
2. Call dot_create         → signed DOT, 153 bytes
3. Call dot_seal           → 48-byte BLS proof
4. Call dot_verify + hex   → verify any DOT
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOT_RELAY_URL` | `wss://dotdotdot.rocks` | CHORUS relay WebSocket URL |
| `DOT_OFFLINE` | `false` | Skip relay connection |

## Example: Agent signs a claim

```json
// dot_boot
{ "offline": true }
// → { "did": "dot:...", "status": "booted" }

// dot_create
{ "what": "I was here", "type": "public" }
// → { "dot_hex": "...", "size_bytes": 153, "chain_length": 1 }

// dot_seal
{ "n": 1, "verify": true }
// → { "seal_hex": "...", "size_bytes": 48, "verified": true }
```

## License

MIT — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

*The act of contact leaves its dot.*
