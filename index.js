#!/usr/bin/env node

const fs = require("fs-extra");
const axios = require("axios");
const chokidar = require("chokidar");
const { program } = require("commander");
const path = require("path");
const express = require("express");
const { execSync, spawn } = require("child_process");
const readline = require("readline");
const agentMdContent = require("./agent.js");

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
const AUTH_TOKEN = options.token;
const tokenParts = AUTH_TOKEN ? AUTH_TOKEN.split('-') : [];
const ENV = (tokenParts[2] || options.env || "production").toLowerCase();

if (!AUTH_TOKEN) {
    console.error("❌ Missing required --token (-t) parameter. Use -h for help.");
    process.exit(1);
}

const API_BASE_URL = API_BASE_URLS[ENV] || API_BASE_URLS.production;

const viewsFolder = tokenParts[0] + "-views";
const VIEWS_DIR = options.path 
    ? path.resolve(options.path, viewsFolder) 
    : path.resolve(viewsFolder);

// Axios instance with authorization
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
});

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

        console.log(`✔️ Downloaded ${response.data.length} template(s).`);
        
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
        console.log("✅ Cleanup complete. Exiting...");
    } catch (error) {
        console.error("❌ Error during cleanup:", error.message);
    }
}


// Function to handle debounced updates
function scheduleUpdate(filePath) {
    if (isShuttingDown) return;

    const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/"); // Extract relative file path
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

async function createSchema(filePath) {
    if (isShuttingDown) return;
    try {
        const relativePath = path.relative(VIEWS_DIR, filePath).replace(/\\/g, "/");
        const resp = await apiClient.post("/cli", { file_path: relativePath});
        const schema = resp.data;
        const templateResp = await apiClient.get(`/${schema.tmpl_main_id}`);
        const template = templateResp.data;
        if (relativePath !== template.file_path) {
            // rename the file
            const oldPath = filePath;
            const newPath = path.join(VIEWS_DIR, template.file_path);
            watcher.unwatch(newPath);
            await fs.move(oldPath, newPath);
            watcher.add(newPath);
            console.log(`✅ Renamed file from ${relativePath} to ${template.file_path}`);
        }
        fileMap[template.file_path.replace(/\\/g, "/")] = template;
        console.log("✅ Created model for:", template.file_path);
    } catch (error) {
        console.error("❌ Error creating model:", error.response?.data || error.message);
        // delete the file locally
        await fs.unlink(filePath);
    }
}

// Start an Express server to serve files in VIEWS_DIR
function startServer() {
    const app = express();

    // Serve static files from VIEWS_DIR
    app.use(express.static(VIEWS_DIR));

    // Optional: Custom 404 for files not found
    app.use((req, res) => {
        res.status(404).send("File not found");
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`\n✅ Ready! Editing session started.`);
        console.log(`\n📁 Templates directory: ${VIEWS_DIR}`);
        console.log(`🌐 Environment: ${ENV}`);
        console.log(`🔗 Static server: http://localhost:${port}`);
        console.log(`\n⚠️  Files will be cleaned up on exit (Ctrl+C).`);
        showEditorMenu();
    });
}

// Function to monitor file changes
function monitorFiles() {
    watcher = chokidar.watch(VIEWS_DIR, { 
        persistent: true, 
        ignoreInitial: true,
        ignored: [/\.vscode\//, /AGENT\.md$/]
    })
    .on("change", scheduleUpdate)
    .on("add", createSchema);
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
        console.log('\n👀 Watching for changes...\n');
        return;
    }
    
    console.log('\n📂 Open in editor:');
    editors.forEach(e => console.log(`   [${e.key}] ${e.name}`));
    console.log('   [Enter] Skip\n');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    // Count lines to clear (menu header + editors + skip + empty + prompt)
    const linesToClear = editors.length + 4;
    
    rl.question('Select editor: ', (answer) => {
        rl.close();
        
        // Clear the menu lines
        process.stdout.write(`\x1b[${linesToClear}A`); // Move cursor up
        for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\x1b[2K\n'); // Clear each line
        }
        process.stdout.write(`\x1b[${linesToClear}A`); // Move back up
        
        const selected = editors.find(e => e.key === answer.trim());
        if (selected) {
            console.log(`👀 Watching for changes... (opened ${selected.name})\n`);
            spawn(selected.cmd, [VIEWS_DIR], { 
                detached: true, 
                stdio: 'ignore' 
            }).unref();
        } else {
            console.log('👀 Watching for changes...\n');
        }
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

// Main function
async function main() {
    await fetchFiles();
    monitorFiles();
    startServer();

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