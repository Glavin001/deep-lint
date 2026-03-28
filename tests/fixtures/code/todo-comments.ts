// This file contains a mix of comment markers
// Some reference tracking issues, others don't

// TODO: refactor this function later
function processData(data: unknown[]) {
  return data.map((item) => String(item));
}

// FIXME(#1234): race condition when multiple users submit
function handleSubmit(form: Record<string, string>) {
  return form;
}

// TODO(JIRA-567): migrate to new API before Q3
function callLegacyApi(endpoint: string) {
  return fetch(endpoint);
}

// HACK: this works around a browser bug
function resizeHandler() {
  setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
}

// TODO: https://github.com/org/repo/issues/42 - fix pagination
function loadPage(page: number) {
  return page;
}

// FIXME: memory leak in event listeners
function setupListeners() {
  document.addEventListener("click", () => {});
}

// TODO: add proper validation
function validateInput(input: string) {
  return input.length > 0;
}

// HACK(PROJ-89): workaround for upstream library bug
function parseConfig(raw: string) {
  return JSON.parse(raw);
}

// Normal comments that are not action items
// This function handles user authentication
function authenticate(user: string, pass: string) {
  return user && pass;
}

// Regular code
const VERSION = "1.0.0";
export { processData, handleSubmit, callLegacyApi, resizeHandler, loadPage, setupListeners, validateInput, parseConfig, authenticate, VERSION };
