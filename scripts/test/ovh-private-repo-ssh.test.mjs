import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const source = readFileSync(new URL('../../scripts/ovh-private-repo-ssh.sh', import.meta.url),'utf8');
test('OVH private-repo setup script is parseable Bash',()=>{
 assert.doesNotThrow(()=>execFileSync('bash',['-n','scripts/ovh-private-repo-ssh.sh']));
});
test('private-repo configuration is fail-closed before activating a drop-in',()=>{
 const probe=source.indexOf('git ls-remote "${REPO}"');
 const override=source.indexOf('mv -f "${tmp}" "${DROPIN}"');
 assert.ok(probe>0 && override>probe, 'never change transport before successful read-only SSH probe');
 assert.match(source,/refs\/heads\/main refs\/heads\/deploy\/ovh-production/);
 assert.match(source,/StrictHostKeyChecking=yes/);
 assert.match(source,/BatchMode=yes/);
 assert.match(source,/IdentitiesOnly=yes/);
 assert.match(source,/GITHUB_FINGERPRINT="SHA256:\+DiY3wvvV6TuJJhbpZisF\/zLDA0zPMSvHdkr4UvCOqU"/);
 assert.doesNotMatch(source,/ssh-keyscan|StrictHostKeyChecking=no|Allow write access ON/);
});
test('OVH SSH key remains host-local and is never staged in Git',()=>{
 assert.match(source,/KEY_DIR=\/var\/lib\/mccluster\/reconcile\/ssh/);
 assert.match(source,/umask 077/);
 assert.match(source,/stat -c %u/);
 assert.match(source,/cat "${KEY}\.pub"/);
 assert.doesNotMatch(source,/cat "${KEY}"(?:\s|$)/);
});
