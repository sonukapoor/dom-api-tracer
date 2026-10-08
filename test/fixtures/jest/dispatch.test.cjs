test("only listener code is counted during event dispatch", () => {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  const handler = () => btn.setAttribute("data-on", "1");
  btn.onclick = handler;
  btn.addEventListener("click", () => btn.setAttribute("data-listener", "1"));
  btn.click();
  expect(btn.onclick).toBe(handler);
  expect(btn.getAttribute("data-on")).toBe("1");

  // The same listener added twice is still registered once.
  let calls = 0;
  const once = () => calls++;
  btn.addEventListener("focus", once);
  btn.addEventListener("focus", once);
  btn.dispatchEvent(new Event("focus"));
  btn.removeEventListener("focus", once);
  btn.dispatchEvent(new Event("focus"));
  expect(calls).toBe(1);
});
