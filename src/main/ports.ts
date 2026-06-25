import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PortOwner, PortRange, PortRegistry } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export async function isPortInUse(port: number): Promise<boolean> {
  const owner = await getPortOwner(port);
  return owner.pid !== null;
}

export async function getPortOwner(port: number): Promise<PortOwner> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    });
    const lines = stdout.split(/\r?\n/);
    const match = lines.find((line) => {
      const normalized = line.trim().replace(/\s+/g, " ");
      return (
        normalized.startsWith("TCP ") &&
        (normalized.includes(`0.0.0.0:${port} `) ||
          normalized.includes(`127.0.0.1:${port} `) ||
          normalized.includes(`[::]:${port} `) ||
          normalized.includes(`[::1]:${port} `)) &&
        normalized.includes("LISTENING")
      );
    });

    if (!match) {
      return { port, pid: null, processName: null, commandLine: null, raw: null };
    }

    const pidText = match.trim().split(/\s+/).at(-1);
    const pid = pidText ? Number(pidText) : null;
    const process = pid ? await getProcessInfo(pid) : null;
    return {
      port,
      pid: Number.isFinite(pid) ? pid : null,
      processName: process?.name ?? null,
      commandLine: process?.commandLine ?? null,
      raw: match.trim()
    };
  } catch {
    return { port, pid: null, processName: null, commandLine: null, raw: null };
  }
}

async function getProcessInfo(pid: number): Promise<{ name: string | null; commandLine: string | null } | null> {
  try {
    const { stdout } = await execFileAsync(
      "wmic",
      ["process", "where", `ProcessId=${pid}`, "get", "Name,CommandLine", "/format:list"],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const name = stdout.match(/^Name=(.*)$/m)?.[1]?.trim() || null;
    const commandLine = stdout.match(/^CommandLine=([\s\S]*?)\r?\nName=/m)?.[1]?.trim() || null;
    if (name || commandLine) {
      return { name, commandLine };
    }
  } catch {
    // Fall through to tasklist below.
  }

  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`], {
      windowsHide: true
    });
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const row = lines.find((line) => line.includes(String(pid)));
    return { name: row?.split(/\s+/)[0] ?? null, commandLine: null };
  } catch {
    return null;
  }
}

export async function findAvailablePort(
  range: PortRange,
  registry: PortRegistry
): Promise<number> {
  const registered = new Set<number>();
  registry.projects.forEach((project) => {
    Object.values(project.ports).forEach((port) => {
      if (typeof port === "number") {
        registered.add(port);
      }
    });
  });

  for (let port = range.start; port <= range.end; port += 1) {
    if (!registered.has(port) && !(await isPortInUse(port))) {
      return port;
    }
  }

  throw new Error(`No available port in range ${range.start}-${range.end}`);
}
