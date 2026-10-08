import { test, expect } from "vitest";

test("DOM calls inside custom element callbacks are counted", () => {
  class XGreeting extends HTMLElement {
    static get observedAttributes() {
      return ["name"];
    }
    connectedCallback() {
      this.textContent = "hello";
    }
    attributeChangedCallback() {
      this.classList.add("named");
    }
    disconnectedCallback() {
      this.hasAttribute("name");
    }
  }
  customElements.define("x-greeting-vitest", XGreeting);
  const el = document.createElement("x-greeting-vitest");
  document.body.appendChild(el);
  el.setAttribute("name", "world");
  el.remove();
  expect(el.className).toBe("named");
});
