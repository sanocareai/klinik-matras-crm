import test from "node:test";
import assert from "node:assert/strict";
import { thumbUrl } from "../src/lib/mediaThumb.js";

test("foto upload server → thumbnail; lainnya dibiarkan", () => {
  assert.equal(thumbUrl("/uploads/a.jpg"), "/uploads/a.jpg?w=480");
  assert.equal(thumbUrl("/uploads/a.PNG", 320), "/uploads/a.PNG?w=320");
  assert.equal(thumbUrl("https://x.id/uploads/a.jpg", 160), "https://x.id/uploads/a.jpg?w=160");
  assert.equal(thumbUrl("/uploads/a.mp4"), "/uploads/a.mp4");
  assert.equal(thumbUrl("/uploads/a.pdf"), "/uploads/a.pdf");
  assert.equal(thumbUrl("blob:http://x/uuid"), "blob:http://x/uuid");
  assert.equal(thumbUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
  assert.equal(thumbUrl("/uploads/a.jpg?v=1"), "/uploads/a.jpg?v=1");
  assert.equal(thumbUrl(null), null);
});
