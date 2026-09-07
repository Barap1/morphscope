import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hrtime } from "node:process";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const WORKSPACE_PREFIX = "morphscope-sandbox-";
const MAX_ERROR_OUTPUT_BYTES = 2_048;

/** Commands that may be launched without explicitly extending the allowlist. */
export const DEFAULT_ALLOWED_COMMANDS = [
  "bun",
  "bundle",
  "cargo",
  "deno",
  "git",
  "go",
  "make",
  "node",
  "npm",
  "npx",
  "pnpm",
  "pytest",
  "python",
  "python3",
  "rg",
  "ruby",
  "tsc",
  "yarn",
] as const;

export type RepositorySource = string | URL;

export interface SandboxResourceLimits {
  /** Maximum wall-clock time for one child process. */
  commandTimeoutMs: number;
  /** Maximum combined stdout and stderr bytes returned for one child process. */
  maxOutputBytes: number;
}

export interface SandboxManagerOptions {
  resourceLimits?: Partial<SandboxResourceLimits>;
  allowedCommands?: readonly string[];
  /** Optional parent directory for owned temporary workspaces. */
  temporaryDirectory?: string;
}

export interface AcquireWorkspaceOptions {
  source: RepositorySource;
  commit: string;
  resourceLimits?: Partial<SandboxResourceLimits>;
}

export interface LocalWorkspaceOptions {
  sourcePath: string;
  commit: string;
  workspaceRoot: string;
  resourceLimits?: {
    maxDurationMs?: number;
    maxCommandOutputBytes?: number;
  };
}

export interface CommandRequest {
  command: string;
  args?: readonly string[];
  /** Relative to the workspace root. Absolute paths are allowed only inside it. */
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Explicit variables are added to a small, sanitized child environment. */
  env?: Readonly<Record<string, string | undefined>>;
}

export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  capturedOutputBytes: number;
  errorCode?: string;
}

export type WorkspaceCommandResult = Pick<
  CommandResult,
  | "command"
  | "cwd"
  | "exitCode"
  | "signal"
  | "stdout"
  | "stderr"
  | "durationMs"
  | "timedOut"
  | "truncated"
>;

export interface BaselineToolbox {
  runCommand(request: CommandRequest): CommandResult;
  listFiles(path?: string): string[];
  search(pattern: string, path?: string): SearchResult;
  readFile(path: string): string;
  replaceFile(path: string, oldText: string, newText: string): FileReplacementResult;
  applyPatch(patch: string): { files: string[] };
  collectDiff(options?: DiffOptions): DiffResult;
}

export interface FileReplacementResult {
  path: string;
  replacements: number;
  changed: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchResult {
  pattern: string;
  path: string;
  matches: SearchMatch[];
  command: CommandResult;
}

export interface DiffOptions {
  paths?: readonly string[];
  maxOutputBytes?: number;
}

export interface DiffResult {
  diff: string;
  command: CommandResult;
}

export interface LocalWorkspace extends BaselineToolbox {
  readonly root: string;
  readonly sourceCommit: string;
  runSetup(command: string, timeoutMs?: number): WorkspaceCommandResult;
  dispose(): void;
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class SandboxInputError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxInputError";
  }
}

export class SandboxDisposedError extends SandboxError {
  constructor() {
    super("The sandbox workspace has already been disposed");
    this.name = "SandboxDisposedError";
  }
}

/** Creates isolated local workspaces while keeping acquisition policy provider-neutral. */
export class SandboxManager {
  private readonly options: Required<Pick<SandboxManagerOptions, "resourceLimits">> &
    Omit<SandboxManagerOptions, "resourceLimits">;

  constructor(options: SandboxManagerOptions = {}) {
    this.options = {
      ...options,
      resourceLimits: normalizeResourceLimits(options.resourceLimits),
    };
  }

  acquire(options: AcquireWorkspaceOptions): SandboxWorkspace {
    return SandboxWorkspace.acquire({
      ...options,
      resourceLimits: {
        ...this.options.resourceLimits,
        ...options.resourceLimits,
      },
      allowedCommands: this.options.allowedCommands,
      temporaryDirectory: this.options.temporaryDirectory,
    });
  }
}

