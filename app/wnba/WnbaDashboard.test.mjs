import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Board Explorer hides unavailable live props from bettable views", () => {
  const source = readFileSync(new URL("./WnbaDashboard.tsx", import.meta.url), "utf8");

  assert.match(source, /function isUnavailableLiveProp/);
  assert.match(source, /row\.rejection_reason === "unavailable_live_prop"/);
  assert.match(source, /if \(isUnavailableLiveProp\(row\)\) return false;/);
});
