/** Load a workspace `.env` file into process.env (Node built-in, zero deps). */
import { join } from "node:path";

/**
 * Load `<dir>/.env` into process.env. A missing or unreadable file is fine —
 * we fall back to the ambient environment. Real environment variables that are
 * already set take precedence over `.env` values.
 */
export function loadEnv(dir: string): void {
  try {
    process.loadEnvFile(join(dir, ".env"));
  } catch {
    // No .env present — rely on the ambient environment.
  }
}
