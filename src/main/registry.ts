import fs from "node:fs";
import path from "node:path";
import type { PortRegistry, RegistryProject } from "../shared/types.js";

export function emptyRegistry(): PortRegistry {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: []
  };
}

export function readRegistry(registryPath: string): PortRegistry {
  if (!fs.existsSync(registryPath)) {
    const registry = emptyRegistry();
    writeRegistry(registryPath, registry);
    return registry;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as PortRegistry;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch {
    const backupPath = `${registryPath}.broken-${Date.now()}.bak`;
    fs.copyFileSync(registryPath, backupPath);
    const registry = emptyRegistry();
    writeRegistry(registryPath, registry);
    return registry;
  }
}

export function writeRegistry(registryPath: string, registry: PortRegistry): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ ...registry, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

export function upsertRegistryProject(
  registry: PortRegistry,
  project: RegistryProject
): PortRegistry {
  const projects = registry.projects.filter((item) => item.id !== project.id);
  projects.push(project);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    projects
  };
}
