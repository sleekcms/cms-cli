#!/usr/bin/env node

/**
 * SleekCMS site sync — thin wrapper.
 *
 * Reads the auth token from <workspace>/.cache/token (written by setup-site)
 * and pushes local changes to the server.
 *
 * Usage: sync-site [-d <workspace-dir>]
 *   -d defaults to the current directory.
 *
 * To initialize a new workspace for the first time, run setup-site instead:
 *   setup-site -t <token> [-d <parent-dir>]
 */

const fs = require("fs-extra");
const path = require("path");
const { program } = require("commander");
const { syncSite } = require("./setup-site");

program
    .name("sync-site")
    .description("Push local changes to SleekCMS. Reads auth token from <workspace>/.cache/token.")
    .option("-d, --dir <dir>", "Workspace directory (default: current directory)")
    .parse(process.argv);

const opts = program.opts();
const workspaceDir = path.resolve(opts.dir || ".");
const tokenPath = path.join(workspaceDir, ".cache", "token");

fs.readFile(tokenPath, "utf-8")
    .then(raw => {
        const token = raw.trim();
        if (!token) throw new Error(`Token file is empty: ${tokenPath}`);
        return syncSite({ token, viewsDir: workspaceDir });
    })
    .then(({ viewsDir, site, pushed }) => {
        console.log(`\n✅ Sync complete for "${site.name}" at ${viewsDir} (pushed ${pushed} file(s)).`);
    })
    .catch(err => {
        if (err.code === "ENOENT") {
            console.error(`❌ Workspace not initialized — run: setup-site -t <token>`);
        } else {
            console.error("❌", err.body || err.message);
        }
        process.exit(1);
    });

