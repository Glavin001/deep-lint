interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  ssn: string;
  creditCard: string;
  sessionToken: string;
}

// VIOLATION: Logging password
export function logUserLogin(user: User) {
  console.log("User logged in:", user.password);
}

// VIOLATION: Logging entire user object (contains sensitive fields)
export function logUserDetails(user: User) {
  console.log("User details:", user);
}

// CLEAN: Logging non-sensitive data
export function logPageView(page: string) {
  console.log("Page viewed:", page);
}

// VIOLATION: Logging session token
export function logSession(user: User) {
  console.log("Session started:", user.sessionToken);
}

// CLEAN: Logging IDs only
export function logUserAction(userId: string, action: string) {
  console.log("Action:", action, "by user:", userId);
}

// VIOLATION: Logging credit card info
export function logPayment(user: User, amount: number) {
  console.log("Payment:", amount, "card:", user.creditCard);
}

// CLEAN: Logging counts and metrics
export function logMetrics(requestCount: number, latencyMs: number) {
  console.log("Requests:", requestCount, "Avg latency:", latencyMs, "ms");
}

// VIOLATION: Logging SSN
export function logVerification(user: User) {
  console.log("Verifying SSN:", user.ssn);
}

// CLEAN: Logging error messages (not sensitive)
export function logError(error: Error) {
  console.log("Error occurred:", error.message);
}
