/**
 * @jest-environment node
 */
test("files that opt out of the DOM still run", () => {
  expect(typeof document).toBe("undefined");
});
