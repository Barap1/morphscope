import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request-body";

describe("bounded JSON request bodies", () => {
  it("parses valid bodies and rejects oversized streamed bodies", async () => {
    const valid = await readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ kind: "task" }),
      }),
      128,
    );
    expect(valid).toEqual({ ok: true, value: { kind: "task" } });

    const oversized = await readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ payload: "123456789" }),
      }),
      8,
    );
    expect(oversized).toEqual({ ok: false, status: 413, message: "Request body is too large." });
  });

  it("rejects malformed JSON without exposing parser details", async () => {
    const result = await readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        body: "not-json",
      }),
      128,
    );
    expect(result).toEqual({ ok: false, status: 400, message: "Request body must be valid JSON." });
  });
});
