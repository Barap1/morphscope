import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TaskSchema, type Task } from "@morphscope/schemas";

type YamlLine = { indent: number; text: string };

export function readTaskFile(filename: string): Task {
  const path = resolve(filename);
  const source = readFileSync(path, "utf8");
  const parsed = path.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
  return TaskSchema.parse(parsed);
}

/** Minimal dependency-free YAML reader for version-controlled task manifests. */
function parseYaml(source: string): unknown {
  const lines: YamlLine[] = source
    .split(/\r?\n/)
    .map((line) => {
      const text = line.trimEnd();
      return { indent: text.length - text.trimStart().length, text: text.trim() };
    })
    .filter(({ text }) => text.length > 0 && !text.startsWith("#"));

  if (lines.length === 0) throw new Error("task file is empty");
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next !== lines.length) throw new Error(`could not parse task near line ${next + 1}`);
  return value;
}

function parseBlock(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  const isArray = lines[start]?.indent === indent && lines[start].text.startsWith("-");
  const result: unknown[] | Record<string, unknown> = isArray ? [] : {};
  let index = start;

  while (index < lines.length && lines[index].indent === indent) {
    const line = lines[index].text;
    if (isArray) {
      if (!line.startsWith("-")) break;
      const item = line.slice(1).trim();
      if (!item) {
        const next = lines[index + 1];
        if (!next || next.indent <= indent)
          throw new Error(`empty array item at line ${index + 1}`);
        const [nested, nextIndex] = parseBlock(lines, index + 1, next.indent);
        (result as unknown[]).push(nested);
        index = nextIndex;
      } else {
        (result as unknown[]).push(parseScalar(item));
        index += 1;
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`expected key/value at line ${index + 1}`);
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest) {
      (result as Record<string, unknown>)[key] = parseScalar(rest);
      index += 1;
    } else {
      const next = lines[index + 1];
      if (!next || next.indent <= indent) throw new Error(`missing value for ${key}`);
      const [nested, nextIndex] = parseBlock(lines, index + 1, next.indent);
      (result as Record<string, unknown>)[key] = nested;
      index = nextIndex;
    }
  }
  return [result, index];
}

function parseScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) return JSON.parse(value);
  return value;
}

export function readJsonFile<T>(filename: string): T {
  return JSON.parse(readFileSync(resolve(filename), "utf8")) as T;
}
