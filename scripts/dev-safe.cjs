const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env.development");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function waitForPort(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`等待前端端口 ${port} 启动超时。`));
          return;
        }
        setTimeout(probe, 300);
      });
    }
    probe();
  });
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`端口 ${port} 已被占用，无法安全启动本地项目启动器。`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

function spawnChecked(command, args, options) {
  const child = spawn(command, args, options);
  child.once("error", (error) => {
    console.error(`[dev:safe] 启动失败：${error.message}`);
    process.exit(1);
  });
  return child;
}

async function main() {
  const env = loadEnv(envPath);
  const frontendHost = env.FRONTEND_HOST || "0.0.0.0";
  const frontendPort = Number(env.FRONTEND_PORT || 3100);
  const childEnv = {
    ...process.env,
    ...env,
    FRONTEND_HOST: frontendHost,
    FRONTEND_PORT: String(frontendPort),
    NODE_ENV: "development",
    FORCE_COLOR: "1",
  };

  await assertPortAvailable(frontendPort);

  console.log(`[dev:safe] Project: ${projectRoot}`);
  console.log(`[dev:safe] Frontend: http://localhost:${frontendPort}`);
  console.log("[dev:safe] Starting Vite and Electron.");

  const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const electronBin = path.join(projectRoot, "node_modules", "electron", "cli.js");
  const tscBin = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");

  const buildElectron = spawnChecked(process.execPath, [tscBin, "-p", "tsconfig.electron.json"], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    buildElectron.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron 主进程构建失败，退出码 ${code}`));
    });
  });

  const vite = spawnChecked(process.execPath, [viteBin, "--host", frontendHost, "--port", String(frontendPort), "--strictPort"], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: false,
  });

  await waitForPort(frontendPort);

  const electron = spawnChecked(process.execPath, [electronBin, "."], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: false,
  });
  const electronStartedAt = Date.now();

  function stopChildren() {
    if (!electron.killed) electron.kill();
    if (!vite.killed) vite.kill();
  }

  process.on("SIGINT", () => {
    stopChildren();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopChildren();
    process.exit(0);
  });
  electron.once("exit", (code) => {
    if (Date.now() - electronStartedAt < 5000 && code === 0) {
      console.log("[dev:safe] Electron exited quickly, likely because the launcher is already running. Keeping Vite alive until stopped.");
      return;
    }
    if (!vite.killed) vite.kill();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[dev:safe] ${error.message}`);
  process.exit(1);
});
