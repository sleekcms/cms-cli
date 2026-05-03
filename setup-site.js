#!/usr/bin/env node

/**
 * SleekCMS site sync — standalone, self-contained.
 *
 * Bi-directional sync between a local workspace and the SleekCMS server.
 * Safe to invoke repeatedly: a `.cache/state.json` inside the workspace
 * tracks server-known state so only real diffs are pushed.
 */

const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { program } = require("commander");

const API_BASE_URLS = {
    localhost:   "http://app.sleekcms.test/api/mcp",
    development: "https://app.sleekcms.dev/api/mcp",
    production:  "https://app.sleekcms.com/api/mcp",
};

const SRC_DIRS = [
    "src/views/blocks",
    "src/views/entries",
    "src/views/pages",
    "src/views/layouts",
    "src/models/blocks",
    "src/models/entries",
    "src/models/pages",
    "src/content/pages",
    "src/content/entries",
    "src/public/js",
    "src/public/css",
];

async function request(baseUrl, token, method, p, body) {
    const res = await fetch(baseUrl + p, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(`${method} ${p} → ${res.status}: ${text}`);
        err.status = res.status;
        err.body = text;
        throw err;
    }
    return res.json();
}

async function writeAuxFiles(viewsDir, agentMdContent) {
    if (agentMdContent) {
        await fs.outputFile(path.join(viewsDir, "AGENT.md"), agentMdContent);
        await fs.outputFile(path.join(viewsDir, "CLAUDE.md"), agentMdContent);
        await fs.outputFile(path.join(viewsDir, ".vscode", "copilot-instructions.md"), agentMdContent);
    }
    await fs.outputFile(path.join(viewsDir, ".vscode", "settings.json"), JSON.stringify({
        "files.associations": { "*.model": "javascript" },
        "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
        "js/ts.validate.enabled": false,
    }, null, 2));
}

async function checkAndWriteToken(viewsDir, token) {
    const tokenPath = path.join(viewsDir, ".cache", "token");
    if (await fs.pathExists(tokenPath)) {
        const existing = (await fs.readFile(tokenPath, "utf-8")).trim();
        if (existing !== token) {
            throw new Error(
                `Workspace at ${viewsDir} is tied to a different token. ` +
                `Remove ${tokenPath} or use a different workspace.`
            );
        }
        return;
    }
    await fs.outputFile(tokenPath, token);
}

function resolveViewsDir(basePath, site) {
    const slug = `${site.name.substr(0, 20)} ${site.id}`
        .replace(/[\s_]+/g, "-")
        .toLowerCase();
    const base = basePath || path.join(os.homedir(), ".sleekcms");
    return path.resolve(base, slug);
}

async function syncSite(opts) {
    const token = (opts.token || "").trim();
    if (!token) throw new Error("syncSite: token is required");

    const env = (opts.env || token.split("-")[2] || "production").toLowerCase();
    const apiBase = API_BASE_URLS[env] || API_BASE_URLS.production;

    const site = await request(apiBase, token, "GET", "/get_site");

    const viewsDir = opts.viewsDir
        ? path.resolve(opts.viewsDir)
        : resolveViewsDir(opts.path, site);

    await fs.ensureDir(viewsDir);
    await Promise.all(SRC_DIRS.map((dir) => fs.ensureDir(path.join(viewsDir, dir))));
    await checkAndWriteToken(viewsDir, token);

    const statePath = path.join(viewsDir, ".cache", "state.json");
    if (opts.flush) await fs.remove(statePath);

    const isFirstRun = !(await fs.pathExists(statePath));
    let fileMap = isFirstRun ? {} : (await fs.readJson(statePath)).fileMap || {};

    let pushed = 0;
    let pulled = 0;

    if (isFirstRun) {
        ({ fileMap, pulled } = await pullServerState(viewsDir, apiBase, token));
        await writeAuxFiles(viewsDir, opts.agentMd);
    } else {
        pushed = await pushLocalChanges(viewsDir, fileMap, apiBase, token);
    }

    await fs.outputJson(statePath, { fileMap }, { spaces: 2 });

    return { viewsDir, site, isFirstRun, pushed, pulled };
}

async function walkFiles(viewsDir) {
    const sourceRoot = path.join(viewsDir, "src");
    if (!(await fs.pathExists(sourceRoot))) return [];

    const out = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) out.push(path.relative(viewsDir, full).replace(/\\/g, "/"));
        }
    }
    await walk(sourceRoot);
    return out;
}

