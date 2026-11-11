import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const pm2File = new URL("../../docker/pm2.config.cjs", import.meta.url);

test("Speedio PM2 keeps server/nginx and gates optional services independently", () => {
  const saved = { ...process.env };
  try {
    for (const ssh of ["0", "1"]) for (const logExport of ["0", "1"]) {
      process.env.CCR_ENABLE_SSH = ssh;
      process.env.CCR_ENABLE_LOG_EXPORT = logExport;
      process.env.HOME = "/data";
      delete require.cache[require.resolve(pm2File.pathname)];
      const apps = require(pm2File.pathname).apps;
      assert.equal(apps.filter(a => a.name === "ccr-core-server").length, 1);
      assert.equal(apps.filter(a => a.name === "ccr-nginx").length, 1);
      assert.equal(apps.some(a => a.name === "ccr-sshd"), ssh === "1");
      assert.equal(apps.some(a => a.name === "ccr-log-export"), logExport === "1");
      assert.equal(new Set(apps.map(a => a.name)).size, apps.length);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[require.resolve(pm2File.pathname)];
  }
});

test("Hetzner exporter retains path-style and checksum compatibility", () => {
  const source = readFileSync(new URL("../../docker/log-export.cjs", import.meta.url), "utf8");
  assert.match(source, /forcePathStyle:\s*true/);
  assert.match(source, /requestChecksumCalculation:\s*"WHEN_REQUIRED"/);
  assert.match(source, /responseChecksumValidation:\s*"WHEN_REQUIRED"/);
});
