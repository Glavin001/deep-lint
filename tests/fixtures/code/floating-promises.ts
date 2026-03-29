// This file contains Promise-returning function calls
// Some are properly awaited/handled, others are floating (fire-and-forget)

async function fetchUser(id: string): Promise<{ name: string }> {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}

async function logEvent(event: string): Promise<void> {
  await fetch("/api/analytics", { method: "POST", body: event });
}

async function sendNotification(msg: string): Promise<void> {
  await fetch("/api/notify", { method: "POST", body: msg });
}

// BUG: floating promise — fetchUser result is not awaited or caught
function getUserName(id: string) {
  fetchUser(id);
  return "loading...";
}

// BUG: floating promise — error not handled
function triggerSync() {
  fetch("/api/sync", { method: "POST" });
}

// SAFE: properly awaited
async function getProfile(id: string) {
  const user = await fetchUser(id);
  return user.name;
}

// SAFE: .then/.catch chain
function getUserWithCallback(id: string) {
  fetchUser(id)
    .then((user) => console.log(user.name))
    .catch((err) => console.error(err));
}

// SAFE: intentional fire-and-forget (analytics/logging)
function trackPageView(page: string) {
  // Fire-and-forget is intentional for analytics
  logEvent(`pageview:${page}`);
}

// BUG: promise returned but not awaited in caller
function processOrder(orderId: string) {
  sendNotification(`Order ${orderId} processed`);
  return { status: "done" };
}

// SAFE: assigned to variable for later use
function prefetchData(id: string) {
  const promise = fetchUser(id);
  return promise;
}

// SAFE: void operator explicitly marks fire-and-forget
function explicitFireAndForget(msg: string) {
  void sendNotification(msg);
}

export { fetchUser, logEvent, sendNotification, getUserName, triggerSync, getProfile, getUserWithCallback, trackPageView, processOrder, prefetchData, explicitFireAndForget };
