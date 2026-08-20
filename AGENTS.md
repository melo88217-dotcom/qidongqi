# AGENTS.md

## Three-role workflow

Use three internal roles for non-trivial work:

- Controller: understand the goal, split work, decide scope, and communicate with the user.
- Executor: inspect files, implement changes, run commands, and verify results.
- Reviewer: check correctness, omissions, privacy risks, Git safety, and whether the work satisfies the user request.

Final handoff should come from Controller with outcome, verification, and remaining choices.

## Local Project Launcher rules

- Default project root is `C:/codex/codex`.
- Do not scan the whole C drive.
- Do not use default development ports `3000`, `5173`, `8000`, `8080`, `5000`, `3306`, `5432`, or `6379`.
- Do not automatically kill unknown processes.
- Do not silently change locked ports for old projects.
- Existing `.env.development` files must be updated through the Local Project Launcher managed block, not overwritten wholesale.
- `.env.example` may contain example values only.

## GitHub privacy check

Before any push to GitHub:

- Check for API keys, tokens, secrets, cookies, private keys, admin passwords, database credentials, third-party service config, local database files, storage, logs, caches, uploads, and test account credentials.
- Report the check result to the user and wait for confirmation before pushing.
- If sensitive config is hard-coded, move it to `.env`.
- Ensure `.env`, local databases, storage, logs, caches, and uploads are not committed.
- If a sensitive file is already tracked, tell the user first and do not rewrite history without explicit confirmation.
