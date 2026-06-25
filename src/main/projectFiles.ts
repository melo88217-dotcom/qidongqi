import fs from "node:fs";
import path from "node:path";
import {
  managedEnvEnd,
  managedEnvStart
} from "../shared/defaults.js";
import type { AppSettings, Ports, ProjectLock, ProjectPaths } from "../shared/types.js";

export function readProjectLock(projectPath: string): ProjectLock | null {
  const lockPath = path.join(projectPath, ".project-ports.lock");
  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8")) as ProjectLock;
  } catch {
    return null;
  }
}

export function writeProjectLock(
  projectPath: string,
  projectName: string,
  ports: Ports,
  paths: ProjectPaths,
  previous?: ProjectLock | null
): ProjectLock {
  const now = new Date().toISOString();
  const lock: ProjectLock = {
    version: 1,
    projectName,
    projectPath: normalizePath(projectPath),
    locked: true,
    ports,
    paths,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
  fs.writeFileSync(
    path.join(projectPath, ".project-ports.lock"),
    JSON.stringify(lock, null, 2),
    "utf8"
  );
  return lock;
}

export function writeEnvDevelopment(
  projectPath: string,
  projectName: string,
  ports: Ports,
  paths: ProjectPaths,
  settings: AppSettings
): void {
  const envPath = path.join(projectPath, ".env.development");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const block = [
    managedEnvStart,
    `PROJECT_NAME=${projectName}`,
    "",
    `FRONTEND_HOST=${settings.allowLanAccess ? "0.0.0.0" : "127.0.0.1"}`,
    `BACKEND_HOST=${settings.allowLanAccess ? "0.0.0.0" : "127.0.0.1"}`,
    "",
    `FRONTEND_PORT=${ports.frontend ?? ""}`,
    `BACKEND_PORT=${ports.backend ?? ""}`,
    `MEDIA_PORT=${ports.media ?? ""}`,
    `ADMIN_PORT=${ports.admin ?? ""}`,
    `WEBSOCKET_PORT=${ports.websocket ?? ""}`,
    "",
    `VITE_API_BASE_URL=http://localhost:${ports.backend ?? ""}`,
    `VITE_MEDIA_BASE_URL=http://localhost:${ports.media ?? ""}`,
    "",
    `MEDIA_ROOT=${paths.mediaRoot}`,
    `OBSIDIAN_ROOT=${paths.obsidianRoot}`,
    managedEnvEnd
  ].join("\n");

  const pattern = new RegExp(`${escapeRegExp(managedEnvStart)}[\\s\\S]*?${escapeRegExp(managedEnvEnd)}`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : [existing.trimEnd(), block].filter(Boolean).join("\n\n");

  fs.writeFileSync(envPath, `${next.trimEnd()}\n`, "utf8");
}

export function writeProjectPortsMarkdown(
  projectPath: string,
  projectName: string,
  ports: Ports,
  paths: ProjectPaths
): void {
  const lines = [
    `# ${projectName} Ports`,
    "",
    "This file is managed by Local Project Launcher.",
    "",
    "## Port Table",
    "",
    "| Role | Port | URL |",
    "| --- | ---: | --- |",
    `| Frontend | ${ports.frontend ?? ""} | http://localhost:${ports.frontend ?? ""} |`,
    `| Backend API | ${ports.backend ?? ""} | http://localhost:${ports.backend ?? ""} |`,
    `| Media service | ${ports.media ?? ""} | http://localhost:${ports.media ?? ""} |`,
    `| Admin | ${ports.admin ?? ""} | http://localhost:${ports.admin ?? ""} |`,
    `| WebSocket | ${ports.websocket ?? ""} | ws://localhost:${ports.websocket ?? ""} |`,
    "",
    "## Local Paths",
    "",
    `- Media root: ${paths.mediaRoot}`,
    `- Obsidian test vault: ${paths.obsidianRoot}`,
    "",
    "## Commands",
    "",
    "- Start: `npm run dev:safe`",
    "- Check ports: use Local Project Launcher or `node scripts/check-ports.js` if generated.",
    "- Repair ports: use Local Project Launcher and confirm before applying changes.",
    "",
    "## Do Not Use",
    "",
    "- 3000",
    "- 5173",
    "- 8000",
    "- 8080",
    "- 5000",
    "- 3306",
    "- 5432",
    "- 6379",
    "",
    "Do not automatically kill unknown processes."
  ];
  fs.writeFileSync(path.join(projectPath, "PROJECT_PORTS.md"), `${lines.join("\n")}\n`, "utf8");
}

export function writeEnvExample(projectPath: string): void {
  const examplePath = path.join(projectPath, ".env.example");
  if (fs.existsSync(examplePath)) {
    return;
  }
  fs.writeFileSync(
    examplePath,
    [
      "PROJECT_NAME=example-project",
      "FRONTEND_HOST=0.0.0.0",
      "BACKEND_HOST=0.0.0.0",
      "FRONTEND_PORT=3100",
      "BACKEND_PORT=8100",
      "MEDIA_PORT=8200",
      "ADMIN_PORT=9100",
      "WEBSOCKET_PORT=8300",
      "VITE_API_BASE_URL=http://localhost:8100",
      "VITE_MEDIA_BASE_URL=http://localhost:8200",
      "MEDIA_ROOT=D:/DevMedia/example-project",
      "OBSIDIAN_ROOT=D:/DevObsidian/example-project-test-vault"
    ].join("\n") + "\n",
    "utf8"
  );
}

export function writeAgents(projectPath: string): void {
  const agentsPath = path.join(projectPath, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    return;
  }
  fs.writeFileSync(
    agentsPath,
    [
      "# Local Project Rules",
      "",
      "- Start this project with `npm run dev:safe`.",
      "- Do not use ports 3000, 5173, 8000, or 8080.",
      "- Do not hard-code `localhost:8000` or similar fixed development URLs in business code.",
      "- Read all ports from `.env.development`.",
      "- Vite projects must use `strictPort: true`.",
      "- Backends must read host and port from environment variables.",
      "- Check ports before starting.",
      "- Never automatically kill unknown processes.",
      "- Never silently change locked ports for an existing project.",
      "- Read local media and Obsidian paths from `.env.development`."
    ].join("\n") + "\n",
    "utf8"
  );
}

export function writeTemplateScripts(projectPath: string): void {
  const scriptsDir = path.join(projectPath, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  const checkPath = path.join(scriptsDir, "check-ports.js");
  if (!fs.existsSync(checkPath)) {
    fs.writeFileSync(
      checkPath,
      [
        "const net = require('node:net');",
        "const ports = ['FRONTEND_PORT', 'BACKEND_PORT', 'MEDIA_PORT', 'ADMIN_PORT', 'WEBSOCKET_PORT']",
        "  .map((key) => Number(process.env[key]))",
        "  .filter(Boolean);",
        "",
        "function check(port) {",
        "  return new Promise((resolve) => {",
        "    const server = net.createServer();",
        "    server.once('error', () => resolve({ port, available: false }));",
        "    server.once('listening', () => server.close(() => resolve({ port, available: true })));",
        "    server.listen(port, '127.0.0.1');",
        "  });",
        "}",
        "",
        "Promise.all(ports.map(check)).then((results) => {",
        "  const blocked = results.filter((item) => !item.available);",
        "  if (blocked.length) {",
        "    console.error('Port conflict:', blocked.map((item) => item.port).join(', '));",
        "    process.exit(1);",
        "  }",
        "  console.log('All configured ports are available.');",
        "});"
      ].join("\n") + "\n",
      "utf8"
    );
  }

  const assignPath = path.join(scriptsDir, "assign-ports.js");
  if (!fs.existsSync(assignPath)) {
    fs.writeFileSync(
      assignPath,
      "console.log('Use Local Project Launcher to assign or repair locked ports.');\n",
      "utf8"
    );
  }
}

export function projectPaths(projectName: string, settings: AppSettings): ProjectPaths {
  return {
    mediaRoot: normalizePath(path.join(settings.mediaRoot, projectName)),
    obsidianRoot: normalizePath(path.join(settings.obsidianRoot, `${projectName}-test-vault`))
  };
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
