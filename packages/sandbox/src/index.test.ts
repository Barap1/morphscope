import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dockerRunSecurityArgs, SandboxInputError, SandboxManager } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository(): { directory: string; commit: string } {
  const directory = mkdtempSync(join(tmpdir(), "morphscope-sandbox-test-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "README.md"), "before\n", "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "MorphScope Test"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@morphscope.local"], { cwd: directory });
  execFileSync("git", ["add", "README.md"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: directory });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  return { directory, commit };
}

describe("SandboxWorkspace", () => {
  it("builds a constrained Docker command contract", () => {
    const args = dockerRunSecurityArgs({
      image: "morphscope/sandbox:node24",
      root: "/tmp/morphscope-workspace",
      cwd: "src",
      maxMemoryMb: 512,
      maxPids: 128,
      maxCpus: 1,
      containerName: "morphscope-test-container",
    });
    expect(args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--memory=512m",
        "--pids-limit=128",
        "--cpus=1",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--tmpfs",
        "--mount",
        "type=bind,src=/tmp/morphscope-workspace,dst=/workspace",
      ]),
    );
  });

  it("checks out an immutable source and collects an isolated diff", () => {
    const source = createRepository();
    const workspace = new SandboxManager().acquire({
      source: source.directory,
      commit: source.commit,
    });
    workspace.replaceFile("README.md", "before", "after");
    expect(workspace.collectDiff().diff).toContain("+after");
    expect(readFileSync(join(source.directory, "README.md"), "utf8")).toBe("before\n");
    workspace.dispose();
    expect(workspace.isDisposed).toBe(true);
  });

  it("rejects paths that escape the workspace", () => {
    const source = createRepository();
    const workspace = new SandboxManager().acquire({
      source: source.directory,
      commit: source.commit,
    });
    expect(() => workspace.readFile("../outside.txt")).toThrow(SandboxInputError);
    expect(() =>
      workspace.applyPatch(
        "diff --git a/README.md b/../../outside.txt\n--- a/README.md\n+++ b/../../outside.txt\n@@ -1 +1 @@\n-before\n+escaped\n",
      ),
    ).toThrow(SandboxInputError);
    workspace.dispose();
  });

  it("keeps symlink reads and child credentials inside the sandbox boundary", () => {
    const source = createRepository();
    const outside = mkdtempSync(join(tmpdir(), "morphscope-sandbox-outside-"));
    temporaryDirectories.push(outside);
    writeFileSync(join(outside, "secret.txt"), "outside-secret\n", "utf8");
    symlinkSync(join(outside, "secret.txt"), join(source.directory, "link.txt"));
    execFileSync("git", ["add", "link.txt"], { cwd: source.directory });
    execFileSync("git", ["commit", "--quiet", "-m", "symlink"], { cwd: source.directory });
    const workspace = new SandboxManager().acquire({
      source: source.directory,
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: source.directory,
        encoding: "utf8",
      }).trim(),
    });
    const previousMorphKey = process.env.MORPH_API_KEY;
    process.env.MORPH_API_KEY = "sandbox-test-secret";
    try {
      expect(() => workspace.readFile("link.txt")).toThrow(SandboxInputError);
      const child = workspace.runCommand({
        command: "node",
        args: ["-e", "process.stdout.write(process.env.MORPH_API_KEY ?? 'missing')"],
      });
      expect(child.stdout).toBe("missing");
      const hostile = workspace.runCommand({
        command: "node",
        args: ["-e", "process.stdout.write('<script>hostile</script>')"],
      });
      expect(hostile.stdout).toContain("<script>");
    } finally {
      if (previousMorphKey === undefined) delete process.env.MORPH_API_KEY;
      else process.env.MORPH_API_KEY = previousMorphKey;
      workspace.dispose();
    }
  });

  it("captures command output and enforces command timeouts", () => {
    const source = createRepository();
    const workspace = new SandboxManager({ resourceLimits: { maxOutputBytes: 32 } }).acquire({
      source: source.directory,
      commit: source.commit,
    });
    const output = workspace.runCommand({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(200))"],
    });
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(32);
    const timeout = workspace.runCommand({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 100)"],
      timeoutMs: 10,
    });
    expect(timeout.timedOut).toBe(true);
    workspace.dispose();
  });

  it("applies a unified diff inside the workspace", () => {
    const source = createRepository();
    const workspace = new SandboxManager().acquire({
      source: source.directory,
      commit: source.commit,
    });
    workspace.applyPatch(
      "diff --git a/README.md b/README.md\nindex 9c7f3c5..2e65efe 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+patched\n",
    );
    expect(workspace.readFile("README.md")).toBe("patched\n");
    workspace.dispose();
  });
});
