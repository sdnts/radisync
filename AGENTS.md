# AGENTS.md

## Commands
- `yarn wrangler dev` - Start local development server (wrangler dev)
- `yarn wrangler deploy` - Deploy to Cloudflare Workers
- `yarn wrangler types` - Generate Cloudflare types
- `yarn tsc --noEmit` - Type check

## Architecture
- **Platform**: Cloudflare Workers with Workers KV & Workflows
- **Purpose**: Calendar sync between Radicale (self-hosted) and Google Calendar
- **Entry**: `src/index.ts` - exports fetch handler and workflow classes
- **Workflows**: `RadicaleToGoogle`, `GoogleToRadicale` - bidirectional sync
- **Bindings**: `DB` (D1), `BeelinkTunnel` (VPC service to self-hosted Radicale)
- **Secrets**: `GoogleOAuthClientSecret` stored as Wrangler secret

## Code Style
- TypeScript with strict mode enabled
- ES2024 target, ES modules
- Tabs for indentation
- Use Cloudflare Workers types from `cloudflare:workers`
- Env type defined in `worker-configuration.d.ts` (auto-generated)
- No semicolons optional (current code uses semicolons)
