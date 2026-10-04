# Local Development Setup

This guide will help you run the Vintage Task App locally with a Convex backend.

## Prerequisites

- **Node.js 18+** (or Bun)
- **Git**
- A **Convex account** (free at [convex.dev](https://convex.dev))

## Quick Start (Windows)

```cmd
# 1. Clone and enter the project
git clone https://github.com/LacasaCorporation/vintage-task-app.git
cd vintage-task-app

# 2. Run the setup script
setup-local.bat
```

## Quick Start (Linux/Mac/Git Bash)

```bash
# 1. Clone and enter the project
git clone https://github.com/LacasaCorporation/vintage-task-app.git
cd vintage-task-app

# 2. Make script executable and run
chmod +x setup-local.sh
./setup-local.sh
```

## Manual Setup (Step by Step)

### 1. Install Dependencies

```bash
npm install
# or
bun install
```

### 2. Set Up Convex Local Backend

Run the Convex development server. This will:
- Prompt you to log in to Convex (first time only, opens browser)
- Create a local development deployment
- Start the Convex backend at `http://localhost:3210`
- Generate TypeScript types in `src/convex/_generated/`

```bash
npx convex dev --configure=new --dev-deployment local
```

**Keep this terminal running!** The Convex backend must stay running.

### 3. Configure Environment

The `.env.local` file is already configured for local development:

```env
VITE_CONVEX_URL=http://localhost:3210
CONVEX_SITE_URL=http://localhost:5173
CONVEX_DEPLOYMENT=dev
```

### 4. Start the Frontend

Open a **new terminal** and run:

```bash
npm run dev
# or
bun run dev
```

The app will be available at **http://localhost:5173**

## How It Works

| Component | URL | Purpose |
|-----------|-----|---------|
| Frontend (Vite) | http://localhost:5173 | React app with hot reload |
| Convex Backend | http://localhost:3210 | Real-time database, auth, functions |
| Convex Dashboard | https://dashboard.convex.dev | View/edit data, logs, schema |

## Project Structure

```
src/
├── convex/           # Convex backend (database, auth, functions)
│   ├── schema.ts     # Database schema (50+ tables)
│   ├── auth.ts       # Authentication config
│   ├── tasks.ts      # Task management
│   ├── sales.ts      # Sales/invoicing
│   ├── accounting.ts # Double-entry accounting
│   └── ...           # 30+ more modules
├── components/       # React components (Shadcn UI)
├── pages/            # Page components
├── hooks/            # Custom React hooks
└── lib/              # Utilities
```

## Troubleshooting

### "Cannot prompt for input in non-interactive terminals"
Run `npx convex dev` in a regular terminal (not VS Code integrated terminal, not CI). Use Command Prompt, PowerShell, or Git Bash.

### Convex URL not working
Check that:
1. Convex dev server is running (terminal shows "Convex dev server running")
2. `.env.local` has `VITE_CONVEX_URL=http://localhost:3210`
3. Restart Vite after changing `.env.local`

### TypeScript errors
Run `npx convex dev` to regenerate types, or run `npm run build` to check.

### Port conflicts
- Convex uses port 3210 (configurable with `--port`)
- Vite uses port 5173 (configurable in `vite.config.ts`)

## Using a Cloud Convex Deployment (Alternative)

If you prefer not to run Convex locally:

1. Create a project at [dashboard.convex.dev](https://dashboard.convex.dev)
2. Copy the deployment URL (e.g., `https://your-deployment.convex.cloud`)
3. Update `.env.local`:
   ```env
   VITE_CONVEX_URL=https://your-deployment.convex.cloud
   CONVEX_SITE_URL=http://localhost:5173
   ```
4. Run `npx convex dev --once` to push schema
5. Run `npm run dev`

## SQL Database Alternative

**Note:** This app is built entirely on Convex (real-time database + auth + backend functions). Migrating to a traditional SQL database (PostgreSQL/MySQL) would require:

- Rewriting 50+ database tables as SQL schemas
- Building a REST/GraphQL API to replace 100+ Convex functions
- Implementing authentication (JWT/sessions)
- Adding real-time support (WebSockets/SSE)
- Replacing all `useQuery`/`useMutation` hooks with API calls

This is **weeks of work**. The recommended approach is to use Convex as designed.

## Useful Commands

```bash
# Push schema changes to Convex
npx convex dev --once

# Run TypeScript type checking
npm run build

# Format code
npm run format

# Lint
npm run lint

# Open Convex dashboard
npx convex dashboard
```