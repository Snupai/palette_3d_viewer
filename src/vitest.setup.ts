import { afterEach } from "vitest";

// The planner mirrors its screen in the URL; jsdom keeps `location` across
// tests in a file, so every test starts from the start page again.
afterEach(() => {
  if (typeof window !== "undefined" && window.location.pathname !== "/") {
    window.history.replaceState(null, "", "/");
  }
});
