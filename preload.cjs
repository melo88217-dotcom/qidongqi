const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  snapshot: () => ipcRenderer.invoke("app:snapshot"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  addProject: () => ipcRenderer.invoke("project:add"),
  assignPorts: (projectPath) => ipcRenderer.invoke("project:assign", projectPath),
  repairPorts: (projectPath) => ipcRenderer.invoke("project:repair", projectPath),
  checkPorts: (projectPath) => ipcRenderer.invoke("project:checkPorts", projectPath),
  startProject: (projectPath) => ipcRenderer.invoke("project:start", projectPath),
  stopProject: (projectPath) => ipcRenderer.invoke("project:stop", projectPath),
  releasePortConflict: (projectPath, port, expectedPid, force) =>
    ipcRenderer.invoke("project:releaseConflict", projectPath, port, expectedPid, force),
  stopAll: () => ipcRenderer.invoke("project:stopAll"),
  openFolder: (projectPath) => ipcRenderer.invoke("project:openFolder", projectPath),
  openEnv: (projectPath) => ipcRenderer.invoke("project:openEnv", projectPath),
  openUrl: (url) => ipcRenderer.invoke("project:openUrl", url),
  openRegistry: () => ipcRenderer.invoke("registry:open"),
  removeFromRegistry: (projectPath) => ipcRenderer.invoke("project:removeRegistry", projectPath),
  generateTemplate: (projectPath) => ipcRenderer.invoke("project:generateTemplate", projectPath)
});
