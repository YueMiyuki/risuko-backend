# Risuko Backend

A Cloudflare Workers backend for settings synchronization, powered by D1 database, Cloudflare Email Service, and native Cloudflare Rate Limiting.

## Quick Start

### 1. Prerequisites

- Node.js 18+
- pnpm
- A Cloudflare account

### 2. Clone & install dependencies

```bash
git clone https://github.com/YueMiyuki/risuko-backend
cd risuko-sync-backend
pnpm install
```

### 3. Create D1 database

```bash
pnpm db:create
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "risuko-sync"
database_id = "YOUR_DATABASE_ID_HERE"  # <- replace this
```

### 4. Apply database schema

For a new database, apply the full schema:

```bash
pnpm db:migrate
```

For an existing database that already has the base schema, apply unapplied migrations:

```bash
pnpm wrangler d1 migrations apply risuko-sync
```

For the local D1 database used by `wrangler dev`, run:

```bash
pnpm db:migrate:local
pnpm wrangler d1 migrations apply risuko-sync --local
```

### 5. Configure variables and secrets

Set production secrets with Wrangler:

```bash
pnpm wrangler secret put GITHUB_CLIENT_SECRET  # optional
```

Set local development secrets in `.dev.vars`. Use `.dev.vars.example` as the template.

| Variable | Required | Location | Description |
|----------|----------|----------|-------------|
| `GITHUB_CLIENT_SECRET` | No | Secret / `.dev.vars` | GitHub OAuth app secret. Leave empty to disable GitHub login. |
| `APP_DEEP_LINK_SCHEME` | No | `[vars]` / `.dev.vars` | Deep link scheme for auth redirects. Defaults to `risuko` in code. |
| `EMAIL_FROM` | Yes | `[vars]` / `.dev.vars` | Sender email address for OTP and magic-link emails. |
| `DISABLE_RATE_LIMIT` | No | `.dev.vars` | Set to any value locally to skip rate-limit bindings during development. |

Non-secret production variables live in `wrangler.toml` under `[vars]`:

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID (leave empty to disable GitHub login) |
| `APP_DEEP_LINK_SCHEME` | Deep link scheme (default: `risuko`) |
| `EMAIL_FROM` | Sender email address |

### 6. Set up Cloudflare Email Service

1. Go to Cloudflare Dashboard -> Email -> Email Service
2. Onboard your sender domain
3. Make sure `EMAIL_FROM` matches an allowed sender address
4. The `[[send_email]]` binding in `wrangler.toml` is already configured

See: https://developers.cloudflare.com/email-service/get-started/send-emails/

### 7. (Optional) Set up GitHub OAuth

1. Go to GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App
2. Set Authorization callback URL to `https://your-worker.workers.dev/auth/github/callback`
3. Set `GITHUB_CLIENT_ID` in `wrangler.toml` and `GITHUB_CLIENT_SECRET` in `.dev.vars`

### 8. Deploy

```bash
pnpm deploy
```

Your backend will be live at `https://risuko-sync.<your-subdomain>.workers.dev`.

### 9. Configure the app

In Risuko app -> Preferences -> Sync -> enter your backend URL.

## Development

```bash
pnpm dev
```

Useful checks:

```bash
pnpm typecheck
node --test test/db.test.js
```

This project uses local binding simulation by default during `wrangler dev`. For real email sending during development, add `remote = true` to the `[[send_email]]` binding.
