import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import path from "node:path";
import type { AppSettings, PortRegistry, ReleaseConflictResult } from "../shared/types.js";
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

  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run dev:safe"]
    : ["run", "dev:safe"];
  const child = spawn(command, args, {
    cwd: projectPath,
    windowsHide: true,
    env: {
      ...process.env,
      FORCE_COLOR: "1"
    }
  });

  running.set(normalized, { child, path: projectPath });
  child.once("exit", () => {
    running.delete(normalized);
    updateRegistryStatus(projectPath, settings, "stopped", child.pid ?? null);
  });

  updateRegistryStatus(
    projectPath,
    settings,
    "running",
    child.pid ?? null,
    child.pid ? getProcessCreatedAt(child.pid) : null
  );
  return child.pid ?? 0;
}

export function stopProject(projectPath: string, settings: AppSettings): boolean {
  const normalized = normalize(projectPath);
  const item = running.get(normalized);
  if (item?.child.pid) {
    stopProcessTree(item.child.pid);
    running.delete(normalized);
    updateRegistryStatus(projectPath, settings, "stopped", item.child.pid);
    return true;
  }

  const registry = readRegistry(settings.registryPath);
  const project = registry.projects.find((entry) => normalize(entry.path) === normalized);
  if (
    project?.managedPid &&
    project.managedProcessCreatedAt &&
    getProcessCreatedAt(project.managedPid) === project.managedProcessCreatedAt
  ) {
    stopProcessTree(project.managedPid);
    updateRegistryStatus(projectPath, settings, "stopped", project.managedPid);
    return true;
  }

  const configuredPorts = Object.values(project?.ports ?? {});
  const unmanagedRoots = findVerifiedUnmanagedRoots(projectPath, configuredPorts);
  if (unmanagedRoots.length === 0) {
    const hasListener = configuredPorts.some((port) => port && getListeningPid(port));
    if (project?.status === "running" && !hasListener) {
      updateRegistryStatus(projectPath, settings, "stopped");
      return true;
    }
    return false;
  }
  unmanagedRoots.forEach(stopProcessTree);
  updateRegistryStatus(projectPath, settings, "stopped");
  return true;
}

export function stopAll(settings: AppSettings): number {
  let count = 0;
  const paths = new Set([
    ...[...running.values()].map((item) => item.path),
    ...readRegistry(settings.registryPath).projects
      .filter((project) => project.managedPid || project.status === "running")
      .map((project) => project.path)
  ]);
  for (const projectPath of paths) {
    if (stopProject(projectPath, settings)) {
      count += 1;
    }
  }
  running.clear();
  return count;
}

export function releasePortConflict(
  projectPath: string,
  port: number,
  expectedPid: number,
  force: boolean,
  settings: AppSettings
): ReleaseConflictResult {
  const registry = readRegistry(settings.registryPath);
  const normalizedProject = normalize(projectPath);
  const project = registry.projects.find((item) => normalize(item.path) === normalizedProject);
  if (!project || !Object.values(project.ports).includes(port)) {
    return { released: false, reason: "invalid-port", pid: null };
  }

  const currentPid = getListeningPid(port);
  if (!currentPid) {
    return { released: true, reason: "already-free", pid: null };
  }
  if (currentPid !== expectedPid) {
    return { released: false, reason: "owner-changed", pid: currentPid };
  }

  const owner = getWindowsProcesses().find((item) => item.ProcessId === currentPid);
  const command = normalize(owner?.CommandLine ?? "").toLowerCase();
  const verifiedOwner = command.includes(normalizedProject.toLowerCase());
  if (!verifiedOwner && !force) {
    return { released: false, reason: "confirmation-required", pid: currentPid };
  }

  stopProcessTree(currentPid);
  const deadline = Date.now() + 2_000;
  let remainingPid = getListeningPid(port);
  while (remainingPid && Date.now() < deadline) {
    sleep(100);
    remainingPid = getListeningPid(port);
  }
  if (remainingPid) {
    return { released: false, reason: "still-in-use", pid: remainingPid };
  }

  if (!Object.values(project.ports).some((configuredPort) => configuredPort && getListeningPid(configuredPort))) {
    updateRegistryStatus(projectPath, settings, "stopped");
  }
  return { released: true, reason: "released", pid: currentPid };
}

