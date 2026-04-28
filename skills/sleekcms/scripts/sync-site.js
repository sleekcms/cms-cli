#!/usr/bin/env node

/**
 * SleekCMS site sync — standalone, self-contained.
 *
 * Bi-directional sync between a local workspace and the SleekCMS server.
 * Safe to invoke repeatedly: a `.cache/` folder inside the workspace
 * tracks server-known state so only real diffs are pushed.
 */

const fs = require("fs-extra");
const path = require("path");
const JSON5 = require("json5");
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

const TYPE_CONFIG = {
    PAGE:  { dir: 'pages',   ext: '.ejs' },
    ENTRY: { dir: 'entries', ext: '.ejs' },
    BLOCK: { dir: 'blocks',  ext: '.ejs' },
    JS:    { dir: 'js',      ext: '.js',  noModel: true },
    CSS:   { dir: 'css',     ext: '.css', noModel: true },
    BASE:  { dir: 'layouts', ext: '.ejs', noModel: true },
};

const ALLOW_MODEL_UPDATES = true;
const ALLOW_CONTENT_UPDATES = true;

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
        fetchSite:           ()             => request(tmplBase, token, "GET",  "/site"),
        fetchTemplates:      ()             => request(apiBase,  token, "GET",  "/get_templates"),
        fetchModels:         ()             => request(apiBase,  token, "GET",  "/get_models"),
        fetchContentRecords: ()             => request(apiBase,  token, "GET",  "/get_records"),
        saveTemplate:        (key, type, code)  => request(apiBase, token, "POST", "/save_template", { key, type, code: code || "" }),
        saveModel:           (key, type, shape) => request(apiBase, token, "POST", "/save_model",    { key, type, shape: shape || "" }),
        saveRecord:          (key, type, item)  => request(apiBase, token, "POST", "/save_record",   { key, type, item }),
    };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const kebabCase = (str) => str.replace(/[\s_]+/g, "-").toLowerCase();

function getFilePath(key, type) {
    const c = TYPE_CONFIG[type];
    return c ? `${c.dir}/${key}${c.ext}` : null;
}

function getModelFilePath(key, type) {
    const c = TYPE_CONFIG[type];
    return c && !c.noModel ? `models/${c.dir}/${key}.model` : null;
}

function getContentRecordFilePath(key, type) {
    const c = TYPE_CONFIG[type];
    return c && key ? `content/${c.dir}/${key}.json` : null;
}

function parseFilePath(filePath) {
    const parts = filePath.split("/");
    if (parts.length < 2) return null;
    const dir = parts[0];
    const filename = parts.slice(1).join("/");
    for (const [type, c] of Object.entries(TYPE_CONFIG)) {
        if (c.dir === dir && filename.endsWith(c.ext)) {
            return { type, key: filename.slice(0, -c.ext.length) };
        }
    }
    return null;
}

function parseModelFilePath(filePath) {
    if (!filePath.startsWith("models/")) return null;
    const parts = filePath.slice(7).split("/");
    if (parts.length < 2) return null;
    const dir = parts[0];
    const filename = parts.slice(1).join("/");
    if (!filename.endsWith(".model")) return null;
    for (const [type, c] of Object.entries(TYPE_CONFIG)) {
        if (c.dir === dir) return { type, key: filename.slice(0, -6) };
    }
    return null;
}

function parseContentRecordFilePath(filePath) {
    if (!filePath.startsWith("content/")) return null;
    const rest = filePath.slice(8);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    const typeDir = rest.slice(0, slash);
    const keyWithExt = rest.slice(slash + 1);
    if (!keyWithExt.endsWith(".json")) return null;
    const type = Object.keys(TYPE_CONFIG).find(t => TYPE_CONFIG[t].dir === typeDir);
    return type ? { type, key: keyWithExt.slice(0, -5) } : null;
}

// ---------------------------------------------------------------------------
// Auxiliary files
// ---------------------------------------------------------------------------

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

async function loadCache(viewsDir) {
    const { state } = cachePaths(viewsDir);
    if (!(await fs.pathExists(state))) {
        return { fileMap: {}, modelMap: {}, contentRecordMap: {}, siteId: null, empty: true };
    }
    const data = await fs.readJson(state);
    return {
        fileMap:          data.fileMap          || {},
        modelMap:         data.modelMap         || {},
        contentRecordMap: data.contentRecordMap || {},
        siteId:           data.siteId           || null,
        empty: false,
    };
}

