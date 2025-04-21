#!/usr/bin/env node

const fs = require("fs-extra");
const axios = require("axios");
const chokidar = require("chokidar");
const { program } = require("commander");
const path = require("path");

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
    .option("--token <token>", "API authentication token")
    .option("--env <env>", "Environment (localhost, development, production)", "production")
    .parse(process.argv);

const options = program.opts();
const AUTH_TOKEN = options.token;
const ENV = options.env.toLowerCase();

if (!AUTH_TOKEN) {
    console.error("❌ Missing required --token parameter.");
    process.exit(1);
}

const API_BASE_URL = API_BASE_URLS[ENV] || API_BASE_URLS.production;

const VIEWS_DIR = path.resolve(AUTH_TOKEN.split('-')[0] + "-views");

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
        console.log("📥 Fetching files from API...");
        const response = await apiClient.get("/");

        await fs.ensureDir(VIEWS_DIR);

        for (const file of response.data) {
            if (file.file_path) {
                const filePath = path.join(VIEWS_DIR, file.file_path);
                await fs.outputFile(filePath, file.code);
                fileMap[file.file_path.replace(/\\/g,"/")] = file;
                console.log(`✅ Created: ${filePath}`);
            }
        }

        console.log("✔️ All files downloaded. They will be deleted on exit.");
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
            console.log(`✅ Updated template for: ${relativePath} | Length In: ${code.length}, Out: ${template.data.code.length}`);

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

// Function to monitor file changes
function monitorFiles() {
    console.log("👀 Watching for file changes...");

    watcher = chokidar.watch(VIEWS_DIR, { 
        persistent: true, 
        ignoreInitial: true,
        ignored: /\.vscode\//
    })
    .on("change", scheduleUpdate)
    .on("add", createSchema);
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
    //const server = startServer();

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