import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "../shared/types.js";

contextBridge.exposeInMainWorld("launcher", {
  snapshot: () => ipcRenderer.invoke("app:snapshot"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  addProject: () => ipcRenderer.invoke("project:add"),
  assignPorts: (projectPath: string) => ipcRenderer.invoke("project:assign", projectPath),
  repairPorts: (projectPath: string) => ipcRenderer.invoke("project:repair", projectPath),
  checkPorts: (projectPath: string) => ipcRenderer.invoke("project:checkPorts", projectPath),
  startProject: (projectPath: string) => ipcRenderer.invoke("project:start", projectPath),
  stopProject: (projectPath: string) => ipcRenderer.invoke("project:stop", projectPath),
  releasePortConflict: (projectPath: string, port: number, expectedPid: number, force: boolean) =>
    ipcRenderer.invoke("project:releaseConflict", projectPath, port, expectedPid, force),
  stopAll: () => ipcRenderer.invoke("project:stopAll"),
  openFolder: (projectPath: string) => ipcRenderer.invoke("project:openFolder", projectPath),
  openEnv: (projectPath: string) => ipcRenderer.invoke("project:openEnv", projectPath),
  openUrl: (url: string) => ipcRenderer.invoke("project:openUrl", url),
  openRegistry: () => ipcRenderer.invoke("registry:open"),
  removeFromRegistry: (projectPath: string) => ipcRenderer.invoke("project:removeRegistry", projectPath),
  generateTemplate: (projectPath: string) => ipcRenderer.invoke("project:generateTemplate", projectPath)
});
