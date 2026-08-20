import type { AppSettings } from "./types.js";

export const defaultSettings: AppSettings = {
  projectRoot: "C:/codex/codex",
  registryPath: "C:/codex/codex/PORT_REGISTRY.json",
  mediaRoot: "D:/DevMedia",
  obsidianRoot: "D:/DevObsidian",
  autoOpenBrowser: true,
  allowLanAccess: true,
  portPools: {
    frontend: { start: 3100, end: 3199 },
    backend: { start: 8100, end: 8199 },
    media: { start: 8200, end: 8299 },
    websocket: { start: 8300, end: 8399 },
    admin: { start: 9100, end: 9199 },
    database: { start: 5433, end: 5499 },
    redis: { start: 6371, end: 6399 }
  }
};

export const managedEnvStart = "# Local Project Launcher managed begin";
export const managedEnvEnd = "# Local Project Launcher managed end";
