# dot-protocol-kin

DOT MCP server — 11 tools for AI agents. Boot, create, sign, chain, encrypt, seal, verify.

[![npm](https://img.shields.io/npm/v/dot-protocol-kin)](https://www.npmjs.com/package/dot-protocol-kin)

## Install

```bash
npm install -g dot-protocol-kin
```

## Usage

### As an MCP server

Add to your `mcp.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "dot": {
      "command": "dot-kin",
      "args": ["--identity", "~/.dot/identity.json"]
    }
  }
}
```

Or run directly:

```bash
dot-kin
```

### Tools exposed to AI agents

| Tool | Description |
|------|-------------|
| `dot_boot` | Initialize DOT identity and relay connection |
| `dot_create` | Create a new signed DOT |
| `dot_create_ping` | Create a PING (empty presence DOT) |
| `dot_verify` | Verify a DOT's signature |
| `dot_check_chain` | Validate a DOT chain sequence |
| `dot_seal` | Seal a message for a recipient |
| `dot_verify_seal` | Open a sealed message |
| `dot_encrypt` | Encrypt payload with ECDH |
| `dot_decrypt` | Decrypt a PRIVATE DOT |
| `dot_inspect` | Parse and display DOT fields |
| `dot_stats` | Runtime metrics |

### Example agent interaction

```
Agent: dot_boot({ offline: false })
→ { identity: "abc123...", relay: "connected" }

Agent: dot_create({ WHAT: "observation logged" })
→ { bytes: "...", size: 153, timestamp: 1709000000000 }

Agent: dot_inspect({ bytes: "..." })
→ { pubkey: "abc...", chain: "def...", timestamp: "...", type: "PUBLIC", payload: "..." }
```

## Why AI agents need DOT

Every AI agent action can be a DOT:
- Who did it (pubkey = agent identity)
- When (timestamp)
- What (payload pointer)
- Provably in sequence (chain hash)
- Signed (Ed25519)

An agent's worldline is its audit log. Tamper with any DOT → chain breaks → instantly detected.

## License

MIT
