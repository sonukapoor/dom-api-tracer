import { test, expect } from "vitest";
import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";

test("list rendering and classList", () => {
  const ul = document.createElement("ul");
  for (let i = 0; i < 50; i++) {
    const li = document.createElement("li");
    li.textContent = "item " + i;
    li.classList.add(i % 2 ? "odd" : "even");
    li.setAttribute("data-i", String(i));
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  expect(document.querySelectorAll("li.odd").length).toBe(25);
  expect(getComputedStyle(ul).display).toBe("block");
  expect(screen.getAllByRole("listitem").length).toBe(50);
});