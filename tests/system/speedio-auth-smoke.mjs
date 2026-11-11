import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

const image = process.env.CCR_DOCKER_TEST_IMAGE || "claude-code-router:local";
const name = `ccr-speedio-auth-${randomUUID().slice(0, 8)}`;
const volume = `${name}-data`;
const password = "speedio-test-password"; // Synthetic fixture; not a real account.
const hash = 'smoke:$2y$05$ZFYaTAXt2VEDxbANAApyC.OivYaMcEpQglXFD/RUPFfVrpqfVN23q';
const authorization = `Basic ${Buffer.from(`smoke:${password}`).toString("base64")}`;
function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function waitFor(check) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for authenticated CCR");
}
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
try {
  docker("volume", "create", volume);
  docker("run", "-d", "--name", name, "-p", `127.0.0.1:${port}:8080`,
    "-e", "CCR_ENABLE_UI_AUTH=1", "-e", `CCR_UI_AUTH_HTPASSWD=${hash}`,
    "-e", "CCR_ENABLE_SSH=1", "-e", "CCR_ENABLE_LOG_EXPORT=0",
    "-e", "CCR_WEB_AUTH_TOKEN=synthetic-web-token", "-v", `${volume}:/data`, image);
  const url = `http://127.0.0.1:${port}/pages/home/index.html?ccr_web_token=synthetic-web-token`;
  async function verify() {
    await waitFor(async () => (await fetch(url, { headers: { authorization } })).status === 200);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Basic " + Buffer.from("smoke:wrong").toString("base64") } })).status, 401);
    const processes = JSON.parse(docker("exec", name, "node", "-e",
      "const cp=require('node:child_process');process.stdout.write(cp.execFileSync('/app/node_modules/.bin/pm2',['jlist'],{encoding:'utf8'}))"));
    for (const service of ["ccr-core-server", "ccr-nginx", "ccr-sshd"]) {
      assert.equal(processes.find(p => p.name === service)?.pm2_env.status, "online", service);
    }
    assert.ok(!processes.some(p => p.name === "ccr-log-export"));
  }
  await verify();
  docker("restart", name);
  await verify();
  console.log("Speedio Basic Auth, SSH and restart persistence smoke passed.");
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["volume", "rm", "-f", volume], { stdio: "ignore" });
}
