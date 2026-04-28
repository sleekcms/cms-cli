#!/usr/bin/env node

/**
 * SleekCMS site setup — one-time workspace bootstrap.
 *
 * Pulls the full site state into a local workspace and persists the
 * auth token at <workspace>/.cache/token so subsequent `sync-site` runs
 * find it without the user re-passing it.
 *
 * Safe to re-run: if the workspace is already initialized, this becomes
 * an incremental sync (no-op when nothing changed).
 */

const { program } = require("commander");
const { syncSite } = require("./sync-site");

program
    .name("setup-site")
    .description("Initialize a SleekCMS workspace: pull all files and persist the auth token for future syncs.")
    .requiredOption("-t, --token <token>", "SleekCMS CLI auth token")
    .option("-p, --path <path>", "Parent directory; the workspace is created as a slug-named subfolder (default: current directory)")
    .option("-e, --env <env>", "Environment override (localhost, development, production)")
    .parse(process.argv);

const opts = program.opts();

syncSite({
    token: opts.token,
    path: opts.path,
    env: opts.env,
})
    .then(({ viewsDir, site, isFirstRun, pulled }) => {
        if (isFirstRun) {
            console.log(`\n✅ Workspace initialized for "${site.name}" at ${viewsDir} (pulled ${pulled} file(s)).`);
        } else {
            console.log(`\n✅ Workspace already initialized for "${site.name}" at ${viewsDir}.`);
        }
        console.log(`\nNext: cd ${viewsDir}  →  edit files  →  run sync-site`);
    })
    .catch(err => {
        console.error("❌", err.body || err.message);
        process.exit(1);
    });
