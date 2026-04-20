/**
 * CLI setup, prompts, and UI for the CMS CLI
 */

const readline = require("readline");
const { execSync, spawn } = require("child_process");
const { program, Option } = require("commander");

let rawModeEnabled = false;

/**
 * Parse CLI arguments and return options
 */
function parseArgs() {
    program
        .name("cms-cli")
        .description("SleekCMS CLI tool to sync and edit CMS templates locally. Downloads templates, watches for changes, and syncs updates back to the API.")
        .addOption(new Option("-v, --version", "output the version number").hideHelp())
        .option("-t, --token <token>", "API authentication token (required)")
        .addOption(new Option("-e, --env <env>", "Environment (localhost, development, production)").default("production").hideHelp())
        .option("-p, --path <path>", "Directory path for files (default: <token-prefix>-views)")
        .addHelpText("after", `
Examples:
  $ cms-cli --token abc123-xxxx
  $ cms-cli -t abc123-xxxx -e development
  $ cms-cli -t abc123-xxxx -p ./my-templates
`)
        .parse(process.argv);

    return program.opts();
}

/**
 * Suspend raw mode for readline input
 */
function suspendRawMode() {
    if (process.stdin.isTTY && rawModeEnabled) {
        process.stdin.setRawMode(false);
    }
}

/**
 * Resume raw mode for keyboard input
 */
function resumeRawMode() {
    if (process.stdin.isTTY && rawModeEnabled) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
    }
}

/**
 * Prompt user for input
 */
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

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Display watch mode help
 */
function showWatchHelp() {
    console.log('📋 Commands: [r] Re-fetch all files  [x] Exit\n');
}

/**
 * Set up keyboard input handling for watch mode
 */
function setupKeyboardInput(handlers) {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        rawModeEnabled = true;
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', async (key) => {
        // Handle Ctrl+C
        if (key === '\u0003') {
            if (handlers.onExit) await handlers.onExit();
            return;
        }
        
        const cmd = key.toLowerCase();
        if (cmd === 'r' && handlers.onRefetch) {
            console.log('\n🔄 Re-fetching all files...');
            await handlers.onRefetch();
            console.log('👀 Watching for changes...');
            showWatchHelp();
        } else if (cmd === 'x' && handlers.onExit) {
            await handlers.onExit();
        }
    });
}

/**
 * Show editor selection menu and handle selection
 */
function showEditorMenu(viewsDir, handlers) {
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
        setupKeyboardInput(handlers);
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
            if (handlers.onExit) await handlers.onExit();
            return;
        }
        
        const selected = editors.find(e => e.key === answer.trim());
        if (selected) {
            console.log(`👀 Watching for changes... (opened ${selected.name})`);
            spawn(selected.cmd, ['-n', viewsDir], { 
                detached: true, 
                stdio: 'ignore' 
            }).unref();
        } else {
            console.log('👀 Watching for changes...');
        }
        
        showWatchHelp();
        setupKeyboardInput(handlers);
    });
}

module.exports = {
    parseArgs,
    prompt,
    showWatchHelp,
    showEditorMenu,
    setupKeyboardInput,
};
