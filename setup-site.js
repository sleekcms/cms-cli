#!/usr/bin/env node

/**
 * SleekCMS site sync — standalone, self-contained.
 *
 * Bi-directional sync between a local workspace and the SleekCMS server.
 * Safe to invoke repeatedly: a `.cache/` folder inside the workspace
 * tracks server-known state so only real diffs are pushed.
 */

const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { program } = require("commander");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE_URLS = {
    localhost:   "http://localhost:9000/api/ai_tools",
    development: "https://app.sleekcms.dev/api/ai_tools",
    production:  "https://app.sleekcms.com/api/ai_tools",
};

const TEMPLATE_API_BASE_URLS = {
    localhost:   "http://localhost:9000/api/template",
    development: "https://app.sleekcms.dev/api/template",
    production:  "https://app.sleekcms.com/api/template",
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

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

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

function makeApi(token, env) {
    const apiBase = API_BASE_URLS[env] || API_BASE_URLS.production;
    const tmplBase = TEMPLATE_API_BASE_URLS[env] || TEMPLATE_API_BASE_URLS.production;
    return {
        fetchSite:  ()      => request(tmplBase, token, "GET",  "/site"),
        fetchFiles: ()      => request(apiBase,  token, "GET",  "/get_files"),
        saveFiles:  (files) => request(apiBase,  token, "POST", "/save_files", files),
    };
}

// ---------------------------------------------------------------------------
// Auxiliary files
// ---------------------------------------------------------------------------

const kebabCase = (str) => str.replace(/[\s_]+/g, "-").toLowerCase();

async function writeVSCodeSettings(viewsDir) {
    const settings = {
        "files.associations": { "*.model": "javascript" },
        "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
        "js/ts.validate.enabled": false,
    };
    await fs.outputFile(
        path.join(viewsDir, ".vscode", "settings.json"),
        JSON.stringify(settings, null, 2)
    );
}

async function writeAgentFiles(viewsDir, agentMdContent) {
    await fs.outputFile(path.join(viewsDir, "AGENT.md"), agentMdContent);
    await fs.outputFile(path.join(viewsDir, "CLAUDE.md"), agentMdContent);
    await fs.outputFile(path.join(viewsDir, ".vscode", "copilot-instructions.md"), agentMdContent);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_DIR = ".cache";
const CACHE_STATE = "state.json";
const CACHE_TOKEN = "token";

function cachePaths(viewsDir) {
    const dir = path.join(viewsDir, CACHE_DIR);
    return {
        dir,
        state: path.join(dir, CACHE_STATE),
        token: path.join(dir, CACHE_TOKEN),
    };
}

async function ensureSourceStructure(viewsDir) {
    await Promise.all(SRC_DIRS.map((dir) => fs.ensureDir(path.join(viewsDir, dir))));
}

async function loadCache(viewsDir) {
    const { state } = cachePaths(viewsDir);
    if (!(await fs.pathExists(state))) {
        return { fileMap: {}, siteId: null, empty: true };
    }
    const data = await fs.readJson(state);
    return {
        fileMap: data.fileMap || {},
        siteId:  data.siteId  || null,
        empty: false,
    };
}

async function saveCache(viewsDir, cache) {
    const { dir, state } = cachePaths(viewsDir);
    await fs.ensureDir(dir);
    await fs.writeJson(state, {
        siteId: cache.siteId,
        fileMap: cache.fileMap,
    }, { spaces: 2 });
}

async function checkAndWriteToken(viewsDir, token) {
    const { dir, token: tokenPath } = cachePaths(viewsDir);
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
    await fs.ensureDir(dir);
    await fs.writeFile(tokenPath, token, "utf-8");
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace dir from a base path + site info. Mirrors the
 * previous behavior in index.js (slug = kebab(name[0..20] + id)).
 */
function resolveViewsDir(basePath, site) {
    const slug = kebabCase(`${site.name.substr(0, 20)} ${site.id}`);
    const base = basePath || path.join(os.homedir(), ".sleekcms");
    return path.resolve(base, slug);
}

async function syncSite(opts) {
    const token = (opts.token || "").trim();
    if (!token) throw new Error("syncSite: token is required");

    const tokenParts = token.split("-");
    const env = (opts.env || tokenParts[2] || "production").toLowerCase();
    const api = makeApi(token, env);

    const site = await api.fetchSite();

    const viewsDir = opts.viewsDir
        ? path.resolve(opts.viewsDir)
        : resolveViewsDir(opts.path, site);

    await fs.ensureDir(viewsDir);
    await ensureSourceStructure(viewsDir);
    await checkAndWriteToken(viewsDir, token);

    if (opts.flush) {
        const { state } = cachePaths(viewsDir);
        await fs.remove(state);
    }

    const cache = await loadCache(viewsDir);
    const isFirstRun = cache.empty;
    cache.siteId = site.id;

    let pushed = 0;
    let pulled = 0;

    if (isFirstRun) {
        pulled = await pullServerState(viewsDir, cache, api);
    } else {
        pushed = await pushLocalChanges(viewsDir, cache, api);
    }

    if (isFirstRun) {
        if (opts.agentMd) await writeAgentFiles(viewsDir, opts.agentMd);
        await writeVSCodeSettings(viewsDir);
    }

    await saveCache(viewsDir, cache);

    return {
        viewsDir,
        site,
        fileMap: cache.fileMap,
        isFirstRun,
        pushed,
        pulled,
    };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function walkFiles(viewsDir) {
    const out = [];
    const sourceRoot = path.join(viewsDir, "src");

    if (!(await fs.pathExists(sourceRoot))) {
        return out;
    }

    async function walk(dir) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(viewsDir, full).replace(/\\/g, "/");
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    }
    await walk(sourceRoot);
    return out;
}

/**
 * Push local edits via the unified /save_files endpoint. The server enforces
 * save order (images → models → templates → content).
 *
 * Cheap-skip: file mtime matches cache → don't read.
 * Content-skip: file content matches cache → just refresh cached mtime.
 */
async function pushLocalChanges(viewsDir, cache, api) {
    const localFiles = await walkFiles(viewsDir);
    const changes = [];

    for (const rel of localFiles) {
        const full = path.join(viewsDir, rel);
        const prior = cache.fileMap[rel];
        const stat = await fs.stat(full);

        if (prior && prior.mtimeMs === stat.mtimeMs) continue;

        const content = await fs.readFile(full, "utf-8");

        if (prior && content === prior.content) {
            cache.fileMap[rel] = { content, mtimeMs: stat.mtimeMs };
            continue;
        }

        changes.push({ rel, full, stat, content, prior });
    }

    if (changes.length === 0) return 0;

    const payload = changes.map((c) => ({ path: c.rel, content: c.content }));

    let results;
    try {
        results = await api.saveFiles(payload);
    } catch (err) {
        console.error("❌ Error saving files:", err.body || err.message);
        return 0;
    }

    let pushed = 0;
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const r = (results && results[i]) || {};

        if (r.error) {
            console.error(`❌ Error saving ${c.rel}: ${r.error}`);
            continue;
        }

        const finalContent = r.content ?? c.content;
        let finalMtime = c.stat.mtimeMs;

        const currentStat = await fs.stat(c.full);
        if (currentStat.mtimeMs === c.stat.mtimeMs && finalContent !== c.content) {
            await fs.outputFile(c.full, finalContent);
            finalMtime = (await fs.stat(c.full)).mtimeMs;
        }

        cache.fileMap[c.rel] = { content: finalContent, mtimeMs: finalMtime };
        console.log(`✅ ${c.prior ? "Updated" : "Created"} ${c.rel}`);
        pushed++;
    }

    return pushed;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function removeStale(viewsDir, oldMap, newMap) {
    for (const rel of Object.keys(oldMap)) {
        if (!newMap[rel]) {
            try { await fs.unlink(path.join(viewsDir, rel)); } catch {}
            console.log(`🗑️  Removed (deleted on server): ${rel}`);
        }
    }
}

async function pullServerState(viewsDir, cache, api) {
    console.log("📥 Fetching files...");
    const files = await api.fetchFiles();

    const newFileMap = {};
    let pulled = 0;

    for (const file of files) {
        const full = path.join(viewsDir, file.path);
        const prior = cache.fileMap[file.path];

        let mtimeMs = prior?.mtimeMs;
        if (!prior || prior.content !== file.content) {
            await fs.outputFile(full, file.content);
            mtimeMs = (await fs.stat(full)).mtimeMs;
            pulled++;
        } else if (mtimeMs == null) {
            try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
        }

        newFileMap[file.path] = { content: file.content, mtimeMs };
    }

    await removeStale(viewsDir, cache.fileMap, newFileMap);
    cache.fileMap = newFileMap;

    console.log(`✔️ Synced ${files.length} file(s).`);
    return pulled;
}

// ---------------------------------------------------------------------------
// Exports + CLI
// ---------------------------------------------------------------------------

module.exports = {
    syncSite,
    resolveViewsDir,
    writeAgentFiles,
    writeVSCodeSettings,
    kebabCase,
};

if (require.main === module) {
    program
        .name("setup-site")
        .description("Initialize a SleekCMS workspace: pull all files and persist the auth token for future syncs.")
        .requiredOption("-t, --token <token>", "SleekCMS CLI auth token")
        .option("-d, --dir <dir>", "Parent directory; workspace is created as a slug-named subfolder (default: current directory)")
        .option("-e, --env <env>", "Environment override (localhost, development, production)")
        .parse(process.argv);

    const opts = program.opts();
    const basePath = opts.dir || path.join(os.homedir(), ".sleekcms");
    syncSite({
        token: opts.token,
        path: basePath,
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
