import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
    this.rootDirectory = resolve(rootDirectory);
    mkdirSync(this.rootDirectory, { recursive: true });
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
    if (!path.startsWith(`${this.rootDirectory}/`)) return undefined;
    try {
      statSync(path);
      return path;
    } catch {
      return undefined;
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
