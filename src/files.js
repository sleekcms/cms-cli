/**
 * File path utilities and file operations for the CMS CLI
 */

const fs = require("fs-extra");
const path = require("path");
const { TYPE_CONFIG } = require("./config");

/**
 * Convert string to kebab-case
 */
const kebabCase = (str) => str.replace(/[\s_]+/g, "-").toLowerCase();

/**
 * Get file path from template key and type
 */
function getFilePath(key, type) {
    const config = TYPE_CONFIG[type];
    if (!config) return null;
    return `${config.dir}/${key}${config.ext}`;
}

/**
 * Get model file path from key and type
 */
function getModelFilePath(key, type) {
    const config = TYPE_CONFIG[type];
    if (!config || config.noModel) return null;
    return `models/${config.dir}/${key}.model`;
}

/**
 * Parse file path to get type and key
 */
function parseFilePath(filePath) {
    const parts = filePath.split('/');
    if (parts.length < 2) return null;
    
    const dir = parts[0];
    const filename = parts.slice(1).join('/');
    
    for (const [type, config] of Object.entries(TYPE_CONFIG)) {
        if (config.dir === dir && filename.endsWith(config.ext)) {
            const key = filename.slice(0, -config.ext.length);
            return { type, key };
        }
    }
    return null;
}

/**
 * Parse model file path to get type and key
 */
function parseModelFilePath(filePath) {
    if (!filePath.startsWith('models/')) return null;
    
    const parts = filePath.slice(7).split('/'); // Remove 'models/' prefix
    if (parts.length < 2) return null;
    
    const dir = parts[0];
    const filename = parts.slice(1).join('/');
    
    if (!filename.endsWith('.model')) return null;
    
    for (const [type, config] of Object.entries(TYPE_CONFIG)) {
        if (config.dir === dir) {
            const key = filename.slice(0, -6); // Remove '.model'
            return { type, key };
        }
    }
    return null;
}

/**
 * Write VS Code settings for the workspace
 */
async function writeVSCodeSettings(viewsDir) {
    const vscodeSettings = {
      "files.associations": {
        "*.model": "javascript",
      },
      "[javascript]": {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
      },
      "js/ts.validate.enabled": false,
    };
    
    await fs.outputFile(
        path.join(viewsDir, '.vscode', 'settings.json'),
        JSON.stringify(vscodeSettings, null, 2)
    );
}

/**
 * Write agent instruction files
 */
async function writeAgentFiles(viewsDir, agentMdContent) {
    await fs.outputFile(path.join(viewsDir, 'AGENT.md'), agentMdContent);
    await fs.outputFile(path.join(viewsDir, 'CLAUDE.md'), agentMdContent);
    await fs.outputFile(path.join(viewsDir, '.vscode', 'copilot-instructions.md'), agentMdContent);
}

/**
 * Clean up the views directory
 */
async function cleanupFiles(viewsDir) {
    console.log("🧹 Cleaning up files...");
    try {
        await fs.remove(viewsDir);
        console.log(`✅ Cleanup complete. Deleted workspace at ${viewsDir} .`);
    } catch (error) {
        console.error("❌ Error during cleanup:", error.message);
    }
}

module.exports = {
    kebabCase,
    getFilePath,
    getModelFilePath,
    parseFilePath,
    parseModelFilePath,
    writeVSCodeSettings,
    writeAgentFiles,
    cleanupFiles,
};
