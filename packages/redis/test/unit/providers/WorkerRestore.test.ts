import { expect, it } from "vitest";

import { restorationBody } from "#test/support/providers/workers/Multipart";

it("restores Cloudflare's filename-less downloads as uploadable module files", async () => {
  const original = await new Response(
    '--boundary\r\nContent-Disposition: form-data; name="worker.js"\r\n\r\nexport default {}\r\n--boundary--\r\n',
    { headers: { "content-type": "multipart/form-data; boundary=boundary" } },
  ).formData();
  expect(typeof original.get("worker.js")).toBe("string");

  const body = restorationBody(original, "worker.js", { compatibility_date: "2026-10-26" });
  const uploaded = await new Response(body).formData();
  const module = uploaded.get("worker.js");

  expect(module).toBeInstanceOf(File);
  if (!(module instanceof File)) throw new Error("Missing module file");
  expect(module.type).toBe("application/javascript+module");
  expect(await module.text()).toBe("export default {}");
  expect(JSON.parse(String(uploaded.get("metadata")))).toEqual({
    main_module: "worker.js",
    compatibility_date: "2026-10-26",
    compatibility_flags: [],
    bindings: [],
  });
});