/** One detached, disposable checkout of an exact source commit. */
export class SandboxWorkspace {
  readonly sourcePath: string;
  readonly sourceCommit: string;
  readonly rootPath: string;

  private readonly resourceLimits: SandboxResourceLimits;
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly ownedTemporaryDirectory: string;
  private disposed = false;

  private constructor(options: {
    sourcePath: string;
    sourceCommit: string;
    rootPath: string;
    resourceLimits: SandboxResourceLimits;
    allowedCommands: ReadonlySet<string>;
    ownedTemporaryDirectory: string;
  }) {
    this.sourcePath = options.sourcePath;
    this.sourceCommit = options.sourceCommit;
    this.rootPath = options.rootPath;
    this.resourceLimits = options.resourceLimits;
    this.allowedCommands = options.allowedCommands;
    this.ownedTemporaryDirectory = options.ownedTemporaryDirectory;
  }

  /** Alias useful to consumers that model the checkout as a generic workspace. */
  get root(): string {
    return this.rootPath;
  }

  get workspacePath(): string {
    return this.rootPath;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  static acquire(
    options: AcquireWorkspaceOptions & SandboxManagerOptions & { workspaceRoot?: string },
  ): SandboxWorkspace {
    const sourcePath = resolveLocalRepositorySource(options.source);
    const gitSource =
      !existsSync(join(sourcePath, ".morphscope-commit")) && isGitRepository(sourcePath);
    const sourceCommit = gitSource
      ? resolveCommit(sourcePath, options.commit)
      : resolveFixtureCommit(sourcePath, options.commit);
    const resourceLimits = normalizeResourceLimits(options.resourceLimits);
    const allowedCommands = normalizeAllowlist(options.allowedCommands);
    const temporaryParent = resolveTemporaryParent(options.temporaryDirectory);
    const workspacePath = createOwnedWorkspacePath(
      options.workspaceRoot,
      temporaryParent,
      sourcePath,
    );

    try {
      if (gitSource) {
        runGit(
          [
            "clone",
            "--no-local",
            "--no-hardlinks",
            "--no-checkout",
            "--",
            sourcePath,
            workspacePath,
          ],
          temporaryParent,
        );
        runGit(
          ["checkout", "--detach", "--force", "--no-recurse-submodules", sourceCommit],
          workspacePath,
        );
        const checkedOutCommit = runGit(
          ["rev-parse", "--verify", "HEAD"],
          workspacePath,
        ).stdout.trim();
        if (checkedOutCommit !== sourceCommit) {
          throw new SandboxError(
            `Git checkout did not produce the requested commit: expected ${sourceCommit}, got ${checkedOutCommit}`,
          );
        }
      } else {
        materializeFixtureWorkspace(sourcePath, workspacePath);
      }

      return new SandboxWorkspace({
        sourcePath,
        sourceCommit,
        rootPath: realpathSync.native(workspacePath),
        resourceLimits,
        allowedCommands,
        ownedTemporaryDirectory: workspacePath,
      });
    } catch (error) {
      rmSync(workspacePath, { recursive: true, force: true });
      throw error;
    }
  }

  runCommand(request: CommandRequest): CommandResult {
    this.assertUsable();
    const command = validateCommand(request.command, this.allowedCommands);
    const args = [...(request.args ?? [])].map((arg) => validateArgument(arg, "command argument"));
    const cwdPath = this.resolveExistingPath(request.cwd ?? ".", "command cwd", true);
    const timeoutMs = normalizePositiveLimit(
      request.timeoutMs ?? this.resourceLimits.commandTimeoutMs,
      "command timeout",
    );
    const maxOutputBytes = normalizePositiveLimit(
      request.maxOutputBytes ?? this.resourceLimits.maxOutputBytes,
      "maximum command output",
    );
    const start = hrtime.bigint();
    const result = spawnSync(command, args, {
      cwd: cwdPath,
      env: createChildEnvironment(request.env),
      encoding: "buffer",
      input: undefined,
      killSignal: "SIGTERM",
      maxBuffer: maxOutputBytes,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      windowsHide: true,
    });
    const durationMs = Number(hrtime.bigint() - start) / 1_000_000;
    return commandResult(command, args, cwdPath, result, durationMs, maxOutputBytes);
  }

  /** Runs a task setup command through the exact same allowlist, cwd, timeout, and capture path. */
  runSetup(command: string, timeoutMs?: number): WorkspaceCommandResult;
  runSetup(request: CommandRequest): CommandResult;
  runSetup(setup: string | CommandRequest, timeoutMs?: number): CommandResult {
    this.assertUsable();
    if (typeof setup === "string") {
      const tokens = parseCommandLine(setup);
      if (tokens.length === 0) {
        throw new SandboxInputError("Setup command must not be empty");
      }
      return this.runCommand({ command: tokens[0], args: tokens.slice(1), timeoutMs });
    }
    return this.runCommand(setup);
  }

  /** Returns repository files in stable POSIX-relative lexical order. */
  listFiles(path = "."): string[] {
    this.assertUsable();
    const directory = this.resolveExistingPath(path, "file listing path", true);
    if (!statSync(directory).isDirectory()) {
      throw new SandboxInputError(`File listing path is not a directory: ${path}`);
    }
    const files: string[] = [];
    walkFiles(this.rootPath, directory, files);
    return files.sort(comparePaths);
  }

  search(pattern: string, path = "."): SearchResult {
    this.assertUsable();
    if (pattern.length === 0) {
      throw new SandboxInputError("Search pattern must not be empty");
    }
    validateArgument(pattern, "search pattern");
    const searchPath = this.resolveExistingPath(path, "search path", true);
    const relativeSearchPath = toWorkspaceRelative(this.rootPath, searchPath);
    const command = this.runCommand({
      command: "rg",
      args: [
        "--no-heading",
        "--line-number",
        "--column",
        "--color",
        "never",
        "--hidden",
        "--sort",
        "path",
        "--glob",
        "!.git/**",
        "--",
        pattern,
        relativeSearchPath,
      ],
    });
    const matches = parseRipgrepMatches(command.stdout);
    return { pattern, path: relativeSearchPath, matches, command };
  }

  readFile(path: string): string {
    this.assertUsable();
    const filePath = this.resolveExistingPath(path, "file path", false);
    if (!statSync(filePath).isFile()) {
      throw new SandboxInputError(`File path is not a regular file: ${path}`);
    }
    return readFileSync(filePath, "utf8");
  }

  /** Replaces exactly one occurrence, preventing accidental broad edits. */
  replaceFile(path: string, oldText: string, newText: string): FileReplacementResult {
    this.assertUsable();
    if (oldText.length === 0) {
      throw new SandboxInputError("Replacement target must not be empty");
    }
    const filePath = this.resolveExistingPath(path, "replacement file path", false);
    if (!statSync(filePath).isFile()) {
      throw new SandboxInputError(`Replacement path is not a regular file: ${path}`);
    }
    const current = readFileSync(filePath, "utf8");
    const firstIndex = current.indexOf(oldText);
    const secondIndex =
      firstIndex === -1 ? -1 : current.indexOf(oldText, firstIndex + oldText.length);
    if (firstIndex === -1) {
      throw new SandboxInputError(`Replacement target was not found in ${path}`);
    }
    if (secondIndex !== -1) {
      throw new SandboxInputError(
        `Replacement target is ambiguous in ${path}; found more than once`,
      );
    }
    const updated = `${current.slice(0, firstIndex)}${newText}${current.slice(firstIndex + oldText.length)}`;
    if (updated !== current) {
      writeFileSync(filePath, updated, "utf8");
    }
    return {
      path: toWorkspaceRelative(this.rootPath, filePath),
      replacements: 1,
      changed: updated !== current,
    };
  }

  applyPatch(patch: string): { files: string[] } {
    this.assertUsable();
    if (patch.length === 0 || patch.includes("\0")) {
      throw new SandboxInputError("Patch must be non-empty and must not contain NUL bytes");
    }
    const files = patchFilePaths(patch);
    for (const file of files) this.resolvePath(file, "patch path", true);
    const patchPath = join(this.rootPath, ".morphscope-apply.patch");
    writeFileSync(patchPath, patch, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      const result = this.runCommand({
        command: "git",
        args: ["apply", "--whitespace=nowarn", "--", ".morphscope-apply.patch"],
      });
      if (result.exitCode !== 0) {
        throw new SandboxError(
          `Patch application failed: ${result.stderr || result.stdout}`.trim(),
        );
      }
      return { files };
    } finally {
      rmSync(patchPath, { force: true });
    }
  }

  collectDiff(options: DiffOptions = {}): DiffResult {
    this.assertUsable();
    const args = ["diff", "--no-ext-diff", "--no-color", "--unified=3", "--"];
    for (const path of options.paths ?? []) {
      const safePath = this.resolvePath(path, "diff path", true);
      args.push(toWorkspaceRelative(this.rootPath, safePath));
    }
    const command = this.runCommand({
      command: "git",
      args,
      maxOutputBytes: options.maxOutputBytes,
    });
    return { diff: command.stdout, command };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    rmSync(this.ownedTemporaryDirectory, { recursive: true, force: true });
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new SandboxDisposedError();
    }
  }

