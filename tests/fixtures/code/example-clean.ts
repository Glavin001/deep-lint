import { logger } from "./logger";

function greet(name: string): string {
  return `Hello, ${name}`;
}

async function loadUser(id: string) {
  try {
    const response = await fetch(`/api/users/${id}`);
    return response.json();
  } catch (error) {
    logger.error("Failed to load user", error);
    throw error;
  }
}

export { greet, loadUser };
