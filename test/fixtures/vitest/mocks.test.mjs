import { test, expect, vi } from "vitest";
test("user mocks are not wrapped or broken", () => {
  const spy = vi.fn();
  window.scrollTo = spy;
  window.scrollTo(0, 10);
  expect(window.scrollTo).toBe(spy);
  expect(spy).toHaveBeenCalledWith(0, 10);
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  expect(window.matchMedia("(min-width: 1px)").matches).toBe(true);
  const el = document.createElement("div");
  expect(el.setAttribute.name).toBe("setAttribute");
  expect(Element.prototype.setAttribute.length).toBe(2);
  expect(window.getComputedStyle === window.getComputedStyle).toBe(true);
});
