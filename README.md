# Exchequer Platform

Real-time double-entry ledger systems for PSPs, Marketplaces, and anyone who needs to move and manage money at scale.

## Why Exchequer?

- **Kick-start your ledger** — Get a production-ready ledger system running in minutes, not months
- **Simple by design** — Clean APIs, predictable patterns, no magic
- **Real-time balances** — Know exactly where your money is, right now
- **By devs, for devs** — Built with the developer experience you wish every financial tool had

## Quick Start

```bash
# Prerequisites: Node.js 18+, Bun 1.2+, Docker

bun install
bun run docker:up
bun run dev
```

API runs at `http://localhost:3000` • Web dashboard at `http://localhost:5173`

## What's Inside

| App | Description | Stack |
|-----|-------------|-------|
| `apps/api` | Ledger API | Fastify, Drizzle, PostgreSQL |
| `apps/web` | Dashboard | React Router v7, Tailwind |
| `apps/docs` | Documentation | Docusaurus |

## Documentation

- [Getting Started](AGENTS.md) — Full development guide
- [Architecture](docs/standards/architecture.md) — Design patterns and principles
- [API Guide](apps/api/AGENTS.md) — Backend development
- [Web Guide](apps/web/AGENTS.md) — Frontend development

## Contributing

```bash
bun run check   # Format, lint, type check
bun run test    # Run all tests (requires Docker)
```

See [AGENTS.md](AGENTS.md) for the full development workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
