const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const {
    syncSite,
    resolveViewsDir,
    kebabCase,
    getFilePath,
    getModelFilePath,
    getContentRecordFilePath,
    validatePath,
    parsePath,
} = require("../setup-site");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("kebabCase lowercases and replaces spaces/underscores", () => {
    assert.equal(kebabCase("Hello World"), "hello-world");
    assert.equal(kebabCase("foo_bar  baz"), "foo-bar-baz");
});

test("getFilePath maps type+key to dir/key.ext", () => {
    assert.equal(getFilePath("home", "PAGES"), "src/views/pages/home.ejs");
    assert.equal(getFilePath("hero", "BLOCKS"), "src/views/blocks/hero.ejs");
    assert.equal(getFilePath("main", "CSS"), "src/public/css/main.css");
    assert.equal(getFilePath("x", "UNKNOWN"), null);
});

test("getModelFilePath returns null for noModel types", () => {
    assert.equal(getModelFilePath("home", "PAGES"), "src/models/pages/home.model");
    assert.equal(getModelFilePath("main", "CSS"), null);
    assert.equal(getModelFilePath("main", "JS"), null);
    assert.equal(getModelFilePath("main", "BASE"), null);
});

test("getContentRecordFilePath", () => {
    assert.equal(getContentRecordFilePath("home", "PAGES"), "src/content/pages/home.json");
    assert.equal(getContentRecordFilePath("", "PAGE"), null);
    assert.equal(getContentRecordFilePath("x", "NOPE"), null);
});

test("parsePath identifies templates", () => {
    assert.deepEqual(parsePath("src/views/pages/home.ejs"), { kind: "views", type: "pages", key: "home", ext: "ejs", path: "src/views/pages/home.ejs" });
    assert.deepEqual(parsePath("src/public/css/main.css"), { kind: "public", type: "css", key: "main", ext: "css", path: "src/public/css/main.css" });
    assert.deepEqual(parsePath("src/views/blocks/nested/card.ejs"), { kind: "views", type: "blocks", key: "nested/card", ext: "ejs", path: "src/views/blocks/nested/card.ejs" });
    assert.equal(parsePath("unknown/x.ejs"), null);
    assert.equal(parsePath("orphan.ejs"), null);
});

test("parsePath identifies models", () => {
    assert.deepEqual(parsePath("src/models/pages/home.model"), { kind: "models", type: "pages", key: "home", ext: "model", path: "src/models/pages/home.model" });
    assert.equal(parsePath("models/pages/home.model"), null);
    assert.equal(parsePath("src/models/pages/home.ejs"), null);
    assert.equal(parsePath("src/models/unknown/home.model"), null);
});

test("parsePath identifies content records", () => {
    assert.deepEqual(parsePath("src/content/pages/home.json"), { kind: "content", type: "pages", key: "home", ext: "json", path: "src/content/pages/home.json" });
    assert.deepEqual(parsePath("src/content/images.json"), { kind: "content", type: "images", key: "images", ext: "json", path: "src/content/images.json" });
    assert.equal(parsePath("content/home.json"), null);
    assert.equal(parsePath("src/content/pages/home.ejs"), null);
    assert.equal(parsePath("src/content/unknown/home.json"), null);
});

test("validatePath returns parsed path for valid inputs", () => {
    assert.deepEqual(validatePath("src/views/pages/home.ejs"), { kind: "views", type: "pages", key: "home", ext: "ejs", path: "src/views/pages/home.ejs" });
    assert.deepEqual(validatePath("src/models/pages/home.model"), { kind: "models", type: "pages", key: "home", ext: "model", path: "src/models/pages/home.model" });
    assert.deepEqual(validatePath("src/content/pages/home.json"), { kind: "content", type: "pages", key: "home", ext: "json", path: "src/content/pages/home.json" });
    assert.deepEqual(validatePath("src/content/images.json"), { kind: "content", type: "images", key: "images", ext: "json", path: "src/content/images.json" });
});

test("validatePath throws for invalid inputs", () => {
    assert.throws(() => validatePath("unknown/x.ejs"), /does not match the configured TREE/);
    assert.throws(() => validatePath("src/models/pages/home.ejs"), /does not match the configured TREE/);
    assert.throws(() => validatePath("src/content/unknown/home.json"), /does not match the configured TREE/);
});

test("resolveViewsDir builds slug from site name + id", () => {
    const dir = resolveViewsDir("/tmp/base", { name: "My Cool Site", id: 42 });
    assert.equal(dir, path.resolve("/tmp/base", "my-cool-site-42"));
});