  private resolveExistingPath(input: string, label: string, directory: boolean): string {
    const candidate = this.resolvePath(input, label, false);
    let realPath: string;
    try {
      realPath = realpathSync.native(candidate);
    } catch {
      throw new SandboxInputError(`${label} does not exist: ${input}`);
    }
    assertWithin(this.rootPath, realPath, label);
    if (directory && !statSync(realPath).isDirectory()) {
      throw new SandboxInputError(`${label} is not a directory: ${input}`);
    }
    if (!directory && !statSync(realPath).isFile()) {
      throw new SandboxInputError(`${label} is not a regular file: ${input}`);
    }
    return realPath;
  }

  private resolvePath(input: string, label: string, allowMissing: boolean): string {
    if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
      throw new SandboxInputError(`${label} must be a non-empty path without NUL bytes`);
    }
    const candidate = isAbsolute(input) ? resolve(input) : resolve(this.rootPath, input);
    assertWithin(this.rootPath, candidate, label);
    if (existsSync(candidate)) {
      const realPath = realpathSync.native(candidate);
      assertWithin(this.rootPath, realPath, label);
      return realPath;
    }
    if (!allowMissing) {
      throw new SandboxInputError(`${label} does not exist: ${input}`);
    }
    const parent = realpathSync.native(dirname(candidate));
    assertWithin(this.rootPath, parent, label);
    return candidate;
  }
}

