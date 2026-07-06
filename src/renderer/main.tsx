import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings, AppSnapshot, PortCheck, PortRole, ProjectSummary } from "../shared/types";
import "./styles.css";

type View = "projects" | "settings" | "help";

const statusLabels: Record<ProjectSummary["status"], string> = {
  stopped: "未运行",
  running: "运行中",
  "port-conflict": "端口冲突",
  "missing-config": "配置缺失",
  "missing-script": "缺少安全启动脚本"
};

const roleLabels: Record<PortRole, string> = {
  frontend: "前端页面",
  backend: "后端 API",
  media: "素材服务",
  admin: "后台管理",
  websocket: "实时服务",
  database: "数据库",
  redis: "Redis"
};

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [view, setView] = useState<View>("projects");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("正在读取本地项目...");
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);

  const refresh = async () => {
    setBusy("scan");
    try {
      if (!window.launcher) {
        setNotice("本地接口没有加载成功，请关闭窗口后重新双击启动文件。");
        return;
      }
      const next = await window.launcher.snapshot();
      setSnapshot(next);
      setSettingsDraft(next.settings);
      setNotice(`已扫描 ${next.settings.projectRoot}，找到 ${next.projects.length} 个一级项目。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runningCount = useMemo(
    () => snapshot?.projects.filter((project) => project.status === "running").length ?? 0,
    [snapshot]
  );
  const conflictCount = useMemo(
    () => snapshot?.projects.filter((project) => project.status === "port-conflict").length ?? 0,
    [snapshot]
  );

  const updateProjects = (projects: ProjectSummary[], registry: AppSnapshot["registry"]) => {
    setSnapshot((current) => current && { ...current, projects, registry });
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setBusy("settings");
    const next = await window.launcher.saveSettings(settingsDraft);
    setSnapshot(next);
    setSettingsDraft(next.settings);
    setNotice("设置已保存，并已重新扫描项目。");
    setBusy(null);
  };

  const stopAllProjects = async () => {
    if (!confirm("只会停止由本启动器本次启动的项目，确认继续？")) return;
    setBusy("stop-all");
    const result = await window.launcher.stopAll();
    updateProjects(result.projects, result.registry);
    setNotice(`已停止 ${result.stopped} 个由启动器启动的项目。`);
    setBusy(null);
  };

  if (!snapshot || !settingsDraft) {
    return (
      <main className="loading">
        <div className="brand-mark">本地</div>
        <h1>本地项目启动器</h1>
        <p>{notice}</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">本地</div>
          <div>
            <h1>本地项目启动器</h1>
            <p>管理端口、启动和本地路径</p>
          </div>
        </div>
        <nav>
          <button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}>
            项目
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            设置
          </button>
          <button className={view === "help" ? "active" : ""} onClick={() => setView("help")}>
            帮助
          </button>
        </nav>
        <div className="sidebar-meta">
          <span>当前扫描目录</span>
          <strong>{snapshot.settings.projectRoot}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{view === "projects" ? "项目控制台" : view === "settings" ? "设置" : "帮助说明"}</h2>
            <p>{notice}</p>
          </div>
          <div className="top-actions">
            <button onClick={refresh} disabled={busy === "scan"}>扫描项目</button>
            <button onClick={() => void window.launcher.openRegistry()}>打开登记表</button>
            <button onClick={stopAllProjects}>停止全部</button>
          </div>
        </header>

        {view === "projects" && (
          <>
            <section className="stats-row">
              <Metric label="项目总数" value={snapshot.projects.length} />
              <Metric label="运行中" value={runningCount} />
              <Metric label="端口冲突" value={conflictCount} />
              <Metric label="已登记项目" value={snapshot.registry.projects.length} />
            </section>
            <section className="project-list">
              {snapshot.projects.map((project) => (
                <ProjectCard
                  key={project.path}
                  project={project}
                  onNotice={setNotice}
                  onBusy={setBusy}
                  updateProjects={updateProjects}
                  refresh={refresh}
                />
              ))}
            </section>
          </>
        )}

        {view === "settings" && (
          <SettingsPanel
            settings={settingsDraft}
            setSettings={setSettingsDraft}
            save={saveSettings}
            busy={busy === "settings"}
          />
        )}

        {view === "help" && <HelpPanel />}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectCard({
  project,
  onNotice,
  onBusy,
  updateProjects,
  refresh
}: {
  project: ProjectSummary;
  onNotice: (message: string) => void;
  onBusy: (key: string | null) => void;
  updateProjects: (projects: ProjectSummary[], registry: AppSnapshot["registry"]) => void;
  refresh: () => Promise<void>;
}) {
  const frontendUrl = project.ports.frontend ? `http://localhost:${project.ports.frontend}` : null;
  const adminUrl = project.ports.admin ? `http://localhost:${project.ports.admin}` : null;

  const assign = async () => {
    onBusy(project.path);
    await window.launcher.assignPorts(project.path);
    onNotice(`${project.name} 已分配端口并生成配置文件。`);
    await refresh();
    onBusy(null);
  };

  const repair = async () => {
    const conflicts = project.portChecks
      .filter((check) => check.conflict)
      .map((check) => `${roleLabels[check.role]}：${check.port}，PID：${check.owner?.pid ?? "未知"}`)
      .join("\n");
    if (
      !confirm(
        `确认为 ${project.name} 重新分配端口？\n\n将更新 .env.development、.project-ports.lock、PROJECT_PORTS.md 和 PORT_REGISTRY.json。\n\n当前冲突：\n${conflicts || "未检测到冲突"}`
      )
    ) {
      return;
    }
    onBusy(project.path);
    await window.launcher.repairPorts(project.path);
    onNotice(`${project.name} 已修复端口。`);
    await refresh();
    onBusy(null);
  };

  const start = async () => {
    if (!project.hasDevSafe) {
      onNotice(`${project.name} 没有 npm run dev:safe，请先生成模板，或让 Codex 接入安全启动脚本。`);
      return;
    }
    if (project.status === "port-conflict") {
      onNotice(`${project.name} 存在端口冲突，请先处理冲突。`);
      return;
    }
    onBusy(project.path);
    const result = await window.launcher.startProject(project.path);
    updateProjects(result.projects, result.registry);
    onNotice(`${project.name} 已启动，PID：${result.pid || "未知"}。`);
    onBusy(null);
  };

  const stop = async () => {
    onBusy(project.path);
    const result = await window.launcher.stopProject(project.path);
    updateProjects(result.projects, result.registry);
    onNotice(result.stopped ? `${project.name} 已停止。` : `${project.name} 不是由本启动器启动，未执行停止。`);
    onBusy(null);
  };

  const releaseConflicts = async () => {
    const conflicts = project.portChecks.filter(
      (check) => check.conflict && check.owner?.pid
    );
    if (conflicts.length === 0) {
      onNotice(`${project.name} 当前没有可释放的端口占用。`);
      return;
    }
    const summary = conflicts
      .map((check) => `${roleLabels[check.role]} ${check.port}，PID ${check.owner!.pid}`)
      .join("\n");
    if (!confirm(`准备释放 ${project.name} 的端口占用：\n\n${summary}\n\n继续后会重新核对进程身份。`)) {
      return;
    }

    onBusy(project.path);
    const messages: string[] = [];
    try {
      for (const conflict of conflicts) {
        const pid = conflict.owner!.pid!;
        let response = await window.launcher.releasePortConflict(
          project.path,
          conflict.port,
          pid,
          false
        );
        if (response.result.reason === "confirmation-required") {
          const command = conflict.owner?.commandLine || "无法读取命令行";
          const confirmed = confirm(
            `无法自动确认 PID ${pid} 属于 ${project.name}。\n\n端口：${conflict.port}\n进程：${conflict.owner?.processName || "未知"}\n命令：${command}\n\n仅在你确认该进程可以结束时选择“确定”。`
          );
          if (!confirmed) {
            messages.push(`${conflict.port}：已取消`);
            continue;
          }
          response = await window.launcher.releasePortConflict(
            project.path,
            conflict.port,
            pid,
            true
          );
        }

        updateProjects(response.projects, response.registry);
        messages.push(formatReleaseResult(conflict.port, response.result.reason, response.result.pid));
      }
      onNotice(messages.join("；"));
    } finally {
      onBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`只从全局登记表移除 ${project.name}，不会删除项目文件。确认继续？`)) return;
    onBusy(project.path);
    const result = await window.launcher.removeFromRegistry(project.path);
    updateProjects(result.projects, result.registry);
    onNotice(`${project.name} 已从登记表移除，项目里的 lock 文件不会被删除。`);
    onBusy(null);
  };

  const template = async () => {
    if (!confirm(`将在 ${project.name} 里生成端口管理脚本模板和 AGENTS.md；不会修改业务代码。确认继续？`)) return;
    await window.launcher.generateTemplate(project.path);
    onNotice(`${project.name} 已生成安全启动模板文件。`);
    await refresh();
  };

  return (
    <article className={`project-card status-${project.status}`}>
      <div className="card-head">
        <div>
          <h3>{project.name}</h3>
          <p>{project.path}</p>
        </div>
        <span className="status">{statusLabels[project.status]}</span>
      </div>

      <div className="port-grid">
        <Port label="前端" value={project.ports.frontend} />
        <Port label="后端" value={project.ports.backend} />
        <Port label="素材" value={project.ports.media} />
        <Port label="后台" value={project.ports.admin} />
        <Port label="实时" value={project.ports.websocket} />
      </div>

      {project.portChecks.some((check) => check.conflict) && (
        <div className="conflicts">
          {project.portChecks
            .filter((check) => check.conflict)
            .map((check) => (
              <p key={`${check.role}-${check.port}`}>
                {roleLabels[check.role]} {check.port} 被 PID {check.owner?.pid ?? "未知"} 占用
                {check.owner?.processName ? `，进程：${check.owner.processName}` : ""}
              </p>
            ))}
        </div>
      )}

      <dl className="details">
        <div>
          <dt>前端地址</dt>
          <dd>{frontendUrl ?? "未配置"}</dd>
        </div>
        <div>
          <dt>API 地址</dt>
          <dd>{project.ports.backend ? `http://localhost:${project.ports.backend}` : "未配置"}</dd>
        </div>
        <div>
          <dt>素材目录</dt>
          <dd>{project.paths.mediaRoot}</dd>
        </div>
        <div>
          <dt>Obsidian 目录</dt>
          <dd>{project.paths.obsidianRoot}</dd>
        </div>
        <div>
          <dt>最近启动</dt>
          <dd>{project.lastStartedAt ? new Date(project.lastStartedAt).toLocaleString() : "无"}</dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{project.pid ?? "无"}</dd>
        </div>
      </dl>

      <div className="actions">
        <button onClick={start}>启动</button>
        <button onClick={stop}>停止</button>
        <button onClick={() => frontendUrl && void window.launcher.openUrl(frontendUrl)} disabled={!frontendUrl}>
          打开前端
        </button>
        <button onClick={() => adminUrl && void window.launcher.openUrl(adminUrl)} disabled={!adminUrl}>
          打开后台
        </button>
        <button onClick={() => void window.launcher.openFolder(project.path)}>项目文件夹</button>
        <button onClick={() => void window.launcher.openEnv(project.path)}>打开配置</button>
        <button onClick={assign}>分配端口</button>
        <button onClick={repair}>修复端口</button>
        {project.portChecks.some((check) => check.conflict) && (
          <button className="danger" onClick={releaseConflicts}>释放占用</button>
        )}
        <button onClick={template}>生成模板</button>
        <button className="danger" onClick={remove}>移除登记</button>
      </div>
    </article>
  );
}

function formatReleaseResult(port: number, reason: string, pid: number | null): string {
  switch (reason) {
    case "released":
      return `${port}：已释放 PID ${pid}`;
    case "already-free":
      return `${port}：已经空闲`;
    case "owner-changed":
      return `${port}：占用进程已变化为 PID ${pid ?? "未知"}，未操作`;
    case "invalid-port":
      return `${port}：不是该项目登记端口，未操作`;
    case "still-in-use":
      return `${port}：结束后仍被 PID ${pid ?? "未知"} 占用`;
    default:
      return `${port}：未释放`;
  }
}

function Port({ label, value }: { label: string; value?: number }) {
  return (
    <div className="port">
      <span>{label}</span>
      <strong>{value ?? "未分配"}</strong>
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  save,
  busy
}: {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  save: () => Promise<void>;
  busy: boolean;
}) {
  const set = (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    setSettings({ ...settings, [key]: value });
  };

  const setRange = (role: keyof AppSettings["portPools"], key: "start" | "end", value: string) => {
    setSettings({
      ...settings,
      portPools: {
        ...settings.portPools,
        [role]: {
          ...settings.portPools[role],
          [key]: Number(value)
        }
      }
    });
  };

  return (
    <section className="settings-panel">
      <Field label="项目根目录" value={settings.projectRoot} onChange={(value) => set("projectRoot", value)} />
      <Field label="全局端口登记表" value={settings.registryPath} onChange={(value) => set("registryPath", value)} />
      <Field label="素材根目录" value={settings.mediaRoot} onChange={(value) => set("mediaRoot", value)} />
      <Field label="Obsidian 根目录" value={settings.obsidianRoot} onChange={(value) => set("obsidianRoot", value)} />

      <div className="toggle-row">
        <label>
          <input
            type="checkbox"
            checked={settings.autoOpenBrowser}
            onChange={(event) => set("autoOpenBrowser", event.target.checked)}
          />
          启动后自动打开浏览器
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.allowLanAccess}
            onChange={(event) => set("allowLanAccess", event.target.checked)}
          />
          允许局域网访问，监听 0.0.0.0
        </label>
      </div>

      <div className="range-table">
        {Object.entries(settings.portPools).map(([role, range]) => (
          <div className="range-row" key={role}>
            <span>{roleLabels[role as PortRole]}</span>
            <input
              value={range.start}
              onChange={(event) => setRange(role as keyof AppSettings["portPools"], "start", event.target.value)}
            />
            <input
              value={range.end}
              onChange={(event) => setRange(role as keyof AppSettings["portPools"], "end", event.target.value)}
            />
          </div>
        ))}
      </div>

      <button className="primary" onClick={save} disabled={busy}>
        保存设置
      </button>
    </section>
  );
}

function Field({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function HelpPanel() {
  return (
    <section className="help-panel">
      <h3>怎么用</h3>
      <p>默认扫描 D:/codex 下的一级项目目录，不扫描 C 盘全盘。</p>
      <p>新项目先点“分配端口”，启动器会生成 .env.development、.project-ports.lock、PROJECT_PORTS.md，并更新全局登记表。</p>
      <p>启动项目只执行 npm run dev:safe。如果项目还没有这个脚本，先点“生成模板”，再让 Codex 帮这个项目接入安全启动脚本。</p>
      <p>端口冲突只展示 PID 和进程名，不会自动杀未知进程。</p>
      <p>“停止”只会停止本启动器当前会话中启动的项目。</p>
      <p>推送到 GitHub 前必须先做隐私检查，确认没有密钥、token、本地数据库、日志、缓存或上传文件被提交。</p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
