"use strict";
// Periodically snapshots CCR's usage/request-log sqlite dbs and uploads them,
// gzipped, to an S3-compatible bucket. Uses better-sqlite3's online backup API
// so it's safe to run against the live databases while CCR keeps writing to them.
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");

const enabled = /^(1|true|yes)$/i.test(process.env.CCR_ENABLE_LOG_EXPORT || "");
if (!enabled) {
  console.log("[log-export] CCR_ENABLE_LOG_EXPORT not set, exiting");
  process.exit(0);
}

const bucket = process.env.CCR_LOG_S3_BUCKET;
if (!bucket) {
  console.error("[log-export] CCR_LOG_S3_BUCKET not set, exiting");
  process.exit(1);
}

const endpoint = process.env.CCR_LOG_S3_ENDPOINT || "https://hel1.your-objectstorage.com";
const region = process.env.CCR_LOG_S3_REGION || "hel1";
let prefix = (process.env.CCR_LOG_S3_PREFIX || "").replace(/^\/+|\/+$/g, "");
if (prefix) {
  prefix += "/";
}
const intervalMinutes = Math.max(1, Number(process.env.CCR_LOG_EXPORT_INTERVAL_MINUTES || "60"));
const intervalMs = intervalMinutes * 60 * 1000;

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const Database = require("better-sqlite3");

const s3 = new S3Client({
  region,
  endpoint,
  // Hetzner's Object Storage (Ceph RGW) doesn't handle the SDK's default
  // flexible-checksum trailers well - surfaces as an opaque "UnknownError"
  // on every request otherwise. forcePathStyle avoids relying on wildcard
  // DNS for <bucket>.<endpoint> virtual-hosted addressing.
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dataDir = path.join(process.env.HOME || "/data", ".claude-code-router", "app-data");
const targets = [
  { name: "usage", file: "usage.sqlite" },
  { name: "request-logs", file: "request-logs.sqlite" },
];

async function snapshotToTemp(srcPath, tmpPath) {
  const db = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(tmpPath);
  } finally {
    db.close();
  }
}

async function exportOne(target) {
  const srcPath = path.join(dataDir, target.file);
  if (!fs.existsSync(srcPath)) {
    return;
  }

  const now = new Date();
  const tmpPath = path.join("/tmp", `${target.name}-${now.getTime()}.sqlite`);
  await snapshotToTemp(srcPath, tmpPath);

  if (target.name === "request-logs" && process.env.CCR_AUDIT_ENABLED === "1") {
    try {
      const { exportAudit } = require("./audit-export.cjs");
      const instance = process.env.CCR_AUDIT_INSTANCE_ID;
      const since = process.env.CCR_AUDIT_SINCE;
      const auditor = process.env.CCR_AUDIT_EXCLUDE_PRINCIPAL;
      if (!/^[a-z0-9-]+$/.test(instance || "") || !Number.isFinite(Date.parse(since || "")) || !/^[a-f0-9]{64}$/.test(auditor || "")) {
        throw new Error("Audit export requires instance, cutover time and dedicated auditor principal");
      }
      await exportAudit(tmpPath, s3, PutObjectCommand, {
        instance, since, auditor, bucket: process.env.CCR_AUDIT_S3_BUCKET || bucket,
        bodyDir: path.join(dataDir, "request-log-bodies")
      });
    } catch (error) {
      console.error("[audit-export] failed:", error.name);
    }
  }
  const raw = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);
  const gz = zlib.gzipSync(raw);

  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const key = `${prefix}${target.name}/${y}/${m}/${d}/${target.name}-${ts}.sqlite.gz`;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: gz,
    ContentType: "application/gzip",
  }));
  console.log(`[log-export] uploaded s3://${bucket}/${key} (${gz.length} bytes)`);
}

let exporting = false;
async function runOnce() {
  if (exporting) return;
  exporting = true;
  try {
  for (const target of targets) {
    try {
      await exportOne(target);
    } catch (err) {
      console.error(`[log-export] failed to export ${target.name}: ${err.message}`);
    }
  }
  } finally { exporting = false; }
}

async function main() {
  await runOnce();
  setInterval(() => {
    runOnce();
  }, intervalMs);
}

main();
