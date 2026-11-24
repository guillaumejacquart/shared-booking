import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPolicy, formatViolation, POLICY_HINTS } from "./policy.mjs";

const factoryDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(factoryDir, "..");
const config = JSON.parse(await readFile(path.join(repoRoot, "factory.json"), "utf8"));

const startedAt = new Date();
const baseRef = process.env.FACTORY_BASE_REF?.trim() || undefined;
const skipChecks = process.env.FACTORY_SKIP_CHECKS === "1";
const skipPolicy = process.env.FACTORY_SKIP_POLICY === "1";

function gitValue(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function runCheck(check) {
  const checkStartedAt = Date.now();
  const result = spawnSync(check.run, {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  const durationMs = Date.now() - checkStartedAt;
  return {
    name: check.name,
    command: check.run,
    outcome: result.status === 0 ? "pass" : "fail",
    exitCode: result.status,
    durationMs,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

const checks = [];
let policy = null;
let failed = false;

console.log(`factory: repo ${path.basename(repoRoot)} (${config.profile ?? "unprofiled"})`);

if (!skipPolicy) {
  try {
    const result = checkPolicy({ cwd: repoRoot, baseRef, config });
    policy = {
      outcome: result.ok ? "pass" : "fail",
      violations: result.violations.length,
      scannedFiles: result.scannedFiles,
      scannedLines: result.scannedLines,
      range: result.range,
    };

    if (result.ok) {
      console.log(
        `factory: policy ok (${result.scannedFiles} file(s), ${result.scannedLines} added line(s), ${result.range})`,
      );
    } else {
      failed = true;
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
    }
  } catch (error) {
    failed = true;
    policy = { outcome: "fail", error: error instanceof Error ? error.message : String(error) };
    console.error(`factory: policy failed: ${policy.error}`);
  }
}

const failFast = config.failFast !== false;

if (!skipChecks && !failed) {
  for (const check of config.checks) {
    console.log(`factory: ${check.name} — ${check.run}`);
    const result = runCheck(check);
    checks.push(result);
    console.log(
      `factory: ${check.name} ${result.outcome} (${(result.durationMs / 1000).toFixed(1)}s)`,
    );
    if (result.outcome === "fail") {
      failed = true;
      if (failFast) break;
    }
  }
}

const finishedAt = new Date();
const record = {
  schema: "software-factory/run@1",
  factoryVersion: config.factoryVersion ?? 1,
  profile: config.profile ?? null,
  repo: path.basename(repoRoot),
  sha: gitValue(["rev-parse", "HEAD"]),
  branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
  dirty: Boolean(gitValue(["status", "--porcelain"])),
  ci: Boolean(process.env.CI),
  actor: process.env.GITHUB_ACTOR || null,
  baseRef: baseRef ?? "HEAD",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  outcome: failed ? "fail" : "pass",
  checks,
  policy,
};

await writeFile(
  path.join(repoRoot, "factory-run.json"),
  `${JSON.stringify(record, null, 2)}\n`,
);

const seconds = (record.durationMs / 1000).toFixed(1);
if (failed) {
  console.error(`factory: FAIL in ${seconds}s — factory-run.json written`);
  process.exit(1);
}
console.log(`factory: PASS in ${seconds}s — factory-run.json written`);