function updateRegistryStatus(
  projectPath: string,
  settings: AppSettings,
  status: "running" | "stopped",
  managedPid: number | null = null,
  managedProcessCreatedAt: string | null = null
): void {
  const registry = readRegistry(settings.registryPath);
  const project = registry.projects.find((item) => normalize(item.path) === normalize(projectPath));
  if (!project) {
    return;
  }
  if (status === "stopped" && managedPid && project.managedPid && project.managedPid !== managedPid) {
    return;
  }
  const nextProject = {
    ...project,
    status,
    lastStartedAt: status === "running" ? new Date().toISOString() : project.lastStartedAt,
    managedPid: status === "running" ? managedPid : null,
    managedProcessCreatedAt: status === "running" ? managedProcessCreatedAt : null
  };
  const nextRegistry: PortRegistry = upsertRegistryProject(registry, nextProject);
  writeRegistry(settings.registryPath, nextRegistry);
}

function getProcessCreatedAt(pid: number): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($p) { $p.CreationDate.ToUniversalTime().ToString(\"o\") }`
      ],
      { encoding: "utf8", windowsHide: true }
    ).trim() || null;
  } catch {
    return null;
  }
}

function stopProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8"
    });
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || `无法停止进程树 PID ${pid}`);
    }
    return;
  }
  process.kill(pid, "SIGTERM");
}

interface WindowsProcess {
  ProcessId: number;
  ParentProcessId: number;
  Name: string | null;
  CommandLine: string | null;
}

function findVerifiedUnmanagedRoots(projectPath: string, ports: Array<number | undefined>): number[] {
  if (process.platform !== "win32") {
    return [];
  }
  const processes = getWindowsProcesses();
  const byPid = new Map(processes.map((item) => [item.ProcessId, item]));
  const normalizedProject = normalize(projectPath).toLowerCase();
  const roots = new Set<number>();

  for (const port of ports) {
    if (!port) continue;
    const pid = getListeningPid(port);
    const owner = pid ? byPid.get(pid) : null;
    const command = normalize(owner?.CommandLine ?? "").toLowerCase();
    if (!owner || !command.includes(normalizedProject)) {
      continue;
    }

    let root = owner;
    while (root.ParentProcessId) {
      const parent = byPid.get(root.ParentProcessId);
      if (!parent) break;
      const parentCommand = normalize(parent.CommandLine ?? "").toLowerCase();
      if (
        parentCommand.includes(normalizedProject) ||
        isRecognizedDevLauncher(parent.Name, parentCommand)
      ) {
        root = parent;
        continue;
      }
      break;
    }
    roots.add(root.ProcessId);
  }

  return [...roots];
}

function getListeningPid(port: number): number | null {
  try {
    const output = execFileSync("netstat", ["-ano"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    });
    for (const line of output.split(/\r?\n/)) {
      const normalized = line.trim().replace(/\s+/g, " ");
      if (
        normalized.startsWith("TCP ") &&
        normalized.includes(`:${port} `) &&
        normalized.includes("LISTENING")
      ) {
        const pid = Number(normalized.split(" ").at(-1));
        return Number.isFinite(pid) ? pid : null;
      }
    }
  } catch {
    // A missing listener is equivalent to no verified process.
  }
  return null;
}

function getWindowsProcesses(): WindowsProcess[] {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress"
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 * 8 }
    ).trim();
    if (!output) return [];
    const parsed = JSON.parse(output) as WindowsProcess | WindowsProcess[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function isRecognizedDevLauncher(name: string | null, commandLine: string): boolean {
  const processName = (name ?? "").toLowerCase();
  if (processName !== "node.exe" && processName !== "cmd.exe" && processName !== "npm.exe") {
    return false;
  }
  return (
    commandLine.includes("dev:safe") ||
    commandLine.includes("npm run dev") ||
    /npm-cli\.js[\s\S]*\brun\s+dev\b/.test(commandLine)
  );
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function normalize(value: string): string {
  return path.normalize(value).replace(/\\/g, "/");
}
