---
name: sleekcms
description: Build, edit, and sync SleekCMS websites. Use whenever the user wants to create or modify a SleekCMS site - generating pages, templates (EJS), content models, content records (JSON), CSS, or JS - or when SLEEKCMS_TOKEN is present in the environment. The skill bundles a two-step sync utility (setup-site + sync-site) that pulls the site to a local workspace and pushes local edits back to the SleekCMS cloud, plus the full SleekCMS site-building reference.
---

# SleekCMS site builder

This skill lets you build and maintain a [SleekCMS](https://sleekcms.com) site from a local workspace. SleekCMS is a cloud headless CMS with a static site builder: every saved file syncs to the cloud and the site rebuilds automatically.

You get two things:

1. **`reference/AGENT.md`** — the complete SleekCMS authoring reference (file layout, model syntax, EJS helpers, content rules). **Read this before editing any site files.** It is the source of truth for naming conventions, model syntax, and templating helpers.
2. **`scripts/`** — two Node CLIs:
   - `setup-site.js` — one-time bootstrap. Takes the auth token, creates the workspace, pulls all server files, and persists the token at `<workspace>/.cache/token`.
   - `sync-site.js` — incremental push/pull for an already-initialized workspace. Reads the token from `.cache/token`; no token argument needed.

   Both are safe to re-run.

## When to use this skill

Use it whenever the user asks you to:
- Create a new SleekCMS site (pages, models, templates, content, styling).
- Edit an existing SleekCMS site (any file under `models/`, `pages/`, `entries/`, `blocks/`, `layouts/`, `css/`, `js/`, or `content/`).
- Pull the latest server state, push local edits, or re-sync after manual changes.

If the user provides a SleekCMS auth token (or one is already in the environment as `SLEEKCMS_TOKEN`), assume they want this skill.

## Required setup (run once per session)

The scripts depend on `commander`, `fs-extra`, and `json5`. Install them inside `scripts/` the first time the skill is used in a session:

```bash
cd <skill-dir>/scripts && npm install --silent
```

Where `<skill-dir>` is the absolute path of this skill folder. Node v16+ is required.

## Auth token

`setup-site` needs a SleekCMS CLI auth token. Resolve it in this order:

1. The user provided one in the conversation.
2. Environment variable `SLEEKCMS_TOKEN`.
3. Otherwise, ask the user for one (they get it from <https://app.sleekcms.com>).

The token's third dash-separated segment encodes the environment (`production`, `development`, `localhost`); the script auto-detects it. Pass `--env` only to override.

After `setup-site` runs once, `sync-site` reads the token from `.cache/token` automatically — never re-pass it.

## Standard workflow

### 1. One-time setup — `setup-site`

Pulls every template, model, and content record from the server into a slug-named workspace folder under the parent path you give (or the current directory if you omit `-p`). Persists the token to `<workspace>/.cache/token` for later syncs.

```bash
node <skill-dir>/scripts/setup-site.js \
  --token "$SLEEKCMS_TOKEN" \
  --path .
```

Capture the workspace path from the output line `✅ Workspace initialized for "<site>" at <viewsDir> ...` and `cd` into it for all subsequent file edits.

Re-running `setup-site` on an already-initialized workspace is safe: it falls through to an incremental sync and reports `Workspace already initialized`.

### 2. Read the reference

Before generating or editing any site files, read `reference/AGENT.md` (in this skill folder). It documents:
- File-naming rules (the `[]` collection suffix, `_` → `/` mapping in page keys)
- Model syntax (field types, groups, collections, block/entry references)
- EJS template syntax, context variables, helper functions (`render`, `img`, `marked`, `link`, `script`, `title`, `meta`, etc.)
- Content record JSON shape, including the `"<source>:<search>"` image shortcut
- Hard rules for AI authors (e.g. always use `link()`/`script()` not raw tags, never drop the `[]` suffix on collection files, use Tailwind by default).

### 3. Edit / generate files in the workspace

Create or modify files under the workspace following the structure in `AGENT.md`:

```
<workspace>/
├── models/{pages,entries,blocks}/<key>.model
├── pages/<key>.ejs
├── entries/<key>.ejs
├── blocks/<key>.ejs
├── layouts/<name>.ejs
├── css/<name>.css           (create css/tailwind.css to enable Tailwind)
├── js/<name>.js
└── content/{pages,entries}/<key>.json   (collection pages: content/pages/<key>[]/<slug>.json)
```

Push order is enforced by the sync engine: **models → templates → content**. Always create or update a model before its template or content record — the script will skip a template whose model is missing.

### 4. Push edits — `sync-site`

After edits, run `sync-site` from inside the workspace (or pass `-d <workspace>`). No token argument: it's read from `.cache/token`.

```bash
cd <workspace>
node <skill-dir>/scripts/sync-site.js
```

The script will:
- Skip files whose mtime matches the cache (cheap no-op).
- Push changed models, then templates, then content records.
- Write back any normalized response from the server (e.g. resolved `"pexels:..."` image shortcuts get expanded to full image objects).
- Print one `✅` line per file pushed.

### 5. Force a full re-pull

If the user wants to discard the local cache and re-download from the server (e.g. after server-side changes), run `sync-site --flush`:

```bash
node <skill-dir>/scripts/sync-site.js --flush
```

This deletes `.cache/state.json` and treats the next run as a first run, pulling everything fresh. The token cache is preserved.

## CLI reference

### `setup-site.js`

| Flag | Description |
|---|---|
| `-t, --token <token>` | **Required.** SleekCMS CLI auth token. Persisted to `<workspace>/.cache/token`. |
| `-p, --path <path>` | Parent directory for the workspace (default: current directory). |
| `-e, --env <env>` | `localhost`, `development`, or `production`. Defaults to the token's third segment, then `production`. |

### `sync-site.js`

| Flag | Description |
|---|---|
| `-d, --dir <dir>` | Workspace directory (default: current directory). Must contain `.cache/token`. |
| `--flush` | Discard the local cache and re-pull all files from the server. |

Both exit `0` on success, `1` on error.

## Things to remember

- **Read `reference/AGENT.md` before writing site files.** All naming, model syntax, and helper rules live there — do not guess.
- **Don't hand-create `AGENT.md`, `CLAUDE.md`, or `.vscode/` inside the workspace.** `setup-site` writes them on first run.
- **`.cache/` is the script's state, not part of the site.** Don't edit or commit it.
- **Collection files keep the `[]` in their filename** (`models/pages/blog[].model`, `pages/blog[].ejs`, `content/pages/blog[]/<slug>.json`). Dropping it breaks the URL.
- **No interactive watcher in this skill.** Use one-shot `sync-site` after each batch of edits.
- **Re-running is safe and idempotent.** If nothing changed, nothing is pushed.
- **One token = one workspace.** The token cached in a workspace can't be swapped — point a different token at a different `--path` instead.

## Quick example: building a new site end-to-end

```bash
# 1. Install deps once per session
cd <skill-dir>/scripts && npm install --silent

# 2. One-time setup — creates the workspace, pulls existing files, stores token
node <skill-dir>/scripts/setup-site.js -t "$SLEEKCMS_TOKEN" -p ~/sites
# → "Workspace initialized for "Acme" at /home/user/sites/acme-1234 (pulled N files)"

# 3. (Read reference/AGENT.md, then create models, templates, content under the workspace)
cd ~/sites/acme-1234

# 4. Push everything — no token needed
node <skill-dir>/scripts/sync-site.js
```

The site rebuilds and previews live at <https://app.sleekcms.com>.
