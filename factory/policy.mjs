import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_EXCLUDES = [
  "node_modules/**",
  ".next/**",
  ".git/**",
  "coverage/**",
  "dist/**",
  "build/**",
  "out/**",
  "factory/**",
  "drizzle/**",
  "**/vendor/**",
  "**/generated/**",
  "**/*.min.*",
  "**/*.generated.*",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
  ".scss",
  ".sql",
  ".php",
  ".py",
  ".go",
  ".rs",
];

const SUPPRESSION_PATTERNS = [
  { name: "@ts-*", re: /@ts-(?:ignore|expect-error|nocheck)\b/ },
  { name: "eslint-disable", re: /eslint-disable(?:-next-line|-line)?\b/ },
  { name: "prettier-ignore", re: /prettier-ignore\b/ },
  { name: "skipped/focused test", re: /(?:^|\W)(?:test|it|describe|suite)\.(?:skip|only)\s*\(/ },
  { name: "skipped test", re: /(?:^|\W)(?:xit|xdescribe|xcontext)\s*\(/ },
  { name: "todo test", re: /(?:^|\W)(?:test|it|describe)\.todo\s*\(/ },
  { name: "type: ignore", re: /#\s*type:\s*ignore\b/ },
  { name: "noqa", re: /#\s*noqa\b/ },
  { name: "nolint", re: /\/\/\s*nolint\b/ },
  { name: "phpstan-ignore", re: /@phpstan-ignore(?:-next-line|-line)?\b/ },
  { name: "psalm-suppress", re: /@psalm-suppress\b/ },
  { name: "noinspection", re: /@noinspection\b/ },
];

const ALLOWED_COMMENT_PATTERNS = [
  /^#!/,
  /^\/\/\/?\s*<reference\b/,
  /^\/\/\s*@(?:ts|js|vitest|jest|flow|noinspection)/,
  /^\/\*\s*eslint-/,
  /^\/\/\s*eslint-(?:disable|enable)/,
  /^\/\/\s*prettier-ignore/,
  /^\/\*\s*prettier-ignore/,
  /^\/\/\s*(?:webpackChunkName|webpackIgnore|vite-ignore)/,
  /^\/\/[#@]\s*sourceMappingURL=/,
  /^\/\*\s*(?:global|exported)\s/,
  /^\/\/\s*(?:go:|nolint|noinspection|biome-ignore|deno-lint-ignore)/,
  /^#\s*(?:type:|noqa|fmt:|pragma|-\*-|vim:|shellcheck|region|endregion)/,
  /^--\s*(?:noinspection|sql-lint)/,
  /(?:copyright|spdx-license-identifier|licensed under|@generated|do not edit|code generated)/i,
  /^\/\*\s*istanbul ignore/,
  /^\/\/\s*istanbul ignore/,
  /^\/\/\s*v8 ignore/,
  /factory:allow-(?:comment|suppression)\b/,
];

const COMMENT_MARKER = /factory:allow-comment\s+\S.{8,}/;
const SUPPRESSION_MARKER = /factory:allow-suppression\s+\S.{8,}/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function isExcluded(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

function normalizeDiffPath(raw) {
  let value = raw.trim();
  if (value === "/dev/null") return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }
  if (value.startsWith("b/") || value.startsWith("a/")) value = value.slice(2);
  return value.replaceAll("\\", "/");
}

function parseAddedLines(diffText) {
  const files = [];
  let current = null;
  let newLine = 0;

  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      current = { path: null, added: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("+++ ")) {
      current.path = normalizeDiffPath(raw.slice(4));
      continue;
    }

    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }

    if (raw.startsWith("-") && !raw.startsWith("---")) continue;
    if (raw.startsWith(" ")) newLine += 1;
  }

  return files.filter((file) => file.path && file.added.length > 0);
}

function readUntrackedFiles(cwd) {
  const output = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const files = [];

  for (const raw of output.split("\n")) {
    const file = raw.trim();
    if (!file) continue;
    const fullPath = path.join(cwd, file);
    try {
      const stats = statSync(fullPath);
      if (!stats.isFile() || stats.size > 1024 * 1024) continue;
      const content = readFileSync(fullPath, "utf8");
      if (content.includes("\0")) continue;
      files.push({
        path: file.replaceAll("\\", "/"),
        added: content.split("\n").map((text, index) => ({ line: index + 1, text })),
      });
    } catch {
      continue;
    }
  }

  return files;
}

function extensionOf(file) {
  return path.extname(file).toLowerCase();
}

function languageFamily(extension) {
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(extension)) return "js";
  if ([".css", ".scss"].includes(extension)) return "css";
  if (extension === ".sql") return "sql";
  if (extension === ".php") return "php";
  if (extension === ".py") return "py";
  if ([".go", ".rs"].includes(extension)) return "go";
  return "other";
}

function startsBlockComment(trimmed, family) {
  if (family === "js") return trimmed.startsWith("/*") || trimmed.startsWith("{/*");
  if (family === "css" || family === "php" || family === "go") return trimmed.startsWith("/*");
  return false;
}

function blockCloses(trimmed, family) {
  const opener = family === "js" && trimmed.startsWith("{/*") ? "{/*" : "/*";
  const openIndex = trimmed.indexOf(opener);
  if (openIndex === -1) return false;
  return trimmed.indexOf("*/", openIndex + opener.length) !== -1;
}

function isCommentLine(trimmed, family) {
  if (family === "js") {
    return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("{/*");
  }
  if (family === "css") return trimmed.startsWith("/*") || trimmed.startsWith("*");
  if (family === "sql") return trimmed.startsWith("--");
  if (family === "php") {
    return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*");
  }
  if (family === "py" || family === "go") {
    return family === "go" ? trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") : trimmed.startsWith("#");
  }
  return false;
}

function isAllowedComment(trimmed) {
  return ALLOWED_COMMENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function hasMarker(text, pattern) {
  return pattern.test(text);
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

export function getPolicyDiff(cwd, baseRef, baseline) {
  if (baseRef) {
    const base = baseline ? pickNewerBase(cwd, baseRef, baseline) : baseRef;
    const range = `${base}...HEAD`;
    return {
      range,
      diff: git(cwd, ["diff", "--unified=0", "--no-color", "--no-ext-diff", range]),
    };
  }
  return {
    range: "HEAD",
    diff: git(cwd, ["diff", "--unified=0", "--no-color", "--no-ext-diff", "HEAD"]),
  };
}

function resolveCommit(cwd, ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Unknown git ref "${ref}".`);
  return result.stdout.trim();
}

function isAncestor(cwd, ancestor, descendant) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd }).status === 0
  );
}

function pickNewerBase(cwd, baseRef, baseline) {
  const baseSha = resolveCommit(cwd, baseRef);
  const baselineSha = resolveCommit(cwd, baseline);
  if (isAncestor(cwd, baselineSha, baseSha)) return baseRef;
  if (isAncestor(cwd, baseSha, baselineSha)) return baseline;
  return baseRef;
}

export function checkPolicy({ cwd, baseRef, config }) {
  const policy = config.policy ?? {};
  const commentsMode = policy.comments ?? "block";
  const suppressionsMode = policy.suppressions ?? "block";
  const extensions = new Set(policy.extensions ?? DEFAULT_EXTENSIONS);
  const excludes = [...DEFAULT_EXCLUDES, ...(policy.exclude ?? [])];

  const { range, diff } = getPolicyDiff(cwd, baseRef, policy.baseline);
  const files = parseAddedLines(diff);
  if (!baseRef) files.push(...readUntrackedFiles(cwd));
  const violations = [];
  let scannedFiles = 0;
  let scannedLines = 0;

  for (const file of files) {
    if (file.path === null || isExcluded(file.path, excludes)) continue;
    const extension = extensionOf(file.path);
    if (!extensions.has(extension)) continue;

    scannedFiles += 1;
    const family = languageFamily(extension);
    let block = null;
    let previous = null;

    for (const added of file.added) {
      const trimmed = added.text.trim();
      if (trimmed.length === 0) continue;
      scannedLines += 1;

      const previousLine = previous && previous.line === added.line - 1 ? previous.text : "";
      const commentAllowed =
        hasMarker(previousLine, COMMENT_MARKER) || hasMarker(added.text, COMMENT_MARKER);
      const suppressionAllowed =
        hasMarker(previousLine, SUPPRESSION_MARKER) || hasMarker(added.text, SUPPRESSION_MARKER);

      if (suppressionsMode === "block" && !suppressionAllowed) {
        for (const suppression of SUPPRESSION_PATTERNS) {
          if (suppression.re.test(added.text)) {
            violations.push({
              file: file.path,
              line: added.line,
              kind: "suppression",
              label: suppression.name,
              text: trimmed.slice(0, 160),
            });
            break;
          }
        }
      }

      if (commentsMode === "block") {
        if (block) {
          if (!block.allowed) {
            violations.push({
              file: file.path,
              line: added.line,
              kind: "comment",
              label: "block comment",
              text: trimmed.slice(0, 160),
            });
          }
          if (trimmed.includes("*/")) block = null;
        } else if (startsBlockComment(trimmed, family)) {
          const allowed = commentAllowed || isAllowedComment(trimmed);
          if (!allowed) {
            violations.push({
              file: file.path,
              line: added.line,
              kind: "comment",
              label: "block comment",
              text: trimmed.slice(0, 160),
            });
          }
          if (!blockCloses(trimmed, family)) block = { allowed };
        } else if (isCommentLine(trimmed, family)) {
          if (!commentAllowed && !isAllowedComment(trimmed)) {
            violations.push({
              file: file.path,
              line: added.line,
              kind: "comment",
              label: "comment",
              text: trimmed.slice(0, 160),
            });
          }
        }
      }

      previous = { line: added.line, text: added.text };
    }
  }

  return {
    ok: violations.length === 0,
    range,
    scannedFiles,
    scannedLines,
    violations,
  };
}

export function formatViolation(violation) {
  const location = `${violation.file}:${violation.line}`;
  if (violation.kind === "suppression") {
    return `${location}  suppression (${violation.label}): ${violation.text}`;
  }
  return `${location}  comment: ${violation.text}`;
}

export const POLICY_HINTS = [
  "Comments: explain only a non-obvious why, an invariant, or an external constraint.",
  "Approved comment exception: put `factory:allow-comment <reason>` on the preceding line.",
  "Suppressions require approval: put `factory:allow-suppression <reason>` on the preceding line.",
];
