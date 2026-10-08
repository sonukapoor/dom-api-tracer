import { test, expect } from "vitest";

test("DOM work done by the implementation itself is not counted", () => {
  const ul = document.createElement("ul");
  ul.innerHTML = "<li>a</li><li class='b'>b</li>";
  document.body.appendChild(ul);
  const style = window.getComputedStyle(ul);
  expect(style.display).toBe("block");
  expect(ul.querySelector("li.b")).not.toBeNull();
});
