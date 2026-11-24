import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPolicy, formatViolation, POLICY_HINTS } from "./policy.mjs";

const factoryDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(factoryDir, "..");
const config = JSON.parse(await readFile(path.join(repoRoot, "factory.json"), "utf8"));
const baseRef = process.env.FACTORY_BASE_REF?.trim() || undefined;

const result = checkPolicy({ cwd: repoRoot, baseRef, config });

if (result.ok) {
  console.log(
    `factory: policy ok (${result.scannedFiles} file(s), ${result.scannedLines} added line(s), ${result.range})`,
  );
  process.exit(0);
}

console.error(
  `factory: policy failed (${result.violations.length} violation(s), ${result.range})`,
);
for (const violation of result.violations.slice(0, 50)) {
  console.error(`  ${formatViolation(violation)}`);
}
if (result.violations.length > 50) {
  console.error(`  ... and ${result.violations.length - 50} more`);
}
for (const hint of POLICY_HINTS) console.error(`  ${hint}`);
process.exit(1);
