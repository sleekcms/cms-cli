/**
 * API client and operations for the CMS CLI
 */

const axios = require("axios");
const { API_BASE_URLS, TEMPLATE_API_BASE_URLS } = require("./config");

let apiClient = null;
let templateApiClient = null;
let site = null;

/**
 * Initialize API clients with the given token and environment
 */
function initApiClients(token, env) {
    const apiBaseUrl = API_BASE_URLS[env] || API_BASE_URLS.production;
    const templateApiBaseUrl = TEMPLATE_API_BASE_URLS[env] || TEMPLATE_API_BASE_URLS.production;

    apiClient = axios.create({
        baseURL: apiBaseUrl,
        headers: { Authorization: `Bearer ${token}` },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    templateApiClient = axios.create({
        baseURL: templateApiBaseUrl,
        headers: { Authorization: `Bearer ${token}` },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    return { apiClient, templateApiClient, apiBaseUrl };
}

/**
 * Fetch site information
 */
async function fetchSite() {
    const response = await templateApiClient.get("/site");
    site = response.data;
    return site;
}

/**
 * Get the current site info
 */
function getSite() {
    return site;
}

/**
 * Fetch all templates from the API
 */
async function fetchTemplates() {
    const response = await apiClient.get("/get_templates");
    return response.data;
}

/**
 * Fetch all models from the API
 */
async function fetchModels() {
    const response = await apiClient.get("/get_models");
    return response.data;
}

/**
 * Fetch all content records from the API
 */
async function fetchContentRecords() {
    const response = await apiClient.get("/get_records");
    return response.data;
}

/**
 * Save a template to the API
 */
async function saveTemplate(key, type, code) {
    return apiClient.post("/save_template", { key, type, code: code || "" });
}

/**
 * Save a model to the API
 */
async function saveModel(key, type, shape) {
    const response = await apiClient.post("/save_model", { key, type, shape: shape || "" });
    return response.data;
}

/**
 * Save a content record to the API
 */
async function saveRecord(key, type, item) {
    const response = await apiClient.post("/save_record", { key, type, item });
    return response.data;
}

module.exports = {
    initApiClients,
    fetchSite,
    getSite,
    fetchTemplates,
    fetchModels,
    fetchContentRecords,
    saveTemplate,
    saveModel,
    saveRecord,
};
