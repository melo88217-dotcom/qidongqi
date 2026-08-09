import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  PortCheck,
  PortRegistry,
  Ports,
  ProjectSummary,
  RegistryProject
} from "../shared/types.js";
import { findAvailablePort, getPortOwner } from "./ports.js";
import {
  projectPaths,
  readProjectLock,
  writeAgents,
  writeEnvDevelopment,
  writeEnvExample,
  writeProjectLock,
  writeProjectPortsMarkdown,
  writeTemplateScripts
} from "./projectFiles.js";
import { readRegistry, upsertRegistryProject, writeRegistry } from "./registry.js";

export async function scanProjects(
  settings: AppSettings,
  runningPids: Map<string, number>
): Promise<{ registry: PortRegistry; projects: ProjectSummary[] }> {
  const registry = readRegistry(settings.registryPath);
  if (!fs.existsSync(settings.projectRoot)) {
    fs.mkdirSync(settings.projectRoot, { recursive: true });
  }

  const dirs = fs
    .readdirSync(settings.projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(settings.projectRoot, entry.name));

  const projects = await Promise.all(
    dirs.map((projectPath) => summarizeProject(projectPath, settings, registry, runningPids))
  );

  return {
    registry,
    projects: projects.sort((a, b) => a.name.localeCompare(b.name))
  };
}

export async function assignPortsToProject(
  projectPath: string,
  settings: AppSettings
): Promise<ProjectSummary> {
  const registry = readRegistry(settings.registryPath);
  const projectName = path.basename(projectPath);
  const existingLock = readProjectLock(projectPath);
  const paths = existingLock?.paths ?? projectPaths(projectName, settings);
  const ports = existingLock?.ports ?? (await allocatePorts(settings, registry));
  const lock = writeProjectLock(projectPath, projectName, ports, paths, existingLock);

  writeEnvDevelopment(projectPath, projectName, ports, paths, settings);
  writeProjectPortsMarkdown(projectPath, projectName, ports, paths);
  writeEnvExample(projectPath);

  const nextRegistry = upsertRegistryProject(registry, {
    id: projectName,
    name: projectName,
    path: normalize(projectPath),
    ports,
    paths,
    status: "stopped",
    lastStartedAt: null
  });
  writeRegistry(settings.registryPath, nextRegistry);

  return summarizeProject(projectPath, settings, nextRegistry, new Map(), lock);
}

export async function repairProjectPorts(
  projectPath: string,
  settings: AppSettings
): Promise<ProjectSummary> {
  const registry = readRegistry(settings.registryPath);
  const projectName = path.basename(projectPath);
  const previous = readProjectLock(projectPath);
  const registryWithoutProject = {
    ...registry,
    projects: registry.projects.filter((project) => normalize(project.path) !== normalize(projectPath))
  };
  const ports = await allocatePorts(settings, registryWithoutProject);
  const paths = previous?.paths ?? projectPaths(projectName, settings);
  const lock = writeProjectLock(projectPath, projectName, ports, paths, previous);

  writeEnvDevelopment(projectPath, projectName, ports, paths, settings);
  writeProjectPortsMarkdown(projectPath, projectName, ports, paths);
  writeEnvExample(projectPath);

  const nextRegistry = upsertRegistryProject(registryWithoutProject, {
    id: projectName,
    name: projectName,
    path: normalize(projectPath),
    ports,
    paths,
    status: "stopped",
    lastStartedAt: null
  });
  writeRegistry(settings.registryPath, nextRegistry);

  return summarizeProject(projectPath, settings, nextRegistry, new Map(), lock);
}

export function generateSafeTemplate(projectPath: string, settings: AppSettings): void {
  const registry = readRegistry(settings.registryPath);
  const projectName = path.basename(projectPath);
  const lock = readProjectLock(projectPath);
  const ports = lock?.ports ?? {};
  const paths = lock?.paths ?? projectPaths(projectName, settings);
  writeEnvDevelopment(projectPath, projectName, ports, paths, settings);
  writeProjectPortsMarkdown(projectPath, projectName, ports, paths);
  writeEnvExample(projectPath);
  writeAgents(projectPath);
  writeTemplateScripts(projectPath);
  writeRegistry(settings.registryPath, registry);
}

export function removeFromRegistry(projectPath: string, settings: AppSettings): void {
  const registry = readRegistry(settings.registryPath);
  writeRegistry(settings.registryPath, {
    ...registry,
    projects: registry.projects.filter((project) => normalize(project.path) !== normalize(projectPath))
  });
}

export async function checkProjectPorts(
  projectPath: string,
  settings: AppSettings
): Promise<PortCheck[]> {
  const registry = readRegistry(settings.registryPath);
  const summary = await summarizeProject(projectPath, settings, registry, new Map());
  return summary.portChecks;
}

