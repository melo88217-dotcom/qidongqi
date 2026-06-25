import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { AppSettings, PortRegistry } from "../shared/types.js";
import { readRegistry, upsertRegistryProject, writeRegistry } from "./registry.js";

interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  path: string;
}

const running = new Map<string, RunningProcess>();

export function runningPids(): Map<string, number> {
  const result = new Map<string, number>();
  running.forEach((value, key) => {
    if (value.child.pid) {
      result.set(key, value.child.pid);
    }
  });
  return result;
}

export function startProject(projectPath: string, settings: AppSettings): number {
  const normalized = normalize(projectPath);
  const existing = running.get(normalized);
  if (existing?.child.pid) {
    return existing.child.pid;
  }

  const child = spawn("npm", ["run", "dev:safe"], {
    cwd: projectPath,
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      FORCE_COLOR: "1"
    }
  });

  running.set(normalized, { child, path: projectPath });
  child.once("exit", () => {
    running.delete(normalized);
    updateRegistryStatus(projectPath, settings, "stopped");
  });

  updateRegistryStatus(projectPath, settings, "running");
  return child.pid ?? 0;
}

export function stopProject(projectPath: string, settings: AppSettings): boolean {
  const normalized = normalize(projectPath);
  const item = running.get(normalized);
  if (!item) {
    return false;
  }

  item.child.kill();
  running.delete(normalized);
  updateRegistryStatus(projectPath, settings, "stopped");
  return true;
}

export function stopAll(settings: AppSettings): number {
  let count = 0;
  for (const item of [...running.values()]) {
    item.child.kill();
    updateRegistryStatus(item.path, settings, "stopped");
    count += 1;
  }
  running.clear();
  return count;
}

function updateRegistryStatus(
  projectPath: string,
  settings: AppSettings,
  status: "running" | "stopped"
): void {
  const registry = readRegistry(settings.registryPath);
  const project = registry.projects.find((item) => normalize(item.path) === normalize(projectPath));
  if (!project) {
    return;
  }
  const nextProject = {
    ...project,
    status,
    lastStartedAt: status === "running" ? new Date().toISOString() : project.lastStartedAt
  };
  const nextRegistry: PortRegistry = upsertRegistryProject(registry, nextProject);
  writeRegistry(settings.registryPath, nextRegistry);
}

function normalize(value: string): string {
  return path.normalize(value).replace(/\\/g, "/");
}
