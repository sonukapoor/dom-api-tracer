// @vitest-environment node
import { test, expect } from "vitest";

test("files that opt out of the DOM still run", () => {
  expect(typeof document).toBe("undefined");
});
