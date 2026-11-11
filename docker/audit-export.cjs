"use strict";
// Export only user text and opaque server-derived identities from this instance.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const hash = (v) => createHash("sha256").update(String(v)).digest("hex");
const day = (v) => new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v));
function textContent(v) {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return "";
  return v.filter(x => x && ["text", "input_text"].includes(x.type) && typeof x.text === "string").map(x => x.text).join("\n");
}
function userText(body) {
  if (typeof body.input === "string") return body.input;
  const messages = body.messages || body.input;
  if (!Array.isArray(messages)) return "";
  for (const m of [...messages].reverse()) {
    if (m.role !== "user") continue;
    const text = textContent(m.content);
    if (text.trim()) return text;
  }
  return "";
}
function redact(text) {
  return text.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g,"[REDACTED]")
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[^\s,"'}]+/gi,"$1=[REDACTED]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,"[EMAIL]");
}
function normalize(row, options) {
  if (row.method !== "POST" || !["/v1/messages","/v1/chat/completions","/v1/responses"].includes(row.path)) return {skip:"not_inference"};
  if (new Date(row.created_at) < new Date(options.since)) return {skip:"before_cutover"};
  let headers;try {headers=JSON.parse(row.request_headers);} catch {return {skip:"invalid_headers"};}
  const identity=headers["x-ccr-audit-principal"];
  if (!/^[a-f0-9]{64}$/.test(identity || "")) return {skip:"unattributed"};
  // Dedicated audit key excluded by authenticated identity, NOT spoofable User-Agent/body.
  if (identity === options.auditor) return {skip:"auditor"};
  if (!row.request_id) return {skip:"missing_request_id"};
  if (row.request_body_truncated) return {skip:"truncated_body"};
  let raw=row.request_body_text;
  if (row.request_body_ref) {
    const ref=row.request_body_ref;
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) return {skip:"invalid_ref"};
    const root=fs.realpathSync(options.bodyDir);
    const target=path.join(root,ref.slice(0,2),ref);
    try {
      const real=fs.realpathSync(target);
      if (!real.startsWith(root+path.sep) || fs.statSync(real).size>8*1024*1024) return {skip:"oversize_body"};
      raw=fs.readFileSync(real,"utf8");
    } catch {return {skip:"missing_body"};}
  }
  let body;try {body=JSON.parse(raw);} catch {return {skip:"invalid_body"};}
  const text=redact(userText(body));
  if (!text.trim()) return {skip:"no_user_text"};
  if (text.length>24000) return {skip:"oversize_text"};
  const session=headers["x-claude-code-session-id"];
  return {record:{request_id:options.instance+":"+row.request_id,identity, timestamp:row.created_at,
    ...(session?{session_id:hash(session)}:{}),text}};
}
async function exportAudit(dbFile, s3, PutObjectCommand, options) {
  const Database=require("better-sqlite3");
  const db=new Database(dbFile,{readonly:true,fileMustExist:true});
  const groups=new Map();
  try {
    for (const row of db.prepare(`SELECT request_id,created_at,method,path,request_headers,
      request_body_text,request_body_ref,request_body_truncated FROM request_logs ORDER BY id`).iterate()) {
      const date=day(row.created_at);let group=groups.get(date);
      if (!group) {group={lines:[],counts:{total:0,exported:0}};groups.set(date,group);}
      group.counts.total++;
      const result=normalize(row,options);
      if (result.skip) {group.counts[result.skip]=(group.counts[result.skip]||0)+1;continue;}
      group.lines.push(JSON.stringify(result.record));group.counts.exported++;
    }
  } finally {db.close();}
  // Publish explicit empty days too; absence of an object is an export failure, not zero use.
  for(let t=Date.now()-8*86400000;t<=Date.now();t+=86400000){
    const date=day(t);
    if(date>=day(options.since) && !groups.has(date)) groups.set(date,{lines:[],counts:{total:0,exported:0}});
  }
  for (const [date,group] of groups) {
    // Merge with prior exports: SQLite retention/restarts must not erase unreviewed history.
    const {GetObjectCommand}=require("@aws-sdk/client-s3");
    const prefix=`audit/${options.instance}/`;
    const key=prefix+`normalized/${date}.jsonl`;
    const records=new Map();
    try {
      const previous=await s3.send(new GetObjectCommand({Bucket:options.bucket,Key:key}));
      if (Number(previous.ContentLength)>10000000) throw new Error("Audit partition exceeds 10 MB");
      const text=await previous.Body.transformToString();
      for(const line of text.split("\n").filter(Boolean)) {const r=JSON.parse(line);records.set(r.request_id,r);}
    } catch(error) {if(!["NoSuchKey","NotFound"].includes(error.name)) throw error;}
    for(const line of group.lines){const r=JSON.parse(line);records.set(r.request_id,r);}
    const body=records.size?[...records.values()].map(r=>JSON.stringify(r)).join("\n")+"\n":"";
    if (Buffer.byteLength(body)>10000000) throw new Error("Audit partition exceeds 10 MB");
    await s3.send(new PutObjectCommand({Bucket:options.bucket,Key:key,Body:body,ContentType:"application/x-ndjson"}));
    const manifest={schema_version:1,instance:options.instance,date,timezone:"America/Sao_Paulo",
      since:options.since,generated_at:new Date().toISOString(),sha256:hash(body),
      accumulated_exported:records.size,latest_snapshot:group.counts};
    await s3.send(new PutObjectCommand({Bucket:options.bucket,Key:prefix+`coverage/${date}.json`,Body:JSON.stringify(manifest),ContentType:"application/json"}));
    console.log("[audit-export]",JSON.stringify({date,...group.counts}));
  }
}
module.exports={normalize,userText,redact,exportAudit};
