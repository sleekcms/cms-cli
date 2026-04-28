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
    parseFilePath,
    parseModelFilePath,
    parseContentRecordFilePath,
} = require("../setup-site");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("kebabCase lowercases and replaces spaces/underscores", () => {
    assert.equal(kebabCase("Hello World"), "hello-world");
    assert.equal(kebabCase("foo_bar  baz"), "foo-bar-baz");
});

test("getFilePath maps type+key to dir/key.ext", () => {
    assert.equal(getFilePath("home", "PAGE"), "pages/home.ejs");
    assert.equal(getFilePath("hero", "BLOCK"), "blocks/hero.ejs");
    assert.equal(getFilePath("main", "CSS"), "css/main.css");
    assert.equal(getFilePath("x", "UNKNOWN"), null);
});

test("getModelFilePath returns null for noModel types", () => {
    assert.equal(getModelFilePath("home", "PAGE"), "models/pages/home.model");
    assert.equal(getModelFilePath("main", "CSS"), null);
    assert.equal(getModelFilePath("main", "JS"), null);
    assert.equal(getModelFilePath("main", "BASE"), null);
});

test("getContentRecordFilePath", () => {
    assert.equal(getContentRecordFilePath("home", "PAGE"), "content/pages/home.json");
    assert.equal(getContentRecordFilePath("", "PAGE"), null);
    assert.equal(getContentRecordFilePath("x", "NOPE"), null);
});

test("parseFilePath round-trips with getFilePath", () => {
    assert.deepEqual(parseFilePath("pages/home.ejs"), { type: "PAGE", key: "home" });
    assert.deepEqual(parseFilePath("css/main.css"), { type: "CSS", key: "main" });
    assert.deepEqual(parseFilePath("blocks/nested/card.ejs"), { type: "BLOCK", key: "nested/card" });
    assert.equal(parseFilePath("unknown/x.ejs"), null);
    assert.equal(parseFilePath("orphan.ejs"), null);
});

test("parseModelFilePath", () => {
    assert.deepEqual(parseModelFilePath("models/pages/home.model"), { type: "PAGE", key: "home" });
    assert.equal(parseModelFilePath("pages/home.model"), null);
    assert.equal(parseModelFilePath("models/pages/home.ejs"), null);
    assert.equal(parseModelFilePath("models/unknown/home.model"), null);
});

test("parseContentRecordFilePath", () => {
    assert.deepEqual(parseContentRecordFilePath("content/pages/home.json"), { type: "PAGE", key: "home" });
    assert.equal(parseContentRecordFilePath("content/home.json"), null);
    assert.equal(parseContentRecordFilePath("content/pages/home.ejs"), null);
    assert.equal(parseContentRecordFilePath("content/unknown/home.json"), null);
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
            { key: "home", type: "PAGE", code: "<h1>Home</h1>" },
            { key: "main", type: "CSS",  code: "body{}" },
        ],
        [`GET ${BASE}/ai_tools/get_models`]: async () => [
            { key: "home", type: "PAGE", shape: "{ title: string }" },
        ],
        [`GET ${BASE}/ai_tools/get_records`]: async () => [
            { key: "home", type: "PAGE", item: { title: "Hello" } },
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

        assert.equal(await fs.readFile(path.join(ws, "pages/home.ejs"), "utf-8"), "<h1>Home</h1>");
        assert.equal(await fs.readFile(path.join(ws, "css/main.css"), "utf-8"), "body{}");
        assert.equal(await fs.readFile(path.join(ws, "models/pages/home.model"), "utf-8"), "{ title: string }");
        assert.equal(
            await fs.readFile(path.join(ws, "content/pages/home.json"), "utf-8"),
            JSON.stringify({ title: "Hello" }, null, 2)
        );

        // Aux files
        assert.equal(await fs.readFile(path.join(ws, "AGENT.md"), "utf-8"), "# Agent");
        assert.equal(await fs.readFile(path.join(ws, "CLAUDE.md"), "utf-8"), "# Agent");
        assert.ok(await fs.pathExists(path.join(ws, ".vscode/settings.json")));

        // Cache + token
        const cache = await fs.readJson(path.join(ws, ".cache/state.json"));
        assert.equal(cache.siteId, 123);
        assert.ok(cache.fileMap["pages/home.ejs"]);
        assert.ok(cache.modelMap["models/pages/home.model"]);
        assert.ok(cache.contentRecordMap["content/pages/home.json"]);
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
            { key: "home", type: "PAGE", code: "<h1>Home</h1>" },
        ],
        [`GET ${BASE}/ai_tools/get_models`]: async () => [
            { key: "home", type: "PAGE", shape: "{ title: string }" },
        ],
        [`POST ${BASE}/ai_tools/save_template`]: async (body) => { saved.templates.push(body); return { ok: true }; },
        [`POST ${BASE}/ai_tools/save_model`]:    async (body) => { saved.models.push(body);    return { shape: body.shape }; },
        [`POST ${BASE}/ai_tools/save_record`]:   async (body) => { saved.records.push(body);   return { item: body.item }; },
    }));

    await withTempDir(async (tmp) => {
        // First run — establishes cache
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        // Edit template and model locally
        await fs.writeFile(path.join(ws, "pages/home.ejs"), "<h1>Edited</h1>");
        await fs.writeFile(path.join(ws, "models/pages/home.model"), "{ title: string, extra: number }");
        // New content record
        await fs.outputFile(path.join(ws, "content/pages/home.json"), JSON.stringify({ title: "X" }));

        // Second run
        const second = await syncSite({ token: "tok", viewsDir: ws });

        assert.equal(second.isFirstRun, false);
        assert.equal(second.pushed, 3);

        // Model was pushed before template (ordering guarantee)
        assert.equal(saved.models.length, 1);
        assert.equal(saved.models[0].key, "home");
        assert.equal(saved.templates.length, 1);
        assert.equal(saved.templates[0].code, "<h1>Edited</h1>");
        assert.equal(saved.records.length, 1);
        assert.deepEqual(saved.records[0].item, { title: "X" });

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
        { key: "home",  type: "PAGE", code: "h" },
        { key: "about", type: "PAGE", code: "a" },
    ];
    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/ai_tools/get_templates`]: async () => templates,
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;
        assert.ok(await fs.pathExists(path.join(ws, "pages/about.ejs")));

        // Simulate server-side delete — but incremental sync only pushes, so the
        // local file is NOT removed. Re-run setup-site to re-pull from server.
        templates = [{ key: "home", type: "PAGE", code: "h" }];
        await syncSite({ token: "tok", viewsDir: ws });

        assert.ok(await fs.pathExists(path.join(ws, "pages/about.ejs")));
        assert.ok(await fs.pathExists(path.join(ws, "pages/home.ejs")));
    });
});

test("syncSite: template push skipped when no matching model exists", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saved = [];
    global.fetch = makeFetchStub(defaultRoutes({
        [`POST ${BASE}/ai_tools/save_template`]: async (body) => { saved.push(body); return {}; },
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        // A PAGE template requires a model, but none exists in cache.
        await fs.outputFile(path.join(ws, "pages/new.ejs"), "<h1>New</h1>");

        const second = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(second.pushed, 0);
        assert.equal(saved.length, 0);
    });
});
