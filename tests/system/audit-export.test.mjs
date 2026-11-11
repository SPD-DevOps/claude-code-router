import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const {normalize,userText}=createRequire(import.meta.url)("../../docker/audit-export.cjs");
const options={instance:"shared-v1",since:"2026-11-11T00:00:00Z",auditor:"a".repeat(64)};
const row={request_id:"r",created_at:"2026-11-11T12:00:00Z",method:"POST",path:"/v1/messages",request_headers:JSON.stringify({"x-ccr-audit-principal":"b".repeat(64)}),request_body_text:JSON.stringify({messages:[{role:"user",content:"Review Kubernetes"}]})};
test("export excludes untrusted legacy identity and dedicated auditor",()=>{
 assert.equal(normalize({...row,request_headers:'{"x-auth-sub":"[redacted]"}'},options).skip,"unattributed");
 assert.equal(normalize({...row,request_headers:JSON.stringify({"x-ccr-audit-principal":options.auditor})},options).skip,"auditor");
});
test("exports minimal last human user text, not tool results, headers or tokens",()=>{
 assert.equal(userText({messages:[{role:"user",content:"Review code"},{role:"user",content:[{type:"tool_result",content:"secret file"}]}]}),"Review code");
 const r=normalize(row,options).record;assert.equal(r.text,"Review Kubernetes");assert.equal(r.identity,"b".repeat(64));assert.equal(r.request_headers,undefined);
});
test("cutover and oversize are explicit coverage exclusions",()=>{
 assert.equal(normalize({...row,created_at:"2026-11-10T00:00:00Z"},options).skip,"before_cutover");
 assert.equal(normalize({...row,request_body_truncated:1},options).skip,"truncated_body");
});

test("native provider base paths are audited and still exclude the dedicated auditor",()=>{
 for(const path of ["/coding/v1/chat/completions","/backend-api/codex/responses"]){
   assert.ok(normalize({...row,path},options).record);
   assert.equal(normalize({...row,path,request_headers:JSON.stringify({"x-ccr-audit-principal":options.auditor})},options).skip,"auditor");
 }
 assert.equal(normalize({...row,path:"/v1/messages/count_tokens"},options).skip,"not_inference");
});
