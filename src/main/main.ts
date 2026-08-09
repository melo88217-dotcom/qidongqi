import path from "node:path";
import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from "electron";
import { readSettings, writeSettings } from "./settings.js";
import {
  assignPortsToProject,
  checkProjectPorts,
  generateSafeTemplate,
  removeFromRegistry,
  repairProjectPorts,
  scanProjects
} from "./projects.js";
import {
  releasePortConflict,
  runningPids,
  startProject,
  stopAll,
  stopProject,
  waitForProjectReady
} from "./processManager.js";

let mainWindow: BrowserWindow | null = null;
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: "Local Project Launcher",
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.NODE_ENV === "development") {
    const frontendPort = Number(process.env.FRONTEND_PORT || 3100);
    await mainWindow.loadURL(`http://127.0.0.1:${frontendPort}`);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  }
}

if (singleInstanceLock) {
  app.whenReady().then(async () => {
    registerIpc();
    await createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出" }]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭" }
      ]
    }
  ])
);

function registerIpc(): void {
  ipcMain.handle("app:snapshot", async () => {
    const settings = readSettings();
    const { registry, projects } = await scanProjects(settings, runningPids());
    return { settings, registry, projects };
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    writeSettings(settings);
    const { registry, projects } = await scanProjects(settings, runningPids());
    return { settings, registry, projects };
  });

  ipcMain.handle("project:add", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0].replace(/\\/g, "/");
  });

  ipcMain.handle("project:assign", async (_event, projectPath: string) => {
    return assignPortsToProject(projectPath, readSettings());
  });

  ipcMain.handle("project:repair", async (_event, projectPath: string) => {
    return repairProjectPorts(projectPath, readSettings());
  });

  ipcMain.handle("project:checkPorts", async (_event, projectPath: string) => {
    return checkProjectPorts(projectPath, readSettings());
  });

  ipcMain.handle("project:start", async (_event, projectPath: string) => {
    const settings = readSettings();
    const comparableProjectPath = normalizePath(projectPath);
    const existingManagedPid = [...runningPids().entries()].find(
      ([runningPath]) => normalizePath(runningPath) === comparableProjectPath
    )?.[1];
    if (!existingManagedPid) {
      const occupiedPorts = (await checkProjectPorts(projectPath, settings))
        .filter((check) => check.inUse)
        .map((check) => check.port);
      if (occupiedPorts.length) {
        throw new Error(`启动前检测到端口已被占用：${occupiedPorts.join(", ")}。`);
      }
    }
    const pid = startProject(projectPath, settings);
    const initialSnapshot = await scanProjects(settings, runningPids());
    const project = initialSnapshot.projects.find(
      (item) => normalizePath(item.path) === comparableProjectPath
    );
    const isSelfProject = normalizePath(projectPath) === normalizePath(app.getAppPath());
    if (project?.ports.frontend && !isSelfProject) {
      const readinessPorts = project.name === "Obsidian-Wiki"
        ? [
            project.ports.frontend,
            project.ports.backend,
            project.ports.media,
            project.ports.websocket
          ].filter((port): port is number => Boolean(port))
        : [project.ports.frontend];
      const readiness = await waitForProjectReady(projectPath, readinessPorts);
      if (!readiness.ready) {
        if (readiness.reason === "timeout") {
          stopProject(projectPath, settings);
        }
        throw new Error(readiness.details ?? `${project.name} 启动失败。`);
      }
    }
    const { registry, projects } = await scanProjects(settings, runningPids());
    const startedProject = projects.find(
      (item) => normalizePath(item.path) === comparableProjectPath
    );
    if (startedProject?.pid !== pid) {
      stopProject(projectPath, settings);
      throw new Error(`${startedProject?.name ?? "项目"} 的启动进程已提前退出。`);
    }
    if (settings.autoOpenBrowser && project?.ports.frontend && !isSelfProject) {
      try {
        await shell.openExternal(frontendUrl(project));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`项目已启动，但无法打开系统浏览器：${reason}`);
      }
    }
    return { pid, registry, projects };
  });

  ipcMain.handle("project:stop", async (_event, projectPath: string) => {
    const settings = readSettings();
    const stopped = stopProject(projectPath, settings);
    const { registry, projects } = await scanProjects(settings, runningPids());
    return { stopped, registry, projects };
  });

  ipcMain.handle("project:stopAll", async () => {
    const settings = readSettings();
    const stopped = stopAll(settings);
    const { registry, projects } = await scanProjects(settings, runningPids());
    return { stopped, registry, projects };
  });

  ipcMain.handle(
    "project:releaseConflict",
    async (_event, projectPath: string, port: number, expectedPid: number, force: boolean) => {
      const settings = readSettings();
      const result = releasePortConflict(projectPath, port, expectedPid, force, settings);
      const { registry, projects } = await scanProjects(settings, runningPids());
      return { result, registry, projects };
    }
  );

  ipcMain.handle("project:openFolder", async (_event, projectPath: string) => {
    await shell.openPath(projectPath);
    return true;
  });

  ipcMain.handle("project:openEnv", async (_event, projectPath: string) => {
    await shell.openPath(path.join(projectPath, ".env.development"));
    return true;
  });

  ipcMain.handle("project:openUrl", async (_event, url: string) => {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("registry:open", async () => {
    await shell.openPath(readSettings().registryPath);
    return true;
  });

  ipcMain.handle("project:removeRegistry", async (_event, projectPath: string) => {
    const settings = readSettings();
    removeFromRegistry(projectPath, settings);
    const { registry, projects } = await scanProjects(settings, runningPids());
    return { registry, projects };
  });

  ipcMain.handle("project:generateTemplate", async (_event, projectPath: string) => {
    generateSafeTemplate(projectPath, readSettings());
    return true;
  });
}

function normalizePath(value: string): string {
  return path.normalize(value).replace(/\\/g, "/").toLowerCase();
}

function frontendUrl(project: { name: string; ports: { frontend?: number } }): string {
  const baseUrl = `http://localhost:${project.ports.frontend}`;
  return project.name === "Obsidian-Wiki" ? `${baseUrl}/?v=20260713-2` : baseUrl;
}