test("resolveViewsDir truncates long names to 20 chars", () => {
    const dir = resolveViewsDir("/tmp", { name: "A".repeat(30), id: 7 });
    assert.ok(dir.endsWith(kebabCase("A".repeat(20) + " 7")));
});

// ---------------------------------------------------------------------------
// syncSite integration (fetch stubbed, real temp fs)
// ---------------------------------------------------------------------------

function makeFetchStub(routes) {
    return async (url, init = {}) => {
        const method = init.method || "GET";
        const key = `${method} ${url}`;
        const handler = routes[key];
        if (!handler) {
            return {
                ok: false,
                status: 404,
                text: async () => `no stub for ${key}`,
                json: async () => ({}),
            };
        }
        const body = init.body ? JSON.parse(init.body) : undefined;
        const result = await handler(body);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(result),
            json: async () => result,
        };
    };
}

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-site-test-"));
    try {
        await fn(dir);
    } finally {
        await fs.remove(dir);
    }
}

const SITE = { id: 123, name: "Demo" };
const BASE = "https://app.sleekcms.com/api";

function defaultRoutes(overrides = {}) {
    return {
        [`GET ${BASE}/template/site`]: async () => SITE,
        [`GET ${BASE}/ai_tools/get_templates`]: async () => [],
        [`GET ${BASE}/ai_tools/get_models`]: async () => [],
        [`GET ${BASE}/ai_tools/get_records`]: async () => [],
        ...overrides,
    };
}

test("syncSite: token is required", async () => {
    await assert.rejects(() => syncSite({ token: "" }), /token is required/);
});

test("syncSite: first run creates workspace, pulls files, writes cache + aux", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/ai_tools/get_templates`]: async () => [
            { key: "home", type: "PAGE", content: "<h1>Home</h1>" },
            { key: "main", type: "css",  content: "body{}" },
        ],
        [`GET ${BASE}/ai_tools/get_models`]: async () => [
            { key: "home", type: "PAGE", content: "{ title: string }" },
        ],
        [`GET ${BASE}/ai_tools/get_records`]: async () => [
            { key: "home", type: "PAGE", content: JSON.stringify({ title: "Hello" }, null, 2) },
        ],
    }));

    await withTempDir(async (tmp) => {
        const result = await syncSite({
            token: "tok-xyz-production",
            path: tmp,
            agentMd: "# Agent",
        });

        assert.equal(result.isFirstRun, true);
        assert.equal(result.pushed, 0);
        assert.equal(result.pulled, 4);
        assert.equal(result.site.id, 123);

        const ws = result.viewsDir;
        assert.ok(ws.endsWith("demo-123"));

        assert.equal(await fs.readFile(path.join(ws, "src/views/pages/home.ejs"), "utf-8"), "<h1>Home</h1>");
        assert.equal(await fs.readFile(path.join(ws, "src/public/css/main.css"), "utf-8"), "body{}");
        assert.equal(await fs.readFile(path.join(ws, "src/models/pages/home.model"), "utf-8"), "{ title: string }");
        assert.equal(
            await fs.readFile(path.join(ws, "src/content/pages/home.json"), "utf-8"),
            JSON.stringify({ title: "Hello" }, null, 2)
        );

        // Setup should create the full src scaffold, even for empty directories.
        const requiredDirs = [
            "src/views",
            "src/views/pages",
            "src/views/entries",
            "src/views/blocks",
            "src/views/layouts",
            "src/models",
            "src/models/pages",
            "src/models/entries",
            "src/models/blocks",
            "src/content",
            "src/content/pages",
            "src/content/entries",
            "src/public",
            "src/public/js",
            "src/public/css",
        ];
        for (const rel of requiredDirs) {
            assert.ok(await fs.pathExists(path.join(ws, rel)), `missing directory: ${rel}`);
        }

        // Aux files
        assert.equal(await fs.readFile(path.join(ws, "AGENT.md"), "utf-8"), "# Agent");
        assert.equal(await fs.readFile(path.join(ws, "CLAUDE.md"), "utf-8"), "# Agent");
        assert.ok(await fs.pathExists(path.join(ws, ".vscode/settings.json")));

        // Cache + token
        const cache = await fs.readJson(path.join(ws, ".cache/state.json"));
        assert.equal(cache.siteId, 123);
        assert.ok(cache.fileMap["src/views/pages/home.ejs"]);
        assert.ok(cache.modelMap["src/models/pages/home.model"]);
        assert.ok(cache.contentRecordMap["src/content/pages/home.json"]);
        assert.equal((await fs.readFile(path.join(ws, ".cache/token"), "utf-8")).trim(), "tok-xyz-production");
    });
});

test("syncSite: token mismatch on existing workspace throws", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });
    global.fetch = makeFetchStub(defaultRoutes());

    await withTempDir(async (tmp) => {
        const ws = path.join(tmp, "ws");
        await fs.ensureDir(path.join(ws, ".cache"));
        await fs.writeFile(path.join(ws, ".cache/token"), "old-token");

        await assert.rejects(
            () => syncSite({ token: "new-token", viewsDir: ws }),
            /tied to a different token/
        );
    });
});

test("syncSite: second run pushes local edits and skips unchanged files", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saved = { templates: [], models: [], records: [] };

    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/ai_tools/get_templates`]: async () => [
            { key: "home", type: "PAGE", content: "<h1>Home</h1>" },
        ],
        [`GET ${BASE}/ai_tools/get_models`]: async () => [
            { key: "home", type: "PAGE", content: "{ title: string }" },
        ],
        [`POST ${BASE}/ai_tools/save_template`]: async (body) => { saved.templates.push(body); return { ok: true }; },
        [`POST ${BASE}/ai_tools/save_model`]:    async (body) => { saved.models.push(body);    return { content: body.content }; },
        [`POST ${BASE}/ai_tools/save_record`]:   async (body) => { saved.records.push(body);   return { content: body.content }; },
    }));

    await withTempDir(async (tmp) => {
        // First run — establishes cache
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        // Edit template and model locally
        await fs.writeFile(path.join(ws, "src/views/pages/home.ejs"), "<h1>Edited</h1>");
        await fs.writeFile(path.join(ws, "src/models/pages/home.model"), "{ title: string, extra: number }");
        // New content record
        await fs.outputFile(path.join(ws, "src/content/pages/home.json"), JSON.stringify({ title: "X" }));

        // Second run
        const second = await syncSite({ token: "tok", viewsDir: ws });

        assert.equal(second.isFirstRun, false);
        assert.equal(second.pushed, 3);

        // Model was pushed before template (ordering guarantee)
        assert.equal(saved.models.length, 1);
        assert.equal(saved.models[0].key, "home");
        assert.equal(saved.templates.length, 1);
        assert.equal(saved.templates[0].content, "<h1>Edited</h1>");
        assert.equal(saved.records.length, 1);
        assert.equal(saved.records[0].content, JSON.stringify({ title: "X" }));

        // Third run with no local changes: nothing pushed
        saved.templates.length = 0;
        saved.models.length = 0;
        saved.records.length = 0;
        const third = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(third.pushed, 0);
        assert.equal(saved.templates.length, 0);
        assert.equal(saved.models.length, 0);
    });
});

