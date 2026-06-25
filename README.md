# Local Project Launcher

Local Project Launcher is a Windows-first Electron desktop app for managing local development projects under `D:/codex`.

It scans one-level project folders, assigns stable development ports, writes project port files, checks conflicts, starts projects with `npm run dev:safe`, and only stops projects launched by this app.

## Default Paths

- Project root: `D:/codex`
- Global port registry: `D:/codex/PORT_REGISTRY.json`
- Media root: `D:/DevMedia`
- Obsidian test vault root: `D:/DevObsidian`

## Port Pools

- Frontend: `3100-3199`
- Backend API: `8100-8199`
- Media service: `8200-8299`
- WebSocket: `8300-8399`
- Admin: `9100-9199`
- Local database exposure: `5433-5499`
- Redis exposure: `6371-6399`

The launcher avoids common default ports such as `3000`, `5173`, `8000`, `8080`, `5000`, `3306`, `5432`, and `6379`.

## Install

```bash
npm install
```

## Development

Start the Vite renderer:

```bash
npm run dev
```

In another terminal, start Electron:

```bash
npm run dev:electron
```

## Build

```bash
npm run build
```

## Package for Windows

```bash
npm run dist
```

The packaged installer is written to `release/`.

## Add the First Project

1. Put a project folder under `D:/codex`.
2. Open Local Project Launcher.
3. Click `扫描项目`.
4. On the project card, click `分配端口`.

The launcher writes:

- `.env.development`
- `.project-ports.lock`
- `PROJECT_PORTS.md`
- `.env.example` if missing
- `D:/codex/PORT_REGISTRY.json`

Existing `.env.development` files are not overwritten wholesale. The launcher writes a managed block between:

```env
# Local Project Launcher managed begin
# Local Project Launcher managed end
```

## Start a Project

The launcher only starts projects with:

```bash
npm run dev:safe
```

If the script is missing, use `生成模板` or ask Codex to wire the project to read ports from `.env.development`.

## Stop a Project

The launcher only stops processes it started in the current launcher session. It does not stop unknown processes.

## Check Port Conflicts

The launcher uses Windows commands:

```bash
netstat -ano
tasklist /FI "PID eq <PID>"
```

Conflicts show the port, PID, and process name when available.

## Repair Port Conflicts

Click `修复端口` on a project card. The app asks for confirmation before updating:

- `.env.development`
- `.project-ports.lock`
- `PROJECT_PORTS.md`
- `PORT_REGISTRY.json`

It does not automatically kill processes.

## Why Not Kill Processes Automatically

Ports may be owned by another terminal, database, browser helper, Docker service, or another project. Automatically killing unknown processes can destroy unsaved work or corrupt local state. This launcher only reports conflicts and lets the user decide.

## Codex Workflow

For each managed project, keep ports and local paths in `.env.development`. Business code should read from environment variables and avoid hard-coded `localhost:3000`, `localhost:8000`, or similar development addresses.

Before pushing any project to GitHub, run a privacy check for API keys, tokens, secrets, cookies, private keys, admin passwords, database credentials, local database files, storage, logs, caches, uploads, and test credentials.
