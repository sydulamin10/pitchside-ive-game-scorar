/**
 * Builds PWA icons from `frontend/public/branding/odcc-live.png`.
 *
 * Usage: node scripts/generate-icons.mjs
 * Requires Python 3 with Pillow (`pip install pillow`).
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(ROOT, "scripts", "generate-icons.py");

const result = spawnSync("python", [script], { cwd: ROOT, stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
