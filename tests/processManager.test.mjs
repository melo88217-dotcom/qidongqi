import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function waitFor(check, timeoutMs = 15_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const result = await check();
        if (result) return resolve(result);
      } catch {
        // The condition is expected to fail while the process is starting/stopping.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error('Timed out waiting for process state'));
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

test('stops the complete project process tree after the manager restarts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-stop-test-'));
  const registryPath = path.join(root, 'registry.json');
  const projectPath = path.join(root, 'fixture-project');
  const statePath = path.join(projectPath, 'state.json');
  fs.mkdirSync(projectPath);
  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
    private: true,
    scripts: { 'dev:safe': 'node server.cjs' },
  }));
  fs.writeFileSync(path.join(projectPath, 'server.cjs'), `
    const fs = require('node:fs');
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({
        pid: process.pid,
        port: server.address().port,
      }));
    });
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const settings = {
    projectRoot: root,
    registryPath,
    mediaRoot: path.join(root, 'media'),
    obsidianRoot: path.join(root, 'obsidian'),
    autoOpenBrowser: false,
    allowLanAccess: false,
    portPools: {},
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: [{
      id: 'fixture-project',
      name: 'fixture-project',
      path: projectPath.replace(/\\/g, '/'),
      ports: {},
      paths: { mediaRoot: '', obsidianRoot: '' },
      status: 'stopped',
      lastStartedAt: null,
    }],
  }));

  const starter = await import(`../dist-electron/main/processManager.js?starter=${Date.now()}`);
  const launcherPid = starter.startProject(projectPath, settings);
  const state = await waitFor(() => {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  });
  t.after(() => {
    if (process.platform === 'win32') {
      import('node:child_process').then(({ spawnSync }) => {
        spawnSync('taskkill', ['/PID', String(launcherPid), '/T', '/F'], { stdio: 'ignore' });
      });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await canConnect(state.port), true, 'fixture server should be running');

  const restartedManager = await import(`../dist-electron/main/processManager.js?restarted=${Date.now()}`);
  const stopped = await restartedManager.stopProject(projectPath, settings);

  assert.equal(stopped, true, 'a verified process started by an earlier launcher session should stop');
  await waitFor(async () => !(await canConnect(state.port)));
  assert.equal(await canConnect(state.port), false, 'the listening child process must also stop');
});

test('stops an unmanaged listener only when its command identifies the project path', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-adopt-test-'));
  const registryPath = path.join(root, 'registry.json');
  const projectPath = path.join(root, 'fixture-project');
  const serverPath = path.join(projectPath, 'unmanaged-server.cjs');
  const statePath = path.join(projectPath, 'state.json');
  fs.mkdirSync(projectPath);
  fs.writeFileSync(serverPath, `
    const fs = require('node:fs');
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({
        pid: process.pid,
        port: server.address().port,
      }));
    });
  `);
  const child = spawn(process.execPath, [serverPath], { windowsHide: true });
  const state = await waitFor(() => {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  });
  t.after(() => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const settings = {
    projectRoot: root,
    registryPath,
    mediaRoot: path.join(root, 'media'),
    obsidianRoot: path.join(root, 'obsidian'),
    autoOpenBrowser: false,
    allowLanAccess: false,
    portPools: {},
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: [{
      id: 'fixture-project',
      name: 'fixture-project',
      path: projectPath.replace(/\\/g, '/'),
      ports: { backend: state.port },
      paths: { mediaRoot: '', obsidianRoot: '' },
      status: 'running',
      lastStartedAt: new Date().toISOString(),
    }],
  }));

  assert.equal(await canConnect(state.port), true);
  const manager = await import(`../dist-electron/main/processManager.js?adopt=${Date.now()}`);
  const stopped = await manager.stopProject(projectPath, settings);

  assert.equal(stopped, true, 'a listener whose command contains the project path is safe to stop');
  await waitFor(async () => !(await canConnect(state.port)));
});

test('stop clears a stale running status when no project process exists', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-stale-stop-test-'));
  const registryPath = path.join(root, 'registry.json');
  const projectPath = path.join(root, 'fixture-project');
  fs.mkdirSync(projectPath);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const settings = {
    projectRoot: root,
    registryPath,
    mediaRoot: path.join(root, 'media'),
    obsidianRoot: path.join(root, 'obsidian'),
    autoOpenBrowser: false,
    allowLanAccess: false,
    portPools: {},
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: [{
      id: 'fixture-project',
      name: 'fixture-project',
      path: projectPath.replace(/\\/g, '/'),
      ports: {},
      paths: { mediaRoot: '', obsidianRoot: '' },
      status: 'running',
      lastStartedAt: new Date().toISOString(),
    }],
  }));

  const manager = await import(`../dist-electron/main/processManager.js?stale=${Date.now()}`);
  const stopped = await manager.stopProject(projectPath, settings);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  assert.equal(stopped, true, 'an already-dead project should be normalized to stopped');
  assert.equal(registry.projects[0].status, 'stopped');
});

test('project scan does not display stale registry status as running', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-stale-scan-test-'));
  const registryPath = path.join(root, 'registry.json');
  const projectPath = path.join(root, 'fixture-project');
  fs.mkdirSync(projectPath);
  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
    private: true,
    scripts: { 'dev:safe': 'node server.cjs' },
  }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const settings = {
    projectRoot: root,
    registryPath,
    mediaRoot: path.join(root, 'media'),
    obsidianRoot: path.join(root, 'obsidian'),
    autoOpenBrowser: false,
    allowLanAccess: false,
    portPools: {},
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: [{
      id: 'fixture-project',
      name: 'fixture-project',
      path: projectPath.replace(/\\/g, '/'),
      ports: {},
      paths: { mediaRoot: '', obsidianRoot: '' },
      status: 'running',
      lastStartedAt: new Date().toISOString(),
    }],
  }));

  const projectsModule = await import(`../dist-electron/main/projects.js?stale=${Date.now()}`);
  const snapshot = await projectsModule.scanProjects(settings, new Map());

  assert.equal(snapshot.projects[0].status, 'stopped');
  assert.equal(snapshot.projects[0].pid, null);
});

test('conflict release requires force for an unknown owner and rechecks the PID', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-release-test-'));
  const registryPath = path.join(root, 'registry.json');
  const projectPath = path.join(root, 'fixture-project');
  const serverPath = path.join(root, 'unknown-server.cjs');
  const statePath = path.join(root, 'state.json');
  fs.mkdirSync(projectPath);
  fs.writeFileSync(serverPath, `
    const fs = require('node:fs');
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({
        pid: process.pid,
        port: server.address().port,
      }));
    });
  `);
  const child = spawn(process.execPath, [serverPath], { windowsHide: true });
  const state = await waitFor(() => {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  });
  t.after(() => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const settings = {
    projectRoot: root,
    registryPath,
    mediaRoot: path.join(root, 'media'),
    obsidianRoot: path.join(root, 'obsidian'),
    autoOpenBrowser: false,
    allowLanAccess: false,
    portPools: {},
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects: [{
      id: 'fixture-project',
      name: 'fixture-project',
      path: projectPath.replace(/\\/g, '/'),
      ports: { backend: state.port },
      paths: { mediaRoot: '', obsidianRoot: '' },
      status: 'stopped',
      lastStartedAt: null,
    }],
  }));

  const manager = await import(`../dist-electron/main/processManager.js?release=${Date.now()}`);
  const release = manager.releasePortConflict ?? (() => ({ released: false, reason: 'missing-api' }));
  const changed = release(projectPath, state.port, state.pid + 1, true, settings);
  assert.deepEqual(changed, {
    released: false,
    reason: 'owner-changed',
    pid: state.pid,
  });
  assert.equal(await canConnect(state.port), true, 'PID mismatch must never stop the current owner');

  const refused = release(projectPath, state.port, state.pid, false, settings);
  assert.deepEqual(refused, {
    released: false,
    reason: 'confirmation-required',
    pid: state.pid,
  });
  assert.equal(await canConnect(state.port), true, 'unconfirmed unknown process must remain running');

  const released = release(projectPath, state.port, state.pid, true, settings);
  assert.equal(released.released, true);
  assert.equal(released.reason, 'released');
  await waitFor(async () => !(await canConnect(state.port)));
});
