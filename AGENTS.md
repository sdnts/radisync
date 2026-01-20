# AGENTS.md

## Commands
- `yarn wrangler dev` - Start local development server
- `yarn wrangler deploy` - Deploy to Cloudflare Workers
- `yarn wrangler types` - Generate Cloudflare types to `worker-configuration.d.ts`
- `yarn tsc --noEmit` - Type check
- `yarn check` - Run Biome linter
- `yarn format` - Format code with Biome

## Architecture
- **Platform**: Cloudflare Workers with KV, Workflows, and VPC Services
- **Purpose**: Bidirectional calendar sync between self-hosted Radicale and Google Calendar
- **Entry**: `src/index.ts` - exports fetch/scheduled handlers and workflow classes
- **Workflows**:
  - `RadicaleToGoogle` - Syncs events from Radicale → Google Calendar
  - `GoogleToRadicale` - Syncs events from Google Calendar → Radicale
- **Scheduled**: Cron runs every minute (`* * * * *`), triggers both workflows
- **Routes**: `/oauth` (OAuth callback), `/logout` (clear auth), `/` (login page)

## Bindings
- `KV` - Workers KV for storing OAuth tokens, sync tokens, calendar ID
- `BeelinkTunnel` - VPC service tunnel to self-hosted Radicale
- `RadicaleToGoogle` / `GoogleToRadicale` - Workflow bindings

## Secrets & Vars
- `GoogleOAuthClientId` - OAuth client ID (var)
- `GoogleOAuthClientSecret` - OAuth client secret (Wrangler secret)
- `AppHost` - Worker URL for OAuth redirects (var)
- `RadicaleUrl` - Radicale calendar URL (var)

## Code Style
- TypeScript strict mode, ES2024 target, ES modules
- Tabs for indentation, double quotes for strings
- Biome for linting and formatting
- Cloudflare Workers types from `cloudflare:workers`
- Env type auto-generated in `worker-configuration.d.ts`
