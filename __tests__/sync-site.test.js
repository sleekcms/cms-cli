const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const {
    syncSite,
    resolveViewsDir,
} = require("../setup-site");

test("resolveViewsDir builds slug from site name + id", () => {
    const dir = resolveViewsDir("/tmp/base", { name: "My Cool Site", id: 42 });
    assert.equal(dir, path.resolve("/tmp/base", "my-cool-site-42"));
});

test("resolveViewsDir truncates long names to 20 chars", () => {
    const dir = resolveViewsDir("/tmp", { name: "A".repeat(30), id: 7 });
    assert.ok(dir.endsWith("a".repeat(20) + "-7"));
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
        [`GET ${BASE}/mcp/get_site`]: async () => SITE,
        [`GET ${BASE}/mcp/get_files`]: async () => [],
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
        [`GET ${BASE}/mcp/get_files`]: async () => [
            { path: "src/views/pages/home.ejs",     content: "<h1>Home</h1>" },
            { path: "src/public/css/main.css",      content: "body{}" },
            { path: "src/models/pages/home.model",  content: "{ title: string }" },
            { path: "src/content/pages/home.json",  content: JSON.stringify({ title: "Hello" }, null, 2) },
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
        assert.ok(cache.fileMap["src/views/pages/home.ejs"]);
        assert.ok(cache.fileMap["src/models/pages/home.model"]);
        assert.ok(cache.fileMap["src/content/pages/home.json"]);
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

    const saveCalls = []; // each call captures the request body (array of files)

    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/mcp/get_files`]: async () => [
            { path: "src/views/pages/home.ejs",    content: "<h1>Home</h1>" },
            { path: "src/models/pages/home.model", content: "{ title: string }" },
        ],
        [`POST ${BASE}/mcp/save_files`]: async (body) => {
            saveCalls.push(body);
            return body.map((f) => ({ path: f.path, content: f.content, error: null }));
        },
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

        // Second run — single batched save_files call with all 3 changes
        const second = await syncSite({ token: "tok", viewsDir: ws });

        assert.equal(second.isFirstRun, false);
        assert.equal(second.pushed, 3);

        assert.equal(saveCalls.length, 1);
        const body = saveCalls[0];
        assert.equal(body.length, 3);

        const byPath = Object.fromEntries(body.map((f) => [f.path, f.content]));
        assert.equal(byPath["src/models/pages/home.model"], "{ title: string, extra: number }");
        assert.equal(byPath["src/views/pages/home.ejs"], "<h1>Edited</h1>");
        assert.equal(byPath["src/content/pages/home.json"], JSON.stringify({ title: "X" }));

        // Third run with no local changes: save_files is not called.
        saveCalls.length = 0;
        const third = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(third.pushed, 0);
        assert.equal(saveCalls.length, 0);
    });
});

test("syncSite: server-deleted templates are NOT removed on incremental sync (push-only)", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    let files = [
        { path: "src/views/pages/home.ejs",  content: "h" },
        { path: "src/views/pages/about.ejs", content: "a" },
    ];
    global.fetch = makeFetchStub(defaultRoutes({
        [`GET ${BASE}/mcp/get_files`]: async () => files,
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;
        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/about.ejs")));

        // Simulate server-side delete — but incremental sync only pushes, so the
        // local file is NOT removed. Re-run setup-site to re-pull from server.
        files = [{ path: "src/views/pages/home.ejs", content: "h" }];
        await syncSite({ token: "tok", viewsDir: ws });

        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/about.ejs")));
        assert.ok(await fs.pathExists(path.join(ws, "src/views/pages/home.ejs")));
    });
});

test("syncSite: template push does not require a matching model", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saveCalls = [];
    global.fetch = makeFetchStub(defaultRoutes({
        [`POST ${BASE}/mcp/save_files`]: async (body) => {
            saveCalls.push(body);
            return body.map((f) => ({ path: f.path, content: f.content, error: null }));
        },
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        await fs.outputFile(path.join(ws, "src/views/pages/new.ejs"), "<h1>New</h1>");

        const second = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(second.pushed, 1);
        assert.equal(saveCalls.length, 1);
        assert.equal(saveCalls[0].length, 1);
        assert.equal(saveCalls[0][0].path, "src/views/pages/new.ejs");
        assert.equal(saveCalls[0][0].content, "<h1>New</h1>");
    });
});

test("syncSite: images-only edit produces a save_files request with just the images path", async (t) => {
    const origFetch = global.fetch;
    t.after(() => { global.fetch = origFetch; });

    const saveCalls = [];
    global.fetch = makeFetchStub(defaultRoutes({
        [`POST ${BASE}/mcp/save_files`]: async (body) => {
            saveCalls.push(body);
            return body.map((f) => ({ path: f.path, content: f.content, error: null }));
        },
    }));

    await withTempDir(async (tmp) => {
        const first = await syncSite({ token: "tok", path: tmp });
        const ws = first.viewsDir;

        await fs.outputFile(path.join(ws, "src/content/images.json"), JSON.stringify([{ url: "/hero.png" }]));

        const second = await syncSite({ token: "tok", viewsDir: ws });
        assert.equal(second.pushed, 1);
        assert.equal(saveCalls.length, 1);
        assert.equal(saveCalls[0].length, 1);
        assert.equal(saveCalls[0][0].path, "src/content/images.json");
    });
});
