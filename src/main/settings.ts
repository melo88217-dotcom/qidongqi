import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { defaultSettings } from "../shared/defaults.js";
import type { AppSettings } from "../shared/types.js";

const settingsFile = () =>
  path.join(app.getPath("userData"), "local-project-launcher-settings.json");

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      portPools: {
        ...defaultSettings.portPools,
        ...(parsed.portPools ?? {})
      }
    };
  } catch {
    return defaultSettings;
  }
}

export function writeSettings(settings: AppSettings): AppSettings {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
  return settings;
}
