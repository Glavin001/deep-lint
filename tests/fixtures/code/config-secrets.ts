// VIOLATION: Hardcoded API key
const STRIPE_SECRET_KEY = "sk_test_FAKE_KEY_for_testing_only_1234567890abcdef";

// VIOLATION: Hardcoded database password
const DB_PASSWORD = "super_secret_p@ssw0rd_123";

// VIOLATION: Hardcoded auth token
const AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";

// CLEAN: Normal string constant
const APP_NAME = "MyApp";

// CLEAN: Non-secret configuration
const DEFAULT_LOCALE = "en-US";

// CLEAN: URL (not a secret)
const API_BASE_URL = "https://api.example.com/v1";

// CLEAN: Short non-secret value
const VERSION = "1.0.0";

// VIOLATION: AWS access key
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE12345678901234567890";

// CLEAN: Error message
const ERROR_MESSAGE = "Something went wrong, please try again later";

export {
  STRIPE_SECRET_KEY,
  DB_PASSWORD,
  AUTH_TOKEN,
  APP_NAME,
  DEFAULT_LOCALE,
  API_BASE_URL,
  VERSION,
  AWS_ACCESS_KEY,
  ERROR_MESSAGE,
};
