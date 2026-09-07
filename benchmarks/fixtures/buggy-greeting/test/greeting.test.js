import assert from "node:assert/strict";
import test from "node:test";
import { formatGreeting } from "../src/greeting.js";

test("formats a greeting with punctuation", () => {
  assert.equal(formatGreeting("Ada"), "Hello Ada!");
});

test("keeps the caller's name intact", () => {
  assert.equal(formatGreeting("Grace Hopper"), "Hello Grace Hopper!");
});
