import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CredentialQuarantineStore, credentialQuarantineMs } from '@ccr/core/providers/credential-quarantine.ts';

test('429 quarantine persists across restart, is account-wide, expires after 1h and does not extend', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-quarantine-test-'));
  try {
    let now = 1000;
    const file = path.join(dir, 'state.json');
    const store = new CredentialQuarantineStore(file, () => now);
    store.quarantine('Claude::first');
    assert.equal(store.read('Claude::first').until, 1000 + credentialQuarantineMs);
    assert.equal(store.read('Claude::second'), undefined);
    now += 5000;
    const restarted = new CredentialQuarantineStore(file, () => now);
    restarted.quarantine('Claude::first');
    assert.equal(restarted.read('Claude::first').until, 1000 + credentialQuarantineMs);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    now = 1000 + credentialQuarantineMs;
    assert.equal(restarted.read('Claude::first'), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt state fails closed instead of reusing quarantined credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccr-quarantine-test-'));
  try {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => new CredentialQuarantineStore(file).read('first'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
