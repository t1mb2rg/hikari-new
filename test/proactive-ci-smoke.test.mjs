import assert from "node:assert/strict";
import test from "node:test";

test("intentional proactive CI outbound smoke failure", () => {
  assert.fail("intentional failure for Hikari proactive CI test");
});
