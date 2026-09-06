import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readText = (relativePath: string): string | undefined => {
  try {
    return readFileSync(join(repositoryRoot, relativePath), "utf8");
  } catch {
    failures.push(`missing or unreadable file: ${relativePath}`);
    return undefined;
  }
};

const readJson = (relativePath: string): JsonObject | undefined => {
  const contents = readText(relativePath);
  if (contents === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isJsonObject(parsed)) {
      failures.push(`expected a JSON object: ${relativePath}`);
      return undefined;
    }
    return parsed;
  } catch {
    failures.push(`invalid JSON: ${relativePath}`);
    return undefined;
  }
};

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) {
    failures.push(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
};

const packageManifest = readJson("package.json");
const workspaceManifest = readText("pnpm-workspace.yaml");

if (packageManifest) {
  requireEqual(packageManifest.name, "morphscope", "package name");
  requireEqual(packageManifest.private, true, "package privacy");
  requireEqual(packageManifest.type, "module", "package module type");
  requireEqual(packageManifest.packageManager, "pnpm@11.25.0", "package manager");

  const engines = isJsonObject(packageManifest.engines) ? packageManifest.engines : {};
  requireEqual(engines.node, ">=24 <25", "Node engine range");

  const scripts = isJsonObject(packageManifest.scripts) ? packageManifest.scripts : {};
  requireEqual(
    scripts["workspace:verify"],
    "node scripts/verify-workspace.ts",
    "workspace verification script",
  );
  requireEqual(scripts.typecheck, "tsc --noEmit --project tsconfig.json", "typecheck script");
  requireEqual(scripts.lint, "eslint . --max-warnings 0", "lint script");
  requireEqual(scripts.test, "vitest run --passWithNoTests", "test script");
  requireEqual(scripts["format:check"], "prettier --check .", "format check script");

  const expectedDevelopmentDependencies: Record<string, string> = {
    "@eslint/js": "10.0.1",
    "@types/node": "24.13.3",
    eslint: "10.10.0",
    prettier: "3.9.6",
    typescript: "6.0.3",
    "typescript-eslint": "8.69.0",
    vitest: "5.0.0",
  };
  const developmentDependencies = isJsonObject(packageManifest.devDependencies)
    ? packageManifest.devDependencies
    : {};
  for (const [name, version] of Object.entries(expectedDevelopmentDependencies)) {
    requireEqual(developmentDependencies[name], version, `development dependency ${name}`);
  }
}

if (workspaceManifest !== undefined) {
  const workspaceLines = workspaceManifest
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line.length > 0);
  const hasPackagesKey = workspaceLines.some((line) => line === "packages:");
  const workspaceGlobs = workspaceLines
    .filter((line) => line.startsWith("- "))
    .map((line) =>
      line
        .slice(2)
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2"),
    );
  const expectedGlobs = ["apps/*", "packages/*"];

  requireEqual(hasPackagesKey, true, "pnpm workspace packages key");
  requireEqual(workspaceGlobs.join("\n"), expectedGlobs.join("\n"), "pnpm workspace globs");
}

const canonicalCopies: Array<[string, string]> = [
  ["MorphScope_PRD.md", "docs/product-prd.md"],
  ["MorphScope_spec.md", "docs/build-spec.md"],
];

for (const [sourcePath, copyPath] of canonicalCopies) {
  const source = readText(sourcePath);
  const copy = readText(copyPath);
  if (source !== undefined && copy !== undefined) {
    const sourceBytes = Buffer.from(source, "utf8");
    const copyBytes = Buffer.from(copy, "utf8");
    if (!sourceBytes.equals(copyBytes)) {
      failures.push(`canonical document differs: ${sourcePath} vs ${copyPath}`);
    }
  }
}

const requiredBootstrapFiles = [
  "README.md",
  "AGENTS.md",
  ".env.example",
  ".editorconfig",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  ".prettierrc.json",
  ".gitattributes",
  "eslint.config.mjs",
  "tsconfig.json",
  "scripts/verify-workspace.ts",
];

for (const relativePath of requiredBootstrapFiles) {
  readText(relativePath);
}

if (failures.length > 0) {
  console.error("workspace verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "workspace verification passed: metadata, workspace globs, bootstrap files, and canonical docs",
  );
}
