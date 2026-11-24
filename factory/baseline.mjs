import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const factoryDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(factoryDir, "..");
const configPath = path.join(repoRoot, "factory.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

const ref = process.argv[2] || "HEAD";
const result = spawnSync("git", ["rev-parse", ref], { cwd: repoRoot, encoding: "utf8" });
if (result.status !== 0) {
  console.error(`factory: cannot resolve ${ref}`);
  process.exit(1);
}

const sha = result.stdout.trim();
config.policy = {
  comments: "block",
  suppressions: "block",
  ...(config.policy ?? {}),
  baseline: sha,
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`factory: policy baseline set to ${sha} (${ref})`);
console.log("Commit factory.json so CI enforces the policy from this commit.");
