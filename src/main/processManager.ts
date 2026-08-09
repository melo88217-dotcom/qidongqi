import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import type { AppSettings, PortRegistry, ReleaseConflictResult } from "../shared/types.js";
import { readRegistry, upsertRegistryProject, writeRegistry } from "./registry.js";

interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  path: string;
  outputTail: string;
  spawnError: string | null;
}

export interface ProjectReadyResult {
  ready: boolean;
  reason: "ready" | "exited" | "timeout";
  details: string | null;
}

const maxOutputTailLength = 8_192;
const running = new Map<string, RunningProcess>();
const recentExits = new Map<string, string>();

export function runningPids(): Map<string, number> {
  const result = new Map<string, number>();
  running.forEach((value, key) => {
    if (value.child.pid) {
      result.set(key, value.child.pid);
    }
  });
  return result;
}

export function waitForPort(
  port: number,
  timeoutMs = 15_000,
  retryMs = 150
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const probe = () => {
      const socket = createConnection({ host: "127.0.0.1", port });
      let retried = false;
      socket.setTimeout(Math.min(retryMs, 500));
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      const retry = () => {
        if (retried) return;
        retried = true;
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
        } else {
          setTimeout(probe, retryMs);
        }
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    probe();
  });
}

export function waitForProjectReady(
  projectPath: string,
  ports: number[],
  timeoutMs = 150_000,
  retryMs = 150
): Promise<ProjectReadyResult> {
  const normalized = normalize(projectPath);
  const requiredPorts = [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0))];
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const probe = async () => {
      const item = running.get(normalized);
      if (!item) {
        resolve({
          ready: false,
          reason: "exited",
          details: recentExits.get(normalized) ?? "启动进程已提前退出。"
        });
        return;
      }

      const ready = requiredPorts.length > 0 &&
        (await Promise.all(requiredPorts.map(canConnect))).every(Boolean);
      if (ready) {
        resolve({ ready: true, reason: "ready", details: null });
        return;
      }

      if (Date.now() >= deadline) {
        const pendingPorts = requiredPorts.filter((port) => !getListeningPid(port));
        const capturedOutput = item.outputTail.trim();
        resolve({
          ready: false,
          reason: "timeout",
          details: [
            `等待端口 ${pendingPorts.join(", ") || requiredPorts.join(", ")} 启动超时。`,
            capturedOutput
          ].filter(Boolean).join("\n")
        });
        return;
      }

      setTimeout(() => void probe(), retryMs);
    };

    void probe();
  });
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
      FORCE_COLOR: "0"
    }
  });

  const item: RunningProcess = {
    child,
    path: projectPath,
    outputTail: "",
    spawnError: null
  };
  recentExits.delete(normalized);
  running.set(normalized, item);
  child.stdout.on("data", (chunk: Buffer | string) => appendOutput(item, chunk));
  child.stderr.on("data", (chunk: Buffer | string) => appendOutput(item, chunk));
  child.once("error", (error) => {
    item.spawnError = error.message;
  });
  child.once("close", (code, signal) => {
    if (running.get(normalized) === item) {
      running.delete(normalized);
    }
    recentExits.set(normalized, formatExitDetails(item, code, signal));
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

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function appendOutput(item: RunningProcess, chunk: Buffer | string): void {
  const sanitized = sanitizeOutput(String(chunk));
  item.outputTail = `${item.outputTail}${sanitized}`.slice(-maxOutputTailLength);
}

function formatExitDetails(
  item: RunningProcess,
  code: number | null,
  signal: NodeJS.Signals | null
): string {
  const summary = item.spawnError
    ? `无法启动项目进程：${item.spawnError}`
    : `启动进程已提前退出（代码：${code ?? "未知"}${signal ? `，信号：${signal}` : ""}）。`;
  return [summary, item.outputTail.trim()].filter(Boolean).join("\n");
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /((?:proxy-)?authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi,
      "$1[REDACTED]"
    )
    .replace(/((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /\b(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{10,})\b/gi,
      "[REDACTED]"
    );
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

  const processes = getWindowsProcesses();
  const owner = processes.find((item) => item.ProcessId === currentPid);
  const terminationRoots = owner
    ? [owner]
    : processes.filter((item) => item.ParentProcessId === currentPid);
  const verifiedOwner = terminationRoots.some((item) =>
    normalize(item.CommandLine ?? "").toLowerCase().includes(normalizedProject.toLowerCase())
  );
  if (!verifiedOwner && !force) {
    return { released: false, reason: "confirmation-required", pid: currentPid };
  }

  if (terminationRoots.length > 0) {
    terminationRoots.forEach((item) => stopProcessTree(item.ProcessId));
  } else {
    stopProcessTree(currentPid);
  }
  const releasedPid = terminationRoots.length === 1
    ? terminationRoots[0].ProcessId
    : currentPid;
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
  return { released: true, reason: "released", pid: releasedPid };
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
    if (result.status !== 0 && isProcessAlive(pid)) {
      throw new Error(result.stderr?.trim() || `无法停止进程树 PID ${pid}`);
    }
    return;
  }
  process.kill(pid, "SIGTERM");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
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
