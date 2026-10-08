import { test, expect } from "vitest";

test("builds a list", () => {
  const ul = document.createElement("ul");
  ul.appendChild(document.createElement("li"));
  document.body.appendChild(ul);
  expect(document.querySelectorAll("li")).toHaveLength(1);
});
