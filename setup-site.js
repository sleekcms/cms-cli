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

const TREE = {
    src: {
        views: { blocks: "ejs", entries: "ejs", pages: "ejs", layouts: "ejs" },
        models: { blocks: "model", entries: "model", pages: "model" },
        content: { pages: "json", entries: "json", images: true },
        public: { js: "js", css: "css" },
    },
};

const PATH_ROOTS = Object.fromEntries(
    Object.keys(TREE.src).map((kind) => [kind, `src/${kind}`])
);

const MODEL_TYPES = new Set(Object.keys(TREE.src.models));
const CONTENT_TYPES = new Set(Object.keys(TREE.src.content).filter((bucket) => bucket !== "images"));
const IMAGES_FILE = `${PATH_ROOTS.content}/images.json`;
const TREE_TYPE_BY_API_TYPE = {
    BASE: "layouts",
    BLOCK: "blocks",
    ENTRY: "entries",
    PAGE: "pages",
};
const API_TYPE_BY_TREE_TYPE = {
    blocks: "BLOCK",
    css: "CSS",
    entries: "ENTRY",
    images: "IMAGES",
    js: "JS",
    layouts: "BASE",
    pages: "PAGE",
};
const FILE_KIND_BY_TYPE = {
    views: ["blocks", "entries", "layouts", "pages"],
    public: ["js", "css"],
};

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
        fetchSite:           ()     => request(tmplBase, token, "GET",  "/site"),
        fetchTemplates:      ()     => request(apiBase,  token, "GET",  "/get_templates"),
        fetchModels:         ()     => request(apiBase,  token, "GET",  "/get_models"),
        fetchContentRecords: ()     => request(apiBase,  token, "GET",  "/get_records"),
        fetchImages:         ()     => request(apiBase,  token, "GET",  "/get_images"),
        saveTemplate:        (item) => request(apiBase,  token, "POST", "/save_template", item),
        saveModel:           (item) => request(apiBase,  token, "POST", "/save_model",    item),
        saveRecord:          (item) => request(apiBase,  token, "POST", "/save_record",   item),
        saveImages:          (item) => request(apiBase,  token, "POST", "/save_images",   item),
    };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const kebabCase = (str) => str.replace(/[\s_]+/g, "-").toLowerCase();


function getPathConfig(kind, type) {
    const bucket = TREE_TYPE_BY_API_TYPE[String(type || "")] || String(type || "").toLowerCase();
    const ext = bucket ? TREE.src[kind]?.[bucket] : null;
    return bucket && ext ? { bucket, ext } : null;
}

function buildPath(kind, type, key) {
    const config = getPathConfig(kind, type);
    if (!config || !key) return null;
    return `${PATH_ROOTS[kind]}/${config.bucket}/${key}.${config.ext}`;
}

function findPathMatch(filePath) {
    if (filePath === IMAGES_FILE) {
        return { kind: "content", type: "images", key: "images", ext: "json", path: filePath };
    }

    const matches = filePath.match(/^src\/([^/]+)\/([^/]+)\/(.+)\.([^/.]+)$/);
    if (!matches) return null;

    const [, kind, bucket, key, ext] = matches;
    if (TREE.src[kind]?.[bucket] !== ext) return null;

    if (bucket === "images") return null;

    return { kind, type: bucket, key, ext, path: filePath };
}


function getFilePath(key, type) {
    const treeType = TREE_TYPE_BY_API_TYPE[String(type || "")] || String(type || "").toLowerCase();
    const kind = Object.entries(FILE_KIND_BY_TYPE).find(([, types]) => types.includes(treeType))?.[0];
    return kind ? buildPath(kind, type, key) : null;
}

function getModelFilePath(key, type) {
    return buildPath("models", type, key);
}

function getContentRecordFilePath(key, type) {
    return buildPath("content", type, key);
}

function validatePath(filePath) {
    const parsed = findPathMatch(filePath);
    if (!parsed) {
        throw new Error(`Invalid path "${filePath}": does not match the configured TREE`);
    }
    return parsed;
}