/** CLI-oriented factory with the stable CP3 workspace shape. */
export function createLocalWorkspace(options: LocalWorkspaceOptions): LocalWorkspace {
  return SandboxWorkspace.acquire({
    source: options.sourcePath,
    commit: options.commit,
    workspaceRoot: options.workspaceRoot,
    resourceLimits: {
      commandTimeoutMs: options.resourceLimits?.maxDurationMs,
      maxOutputBytes: options.resourceLimits?.maxCommandOutputBytes,
    },
  });
}

function normalizeResourceLimits(
  limits: Partial<SandboxResourceLimits> = {},
): SandboxResourceLimits {
  return {
    commandTimeoutMs: normalizePositiveLimit(
      limits.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      "command timeout",
    ),
    maxOutputBytes: normalizePositiveLimit(
      limits.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      "maximum command output",
    ),
  };
}

function normalizePositiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SandboxInputError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizeAllowlist(
  commands: readonly string[] = DEFAULT_ALLOWED_COMMANDS,
): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const command of commands) {
    if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
      throw new SandboxInputError("Allowed commands must be non-empty strings without NUL bytes");
    }
    normalized.add(command.toLowerCase());
    normalized.add(commandBasename(command).toLowerCase());
  }
  return normalized;
}

function validateCommand(command: string, allowedCommands: ReadonlySet<string>): string {
  validateArgument(command, "command");
  if (command.includes(" ") || command.includes("\t") || command.includes("\n")) {
    throw new SandboxInputError(
      "Command must contain only the executable name; pass arguments separately",
    );
  }
  const commandName = command.toLowerCase();
  const baseName = commandBasename(command).toLowerCase();
  if (!allowedCommands.has(commandName) && !allowedCommands.has(baseName)) {
    throw new SandboxInputError(`Command is not allowlisted: ${command}`);
  }
  return command;
}

