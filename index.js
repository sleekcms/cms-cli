#!/usr/bin/env node

/**
 * SleekCMS CLI — interactive entry point.
 *
 * Handles CLI prompts, editor launch, and file watching. All sync work
 * (fetch, push, pull, cache) is delegated to sync-site.js so the same
 * logic can be invoked standalone (e.g. as a skill for managed agents).
 */

const fs = require("fs-extra");
const path = require("path");

const cli = require("./src/cli");
const watcher = require("./src/watcher");
const { syncSite } = require("./setup-site");

const agentMdContent = fs.readFileSync(path.join(__dirname, "Agent.md"), "utf-8");

const options = cli.parseArgs();

if (options.version) {
    console.log(require("./package.json").version);
    process.exit(0);
}

let VIEWS_DIR = null;
let ENV = null;
let TOKEN = null;
let site = null;
let isShuttingDown = false;

async function cleanupFiles(dir) {
    if (!dir) return;
    console.log("🧹 Cleaning up files...");
    try {
        await fs.remove(dir);
        console.log(`✅ Cleanup complete. Deleted workspace at ${dir}.`);
    } catch (err) {
        console.error("❌ Error during cleanup:", err.message);
    }
}

async function runSync({ flush = false } = {}) {
    const result = await syncSite({
        token: TOKEN,
        viewsDir: VIEWS_DIR,
        path: VIEWS_DIR ? undefined : options.path,
        env: ENV,
        agentMd: agentMdContent,
        flush,
    });
    VIEWS_DIR = result.viewsDir;
    site = result.site;
    return result;
}

async function initConfig() {
    TOKEN = options.token;
    if (!TOKEN) {
        TOKEN = await cli.prompt("Enter SleekCMS CLI auth token: ");
        if (!TOKEN) {
            console.error("❌ Token is required.");
            process.exit(1);
        }
    }

    const tokenParts = TOKEN.trim().split("-");
    ENV = (tokenParts[2] || options.env || "production").toLowerCase();

    let customPath = options.path;
    if (!customPath) {
        customPath = await cli.prompt("Enter workspace folder path (or press Enter for current directory): ");
    }
    if (customPath && customPath.startsWith("~")) {
        customPath = path.join(require("os").homedir(), customPath.slice(1));
    }
    options.path = customPath;
}

async function handleExit() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    watcher.setShuttingDown(true);
    console.log("\n⚠️ Shutting down...");

    await watcher.stopWatching();
    await cleanupFiles(VIEWS_DIR);

    process.exit(0);
}

async function main() {
    await initConfig();

    try {
        await runSync();
    } catch (err) {
        console.error("❌ Sync failed:", err.body || err.message);
        process.exit(1);
    }

    watcher.init({ viewsDir: VIEWS_DIR, onSync: runSync });
    watcher.monitorFiles();

    console.log(`\n✅ Ready! Editing session started for site - ${site.name}.`);
    console.log(`\n📁 Workspace created at: ${VIEWS_DIR}`);
    if (ENV !== "production") console.log(`🌐 Environment: ${ENV}`);
    console.log(`\n⚠️  Files will be cleaned up on exit (Ctrl+C).`);

    cli.showEditorMenu(VIEWS_DIR, {
        onExit: handleExit,
        onRefetch: () => runSync({ flush: true }),
    });

    process.on("SIGINT", async () => {
        console.log("\n🛑 Caught interrupt signal (Ctrl+C)");
        await handleExit();
    });

    process.on("SIGTERM", async () => {
        console.log("\n🛑 Caught termination signal");
        await handleExit();
    });
}

main();