/**
 * Push local edits via /save_files. Server enforces save order.
 *
 * Skip: file mtime matches cache → don't read, don't push.
 * After save, only overwrite the local file if its mtime is unchanged from
 * when we read it — otherwise a newer local edit is pending and we'd clobber it.
 */
async function pushLocalChanges(viewsDir, fileMap, apiBase, token) {
    const changes = [];

    for (const rel of await walkFiles(viewsDir)) {
        const full = path.join(viewsDir, rel);
        const prior = fileMap[rel];
        const stat = await fs.stat(full);

        if (prior && prior.mtimeMs === stat.mtimeMs) continue;

        const content = await fs.readFile(full, "utf-8");
        if (!content.trim()) continue;
        changes.push({ rel, full, stat, content, prior });
    }

    if (changes.length === 0) return 0;

    let results;
    try {
        results = await request(apiBase, token, "POST", "/save_files",
            changes.map((c) => ({ path: c.rel, content: c.content })));
    } catch (err) {
        console.error("❌ Error saving files:", err.body || err.message);
        return 0;
    }

    const errors = await loadErrors(viewsDir);
    let pushed = 0;

    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const r = results[i] || {};

        if (r.error) {
            errors[c.rel] = r.error;
            console.error(`❌ Error saving ${c.rel}: ${r.error}`);
            continue;
        }

        delete errors[c.rel];

        const finalContent = r.content ?? c.content;
        let finalMtime = c.stat.mtimeMs;

        const currentStat = await fs.stat(c.full);
        if (currentStat.mtimeMs === c.stat.mtimeMs && finalContent !== c.content) {
            await fs.outputFile(c.full, finalContent);
            finalMtime = (await fs.stat(c.full)).mtimeMs;
        }

        fileMap[c.rel] = { mtimeMs: finalMtime };
        console.log(`✅ ${c.prior ? "Updated" : "Created"} ${c.rel}`);
        pushed++;
    }

    await saveErrors(viewsDir, errors);
    return pushed;
}

const ERROR_LOG = "sync-errors.log";

async function loadErrors(viewsDir) {
    const file = path.join(viewsDir, ERROR_LOG);
    if (!(await fs.pathExists(file))) return {};
    const text = await fs.readFile(file, "utf-8");
    const errors = {};
    for (const line of text.split("\n")) {
        const idx = line.indexOf(": ");
        if (idx > 0) errors[line.slice(0, idx)] = line.slice(idx + 2);
    }
    return errors;
}

async function saveErrors(viewsDir, errors) {
    const file = path.join(viewsDir, ERROR_LOG);
    const entries = Object.entries(errors);
    if (entries.length === 0) {
        await fs.remove(file);
        return;
    }
    await fs.outputFile(file, entries.map(([p, msg]) => `${p}: ${msg}`).join("\n") + "\n");
}

async function pullServerState(viewsDir, apiBase, token) {
    console.log("📥 Fetching files...");
    const files = await request(apiBase, token, "GET", "/get_files");

    const fileMap = {};
    let pulled = 0;

    for (const file of files) {
        const full = path.join(viewsDir, file.path);
        await fs.outputFile(full, file.content);
        const mtimeMs = (await fs.stat(full)).mtimeMs;
        pulled++;
        fileMap[file.path] = { mtimeMs };
    }

    console.log(`✔️ Synced ${files.length} file(s).`);
    return { fileMap, pulled };
}

module.exports = { syncSite, resolveViewsDir };

if (require.main === module) {
    program
        .name("setup-site")
        .description("Initialize a SleekCMS workspace: pull all files and persist the auth token for future syncs.")
        .requiredOption("-t, --token <token>", "SleekCMS CLI auth token")
        .option("-d, --dir <dir>", "Parent directory; workspace is created as a slug-named subfolder (default: current directory)")
        .option("-e, --env <env>", "Environment override (localhost, development, production)")
        .parse(process.argv);

    const opts = program.opts();
    syncSite({
        token: opts.token,
        path: opts.dir || path.join(os.homedir(), ".sleekcms"),
        env: opts.env,
    })
        .then(({ viewsDir, site, isFirstRun, pulled }) => {
            if (isFirstRun) {
                console.log(`\n✅ Workspace initialized for "${site.name}" at ${viewsDir} (pulled ${pulled} file(s)).`);
            } else {
                console.log(`\n✅ Workspace already initialized for "${site.name}" at ${viewsDir}.`);
            }
            console.log(`\nNext: cd ${viewsDir}  →  edit files  →  run sync-site`);
        })
        .catch(err => {
            console.error("❌", err.body || err.message);
            process.exit(1);
        });
}