function validateArgument(value: string, label: string): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new SandboxInputError(`${label} must be a string without NUL bytes`);
  }
  return value;
}

function commandBasename(command: string): string {
  return basename(command).replace(/\.exe$/i, "");
}

function resolveTemporaryParent(directory: string | undefined): string {
  const parent = realpathSync.native(directory ?? tmpdir());
  if (!statSync(parent).isDirectory()) {
    throw new SandboxInputError(`Temporary workspace parent is not a directory: ${parent}`);
  }
  return parent;
}

function createOwnedWorkspacePath(
  requestedPath: string | undefined,
  temporaryParent: string,
  sourcePath: string,
): string {
  if (requestedPath === undefined) {
    return mkdtempSync(join(temporaryParent, WORKSPACE_PREFIX));
  }
  if (requestedPath.length === 0 || requestedPath.includes("\0")) {
    throw new SandboxInputError("Workspace root must be a non-empty path without NUL bytes");
  }
  const workspacePath = resolve(requestedPath);
  if (workspacePath === sourcePath || isWithinPath(sourcePath, workspacePath)) {
    throw new SandboxInputError("Workspace root cannot be the source repository or inside it");
  }
  if (existsSync(workspacePath)) {
    throw new SandboxInputError(
      `Workspace root already exists and will not be removed: ${workspacePath}`,
    );
  }
  const parent = realpathSync.native(dirname(workspacePath));
  if (parent === sourcePath || isWithinPath(sourcePath, parent)) {
    throw new SandboxInputError("Workspace root cannot be created inside the source repository");
  }
  mkdirSync(workspacePath);
  return workspacePath;
}

function resolveLocalRepositorySource(source: RepositorySource): string {
  const input = source instanceof URL ? source.toString() : source;
  if (typeof input !== "string" || input.length === 0) {
    throw new SandboxInputError("Repository source must be a local path or file:// URL");
  }
  if (source instanceof URL || input.startsWith("file:")) {
    let filePath: string;
    try {
      const url = source instanceof URL ? source : new URL(input);
      if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost")) {
        throw new SandboxInputError("Only local file:// repository sources are supported");
      }
      filePath = fileURLToPath(url);
    } catch (error) {
      if (error instanceof SandboxError) {
        throw error;
      }
      throw new SandboxInputError("Repository source must be a valid local file:// URL");
    }
    return validateRepositoryDirectory(filePath);
  }
  if (/^(?:https?|ssh|git):\/\//i.test(input) || /^git@[^:]+:/i.test(input)) {
    throw new SandboxInputError(
      "Remote git sources are not supported in this checkpoint; provide a local path or file:// URL",
    );
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(input) && !isAbsolute(input)) {
    throw new SandboxInputError(
      "Remote or non-file repository sources are not supported; provide a local path or file:// URL",
    );
  }
  return validateRepositoryDirectory(resolve(input));
}

