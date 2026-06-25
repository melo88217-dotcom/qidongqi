# 本地项目启动器 Ports

This file is managed by Local Project Launcher.

## Port Table

| Role | Port | URL |
| --- | ---: | --- |
| Frontend | 3100 | http://localhost:3100 |
| Backend API | 8100 | http://localhost:8100 |
| Media service | 8200 | http://localhost:8200 |
| Admin | 9100 | http://localhost:9100 |
| WebSocket | 8300 | ws://localhost:8300 |

## Local Paths

- Media root: D:/DevMedia/本地项目启动器
- Obsidian test vault: D:/DevObsidian/本地项目启动器-test-vault

## Commands

- Start: `npm run dev:safe`
- Check ports: use Local Project Launcher or `node scripts/check-ports.js` if generated.
- Repair ports: use Local Project Launcher and confirm before applying changes.

## Do Not Use

- 3000
- 5173
- 8000
- 8080
- 5000
- 3306
- 5432
- 6379

Do not automatically kill unknown processes.