async function summarizeProject(
  projectPath: string,
  settings: AppSettings,
  registry: PortRegistry,
  runningPids: Map<string, number>,
  lockOverride?: ReturnType<typeof readProjectLock>
): Promise<ProjectSummary> {
  const name = path.basename(projectPath);
  const lock = lockOverride ?? readProjectLock(projectPath);
  const registryProject =
    registry.projects.find((project) => normalize(project.path) === normalize(projectPath)) ?? null;
  const packageJson = readPackageJson(projectPath);
  const ports = lock?.ports ?? registryProject?.ports ?? {};
  const paths = lock?.paths ?? registryProject?.paths ?? projectPaths(name, settings);
  const projectWasMarkedRunning = registryProject?.status === "running";
  const portChecks = await checkPorts(ports, projectPath, projectWasMarkedRunning);
  const isObsidianWiki = normalize(projectPath) === "d:/codex/obsidian-wiki";
  const obsidianWikiPortsRunning = isObsidianWiki && [3107, 8107, 8207, 8307].every((port) =>
    portChecks.some((check) => check.port === port && check.inUse)
  );
  const hasConflict = !obsidianWikiPortsRunning && portChecks.some((check) => check.conflict);
  const ownedRunningPid = portChecks.find((check) => check.ownedByProject && check.owner?.pid)?.owner?.pid ?? null;
  const recoveredObsidianWikiPid = obsidianWikiPortsRunning
    ? portChecks.find((check) => check.port === 3107)?.owner?.pid ?? null
    : null;
  const pid = runningPids.get(normalize(projectPath)) ?? ownedRunningPid ?? recoveredObsidianWikiPid;
  const hasDevSafe = Boolean(packageJson?.scripts?.["dev:safe"]);
  const hasPackageJson = Boolean(packageJson);
  const status = pid
    ? "running"
    : obsidianWikiPortsRunning
      ? "running"
      : hasConflict
      ? "port-conflict"
      : ownedRunningPid
        ? "running"
      : !lock && !registryProject
        ? "missing-config"
        : hasPackageJson && !hasDevSafe
          ? "missing-script"
          : "stopped";

  return {
    id: name,
    name,
    path: normalize(projectPath),
    hasPackageJson,
    hasDevSafe,
    detected: {
      frontend: hasAny(projectPath, ["frontend", "web", "client", "src", "vite.config.ts", "vite.config.js", "next.config.js"]),
      backend: hasAny(projectPath, ["backend", "server", "api", "main.py", "app.py", "requirements.txt", "pyproject.toml"]),
      admin: hasAny(projectPath, ["admin", "dashboard"])
    },
    lock,
    registry: registryProject,
    ports,
    paths,
    status,
    lastStartedAt: registryProject?.lastStartedAt ?? null,
    pid,
    portChecks
  };
}

async function allocatePorts(settings: AppSettings, registry: PortRegistry): Promise<Ports> {
  return {
    frontend: await findAvailablePort(settings.portPools.frontend, registry),
    backend: await findAvailablePort(settings.portPools.backend, registry),
    media: await findAvailablePort(settings.portPools.media, registry),
    admin: await findAvailablePort(settings.portPools.admin, registry),
    websocket: await findAvailablePort(settings.portPools.websocket, registry)
  };
}

async function checkPorts(
  ports: Ports,
  projectPath: string,
  projectWasMarkedRunning = false
): Promise<PortCheck[]> {
  const entries = Object.entries(ports).filter((entry): entry is [keyof Ports, number] => {
    return typeof entry[1] === "number";
  });

  return Promise.all(
    entries.map(async ([role, port]) => {
      const owner = await getPortOwner(port);
      const ownedByProject =
        owner.pid !== null &&
        (isOwnedByProject(owner.commandLine, projectPath) ||
          (projectWasMarkedRunning && isLikelyLocalDevProcess(owner.processName)));
      return {
        role,
        port,
        inUse: owner.pid !== null,
        owner: owner.pid ? owner : null,
        conflict: owner.pid !== null && !ownedByProject,
        ownedByProject
      };
    })
  );
}

function isOwnedByProject(commandLine: string | null, projectPath: string): boolean {
  if (!commandLine) {
    return false;
  }
  const normalizedCommand = normalize(commandLine).toLowerCase();
  const normalizedProject = normalize(projectPath).toLowerCase();
  return normalizedCommand.includes(normalizedProject);
}

function isLikelyLocalDevProcess(processName: string | null): boolean {
  const normalized = (processName ?? "").toLowerCase();
  return normalized === "node.exe" || normalized === "python.exe" || normalized === "py.exe";
}

function readPackageJson(projectPath: string): { scripts?: Record<string, string> } | null {
  const file = path.join(projectPath, "package.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

function hasAny(projectPath: string, names: string[]): boolean {
  return names.some((name) => fs.existsSync(path.join(projectPath, name)));
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/");
}
