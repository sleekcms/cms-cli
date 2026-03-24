#!/usr/bin/env node

const fs = require("fs-extra");
const axios = require("axios");
const chokidar = require("chokidar");
const { program } = require("commander");
const path = require("path");
const { execSync, spawn } = require("child_process");
const readline = require("readline");
const agentMdContent = require("./agent.js");

const kebabCase = (str) => str.replace(/[\s_]+/g, "-").toLowerCase();

const API_BASE_URLS = {
    localhost: "http://localhost:9000/api/template",
    development: "https://app.sleekcms.net/api/template",
    production: "https://app.sleekcms.com/api/template",
}

const DEBOUNCE_DELAY = 1000; // 2 seconds delay
let isShuttingDown = false;
const pendingUpdates = {};
let fileMap = {};
let watcher;
const addQueue = [];
let processingAdd = false;

// CLI Setup to take `--token=<token>`
program
    .name("cms-cli")
    .description("SleekCMS CLI tool to sync and edit CMS templates locally. Downloads templates, watches for changes, and syncs updates back to the API.")
    .version("1.0.0", "-v, --version", "output the version number")
    .option("-t, --token <token>", "API authentication token (required)")
    .option("-e, --env <env>", "Environment (localhost, development, production)", "production")
    .option("-p, --path <path>", "Directory path for files (default: <token-prefix>-views)")
    .addHelpText("after", `
Examples:
  $ cms-cli --token abc123-xxxx
  $ cms-cli -t abc123-xxxx -e development
  $ cms-cli -t abc123-xxxx -p ./my-templates
`)
    .parse(process.argv);

const options = program.opts();

// Will be set after prompting if needed
let AUTH_TOKEN;
let ENV;
let API_BASE_URL;
let VIEWS_DIR;
let apiClient;
let site = null;
let rawModeEnabled = false;

function suspendRawMode() {
    if (process.stdin.isTTY && rawModeEnabled) {
        process.stdin.setRawMode(false);
    }
}

function resumeRawMode() {
    if (process.stdin.isTTY && rawModeEnabled) {
        process.stdin.setRawMode(true);
    }
}

function prompt(question) {
    suspendRawMode();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resumeRawMode();
            resolve(answer.trim());
        });
    });
}

