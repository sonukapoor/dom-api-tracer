// Test framework globals live on the jsdom window; the tracer must not wrap them.
describe.each([["a"], ["b"]])("describe.each %s", (name) => {
  it.each([[1], [2]])("it.each %i", (n) => {
    expect(name.length + n).toBeGreaterThan(1);
  });
});

test("test framework globals are not counted as DOM members", () => {
  expect(typeof it.each).toBe("function");
});
