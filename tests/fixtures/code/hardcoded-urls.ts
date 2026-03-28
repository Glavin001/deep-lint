// This file contains various hardcoded URLs
// Some are development/staging URLs (violations), others are acceptable

// VIOLATION: hardcoded localhost in production API client
const API_URL = "http://localhost:3000/api/v1";

// VIOLATION: hardcoded staging URL
const STAGING_ENDPOINT = "https://api.staging.example.com/graphql";

// VIOLATION: hardcoded dev environment URL
const DEV_SERVER = "http://dev.internal.company.com:8080/service";

// VIOLATION: hardcoded 127.0.0.1
const METRICS_URL = "http://127.0.0.1:9090/metrics";

// SAFE: production URL (not a dev/staging URL)
const PRODUCTION_API = "https://api.example.com/v2";

// SAFE: CDN URL
const CDN_URL = "https://cdn.example.com/assets";

// SAFE: URL in a test helper
function createTestServer() {
  const TEST_URL = "http://localhost:4000/test";
  return TEST_URL;
}

// SAFE: environment variable usage (not hardcoded)
const DYNAMIC_URL = process.env.API_URL || "https://api.example.com";

// VIOLATION: localhost URL in production code path
function fetchUserData(userId: string) {
  return fetch(`http://localhost:5000/users/${userId}`);
}

// SAFE: documentation/example URL
const DOCS_EXAMPLE = "// Example: curl http://localhost:8080/health";

// VIOLATION: local development database
const DB_URL = "http://localhost:5432/mydb";

// SAFE: URL pattern (not an actual URL)
const URL_REGEX = /https?:\/\/localhost/;

export { API_URL, STAGING_ENDPOINT, DEV_SERVER, METRICS_URL, PRODUCTION_API, CDN_URL, createTestServer, DYNAMIC_URL, fetchUserData, DOCS_EXAMPLE, DB_URL, URL_REGEX };
