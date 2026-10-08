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
  customElements.define("x-greeting-jest", XGreeting);
  const el = document.createElement("x-greeting-jest");
  document.body.appendChild(el);
  el.setAttribute("name", "world");
  el.remove();
  expect(el.className).toBe("named");
});
