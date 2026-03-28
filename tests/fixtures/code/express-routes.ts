import express from "express";

const app = express();

function authMiddleware(req: any, res: any, next: any) {
  if (!req.headers.authorization) return res.status(401).send("Unauthorized");
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.user?.isAdmin) return res.status(403).send("Forbidden");
  next();
}

// CLEAN: Public health check — no auth needed
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// VIOLATION: User data endpoint without auth
app.get("/api/users", (req, res) => {
  res.json({ users: [] });
});

// CLEAN: Protected with auth middleware
app.get("/api/profile", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// VIOLATION: Admin endpoint without auth
app.post("/api/admin/settings", (req, res) => {
  res.json({ updated: true });
});

// CLEAN: Admin endpoint with both auth and admin check
app.post("/api/admin/users", authMiddleware, requireAdmin, (req, res) => {
  res.json({ created: true });
});

// VIOLATION: Delete endpoint without auth
app.delete("/api/users/:id", (req, res) => {
  res.json({ deleted: true });
});

// CLEAN: Public login endpoint — auth not expected
app.post("/api/login", (req, res) => {
  res.json({ token: "..." });
});

// CLEAN: Public registration — auth not expected
app.post("/api/register", (req, res) => {
  res.json({ success: true });
});

export { app };
