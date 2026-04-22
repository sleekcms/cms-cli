#!/usr/bin/env node

/**
 * SleekCMS CLI - Main entry point
 * 
 * Downloads templates from the CMS, watches for changes,
 * and syncs updates back to the API.
 */

const fs = require("fs-extra");
const path = require("path");

// Load modules
const api = require("./src/api");
const cli = require("./src/cli");
const fileUtils = require("./src/files");
const watcher = require("./src/watcher");
const { ALLOW_CONTENT_UPDATES } = require("./src/config");

// Load agent instructions
const agentMdContent = fs.readFileSync(path.join(__dirname, "Agent.md"), "utf-8");

// Parse CLI arguments
const options = cli.parseArgs();

// Handle version flag
if (options.version) {
    const { version } = require("./package.json");
    console.log(version);
    process.exit(0);
}

// Global state
let VIEWS_DIR = null;
let ENV = null;
let site = null;
let isShuttingDown = false;

/**
 * Initialize configuration from CLI args and user prompts
 */
async function initConfig() {
    let authToken = options.token;
    if (!authToken) {
        authToken = await cli.prompt("Enter SleekCMS CLI auth token: ");
        if (!authToken) {
            console.error("❌ Token is required.");
            process.exit(1);
        }
    }

    const tokenParts = authToken.trim().split('-');
    ENV = (tokenParts[2] || options.env || "production").toLowerCase();

    let customPath = options.path;
    if (!customPath) {
        customPath = await cli.prompt("Enter workspace folder path (or press Enter for current directory): ");
    }
    if (customPath && customPath.startsWith("~")) {
        customPath = path.join(require("os").homedir(), customPath.slice(1));
    }

    // Initialize API clients
    api.initApiClients(authToken, ENV);

    // Fetch site info
    try {
        site = await api.fetchSite();
    } catch (error) {
        console.error("❌ Error fetching site info. Please check your token and network connection.");
        console.error(error.response?.data || error.message);
        process.exit(1);
    }

    const viewsFolder = fileUtils.kebabCase(`${site.name.substr(0, 20)} ${site.id}`);
    VIEWS_DIR = customPath 
        ? path.resolve(customPath, viewsFolder) 
        : path.resolve(viewsFolder);

    // Initialize watcher with dependencies
    watcher.init({
        viewsDir: VIEWS_DIR,
        fetchFilesFn: fetchFiles,
    });
}

/**
 * Fetch and save all files from the API
 */
async function fetchFiles() {
    const currentFileMap = watcher.getFileMap();
    const currentContentRecordMap = watcher.getContentRecordMap();

    try {
        console.log("📥 Fetching templates...");
        const templates = await api.fetchTemplates();

        await fs.ensureDir(VIEWS_DIR);

        // Track old files to detect deletions
        const oldFilePaths = new Set(Object.keys(currentFileMap));
        const newFilePaths = new Set();
        const newFileMap = {};

        for (const template of templates) {
            const { key, type, code } = template;
            const relativePath = fileUtils.getFilePath(key, type);
            
            if (relativePath) {
                const filePath = path.join(VIEWS_DIR, relativePath);
                await fs.outputFile(filePath, code);
                const normalizedPath = relativePath.replace(/\\/g, "/");
                newFileMap[normalizedPath] = { key, type, code };
                newFilePaths.add(normalizedPath);
            }
        }

        // Remove files that no longer exist on the server
        for (const oldPath of oldFilePaths) {
            if (!newFilePaths.has(oldPath)) {
                const filePath = path.join(VIEWS_DIR, oldPath);
                try {
                    await fs.unlink(filePath);
                    console.log(`🗑️  Removed (deleted on server): ${oldPath}`);
                } catch (err) {
                    // File may already be gone locally
                }
            }
        }

        watcher.setFileMap(newFileMap);
        console.log(`✔️ Downloaded ${templates.length} template(s).`);

        // Fetch and save content model definitions
        try {
            console.log("📥 Fetching models...");
            const models = await api.fetchModels();
            const newModelMap = {};
            let modelCount = 0;
            
            for (const model of models) {
                const { key, type, shape } = model;
                const relativePath = fileUtils.getModelFilePath(key, type);
                
                if (relativePath) {
                    const filePath = path.join(VIEWS_DIR, relativePath);
                    const content = typeof shape === 'string' ? shape : JSON.stringify(shape, null, 2);
                    await fs.outputFile(filePath, content);
                    const normalizedPath = relativePath.replace(/\\/g, "/");
                    newModelMap[normalizedPath] = { key, type, shape: content };
                    modelCount++;
                }
            }
            
            watcher.setModelMap(newModelMap);
            console.log(`✔️ Downloaded ${modelCount} model(s).`);
        } catch (modelsError) {
            console.warn("⚠️ Could not fetch models:", modelsError.response?.data || modelsError.message);
        }

        // Fetch and save content records
        if (ALLOW_CONTENT_UPDATES) try {
            console.log("📥 Fetching content records...");
            const records = await api.fetchContentRecords();
            const oldContentPaths = new Set(Object.keys(currentContentRecordMap));
            const newContentPaths = new Set();
            const newContentRecordMap = {};
            let contentRecordCount = 0;

            for (const record of records) {
                const { key, type, item } = record;
                const relativePath = fileUtils.getContentRecordFilePath(key, type);

                if (relativePath) {
                    const filePath = path.join(VIEWS_DIR, relativePath);
                    const content = JSON.stringify(item, null, 2);
                    await fs.outputFile(filePath, content);
                    const normalizedPath = relativePath.replace(/\\/g, "/");
                    newContentRecordMap[normalizedPath] = { key, type, item };
                    newContentPaths.add(normalizedPath);
                    contentRecordCount++;
                }
            }

            for (const oldPath of oldContentPaths) {
                if (!newContentPaths.has(oldPath)) {
                    const filePath = path.join(VIEWS_DIR, oldPath);
                    try {
                        await fs.unlink(filePath);
                        console.log(`🗑️  Removed content record (deleted on server): ${oldPath}`);
                    } catch (err) {
                        // File may already be gone locally
                    }
                }
            }

            watcher.setContentRecordMap(newContentRecordMap);
            console.log(`✔️ Downloaded ${contentRecordCount} content record(s).`);
        } catch (recordsError) {
            console.warn("⚠️ Could not fetch content records:", recordsError.response?.data || recordsError.message);
        }
        
        // Write agent instruction files and VS Code settings
        await fileUtils.writeAgentFiles(VIEWS_DIR, agentMdContent);
        await fileUtils.writeVSCodeSettings(VIEWS_DIR);
        console.log(`✔️ Created VS Code settings`);

    } catch (error) {
        console.error("❌ Error fetching files:", error.response?.data || error.message);
    }
}

/**
 * Graceful shutdown handler
 */
async function handleExit() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    watcher.setShuttingDown(true);
    console.log("\n⚠️ Shutting down...");

    await watcher.stopWatching();
    await fileUtils.cleanupFiles(VIEWS_DIR);

    process.exit(0);
}

/**
 * Main function
 */
async function main() {
    await initConfig();
    await fetchFiles();
    watcher.monitorFiles();
    
    console.log(`\n✅ Ready! Editing session started for site - ${site.name}.`);
    console.log(`\n📁 Workspace created at: ${VIEWS_DIR}`);
    if (ENV !== 'production') console.log(`🌐 Environment: ${ENV}`);
    console.log(`\n⚠️  Files will be cleaned up on exit (Ctrl+C).`);
    
    cli.showEditorMenu(VIEWS_DIR, {
        onExit: handleExit,
        onRefetch: fetchFiles,
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

// Execute when script runs
main();
