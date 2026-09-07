import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ArtifactManifestSchema, type ArtifactManifest } from "@morphscope/schemas";

export type ArtifactPutInput = {
  content: string | Uint8Array;
  mimeType: string;
  redactionStatus: string;
  producerSpanId: string;
};

export type StoredArtifact = ArtifactManifest;

const toBuffer = (content: string | Uint8Array): Buffer =>
  typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);

export class ContentAddressedArtifactStore {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    const resolvedRoot = resolve(rootDirectory);
    mkdirSync(resolvedRoot, { recursive: true });
    this.rootDirectory = realpathSync.native(resolvedRoot);
  }

  put(input: ArtifactPutInput): StoredArtifact {
    const content = toBuffer(input.content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const relativeStoragePath = join("sha256", sha256.slice(0, 2), sha256);
    const storagePath = resolve(this.rootDirectory, relativeStoragePath);

    if (!storagePath.startsWith(`${this.rootDirectory}/`)) {
      throw new Error("artifact path escaped the artifact store root");
    }

    mkdirSync(dirname(storagePath), { recursive: true });
    try {
      writeFileSync(storagePath, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (!isSafeArtifactFile(this.rootDirectory, storagePath)) {
        throw new Error("artifact path is not a regular file inside the artifact store root");
      }
    }

    return ArtifactManifestSchema.parse({
      sha256,
      mimeType: input.mimeType,
      size: content.byteLength,
      storagePath: relative(this.rootDirectory, storagePath),
      redactionStatus: input.redactionStatus,
      producerSpanId: input.producerSpanId,
    });
  }

  has(sha256: string): boolean {
    return this.pathForHash(sha256) !== undefined;
  }

  read(sha256: string): Buffer {
    const path = this.pathForHash(sha256);
    if (!path) throw new Error(`artifact not found: ${sha256}`);
    return readFileSync(path);
  }

  size(sha256: string): number {
    const path = this.pathForHash(sha256);
    if (!path) throw new Error(`artifact not found: ${sha256}`);
    return statSync(path).size;
  }

  private pathForHash(sha256: string): string | undefined {
    if (!/^[a-f0-9]{64}$/.test(sha256)) return undefined;
    const path = resolve(this.rootDirectory, "sha256", sha256.slice(0, 2), sha256);
    if (!isWithin(this.rootDirectory, path)) return undefined;
    try {
      return isSafeArtifactFile(this.rootDirectory, path) ? path : undefined;
    } catch {
      return undefined;
    }
  }
}

function isSafeArtifactFile(root: string, path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return isWithin(root, realpathSync.native(path));
  } catch {
    return false;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