function validateRepositoryDirectory(sourcePath: string): string {
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync.native(sourcePath);
  } catch {
    throw new SandboxInputError(`Repository source does not exist: ${sourcePath}`);
  }
  if (!statSync(resolvedPath).isDirectory()) {
    throw new SandboxInputError(`Repository source is not a directory: ${resolvedPath}`);
  }
  if (existsSync(join(resolvedPath, ".morphscope-commit"))) {
    return resolvedPath;
  }
  if (isGitRepository(resolvedPath)) {
    const topLevel = runGit(["rev-parse", "--show-toplevel"], resolvedPath).stdout.trim();
    return realpathSync.native(topLevel);
  }
  if (!existsSync(join(resolvedPath, ".morphscope-commit"))) {
    throw new SandboxInputError(
      "Repository source is not a Git repository; add .morphscope-commit for a versioned local fixture",
    );
  }
  return resolvedPath;
}

function validateCommit(commit: string): string {
  if (!/^[0-9a-f]{4,64}$/i.test(commit)) {
    throw new SandboxInputError(
      "Commit must be a hexadecimal Git object ID or abbreviated object ID",
    );
  }
  return commit;
}

function resolveCommit(sourcePath: string, requestedCommit: string): string {
  const commit = validateCommit(requestedCommit);
  const result = runGit(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], sourcePath);
  const resolved = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(resolved)) {
    throw new SandboxError("Git did not return a valid commit object ID");
  }
  return resolved;
}

function resolveFixtureCommit(sourcePath: string, requestedCommit: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(requestedCommit)) {
    throw new SandboxInputError("Fixture commit must be a non-empty version identifier");
  }
  const declaredCommit = readFileSync(join(sourcePath, ".morphscope-commit"), "utf8").trim();
  if (declaredCommit !== requestedCommit) {
    throw new SandboxError(
      `Fixture commit does not match its manifest: expected ${requestedCommit}, got ${declaredCommit || "<empty>"}`,
    );
  }
  return requestedCommit;
}

function isGitRepository(sourcePath: string): boolean {
  try {
    runGit(["rev-parse", "--show-toplevel"], sourcePath);
    return true;
  } catch {
    return false;
  }
}

function materializeFixtureWorkspace(sourcePath: string, workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });
  for (const entry of readdirSync(sourcePath)) {
    cpSync(join(sourcePath, entry), join(workspacePath, entry), { recursive: true, force: true });
  }
  runGit(["init", "--quiet"], workspacePath);
  runGit(["config", "user.name", "MorphScope Fixture"], workspacePath);
  runGit(["config", "user.email", "fixture@morphscope.local"], workspacePath);
  runGit(["add", "--all"], workspacePath);
  runGit(["commit", "--quiet", "-m", "fixture snapshot"], workspacePath);
}

interface GitResult {
  stdout: string;
  stderr: string;
}

function runGit(args: readonly string[], cwd: string): GitResult {
  const result = spawnSync("git", [...args], {
    cwd,
    env: createChildEnvironment({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    }),
    encoding: "utf8",
    maxBuffer: DEFAULT_MAX_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    const code = getErrorCode(result.error);
    const details = truncateForError(stderr || stdout);
    throw new SandboxError(
      `git ${args[0] ?? "command"} failed${code ? ` (${code})` : ""}${details ? `: ${details}` : ""}`,
    );
  }
  return { stdout, stderr };
}

function createChildEnvironment(
  overrides?: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
  ]) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_SYSTEM = "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  for (const [name, value] of Object.entries(overrides ?? {})) {
    validateArgument(name, "environment variable name");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new SandboxInputError(`Invalid environment variable name: ${name}`);
    }
    if (value === undefined) {
      delete environment[name];
    } else {
      environment[name] = validateArgument(value, "environment variable value");
    }
  }
  return environment;
}

