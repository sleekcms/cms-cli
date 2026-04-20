/**
 * File watching and update scheduling for the CMS CLI
 */

const fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
const { DEBOUNCE_DELAY } = require("./config");
const { parseFilePath, parseModelFilePath, getModelFilePath } = require("./files");
const api = require("./api");

let watcher = null;
let isShuttingDown = false;
const pendingUpdates = {}; // updateKey -> { filePath, relativePath, isModel, parsed }
let debounceTimer = null;
let fileMap = {};
let modelMap = {};
const ignoredFiles = new Set();

// These will be set during initialization
let viewsDir = null;
let fetchFilesFn = null;

/**
 * Initialize the watcher module with required dependencies
 */
function init(options) {
    viewsDir = options.viewsDir;
    fetchFilesFn = options.fetchFilesFn;
}

/**
 * Get the file map
 */
function getFileMap() {
    return fileMap;
}

/**
 * Set the file map
 */
function setFileMap(map) {
    fileMap = map;
}

/**
 * Get the model map
 */
function getModelMap() {
    return modelMap;
}

/**
 * Set the model map
 */
function setModelMap(map) {
    modelMap = map;
}

/**
 * Set the shutdown flag
 */
function setShuttingDown(value) {
    isShuttingDown = value;
}

/**
 * Refresh a single file from the API
 */
async function refreshFile(filePath) {
    try {
        const relativePath = path.relative(viewsDir, filePath).replace(/\\/g, "/");
        const parsed = parseFilePath(relativePath);
        if (!parsed) {
            console.warn(`⚠️ Cannot refresh: Invalid file path ${relativePath}`);
            return;
        }
        
        const templates = await api.fetchTemplates();
        const template = templates.find(t => t.key === parsed.key && t.type === parsed.type);
        
        if (template) {
            fileMap[relativePath] = { key: template.key, type: template.type, code: template.code };
            await fs.outputFile(filePath, template.code);
            console.log(`✅ Refreshed template for: ${relativePath}`);
        } else {
            console.warn(`⚠️ Template not found on server: ${relativePath}`);
        }
    } catch (error) {
        console.error("❌ Error refreshing template:", error.response?.data || error.message);
    }
}

/**
 * Flush all pending updates immediately
 */
async function flushUpdates() {
    const entries = Object.entries(pendingUpdates);
    const modelEntries = entries.filter(([, e]) => e.isModel);
    const templateEntries = entries.filter(([, e]) => !e.isModel);

    for (const [updateKey, entry] of [...modelEntries, ...templateEntries]) {
        delete pendingUpdates[updateKey];
        const { filePath, relativePath, isModel, parsed } = entry;
        try {
            if (isModel) {
                const model = modelMap[relativePath];
                const shape = await fs.readFile(filePath, "utf-8");
                if (model && shape === model.shape) continue;
                const response = await api.saveModel(parsed.key, parsed.type, shape);
                modelMap[relativePath] = { key: parsed.key, type: parsed.type, shape: response.shape };
                ignoredFiles.add(relativePath);
                await fs.writeFile(filePath, response.shape, "utf-8");
                setTimeout(() => ignoredFiles.delete(relativePath), 100);
                console.log(`✅ ${model ? 'Updated' : 'Created'} model for: ${relativePath}`);
            } else {
                const file = fileMap[relativePath];
                const code = await fs.readFile(filePath, "utf-8");
                if (file && code === file.code) continue;
                await api.saveTemplate(parsed.key, parsed.type, code);
                fileMap[relativePath] = { key: parsed.key, type: parsed.type, code };
                console.log(`✅ ${file ? 'Updated' : 'Created'} template for: ${relativePath}`);
            }
        } catch (error) {
            if (isModel) {
                console.error("❌ Error updating model:", error.response?.data || error.message);
                if (fetchFilesFn) await fetchFilesFn();
            } else {
                console.error("❌ Error updating API:", error.response?.data || error.message);
                await refreshFile(filePath);
            }
        }
    }
}

/**
 * Schedule a debounced file update (template or model)
 */
function scheduleUpdate(filePath) {
    if (isShuttingDown) return;

    const relativePath = path.relative(viewsDir, filePath).replace(/\\/g, "/");
    if (ignoredFiles.has(relativePath)) return;

    const isModel = relativePath.startsWith('models/');

    if (isModel) {
        const parsed = parseModelFilePath(relativePath);
        if (!parsed) {
            console.warn(`⚠️ Skipping update: Invalid model file path ${relativePath}`);
            return;
        }
        pendingUpdates[`model:${parsed.type}:${parsed.key}`] = { filePath, relativePath, isModel: true, parsed };
    } else {
        const parsed = parseFilePath(relativePath);
        if (!parsed) {
            console.warn(`⚠️ Skipping update: Invalid file path ${relativePath}`);
            return;
        }
        const modelRelativePath = getModelFilePath(parsed.key, parsed.type);
        if (modelRelativePath && !modelMap[modelRelativePath]) {
            console.warn(`⚠️ Skipping update: no model found for ${relativePath}`);
            return;
        }
        pendingUpdates[`${parsed.type}:${parsed.key}`] = { filePath, relativePath, isModel: false, parsed };
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushUpdates();
    }, DEBOUNCE_DELAY);
}

/**
 * Start monitoring files for changes
 */
function monitorFiles() {
    watcher = chokidar.watch(viewsDir, { 
        persistent: true, 
        ignoreInitial: true,
        ignored: [/\.vscode\//, /AGENT\.md$/, /CLAUDE\.md$/, /\.sleekcms\//]
    })
    .on("change", (filePath) => {
        scheduleUpdate(filePath);
    })
    .on("add", (filePath) => {
        const relativePath = path.relative(viewsDir, filePath).replace(/\\/g, "/");
        if (ignoredFiles.has(relativePath)) return;
        if (relativePath.startsWith('models/')) {
            if (modelMap[relativePath]) return;
        } else {
            if (fileMap[relativePath]) return;
        }
        scheduleUpdate(filePath);
    })
    .on("unlink", (filePath) => {
        const relativePath = path.relative(viewsDir, filePath).replace(/\\/g, "/");
        ignoredFiles.delete(relativePath);
    });
}

/**
 * Stop watching files
 */
async function stopWatching() {
    if (watcher) {
        await watcher.close();
        watcher = null;
    }
}

module.exports = {
    init,
    getFileMap,
    setFileMap,
    getModelMap,
    setModelMap,
    setShuttingDown,
    refreshFile,
    monitorFiles,
    stopWatching,
};
