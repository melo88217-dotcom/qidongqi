export type PortRole =
  | "frontend"
  | "backend"
  | "media"
  | "admin"
  | "websocket"
  | "database"
  | "redis";

export type ProjectStatus =
  | "stopped"
  | "running"
  | "port-conflict"
  | "missing-config"
  | "missing-script";

export type Ports = Partial<Record<PortRole, number>>;

export interface ProjectPaths {
  mediaRoot: string;
  obsidianRoot: string;
}

export interface PortRange {
  start: number;
  end: number;
}

export interface AppSettings {
  projectRoot: string;
  registryPath: string;
  mediaRoot: string;
  obsidianRoot: string;
  autoOpenBrowser: boolean;
  allowLanAccess: boolean;
  portPools: Record<PortRole, PortRange>;
}

export interface RegistryProject {
  id: string;
  name: string;
  path: string;
  ports: Ports;
  paths: ProjectPaths;
  status: ProjectStatus;
  lastStartedAt: string | null;
}

export interface PortRegistry {
  version: 1;
  updatedAt: string;
  projects: RegistryProject[];
}

export interface ProjectLock {
  version: 1;
  projectName: string;
  projectPath: string;
  locked: true;
  ports: Ports;
  paths: ProjectPaths;
  createdAt: string;
  updatedAt: string;
}

export interface PortOwner {
  port: number;
  pid: number | null;
  processName: string | null;
  commandLine: string | null;
  raw: string | null;
}

export interface PortCheck {
  role: PortRole;
  port: number;
  inUse: boolean;
  owner: PortOwner | null;
  conflict: boolean;
  ownedByProject: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  hasPackageJson: boolean;
  hasDevSafe: boolean;
  detected: {
    frontend: boolean;
    backend: boolean;
    admin: boolean;
  };
  lock: ProjectLock | null;
  registry: RegistryProject | null;
  ports: Ports;
  paths: ProjectPaths;
  status: ProjectStatus;
  lastStartedAt: string | null;
  pid: number | null;
  portChecks: PortCheck[];
}

export interface AppSnapshot {
  settings: AppSettings;
  registry: PortRegistry;
  projects: ProjectSummary[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}
