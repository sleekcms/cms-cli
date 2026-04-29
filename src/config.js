/**
 * Config shared by the interactive CLI (index.js + watcher).
 * Sync-related config lives inside sync-site.js so that file stays standalone.
 */

const DEBOUNCE_DELAY = 5000;

module.exports = {
    DEBOUNCE_DELAY,
};
