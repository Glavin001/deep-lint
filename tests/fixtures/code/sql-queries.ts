import { db } from "./database";

// UNSAFE: String concatenation — SQL injection risk
export async function findUserByName(name: string) {
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}

// UNSAFE: Template literal interpolation — SQL injection risk
export async function findUserById(id: string) {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}

// SAFE: Parameterized query
export async function findUserSafe(id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}

// SAFE: Using a query builder helper
export async function findUserWithBuilder(criteria: Record<string, unknown>) {
  return db.query(buildWhereClause("users", criteria));
}

// UNSAFE: Dynamic table name via concat
export async function findInTable(table: string, id: string) {
  return db.query("SELECT * FROM " + table + " WHERE id = $1", [id]);
}

// SAFE: Hardcoded query string, no user input
export async function getAllUsers() {
  return db.query("SELECT id, name, email FROM users ORDER BY name");
}
