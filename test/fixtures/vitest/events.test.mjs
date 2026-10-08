import { test, expect } from "vitest";

test("DOM calls inside event listeners are counted", () => {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  btn.addEventListener("click", () => {
    btn.setAttribute("data-a", "1");
    btn.setAttribute("data-b", "2");
    btn.setAttribute("data-c", "3");
  });
  btn.click();
  expect(btn.getAttribute("data-c")).toBe("3");
});
