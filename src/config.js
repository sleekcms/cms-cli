/**
 * Configuration constants for the CMS CLI
 */

const API_BASE_URLS = {
    localhost: "http://localhost:9000/api/ai_tools",
    development: "https://app.sleekcms.dev/api/ai_tools",
    production: "https://app.sleekcms.com/api/ai_tools",
};

const TEMPLATE_API_BASE_URLS = {
    localhost: "http://localhost:9000/api/template",
    development: "https://app.sleekcms.dev/api/template",
    production: "https://app.sleekcms.com/api/template",
};

// Template type to directory/extension mapping
const TYPE_CONFIG = {
    PAGE:  { dir: 'pages',   ext: '.ejs' },
    ENTRY: { dir: 'entries', ext: '.ejs' },
    BLOCK: { dir: 'blocks',  ext: '.ejs' },
    JS:    { dir: 'js',      ext: '.js' },
    CSS:   { dir: 'css',     ext: '.css' },
    BASE:  { dir: 'layouts', ext: '.ejs' },
};

const DEBOUNCE_DELAY = 1000; // 1 second delay

// Whether to allow updating models (e.g., syncing model changes)
const ALLOW_MODEL_UPDATES = true;

module.exports = {
    API_BASE_URLS,
    TEMPLATE_API_BASE_URLS,
    TYPE_CONFIG,
    DEBOUNCE_DELAY,
    ALLOW_MODEL_UPDATES,
};
