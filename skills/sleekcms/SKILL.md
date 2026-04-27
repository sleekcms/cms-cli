---
name: sleekcms
description: Build, edit, and sync SleekCMS websites. Use whenever the user wants to create or modify a SleekCMS site - generating pages, templates (EJS), content models, content records (JSON), CSS, or JS - or when SLEEKCMS_TOKEN is present in the environment. The skill bundles a one-shot sync utility that pulls the site to a local workspace and pushes local edits back to the SleekCMS cloud, plus the full SleekCMS site-building reference.
---

# SleekCMS site builder

This skill lets you build and maintain a [SleekCMS](https://sleekcms.com) site from a local workspace. SleekCMS is a cloud headless CMS with a static site builder: every saved file syncs to the cloud and the site rebuilds automatically.

You get two things:

1. **`reference/AGENT.md`** — the complete SleekCMS authoring reference (file layout, model syntax, EJS helpers, content rules). **Read this before editing any site files.** It is the source of truth for naming conventions, model syntax, and templating helpers.
2. **`scripts/sync-site.js`** — a standalone Node script that performs a bi-directional sync between the workspace and the SleekCMS server. Safe to run repeatedly: a `.cache/` folder inside the workspace tracks server state so only real diffs are pushed.

## When to use this skill

Use it whenever the user asks you to:
- Create a new SleekCMS site (pages, models, templates, content, styling).
- Edit an existing SleekCMS site (any file under `models/`, `pages/`, `entries/`, `blocks/`, `layouts/`, `css/`, `js/`, or `content/`).
- Pull the latest server state, push local edits, or re-sync after manual changes.

If the user provides a SleekCMS auth token (or one is already in the environment as `SLEEKCMS_TOKEN`), assume they want this skill.

## Required setup (run once per session)

The script depends on `commander`, `fs-extra`, and `json5`. Install them inside `scripts/` the first time the skill is used in a session:

```bash
cd <skill-dir>/scripts && npm install --silent
```

Where `<skill-dir>` is the absolute path of this skill folder. Node v16+ is required.

## Auth token

Every sync needs a SleekCMS CLI auth token. Resolve it in this order:

1. The user provided one in the conversation.
2. Environment variable `SLEEKCMS_TOKEN`.
3. Otherwise, ask the user for one (they get it from <https://app.sleekcms.com>).

The token's third dash-separated segment encodes the environment (`production`, `development`, `localhost`); the script auto-detects it. Pass `--env` only to override.

## Standard workflow

### 1. Initial pull — fetch the site into a workspace

Run the sync script with the token. On first run it pulls all templates, models, and content records from the server into a slug-named workspace folder under the path you supply (or the current directory if none).

```bash
node <skill-dir>/scripts/sync-site.js \
  --token "$SLEEKCMS_TOKEN" \
  --path .
```

Capture the workspace path printed at the end (`Sync complete for "<site>" at <viewsDir> ...`) and `cd` into it for all subsequent file edits. To pin an explicit directory instead of the auto-slug, use `--dir <path>` instead of `--path`.

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

Push order is enforced by the sync script: **models → templates → content**. Always create or update a model before its template or content record — the script will skip a template whose model is missing.

### 4. Push edits — re-run the sync script

After edits, run the same script again (incremental mode — only diffs are pushed):

```bash
node <skill-dir>/scripts/sync-site.js \
  --token "$SLEEKCMS_TOKEN" \
  --dir <workspace>
```

Use `--dir` (not `--path`) when re-syncing to point at the exact workspace folder. The script will:
- Skip files whose mtime matches the cache (cheap no-op).
- Push changed models, then templates, then content records.
- Write back any normalized response from the server (e.g. resolved `"pexels:..."` image shortcuts get expanded to full image objects).
- Print one `✅` line per file pushed.

### 5. Force a full re-pull

If the user wants to discard the local cache and re-download from the server (e.g. after server-side changes), delete `<workspace>/.cache/state.json` before running the sync, or just delete `.cache/` entirely. The next run will be treated as a first run and will pull everything again.

## CLI reference (`scripts/sync-site.js`)

| Flag | Description |
|---|---|
| `-t, --token <token>` | **Required.** SleekCMS CLI auth token. |
| `-p, --path <path>` | Parent directory; the script creates a slug-named subfolder for the site. |
| `-d, --dir <dir>` | Explicit workspace directory (overrides `--path`). Use this for re-syncs once you know the exact folder. |
| `-e, --env <env>` | `localhost`, `development`, or `production`. Defaults to the token's third segment, then `production`. |

Exit code `0` on success, `1` on error. The last line of stdout always contains the workspace path on success.

## Things to remember

- **Read `reference/AGENT.md` before writing site files.** All naming, model syntax, and helper rules live there — do not guess.
- **Don't hand-create `AGENT.md`, `CLAUDE.md`, or `.vscode/` inside the workspace.** The sync script writes them on first run.
- **`.cache/` is the script's state, not part of the site.** Don't edit or commit it.
- **Collection files keep the `[]` in their filename** (`models/pages/blog[].model`, `pages/blog[].ejs`, `content/pages/blog[]/<slug>.json`). Dropping it breaks the URL.
- **No interactive watcher in this skill.** The original CLI has a chokidar watcher; here we use one-shot sync, which is the right model for non-interactive agent runs. After editing, just re-run the script.
- **Re-running is safe and idempotent.** If nothing changed, nothing is pushed.
- **One token = one workspace.** If you change tokens, point at a different `--path`/`--dir` — the script refuses to mix tokens in one workspace.

## Quick example: building a new site end-to-end

```bash
# 1. Install deps once per session
cd <skill-dir>/scripts && npm install --silent

# 2. Initial sync (creates the workspace, pulls existing files if any)
node <skill-dir>/scripts/sync-site.js -t "$SLEEKCMS_TOKEN" -p ~/sites
# → "Sync complete for "Acme" at /home/user/sites/acme-1234 (first run, ...)"

# 3. (Read reference/AGENT.md, then create models, templates, content under the workspace)

# 4. Push everything
node <skill-dir>/scripts/sync-site.js -t "$SLEEKCMS_TOKEN" -d ~/sites/acme-1234
```

The site rebuilds and previews live at <https://app.sleekcms.com>.
