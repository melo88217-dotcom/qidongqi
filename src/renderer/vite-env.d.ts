/// <reference types="vite/client" />

import type { AppSettings, AppSnapshot, PortCheck, ProjectSummary } from "../shared/types";

declare global {
  interface Window {
    launcher: {
      snapshot: () => Promise<AppSnapshot>;
      saveSettings: (settings: AppSettings) => Promise<AppSnapshot>;
      addProject: () => Promise<string | null>;
      assignPorts: (projectPath: string) => Promise<ProjectSummary>;
      repairPorts: (projectPath: string) => Promise<ProjectSummary>;
      checkPorts: (projectPath: string) => Promise<PortCheck[]>;
      startProject: (projectPath: string) => Promise<{
        pid: number;
        registry: AppSnapshot["registry"];
        projects: ProjectSummary[];
      }>;
      stopProject: (projectPath: string) => Promise<{
        stopped: boolean;
        registry: AppSnapshot["registry"];
        projects: ProjectSummary[];
      }>;
      stopAll: () => Promise<{
        stopped: number;
        registry: AppSnapshot["registry"];
        projects: ProjectSummary[];
      }>;
      openFolder: (projectPath: string) => Promise<boolean>;
      openEnv: (projectPath: string) => Promise<boolean>;
      openUrl: (url: string) => Promise<boolean>;
      openRegistry: () => Promise<boolean>;
      removeFromRegistry: (projectPath: string) => Promise<{
        registry: AppSnapshot["registry"];
        projects: ProjectSummary[];
      }>;
      generateTemplate: (projectPath: string) => Promise<boolean>;
    };
  }
}
