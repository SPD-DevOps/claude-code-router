const noGateway = /^(1|true|yes)$/i.test(process.env.CCR_NO_GATEWAY || "");
const enableSsh = /^(1|true|yes)$/i.test(process.env.CCR_ENABLE_SSH || "");
const enableLogExport = /^(1|true|yes)$/i.test(process.env.CCR_ENABLE_LOG_EXPORT || "");
const serverArgs = [
  "--host",
  process.env.CCR_WEB_HOST || "127.0.0.1",
  "--port",
  process.env.CCR_WEB_PORT || "3459",
  "--no-open"
];

if (noGateway) {
  serverArgs.push("--no-gateway");
}

const apps = [
  {
    name: "ccr-core-server",
    script: "/app/packages/core/dist/main/server.js",
    args: serverArgs,
    cwd: "/app",
    interpreter: "node",
    env: {
      ...process.env,
      NODE_ENV: "production"
    }
  },
  {
    name: "ccr-nginx",
    script: "/usr/sbin/nginx",
    args: ["-g", "daemon off;"],
    cwd: "/app",
    interpreter: "none"
  }
];

if (enableSsh) {
  const sshHostKeyDir = `${process.env.HOME || "/data"}/.ssh_host_keys`;
  apps.push({
    name: "ccr-sshd",
    script: "/usr/sbin/dropbear",
    args: [
      "-F",
      "-E",
      "-p",
      process.env.CCR_SSH_PORT || "22",
      "-r",
      `${sshHostKeyDir}/dropbear_ed25519_host_key`,
      "-r",
      `${sshHostKeyDir}/dropbear_rsa_host_key`
    ],
    cwd: "/app",
    interpreter: "none"
  });
}

if (enableLogExport) {
  apps.push({
    name: "ccr-log-export",
    script: "/app/docker/log-export.cjs",
    cwd: "/app",
    interpreter: "node",
    env: {
      ...process.env,
      NODE_ENV: "production"
    }
  });
}

module.exports = { apps };
