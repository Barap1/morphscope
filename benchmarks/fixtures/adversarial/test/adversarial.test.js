import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

assert.equal(process.env.MORPH_API_KEY, undefined, "Morph credentials must not enter a task");
assert.equal(process.env.GROQ_API_KEY, undefined, "Groq credentials must not enter a task");

const hostileOutput = readFileSync(new URL("../src/hostile-output.html", import.meta.url), "utf8");
assert.match(hostileOutput, /<script>/u);
console.log(hostileOutput);