async function initConfig() {
    AUTH_TOKEN = options.token;
    if (!AUTH_TOKEN) {
        AUTH_TOKEN = await prompt("Enter SleekCMS CLI auth token: ");
        if (!AUTH_TOKEN) {
            console.error("❌ Token is required.");
            process.exit(1);
        }
    }

    const tokenParts = AUTH_TOKEN.trim().split('-');
    ENV = (tokenParts[2] || options.env || "production").toLowerCase();
    API_BASE_URL = API_BASE_URLS[ENV] || API_BASE_URLS.production;

    let customPath = options.path;
    if (!customPath) {
        customPath = await prompt("Enter workspace folder path (or press Enter for current directory): ");
    }
    if (customPath && customPath.startsWith("~")) {
        customPath = path.join(require("os").homedir(), customPath.slice(1));
    }

    apiClient = axios.create({
      baseURL: API_BASE_URL,
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    site = await apiClient.get("/site");

    const viewsFolder = kebabCase(`${site.data.name.substr(0,20)} ${site.data.id}`);

    VIEWS_DIR = customPath 
        ? path.resolve(customPath, viewsFolder) 
        : path.resolve(viewsFolder);

}

async function refreshFile(filePath) {
    try {
        const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/");
        const resp = await apiClient.get(`/${fileMap[relativePath].id}`);
        const template = resp.data;
        fileMap[relativePath] = template;
        await fs.outputFile(filePath, template.code);
        console.log(`✅ Refreshed template for: ${relativePath}`);
    } catch (error) {
        console.error("❌ Error refreshing template:", error.response?.data || error.message);
    }
}

// Function to fetch and save files
async function fetchFiles() {
    try {
        console.log("📥 Fetching source code...");
        const response = await apiClient.get("/");

        await fs.ensureDir(VIEWS_DIR);

        for (const file of response.data) {
            if (file.file_path) {
                const filePath = path.join(VIEWS_DIR, file.file_path);
                await fs.outputFile(filePath, file.code);
                fileMap[file.file_path.replace(/\\/g,"/")] = file;
                //console.log(`✅ Created: ${filePath}`);
            }
        }

        console.log(`✔️ Downloaded ${response.data.length} file(s).`);

        // Fetch and save TypeScript types
        try {
            const typesResponse = await apiClient.get("/types");
            const sleekcmsDir = path.join(VIEWS_DIR, '.sleekcms');
            await fs.ensureDir(sleekcmsDir);
            await fs.outputFile(path.join(sleekcmsDir, 'types.ts'), typesResponse.data.typescript);
            console.log(`✔️ Downloaded types.ts`);
        } catch (typesError) {
            console.warn("⚠️ Could not fetch types:", typesError.response?.data || typesError.message);
        }
        
        // Create AGENT.md
        await fs.outputFile(path.join(VIEWS_DIR, 'AGENT.md'), agentMdContent);
    } catch (error) {
        console.error("❌ Error fetching files:", error.response?.data || error.message);
    }
}

// Function to clean up views directory
async function cleanupFiles() {
    console.log("🧹 Cleaning up files...");
    try {
        await fs.remove(VIEWS_DIR);
        console.log(`✅ Cleanup complete. Deleted workspace at ${VIEWS_DIR} .`);
    } catch (error) {
        console.error("❌ Error during cleanup:", error.message);
    }
}


// Function to handle debounced updates
function scheduleUpdate(filePath) {
    if (isShuttingDown) return;

    const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/"); // Extract relative file path
    if (ignoredFiles.has(relativePath)) return;
    const file = fileMap[relativePath];

    if (!file?.id) {
        console.warn(`⚠️ Skipping update: No matching file found in API for ${relativePath}`);
        return;
    }

    // Clear previous timeout if it exists
    if (pendingUpdates[file.id]) {
        clearTimeout(pendingUpdates[file.id]);
    }

    // Schedule a new update after the debounce delay
    pendingUpdates[file.id] = setTimeout(async () => {
        try {
            const code = await fs.readFile(filePath, "utf-8");

            // Skip API call if content hasn't changed
            if (code === file.code) {
                delete pendingUpdates[file.id];
                return;
            }

            let template = await apiClient.patch(`/${file.id}`, { code: code || "foo bar", updated_at: file.updated_at });
            fileMap[relativePath] = template.data;
            console.log(`✅ Updated template for: ${relativePath}`);

            delete pendingUpdates[file.id]; // Cleanup
        } catch (error) {
            console.error("❌ Error updating API:", error.response?.data || error.message);
            // refresh file
            await refreshFile(filePath);
        }
    }, DEBOUNCE_DELAY);
}

async function createSchema(relativePath) {
    if (isShuttingDown) return;
    try {
        const resp = await apiClient.post("/cli", { file_path: relativePath});
        let template;
        if (relativePath.startsWith("js") || relativePath.startsWith("css")) {
            template = resp.data;
        } else {
            const schema = resp.data;
            const templateResp = await apiClient.get(`/${schema.tmpl_main_id}`);
            template = templateResp.data;    
        }
        if (relativePath !== template.file_path) {
            // rename the file
            const oldPath = path.join(VIEWS_DIR, relativePath);
            const newPath = path.join(VIEWS_DIR, template.file_path);
            watcher.unwatch(newPath);
            await fs.move(oldPath, newPath);
            watcher.add(newPath);
            console.log(`✅ Renamed file from ${relativePath} to ${template.file_path}`);
        }
        fileMap[template.file_path.replace(/\\/g, "/")] = template;
        scheduleUpdate(path.join(VIEWS_DIR, template.file_path));
        console.log("✅ Synced:", template.file_path);
    } catch (error) {
        console.error(`❌ Error creating model (${relativePath}):`, error.response?.data || error.message);
        // delete the file locally
        await fs.unlink(path.join(VIEWS_DIR, relativePath));
    }
}

const ignoredFiles = new Set();

async function processAddQueue() {
    if (processingAdd) return;
    processingAdd = true;
    while (addQueue.length > 0) {
        const filePath = addQueue.shift();
        const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/");
        if (!await fs.pathExists(filePath)) {
            ignoredFiles.delete(relativePath);
            continue;
        }
        const answer = await prompt(`New file detected: ${relativePath}. Create model? (y)es / (n)o / (i)gnore: `);
        if (!await fs.pathExists(filePath)) {
            ignoredFiles.delete(relativePath);
            console.log(`⏭️  Skipped: ${relativePath} (file was deleted)`);
            continue;
        }
        const choice = answer.toLowerCase();
        if (choice === 'y') {
            ignoredFiles.delete(relativePath);
            await createSchema(relativePath);
        } else if (choice === 'i') {
            console.log(`🙈 Ignored: ${relativePath} (kept locally, not synced)`);
        } else {
            ignoredFiles.delete(relativePath);
            await fs.unlink(path.join(VIEWS_DIR, relativePath));
            console.log(`🗑️  Removed: ${relativePath}`);
        }
    }
    processingAdd = false;
}

// Function to monitor file changes
function monitorFiles() {
    watcher = chokidar.watch(VIEWS_DIR, { 
        persistent: true, 
        ignoreInitial: true,
        ignored: [/\.vscode\//, /AGENT\.md$/, /\.sleekcms\//]
    })
    .on("change", scheduleUpdate)
    .on("add", (filePath) => {
        const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/");
        if (ignoredFiles.has(relativePath)) return;
        // Skip files that are already tracked (e.g., from fetchFiles)
        if (fileMap[relativePath]) return;
        ignoredFiles.add(relativePath);
        addQueue.push(filePath);
        processAddQueue();
    })
    .on("unlink", (filePath) => {
        const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/");
        ignoredFiles.delete(relativePath);
        const idx = addQueue.indexOf(filePath);
        if (idx !== -1) addQueue.splice(idx, 1);
    });
}

// Check if a command exists in PATH
function commandExists(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Show editor selection menu
function showEditorMenu() {
    const editors = [];
    
    if (commandExists('code')) {
        editors.push({ key: '1', name: 'VS Code', cmd: 'code' });
    }
    if (commandExists('cursor')) {
        editors.push({ key: '2', name: 'Cursor', cmd: 'cursor' });
    }
    
    if (editors.length === 0) {
        console.log('\n👀 Watching for changes...');
        showWatchHelp();
        setupKeyboardInput();
        return;
    }
    
    console.log('\n📂 Open in editor:');
    editors.forEach(e => console.log(`   [${e.key}] ${e.name}`));
    console.log('   [Enter] Skip');
    console.log('   [x] Quit\n');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    // Count lines to clear (menu header + editors + skip + quit + empty + prompt)
    const linesToClear = editors.length + 5;
    
    rl.question('Select editor: ', async (answer) => {
        rl.close();
        
        // Clear the menu lines
        process.stdout.write(`\x1b[${linesToClear}A`); // Move cursor up
        for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\x1b[2K\n'); // Clear each line
        }
        process.stdout.write(`\x1b[${linesToClear}A`); // Move back up
        
        if (answer.trim().toLowerCase() === 'x') {
            await handleExit();
            return;
        }
        
        const selected = editors.find(e => e.key === answer.trim());
        if (selected) {
            console.log(`👀 Watching for changes... (opened ${selected.name})`);
            spawn(selected.cmd, [VIEWS_DIR], { 
                detached: true, 
                stdio: 'ignore' 
            }).unref();
        } else {
            console.log('👀 Watching for changes...');
        }
        
        showWatchHelp();
        setupKeyboardInput();
    });
}

// Graceful shutdown handler
async function handleExit() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n⚠️ Shutting down...");

    //await finalSync();
    await cleanupFiles();

    process.exit(0);
}

// Display watch mode help
function showWatchHelp() {
    console.log('📋 Commands: [r] Re-fetch all files  [x] Exit\n');
}

// Set up keyboard input handling for watch mode
function setupKeyboardInput() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        rawModeEnabled = true;
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', async (key) => {
        // Handle Ctrl+C
        if (key === '\u0003') {
            await handleExit();
            return;
        }
        
        const cmd = key.toLowerCase();
        if (cmd === 'r') {
            console.log('\n🔄 Re-fetching all files...');
            await fetchFiles();
            console.log('👀 Watching for changes...');
            showWatchHelp();
        } else if (cmd === 'x') {
            await handleExit();
        }
    });
}

// Main function
async function main() {
    await initConfig();
    await fetchFiles();
    monitorFiles();
    
    console.log(`\n✅ Ready! Editing session started for site - ${site.data.name}.`);
    console.log(`\n📁 Workspace created at: ${VIEWS_DIR}`);
    if (ENV !== 'production') console.log(`🌐 Environment: ${ENV}`);
    console.log(`\n⚠️  Files will be cleaned up on exit (Ctrl+C).`);
    showEditorMenu();

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