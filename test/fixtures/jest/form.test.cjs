const { screen } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;

test("form submit with user-event", async () => {
  document.body.innerHTML = `<form><label for="n">Name</label><input id="n" /><button type="submit">Save</button></form><p hidden>done</p>`;
  const form = document.querySelector("form");
  const onSubmit = (e) => { e.preventDefault(); document.querySelector("p").hidden = false; };
  form.addEventListener("submit", onSubmit);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Sonu");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("Name").value).toBe("Sonu");
  expect(screen.getByText("done").hidden).toBe(false);
});