test("syncSite: server-deleted templates are NOT removed on incremental sync (push-only)", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    let templates = [
        { key: "home",  type: "PAGE", content: "h" },
        { key: "about", type: "PAGE", content: "a" },
    ];
    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/ai_tools/get_templates`]: async () => templates,
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;
        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/about.ejs")));

        // Simulate server-side delete — but incremental sync only pushes, so the
        // local file is NOT removed. Re-run setup-site to re-pull from server.
        templates = [{ key: "home", type: "PAGE", content: "h" }];
        await syncSite({ token: "tok", viewsDir: ws });

        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/about.ejs")));
        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/home.ejs")));
    });
});

test("syncSite: template push does not require a matching model", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saved = [];
    global.fetch = makeFetchStub(defaultRoutes({
        [`POST ${BASE}/ai_tools/save_template`]: async (body) => { saved.push(body); return {}; },
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        await fs.outputFile(path.join(ws, "src/views/pages/new.ejs"), "<h1>New</h1>");

        const second = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(second.pushed, 1);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].key, "new");
        assert.equal(saved[0].type, "PAGE");
    });
});

test("syncSite: images push uses images endpoint only", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saved = { images: [], records: [] };
    global.fetch = makeFetchStub(defaultRoutes({
        [`POST ${BASE}/ai_tools/save_images`]: async (body) => { saved.images.push(body); return { content: body.content }; },
        [`POST ${BASE}/ai_tools/save_record`]: async (body) => { saved.records.push(body); return { content: body.content }; },
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        await fs.outputFile(path.join(ws, "src/content/images.json"), JSON.stringify([{ url: "/hero.png" }]));

        const second = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(second.pushed, 1);
        assert.equal(saved.images.length, 1);
        assert.equal(saved.images[0].key, "images");
        assert.equal(saved.images[0].type, "IMAGES");
        assert.equal(saved.records.length, 0);
    });
});