function commandResult(
  command: string,
  args: string[],
  cwd: string,
  result: SpawnSyncReturns<Buffer>,
  durationMs: number,
  maxOutputBytes: number,
): CommandResult {
  const stdoutBuffer = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "");
  const stderrBuffer = Buffer.isBuffer(result.stderr)
    ? result.stderr
    : Buffer.from(result.stderr ?? "");
  const errorCode = getErrorCode(result.error);
  const processOutputTruncated = errorCode === "ENOBUFS";
  const originalOutputBytes = stdoutBuffer.byteLength + stderrBuffer.byteLength;
  const stdoutTruncated = processOutputTruncated || originalOutputBytes > maxOutputBytes;
  const stderrTruncated = processOutputTruncated || originalOutputBytes > maxOutputBytes;
  let remaining = maxOutputBytes;
  const capturedStdout = stdoutBuffer.subarray(0, remaining);
  remaining -= capturedStdout.byteLength;
  const capturedStderr = stderrBuffer.subarray(0, Math.max(0, remaining));
  const truncated = processOutputTruncated || originalOutputBytes > maxOutputBytes;
  return {
    command,
    args,
    cwd,
    stdout: capturedStdout.toString("utf8"),
    stderr: capturedStderr.toString("utf8"),
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    timedOut: errorCode === "ETIMEDOUT",
    truncated,
    stdoutTruncated: stdoutTruncated && stdoutBuffer.byteLength > capturedStdout.byteLength,
    stderrTruncated: stderrTruncated && stderrBuffer.byteLength > capturedStderr.byteLength,
    stdoutBytes: capturedStdout.byteLength,
    stderrBytes: capturedStderr.byteLength,
    capturedOutputBytes: capturedStdout.byteLength + capturedStderr.byteLength,
    ...(errorCode ? { errorCode } : {}),
  };
}

function walkFiles(rootPath: string, directory: string, files: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    comparePaths(left.name, right.name),
  );
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootPath, entryPath, files);
    } else {
      files.push(toWorkspaceRelative(rootPath, entryPath));
    }
  }
}

function parseRipgrepMatches(output: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    matches.push({
      path: match[1].replace(/^\.\//u, ""),
      line: Number(match[2]),
      column: Number(match[3]),
      text: match[4],
    });
  }
  return matches.sort((left, right) => {
    const pathOrder = comparePaths(left.path, right.path);
    return (
      pathOrder ||
      left.line - right.line ||
      left.column - right.column ||
      left.text.localeCompare(right.text)
    );
  });
}

function parseCommandLine(input: string): string[] {
  if (input.trim().length === 0) {
    return [];
  }
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"') {
        index += 1;
        if (index >= input.length) {
          throw new SandboxInputError("Setup command ends with an incomplete escape");
        }
        token += input[index];
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    if (character === "\\") {
      index += 1;
      if (index >= input.length) {
        throw new SandboxInputError("Setup command ends with an incomplete escape");
      }
      token += input[index];
      tokenStarted = true;
      continue;
    }
    if (";&|<>$`(){}!".includes(character)) {
      throw new SandboxInputError(`Shell syntax is not supported in setup commands: ${character}`);
    }
    token += character;
    tokenStarted = true;
  }
  if (quote !== null) {
    throw new SandboxInputError("Setup command contains an unterminated quote");
  }
  if (tokenStarted) {
    tokens.push(token);
  }
  return tokens;
}

function patchFilePaths(patch: string): string[] {
  const paths = [
    ...[...patch.matchAll(/^--- a\/(.+)$/gmu)].map((match) => match[1]),
    ...[...patch.matchAll(/^\+\+\+ b\/(.+)$/gmu)].map((match) => match[1]),
  ].filter((path) => path !== "/dev/null");
  return [...new Set(paths)];
}

function assertWithin(rootPath: string, candidate: string, label: string): void {
  const root = resolve(rootPath);
  const target = resolve(candidate);
  const relativePath = relative(root, target);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new SandboxInputError(`${label} escapes the workspace: ${candidate}`);
  }
}

function isWithinPath(rootPath: string, candidate: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidate));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

function toWorkspaceRelative(rootPath: string, filePath: string): string {
  const result = relative(rootPath, filePath);
  return result.length === 0 ? "." : result.split(sep).join("/");
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "variant" });
}

function getErrorCode(error: Error | undefined): string | undefined {
  if (!error) {
    return undefined;
  }
  const candidate = error as Error & { code?: string };
  return candidate.code;
}

function truncateForError(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  return bytes.subarray(0, MAX_ERROR_OUTPUT_BYTES).toString("utf8").replace(/\s+$/u, "");
}
