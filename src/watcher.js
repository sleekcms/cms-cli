/**
 * File watching + debounced sync trigger.
 *
 * All push/pull logic lives in sync-site.js. This module only:
 *   - watches the workspace with chokidar
 *   - debounces change events
 *   - calls back into a provided `onSync` handler that invokes syncSite()
 */

const path = require("path");
const chokidar = require("chokidar");

const DEBOUNCE_DELAY = 5000;

let watcher = null;
let isShuttingDown = false;
let debounceTimer = null;
let dirty = false;
let syncInFlight = false;

let viewsDir = null;
let onSync = null;

function init(options) {
    viewsDir = options.viewsDir;
    onSync = options.onSync;
}

function setShuttingDown(value) {
    isShuttingDown = value;
}

async function flush() {
    debounceTimer = null;
    if (!dirty || isShuttingDown) return;
    if (syncInFlight) {
        // Re-arm to retry after the current sync finishes.
        debounceTimer = setTimeout(flush, DEBOUNCE_DELAY);
        return;
    }
    dirty = false;
    syncInFlight = true;
    try {
        await onSync();
    } catch (err) {
        console.error("❌ Sync failed:", err.body || err.message);
    } finally {
        syncInFlight = false;
    }
}

function scheduleSync() {
    if (isShuttingDown) return;
    dirty = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_DELAY);
}

function watchTargets(rootDir) {
    return [path.join(rootDir, "src", "**", "*")];
}

function monitorFiles() {
    watcher = chokidar.watch(watchTargets(viewsDir), {
        persistent: true,
        ignoreInitial: true,
    })
        .on("change", (path) => { console.log(`📝 Changed: ${path}`); scheduleSync(); })
        .on("add", (path) => { console.log(`➕ Added: ${path}`); scheduleSync(); })
        .on("unlink", (path) => { console.log(`🗑️  Deleted: ${path}`); scheduleSync(); });
}

async function stopWatching() {
    if (watcher) {
        await watcher.close();
        watcher = null;
    }
}

module.exports = {
    init,
    setShuttingDown,
    monitorFiles,
    stopWatching,
};