async function saveCache(viewsDir, cache) {
    const { dir, state } = cachePaths(viewsDir);
    await fs.ensureDir(dir);
    await fs.writeJson(state, {
        siteId: cache.siteId,
        fileMap: cache.fileMap,
        modelMap: cache.modelMap,
        contentRecordMap: cache.contentRecordMap,
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
    return basePath ? path.resolve(basePath, slug) : path.resolve(slug);
}

/**
 * Main sync entrypoint.
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} [opts.path]         Parent directory. Workspace is created as a slug-named subfolder.
 * @param {string} [opts.viewsDir]     Explicit workspace dir (overrides `path`).
 * @param {string} [opts.env]
 * @param {string} [opts.agentMd]      Agent.md content; written on first run if provided.
 * @param {boolean} [opts.flush]       Delete the local cache before syncing, forcing a full re-pull from server.
 * @returns {Promise<{viewsDir, site, fileMap, modelMap, contentRecordMap, isFirstRun, pushed, pulled}>}
 */
async function syncSite(opts) {
    const token = (opts.token || "").trim();
    if (!token) throw new Error("syncSite: token is required");

    const tokenParts = token.split("-");
    const env = (opts.env || tokenParts[2] || "production").toLowerCase();
    const api = makeApi(token, env);

    // Fetch site info up-front so we can resolve viewsDir.
    const site = await api.fetchSite();

    const viewsDir = opts.viewsDir
        ? path.resolve(opts.viewsDir)
        : resolveViewsDir(opts.path, site);

    await fs.ensureDir(viewsDir);
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

    // Pull only on first run — after that, the cache is our source of truth
    // for server state and we only push local changes.
    if (isFirstRun) {
        pulled = await pullServerState(viewsDir, cache, api);
    } else {
        pushed = await pushLocalChanges(viewsDir, cache, api);
    }

    // -------- AUX FILES (first run only) -----------------------------------
    if (isFirstRun) {
        if (opts.agentMd) await writeAgentFiles(viewsDir, opts.agentMd);
        await writeVSCodeSettings(viewsDir);
    }

    await saveCache(viewsDir, cache);

    return {
        viewsDir,
        site,
        fileMap: cache.fileMap,
        modelMap: cache.modelMap,
        contentRecordMap: cache.contentRecordMap,
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
    async function walk(dir) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(viewsDir, full).replace(/\\/g, "/");
            if (entry.isDirectory()) {
                if (rel === ".cache" || rel === ".vscode") continue;
                await walk(full);
            } else if (entry.isFile()) {
                if (rel === "AGENT.md" || rel === "CLAUDE.md") continue;
                out.push(rel);
            }
        }
    }
    await walk(viewsDir);
    return out;
}

/**
 * Push local edits. Order is strict and sequential: models → templates → content.
 * Models first because templates and content may reference model shapes.
 *
 * Cheap-skip: if the file's mtime matches the cached mtime, treat it as
 * unchanged without reading the file.
 */
async function pushLocalChanges(viewsDir, cache, api) {
    const localFiles = await walkFiles(viewsDir);

    const modelFiles = [];
    const templateFiles = [];
    const contentFiles = [];

    for (const rel of localFiles) {
        if (rel.startsWith("models/")) {
            if (!ALLOW_MODEL_UPDATES) continue;
            const parsed = parseModelFilePath(rel);
            if (parsed) modelFiles.push({ rel, parsed });
        } else if (rel.startsWith("content/")) {
            if (!ALLOW_CONTENT_UPDATES) continue;
            const parsed = parseContentRecordFilePath(rel);
            if (parsed) contentFiles.push({ rel, parsed });
        } else {
            const parsed = parseFilePath(rel);
            if (parsed) templateFiles.push({ rel, parsed });
        }
    }

    let pushed = 0;

    // --- Models ---
    for (const { rel, parsed } of modelFiles) {
        const full = path.join(viewsDir, rel);
        const prior = cache.modelMap[rel];
        const stat = await fs.stat(full);
        if (prior && prior.mtimeMs === stat.mtimeMs) continue;
        const shape = await fs.readFile(full, "utf-8");
        if (prior && shape === prior.shape) {
            cache.modelMap[rel] = { ...prior, mtimeMs: stat.mtimeMs };
            continue;
        }
        try {
            const resp = await api.saveModel(parsed.key, parsed.type, shape);
            let finalMtime = stat.mtimeMs;
            if (resp.shape !== shape) {
                await fs.writeFile(full, resp.shape, "utf-8");
                finalMtime = (await fs.stat(full)).mtimeMs;
            }
            cache.modelMap[rel] = { key: parsed.key, type: parsed.type, shape: resp.shape, mtimeMs: finalMtime };
            console.log(`✅ ${prior ? "Updated" : "Created"} model: ${rel}`);
            pushed++;
        } catch (err) {
            console.error(`❌ Error saving model ${rel}:`, err.body || err.message);
        }
    }

    // --- Templates ---
    for (const { rel, parsed } of templateFiles) {
        const full = path.join(viewsDir, rel);
        const prior = cache.fileMap[rel];
        const stat = await fs.stat(full);
        if (prior && prior.mtimeMs === stat.mtimeMs) continue;
        const code = await fs.readFile(full, "utf-8");
        if (prior && code === prior.code) {
            cache.fileMap[rel] = { ...prior, mtimeMs: stat.mtimeMs };
            continue;
        }

        const modelRel = getModelFilePath(parsed.key, parsed.type);
        if (modelRel && !cache.modelMap[modelRel]) {
            console.warn(`⚠️ Skipping template ${rel}: no model found`);
            continue;
        }
        try {
            await api.saveTemplate(parsed.key, parsed.type, code);
            cache.fileMap[rel] = { key: parsed.key, type: parsed.type, code, mtimeMs: stat.mtimeMs };
            console.log(`✅ ${prior ? "Updated" : "Created"} template: ${rel}`);
            pushed++;
        } catch (err) {
            console.error(`❌ Error saving template ${rel}:`, err.body || err.message);
        }
    }

    // --- Content records ---
    for (const { rel, parsed } of contentFiles) {
        const full = path.join(viewsDir, rel);
        const prior = cache.contentRecordMap[rel];
        const stat = await fs.stat(full);
        if (prior && prior.mtimeMs === stat.mtimeMs) continue;
        let item;
        try {
            item = JSON5.parse(await fs.readFile(full, "utf-8"));
        } catch {
            console.error(`❌ Invalid JSON in content record: ${rel}`);
            continue;
        }
        if (prior && JSON.stringify(item) === JSON.stringify(prior.item)) {
            cache.contentRecordMap[rel] = { ...prior, mtimeMs: stat.mtimeMs };
            continue;
        }
        try {
            const resp = await api.saveRecord(parsed.key, parsed.type, item);
            const receivedItem = resp.item ?? item;
            let finalMtime = stat.mtimeMs;
            // Write server response back to file unless file was modified while save was in-flight
            const currentStat = await fs.stat(full);
            if (currentStat.mtimeMs === stat.mtimeMs) {
                if (JSON.stringify(receivedItem) !== JSON.stringify(item)) {
                    await fs.outputFile(full, JSON.stringify(receivedItem, null, 2));
                    finalMtime = (await fs.stat(full)).mtimeMs;
                }
            }
            cache.contentRecordMap[rel] = { key: parsed.key, type: parsed.type, item: receivedItem, mtimeMs: finalMtime };
            console.log(`✅ ${prior ? "Updated" : "Created"} content record: ${rel}`);
            pushed++;
        } catch (err) {
            console.error(`❌ Error saving content record ${rel}:`, err.body || err.message);
        }
    }

    return pushed;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pullServerState(viewsDir, cache, api) {
    let pulled = 0;

    // --- Templates ---
    console.log("📥 Fetching templates...");
    const templates = await api.fetchTemplates();
    const newFileMap = {};
    for (const t of templates) {
        const rel = getFilePath(t.key, t.type);
        if (!rel) continue;
        const full = path.join(viewsDir, rel);
        const prior = cache.fileMap[rel];
        let mtimeMs = prior?.mtimeMs;
        if (!prior || prior.code !== t.code) {
            await fs.outputFile(full, t.code);
            mtimeMs = (await fs.stat(full)).mtimeMs;
            pulled++;
        } else if (mtimeMs == null) {
            try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
        }
        newFileMap[rel] = { key: t.key, type: t.type, code: t.code, mtimeMs };
    }
    for (const rel of Object.keys(cache.fileMap)) {
        if (!newFileMap[rel]) {
            try { await fs.unlink(path.join(viewsDir, rel)); } catch {}
            console.log(`🗑️  Removed template (deleted on server): ${rel}`);
        }
    }
    cache.fileMap = newFileMap;
    console.log(`✔️ Synced ${templates.length} template(s).`);

    // --- Models ---
    try {
        console.log("📥 Fetching models...");
        const models = await api.fetchModels();
        const newModelMap = {};
        for (const m of models) {
            const rel = getModelFilePath(m.key, m.type);
            if (!rel) continue;
            const full = path.join(viewsDir, rel);
            const shape = typeof m.shape === "string" ? m.shape : JSON.stringify(m.shape, null, 2);
            const prior = cache.modelMap[rel];
            let mtimeMs = prior?.mtimeMs;
            if (!prior || prior.shape !== shape) {
                await fs.outputFile(full, shape);
                mtimeMs = (await fs.stat(full)).mtimeMs;
                pulled++;
            } else if (mtimeMs == null) {
                try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
            }
            newModelMap[rel] = { key: m.key, type: m.type, shape, mtimeMs };
        }
        for (const rel of Object.keys(cache.modelMap)) {
            if (!newModelMap[rel]) {
                try { await fs.unlink(path.join(viewsDir, rel)); } catch {}
                console.log(`🗑️  Removed model (deleted on server): ${rel}`);
            }
        }
        cache.modelMap = newModelMap;
        console.log(`✔️ Synced ${Object.keys(newModelMap).length} model(s).`);
    } catch (err) {
        console.warn("⚠️ Could not fetch models:", err.body || err.message);
    }

    // --- Content records ---
    if (ALLOW_CONTENT_UPDATES) {
        try {
            console.log("📥 Fetching content records...");
            const records = await api.fetchContentRecords();
            const newMap = {};
            for (const r of records) {
                const rel = getContentRecordFilePath(r.key, r.type);
                if (!rel) continue;
                const full = path.join(viewsDir, rel);
                const content = JSON.stringify(r.item, null, 2);
                const prior = cache.contentRecordMap[rel];
                const priorContent = prior ? JSON.stringify(prior.item, null, 2) : null;
                let mtimeMs = prior?.mtimeMs;
                if (priorContent !== content) {
                    await fs.outputFile(full, content);
                    mtimeMs = (await fs.stat(full)).mtimeMs;
                    pulled++;
                } else if (mtimeMs == null) {
                    try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
                }
                newMap[rel] = { key: r.key, type: r.type, item: r.item, mtimeMs };
            }
            for (const rel of Object.keys(cache.contentRecordMap)) {
                if (!newMap[rel]) {
                    try { await fs.unlink(path.join(viewsDir, rel)); } catch {}
                    console.log(`🗑️  Removed content record (deleted on server): ${rel}`);
                }
            }
            cache.contentRecordMap = newMap;
            console.log(`✔️ Synced ${Object.keys(newMap).length} content record(s).`);
        } catch (err) {
            console.warn("⚠️ Could not fetch content records:", err.body || err.message);
        }
    }

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
    getFilePath,
    getModelFilePath,
    getContentRecordFilePath,
    parseFilePath,
    parseModelFilePath,
    parseContentRecordFilePath,
};

if (require.main === module) {
    program
        .name("sync-site")
        .description("Incremental sync for an existing SleekCMS workspace. Run from the workspace directory (created by setup-site). Reads token and state from .cache/.")
        .option("--flush", "Discard the local cache and re-pull all files from the server")
        .parse(process.argv);

    const opts = program.opts();
    const viewsDir = path.resolve(process.cwd());
    const tokenPath = path.join(viewsDir, ".cache", "token");

    if (!fs.existsSync(tokenPath)) {
        console.error(`❌ No token found at ${tokenPath}. Run setup-site first to initialize this workspace.`);
        process.exit(1);
    }
    const token = fs.readFileSync(tokenPath, "utf-8").trim();

    syncSite({ token, viewsDir, flush: opts.flush })
        .then(({ viewsDir, site, isFirstRun, pushed, pulled }) => {
            console.log(
                `\n✅ Sync complete for "${site.name}" at ${viewsDir} ` +
                `(${isFirstRun ? "first run" : "incremental"}, pushed=${pushed}, pulled=${pulled}).`
            );
        })
        .catch(err => {
            console.error("❌", err.body || err.message);
            process.exit(1);
        });
}
