// @vitest-environment jsdom
import { expect, test } from "vitest";

test("jsdom is available for browser-like tests", () => {
  document.body.innerHTML = '<button id="x">hello</button>';
  expect(document.querySelector("#x")?.textContent).toBe("hello");
});