function parsePath(filePath) {
    try {
        return validatePath(filePath);
    } catch {
        return null;
    }
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

async function ensureSourceStructure(viewsDir) {
    const requiredDirs = [
        "src",
        ...Object.keys(PATH_ROOTS).map((kind) => PATH_ROOTS[kind]),
        ...Object.entries(TREE.src).flatMap(([kind, bucketMap]) => Object.entries(bucketMap)
            .filter(([, ext]) => ext !== true)
            .map(([bucket]) => `${PATH_ROOTS[kind]}/${bucket}`)),
    ];

    await Promise.all([...new Set(requiredDirs)].map((dir) => fs.ensureDir(path.join(viewsDir, dir))));
}

async function loadCache(viewsDir) {
    const { state } = cachePaths(viewsDir);
    if (!(await fs.pathExists(state))) {
        return { fileMap: {}, modelMap: {}, contentRecordMap: {}, imagesJson: null, siteId: null, empty: true };
    }
    const data = await fs.readJson(state);
    return {
        fileMap:          data.fileMap          || {},
        modelMap:         data.modelMap         || {},
        contentRecordMap: data.contentRecordMap || {},
        imagesJson:       data.imagesJson       || null,
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
        imagesJson: cache.imagesJson || null,
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

const PUSH_RESOURCES = [
    {
        name: "images",
        label: "images",
        matches: (parsed) => parsed.type === "images",
        getPrior: (cache) => cache.imagesJson,
        setCache: (cache, _rel, entry) => { cache.imagesJson = entry; },
        save: (api, item) => api.saveImages(item),
        successMessage: () => "✅ Updated images",
    },
    {
        name: "model",
        label: "model",
        matches: (parsed) => parsed.kind === "models",
        getPrior: (cache, rel) => cache.modelMap[rel],
        setCache: (cache, rel, entry) => { cache.modelMap[rel] = entry; },
        save: (api, item) => api.saveModel(item),
    },
    {
        name: "template",
        label: "template",
        matches: (parsed) => parsed.kind === "views" || parsed.kind === "public",
        getPrior: (cache, rel) => cache.fileMap[rel],
        setCache: (cache, rel, entry) => { cache.fileMap[rel] = entry; },
        save: (api, item) => api.saveTemplate(item),
    },
    {
        name: "content record",
        label: "content record",
        matches: (parsed) => parsed.kind === "content" && parsed.type !== "images",
        getPrior: (cache, rel) => cache.contentRecordMap[rel],
        setCache: (cache, rel, entry) => { cache.contentRecordMap[rel] = entry; },
        save: (api, item) => api.saveRecord(item),
    },
];

async function pushLocalResource(viewsDir, cache, api, resource, { rel, parsed }) {
    const full = path.join(viewsDir, rel);
    const prior = resource.getPrior(cache, rel);
    const stat = await fs.stat(full);
    if (prior && prior.mtimeMs === stat.mtimeMs) return 0;

    const readContent = resource.readContent || ((file) => fs.readFile(file, "utf-8"));
    const content = await readContent(full, rel);
    if (content == null) return 0;

    if (prior && content === prior.content) {
        resource.setCache(cache, rel, { ...prior, mtimeMs: stat.mtimeMs });
        return 0;
    }

    const apiType = API_TYPE_BY_TREE_TYPE[parsed.type] || parsed.type;
    try {
        const resp = await resource.save(api, { key: parsed.key, type: apiType, content });
        const finalContent = resp.content ?? content;
        let finalMtime = stat.mtimeMs;
        const currentStat = await fs.stat(full);
        if (currentStat.mtimeMs === stat.mtimeMs && finalContent !== content) {
            await fs.outputFile(full, finalContent);
            finalMtime = (await fs.stat(full)).mtimeMs;
        }
        resource.setCache(cache, rel, { key: parsed.key, type: apiType, content: finalContent, mtimeMs: finalMtime });
        const message = resource.successMessage
            ? resource.successMessage({ prior, rel })
            : `✅ ${prior ? "Updated" : "Created"} ${resource.label}: ${rel}`;
        console.log(message);
        return 1;
    } catch (err) {
        console.error(`❌ Error saving ${resource.name}${resource.name === "images" ? "" : ` ${rel}`}:`, err.body || err.message);
        return 0;
    }
}

/**
 * Push local edits. Order is strict and sequential: images → models → templates → content.
 * Images first, then models (because templates and content may reference model shapes).
 *
 * Cheap-skip: if the file's mtime matches the cached mtime, treat it as
 * unchanged without reading the file.
 */
async function pushLocalChanges(viewsDir, cache, api) {
    const localFiles = await walkFiles(viewsDir);

    const localResources = localFiles
        .map((rel) => ({ rel, parsed: parsePath(rel) }))
        .filter((item) => item.parsed);

    let pushed = 0;

    for (const resource of PUSH_RESOURCES) {
        for (const item of localResources) {
            if (!resource.matches(item.parsed)) continue;
            pushed += await pushLocalResource(viewsDir, cache, api, resource, item);
        }
    }

    return pushed;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pullItems(viewsDir, items, getPath, oldMap) {
    const newMap = {};
    let pulled = 0;
    for (const item of items) {
        const rel = getPath(item.key, item.type);
        if (!rel) continue;
        const full = path.join(viewsDir, rel);
        const prior = oldMap[rel];
        let mtimeMs = prior?.mtimeMs;
        if (!prior || prior.content !== item.content) {
            await fs.outputFile(full, item.content);
            mtimeMs = (await fs.stat(full)).mtimeMs;
            pulled++;
        } else if (mtimeMs == null) {
            try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
        }
        newMap[rel] = { key: item.key, type: item.type, content: item.content, mtimeMs };
    }
    return { newMap, pulled };
}

async function removeStale(viewsDir, oldMap, newMap, label) {
    for (const rel of Object.keys(oldMap)) {
        if (!newMap[rel]) {
            try { await fs.unlink(path.join(viewsDir, rel)); } catch {}
            console.log(`🗑️  Removed ${label} (deleted on server): ${rel}`);
        }
    }
}

async function pullServerState(viewsDir, cache, api) {
    let pulled = 0;

    // --- Templates ---
    console.log("📥 Fetching templates...");
    const templates = await api.fetchTemplates();
    const { newMap: newFileMap, pulled: tPulled } = await pullItems(viewsDir, templates, getFilePath, cache.fileMap);
    await removeStale(viewsDir, cache.fileMap, newFileMap, "template");
    cache.fileMap = newFileMap;
    pulled += tPulled;
    console.log(`✔️ Synced ${templates.length} template(s).`);

    // --- Models ---
    try {
        console.log("📥 Fetching models...");
        const models = await api.fetchModels();
        const { newMap: newModelMap, pulled: mPulled } = await pullItems(viewsDir, models, getModelFilePath, cache.modelMap);
        await removeStale(viewsDir, cache.modelMap, newModelMap, "model");
        cache.modelMap = newModelMap;
        pulled += mPulled;
        console.log(`✔️ Synced ${Object.keys(newModelMap).length} model(s).`);
    } catch (err) {
        console.warn("⚠️ Could not fetch models:", err.body || err.message);
    }

    // --- Content records ---
    try {
        console.log("📥 Fetching content records...");
        const records = await api.fetchContentRecords();
        const { newMap, pulled: rPulled } = await pullItems(viewsDir, records, getContentRecordFilePath, cache.contentRecordMap);
        await removeStale(viewsDir, cache.contentRecordMap, newMap, "content record");
        cache.contentRecordMap = newMap;
        pulled += rPulled;
        console.log(`✔️ Synced ${Object.keys(newMap).length} content record(s).`);
    } catch (err) {
        console.warn("⚠️ Could not fetch content records:", err.body || err.message);
    }

    // --- Images ---
    try {
        console.log("📥 Fetching images...");
        const images = await api.fetchImages();
        const imagesPath = path.join(viewsDir, IMAGES_FILE);
        const prior = cache.imagesJson;
        let mtimeMs = prior?.mtimeMs;
        if (!prior || prior.content !== images.content) {
            await fs.outputFile(imagesPath, images.content);
            mtimeMs = (await fs.stat(imagesPath)).mtimeMs;
            pulled++;
        } else if (mtimeMs == null) {
            try { mtimeMs = (await fs.stat(imagesPath)).mtimeMs; } catch {}
        }
        cache.imagesJson = { key: images.key, type: images.type, content: images.content, mtimeMs };
        console.log("✔️ Synced images.");
    } catch (err) {
        console.warn("⚠️ Could not fetch images:", err.body || err.message);
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
    validatePath,
    parsePath,
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
