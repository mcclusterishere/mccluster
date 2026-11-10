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
 assert.doesNotMatch(source,/^\s*ssh-keyscan\s/m);
 assert.doesNotMatch(source,/StrictHostKeyChecking=no|Allow write access ON/);
});
test('OVH SSH key remains host-local and is never staged in Git',()=>{
 assert.match(source,/KEY_DIR=\/var\/lib\/mccluster\/reconcile\/ssh/);
 assert.match(source,/umask 077/);
 assert.match(source,/stat -c %u/);
 assert.ok(source.includes('cat "${KEY}.pub"'), 'only the public key may be printed');
 assert.ok(!source.includes('cat "${KEY}"'), 'private key must not be printed');
});

/*
 * Incident #510: while the repository is public, ANY key registered with GitHub
 * can fetch it over SSH, so "ls-remote worked" shows neither that the key is
 * this repository's deploy key nor that it is read-only. The script now proves
 * both before it changes the transport, and has a read-only status mode.
 *
 * The tests below run the REAL script in a temporary directory. Its host paths
 * and the ssh binary are redirected in the copy under test (the test refuses to
 * run if a redirect did not apply), ssh-keygen, systemctl, stat and install are
 * fakes, and "GitHub" is a fake ssh that answers with the texts the script
 * depends on and serves a local bare repository through the real git. No
 * network, no real host path, no real key: the "keys" are marker strings.
 *
 * What the fake ssh says is an ASSUMPTION about GitHub that could not be
 * exercised here. The script isolates it in two named variables; the runbook
 * tells the owner to confirm both on the first real run.
 */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync as readFile,chmodSync,existsSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const REPO_SSH='git@github.com:mcclusterishere/mccluster.git';
const HOST_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const HOST_FP='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';
const KEY_FP=`SHA256:${'A'.repeat(43)}`;
const OTHER_FP=`SHA256:${'B'.repeat(43)}`;
const PRIVATE_MARKER='FIXTURE-PRIVATE-HALF-NOT-A-KEY';
const DEPLOY_GREETING="Hi mcclusterishere/mccluster! You've successfully authenticated, but GitHub does not provide shell access.";
const READ_ONLY_REFUSAL='ERROR: The key you are authenticating with has been marked as read only.';

const FAKE_BIN={
 // "GitHub": the last argument is what git or the script asked the remote for.
 ssh:`#!/usr/bin/env bash
echo "ssh $*" >> "$FIXTURE/calls.log"
for required in "-F /dev/null" "IdentitiesOnly=yes" "BatchMode=yes" "StrictHostKeyChecking=yes" "GlobalKnownHostsFile=/dev/null" "UpdateHostKeys=no" "ConnectTimeout=20"; do
  [[ " $* " == *"$required"* ]] || { echo "fixture: the pinned option $required is missing" >&2; exit 255; }
done
case "\${!#}" in
  git@github.com)
    case "\${FAKE_IDENTITY:-deploy}" in
      deploy) echo "${DEPLOY_GREETING}" >&2 ;;
      reworded) echo "Hi mcclusterishere/mccluster! Authentication succeeded. Shell access is not offered here." >&2 ;;
      banner) echo "** WARNING: fixture banner line" >&2; printf '%s\\r\\n' "${DEPLOY_GREETING}" >&2 ;;
      user) echo "Hi fixture-user! You've successfully authenticated, but GitHub does not provide shell access." >&2 ;;
      other-repository) echo "Hi mcclusterishere/mccluster-mirror! You've successfully authenticated, but GitHub does not provide shell access." >&2 ;;
      lowercase) echo "hi mcclusterishere/mccluster! you've successfully authenticated" >&2 ;;
      two) echo "${DEPLOY_GREETING}" >&2; echo "Hi fixture-user! You've successfully authenticated." >&2 ;;
      silent) ;;
      denied) echo "git@github.com: Permission denied (publickey)." >&2; exit 255 ;;
    esac
    exit 1 ;;
  "git-upload-pack 'mcclusterishere/mccluster.git'")
    [[ "\${FAKE_READ:-ok}" == ok ]] || { echo "ERROR: Repository not found." >&2; exit 1; }
    exec git upload-pack "$FIXTURE/github.git" ;;
  "git-receive-pack 'mcclusterishere/mccluster.git'")
    case "\${FAKE_WRITE:-read-only}" in
      read-only) echo "${READ_ONLY_REFUSAL}" >&2; exit 1 ;;
      read-only-reworded) echo "ERROR: The deploy key you used is marked as read-only." >&2; exit 1 ;;
      unrecognised) echo "ERROR: Write access is not granted to this key." >&2; exit 1 ;;
      writable) exec git receive-pack "$FIXTURE/github.git" ;;
      archived) echo "ERROR: This repository was archived so it is read-only." >&2; exit 1 ;;
      denied) echo "ERROR: Permission to mcclusterishere/mccluster.git denied to fixture-user." >&2; exit 1 ;;
      silent) exit 1 ;;
    esac ;;
esac
echo "fixture: unexpected ssh request: $*" >&2
exit 255
`,
 'ssh-keygen':`#!/usr/bin/env bash
echo "ssh-keygen $*" >> "$FIXTURE/calls.log"
previous=""; target=""
for arg in "$@"; do [[ "$previous" == "-f" || "$previous" == "-lf" ]] && target="$arg"; previous="$arg"; done
if [[ " $* " == *" -t ed25519 "* ]]; then
  echo "${PRIVATE_MARKER}" > "$target"; echo "ssh-ed25519 FIXTURE-PUBLIC-HALF-NOT-A-KEY mccluster-ovh-readonly-reconcile" > "$target.pub"; exit 0
fi
if [[ " $* " == *" -lf "* ]]; then
  case "$target" in
    *github_known_hosts*) if grep -Fq "${HOST_KEY.split(' ')[2]}" "$target"; then echo "256 ${HOST_FP} github.com (ED25519)"; else echo "256 ${OTHER_FP} github.com (ED25519)"; fi ;;
    *.pub) echo "256 \${FAKE_KEY_FINGERPRINT:-${KEY_FP}} mccluster-ovh-readonly-reconcile (ED25519)" ;;
    *) echo "the fixture refuses anything but a public key" >&2; exit 1 ;;
  esac
  exit 0
fi
exit 1
`,
 // systemd's merged view: the unit file's Environment, then each drop-in in name order.
 // The reconcile unit is a oneshot. A cycle keeps the environment that was loaded
 // when it started, and a start request while a cycle runs joins THAT cycle
 // instead of starting another (systemd merges the start job into the running
 // one). $FIXTURE/running is such a cycle: "<invocation> <transport> <polls left>".
 // Each cycle that ends leaves last-cycle.json as scripts/mccluster-vps-reconcile.sh
 // writes it (unless FAKE_NO_RECEIPT: a reconciler that predates the receipts).
 systemctl:`#!/usr/bin/env bash
echo "systemctl $*" >> "$FIXTURE/calls.log"
loaded_transport() { cat "$FIXTURE/loaded-transport" 2>/dev/null || echo https; }
receipt() { # receipt <invocation> <transport> <outcome> <trigger>
  [[ -z "\${FAKE_NO_RECEIPT:-}" ]] || return 0
  local pinned=false fingerprint=""
  if [[ "$2" == ssh ]]; then pinned=true; fingerprint="\${FAKE_CYCLE_KEY_FINGERPRINT:-${KEY_FP}}"; fi
  printf '{"schema_version":"mccluster-reconcile-cycle/v1","repository":"mcclusterishere/mccluster","promoted_ref":"deploy/ovh-production","cycle_id":"%s","trigger":"%s","timer_trigger_monotonic_usec":"","outcome":"%s","stage":"complete","exit_code":0,"interrupted":false,"transport":"%s","ssh_host_key_pinned":%s,"ssh_key_fingerprint":"%s","https_credential_configured":false,"github_main_sha":"","github_promoted_sha":"","deployed_sha":"","started_at":"2026-11-10T00:00:00Z","finished_at":"2026-11-10T00:00:01Z"}\\n' "$1" "$4" "$3" "$2" "$pinned" "$fingerprint" > "$FAKE_STATE_DIR/last-cycle.json"
}
finish_running() {
  local id transport polls
  read -r id transport polls < "$FIXTURE/running"
  receipt "$id" "$transport" verified_no_change timer
  echo "$id" > "$FIXTURE/invocation"
  rm -f "$FIXTURE/running"
}
case "$*" in
  "show --property=ActiveState --value mccluster-vps-reconcile.service")
    if [[ -f "$FIXTURE/running" ]]; then
      read -r id transport polls < "$FIXTURE/running"
      if (( polls > 0 )); then echo "$id $transport $((polls - 1))" > "$FIXTURE/running"; echo activating; exit 0; fi
      finish_running
    fi
    echo inactive ;;
  "show --property=InvocationID --value mccluster-vps-reconcile.service") cat "$FIXTURE/invocation" 2>/dev/null || echo ;;
  "show --property=Environment --value mccluster-vps-reconcile.service")
    out="HOME=/var/lib/mccluster/reconcile MCCLUSTER_REPO_URL=https://github.com/mcclusterishere/mccluster.git MCCLUSTER_DEPLOY_REF=deploy/ovh-production"
    for file in "$FAKE_DROPIN_DIR"/*.conf; do
      [[ -e "$file" ]] || continue
      while IFS= read -r line; do
        [[ "$line" == 'Environment="'*'"' ]] || continue
        entry="\${line#Environment=\\"}"; entry="\${entry%\\"}"
        case "\${FAKE_ENVIRONMENT_STYLE:-quoted}" in
          quoted) if [[ "$entry" == *" "* ]]; then out+=" \\"$entry\\""; else out+=" $entry"; fi ;;
          escaped) out+=" \${entry// /\\\\x20}" ;;
          bare) out+=" $entry" ;;
        esac
      done < "$file"
    done
    echo "$out" ;;
  "is-active mccluster-vps-reconcile.timer") echo "\${FAKE_TIMER:-active}" ;;
  "is-active --quiet mccluster-vps-reconcile.timer") [[ "\${FAKE_TIMER:-active}" == active ]] || exit 3 ;;
  "show --property=LastTriggerUSec --value mccluster-vps-reconcile.timer") echo "Mon 2026-11-09 22:40:01 UTC" ;;
  "daemon-reload")
    # The timer elapsing between the drop-in and this reload starts a cycle on the environment loaded before it.
    if [[ -n "\${FAKE_TIMER_FIRES_BEFORE_RELOAD:-}" && ! -f "$FIXTURE/timer-fired" ]]; then
      touch "$FIXTURE/timer-fired"; echo "$(printf 'd%.0s' {1..32}) $(loaded_transport) 0" > "$FIXTURE/running"
    fi
    if grep -qsF 'Environment="MCCLUSTER_REPO_URL=${REPO_SSH}"' "$FAKE_DROPIN_DIR"/*.conf; then echo ssh; else echo https; fi > "$FIXTURE/loaded-transport" ;;
  "start mccluster-vps-reconcile.service")
    if [[ -f "$FIXTURE/running" ]]; then finish_running; exit 0; fi
    count=$(( $(cat "$FIXTURE/started" 2>/dev/null || echo 0) + 1 )); echo "$count" > "$FIXTURE/started"
    id="$(printf '%032x' "$count")"; echo "$id" > "$FIXTURE/invocation"
    if [[ "\${FAKE_START_RC:-0}" == 0 ]]; then receipt "$id" "$(loaded_transport)" verified_no_change other; else receipt "$id" "$(loaded_transport)" failed other; fi
    exit "\${FAKE_START_RC:-0}" ;;
  *) echo "fixture: unexpected systemctl call: $*" >&2; exit 64 ;;
esac
`,
 // The key must be root-owned. Tests do not run as root everywhere, so ownership is the fixture's to state.
 stat:`#!/usr/bin/env bash
if [[ "$1 $2" == "-c %u" ]]; then echo "\${FAKE_KEY_OWNER:-0}"; exit 0; fi
exec "$REAL_STAT" "$@"
`,
 install:`#!/usr/bin/env bash
args=(); skip=0
for arg in "$@"; do
  if (( skip )); then skip=0; continue; fi
  if [[ "$arg" == "-o" || "$arg" == "-g" ]]; then skip=1; continue; fi
  args+=("$arg")
done
exec "$REAL_INSTALL" "\${args[@]}"
`,
};

const which=(name)=>spawnSync('/bin/bash',['-c',`command -v ${name}`],{encoding:'utf8'}).stdout.trim();
const REAL_STAT=which('stat'), REAL_INSTALL=which('install');

function host(t){
 const root=mkdtempSync(join(tmpdir(),'mcc-ssh-setup-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const p=(...parts)=>join(root,...parts);
 const state=p('host/var/lib/mccluster/reconcile'), dropinDir=p('host/etc/systemd/system/mccluster-vps-reconcile.service.d');
 for(const dir of ['bin','fixture','home','host/var/lib/mccluster/reconcile','host/etc/systemd/system'])mkdirSync(p(dir),{recursive:true});
 for(const [name,body] of Object.entries(FAKE_BIN)){writeFileSync(p('bin',name),body);chmodSync(p('bin',name),0o755);}
 writeFileSync(p('fixture/calls.log'),'');

 // The copy under test: the real script with its host paths and ssh binary redirected.
 const redirects=[
  ['if [[ "${EUID}" -ne 0 ]]; then','if false; then'],
  ['KEY_DIR=/var/lib/mccluster/reconcile/ssh',`KEY_DIR=${state}/ssh`],
  ['DROPIN_DIR=/etc/systemd/system/mccluster-vps-reconcile.service.d',`DROPIN_DIR=${dropinDir}`],
  ['RECONCILE_STATE=/var/lib/mccluster/reconcile',`RECONCILE_STATE=${state}`],
  ['SSH_COMMAND="/usr/bin/ssh ',`SSH_COMMAND="${p('bin/ssh')} `],
 ];
 let copy=source;
 for(const [from,to] of redirects){assert.equal(copy.split(from).length-1,1,`redirect anchor: ${from}`);copy=copy.replace(from,to);}
 // Timing only, so applied where present: activate's wait for a running cycle, in tenths of seconds.
 for(const [from,to] of [['RECONCILE_IDLE_WAIT_SECONDS=1260','RECONCILE_IDLE_WAIT_SECONDS=3'],['RECONCILE_IDLE_POLL_SECONDS=2','RECONCILE_IDLE_POLL_SECONDS=0.1']])copy=copy.replace(from,to);
 const live=copy.split('\n').filter(line=>!/^\s*#/.test(line)).join('\n');
 assert.doesNotMatch(live,/(^|[^A-Za-z0-9_.-])\/(var\/lib\/mccluster|etc\/systemd|usr\/bin\/ssh)/,'the copy cannot reach a real host path or the real ssh');
 assert.doesNotMatch(live,/"\$\{EUID\}"/);
 writeFileSync(p('setup.sh'),copy);

 // "GitHub": a bare repository holding both protected refs.
 const gitEnv={PATH:process.env.PATH,HOME:p('home'),LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@invalid',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@invalid'};
 const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,env:gitEnv,encoding:'utf8'});assert.equal(r.status,0,`git ${args.join(' ')}: ${r.stderr}`);return r.stdout.trim();};
 mkdirSync(p('fixture/seed'));
 git(p('fixture/seed'),'init','-q','-b','main','.');
 git(p('fixture/seed'),'commit','-q','--allow-empty','-m','fixture');
 git(p('fixture/seed'),'branch','deploy/ovh-production');
 git(p('fixture'),'clone','-q','--bare',p('fixture/seed'),p('fixture/github.git'));
 const sha=git(p('fixture/seed'),'rev-parse','HEAD');
 // The reconciler's checkout, as a cycle leaves it.
 const checkout=(url)=>{rmSync(join(state,'source'),{recursive:true,force:true});mkdirSync(join(state,'source'));git(join(state,'source'),'init','-q','.');git(join(state,'source'),'remote','add','origin',url);};
 checkout('https://github.com/mcclusterishere/mccluster.git');

 const box={root,p,state,dropinDir,sha,checkout,
  dropin:join(dropinDir,'50-github-readonly-ssh.conf'),
  pinned:`${p('bin/ssh')} -F /dev/null -i ${state}/ssh/github_deploy_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${state}/ssh/github_known_hosts -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no`,
  run(mode,env={}){
   const before=readFile(p('fixture/calls.log'),'utf8').length;
   const result=spawnSync('/bin/bash',[p('setup.sh'),...(mode?[mode]:[])],{encoding:'utf8',timeout:60_000,killSignal:'SIGKILL',
    env:{PATH:`${p('bin')}:${process.env.PATH}`,HOME:p('home'),LC_ALL:'C',FIXTURE:p('fixture'),FAKE_DROPIN_DIR:dropinDir,FAKE_STATE_DIR:state,REAL_STAT,REAL_INSTALL,...env}});
   return {...result,calls:readFile(p('fixture/calls.log'),'utf8').slice(before),
    lines:Object.fromEntries(result.stdout.split('\n').filter(line=>/^[a-z_]+=/.test(line)&&!line.startsWith('timer_cycle=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)])),
    timerCycles:result.stdout.split('\n').filter(line=>line.startsWith('timer_cycle=')).map(line=>line.slice('timer_cycle='.length))};
  },
  branches:()=>git(p('fixture/github.git'),'for-each-ref','--format=%(refname)').split('\n').sort(),
  // Receipts as scripts/mccluster-vps-reconcile.sh writes them.
  receipt(over={}){
   const now=Date.now(), iso=(ms)=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z');
   const value={schema_version:'mccluster-reconcile-cycle/v1',repository:'mcclusterishere/mccluster',promoted_ref:'deploy/ovh-production',
    cycle_id:'c'.repeat(32),trigger:'timer',timer_trigger_monotonic_usec:'7200000000',outcome:'verified_no_change',stage:'complete',exit_code:0,interrupted:false,
    transport:'ssh',ssh_host_key_pinned:true,ssh_key_fingerprint:KEY_FP,https_credential_configured:false,
    github_main_sha:sha,github_promoted_sha:sha,deployed_sha:sha,started_at:iso(now-65_000),finished_at:iso(now-60_000),...over};
   if(typeof over.minutesAgo==='number'){value.started_at=iso(now-over.minutesAgo*60_000-5000);value.finished_at=iso(now-over.minutesAgo*60_000);delete value.minutesAgo;}
   return JSON.stringify(value);
  },
  cycles(lines){writeFileSync(join(state,'cycles.jsonl'),lines.join('\n')+'\n');writeFileSync(join(state,'last-verified-cycle.json'),lines.at(-1)+'\n');},
  // Everything under the fake host, by content, so "status changed nothing" is checked and not assumed.
  snapshot(){
   const seen=[];
   const walk=(dir)=>{for(const name of readdirSync(dir).sort()){const full=join(dir,name);const info=statSync(full);
    if(info.isDirectory()){if(name==='.git')continue;seen.push(`${full.slice(root.length)}/ ${(info.mode&0o777).toString(8)}`);walk(full);}
    else seen.push(`${full.slice(root.length)} ${(info.mode&0o777).toString(8)} ${createHash('sha256').update(readFile(full)).digest('hex')}`);}};
   walk(p('host'));
   return seen.join('\n');
  },
 };
 return box;
}

// A host that has been prepared and activated, with two timer cycles on record.
function activated(t){
 const box=host(t);
 assert.equal(box.run('prepare').status,0);
 const result=box.run('activate');
 assert.equal(result.status,0,result.stderr);
 box.checkout(REPO_SSH);
 box.cycles([box.receipt({cycle_id:'1'.repeat(32),trigger:'other',timer_trigger_monotonic_usec:'',minutesAgo:6}),
  box.receipt({cycle_id:'2'.repeat(32),minutesAgo:4}),box.receipt({cycle_id:'3'.repeat(32),minutesAgo:2})]);
 return box;
}

test('prepare creates the host-only key once, pins the host key and prints only the public half',(t)=>{
 const box=host(t);
 const first=box.run('prepare');
 assert.equal(first.status,0,first.stderr);
 assert.match(first.stdout,/Register ONLY the following public key as a read-only Deploy key:\n/);
 assert.match(first.stdout,/\nssh-ed25519 FIXTURE-PUBLIC-HALF-NOT-A-KEY mccluster-ovh-readonly-reconcile\n/);
 assert.match(first.stdout,new RegExp(`fingerprint, to compare with the one GitHub shows: ${KEY_FP.replace(/[+/]/g,'\\$&')}\\n`));
 assert.doesNotMatch(first.stdout+first.stderr,new RegExp(PRIVATE_MARKER));
 assert.equal(statSync(join(box.state,'ssh')).mode&0o777,0o700);
 assert.equal(statSync(join(box.state,'ssh/github_deploy_ed25519')).mode&0o077,0,'the private half is created under umask 077');
 assert.equal(readFile(join(box.state,'ssh/github_known_hosts'),'utf8'),`${HOST_KEY}\n`);
 assert.equal(statSync(join(box.state,'ssh/github_known_hosts')).mode&0o777,0o600);
 assert.doesNotMatch(first.calls,/^ssh /m,'prepare sends nothing to GitHub');
 assert.doesNotMatch(first.calls,/^systemctl /m);
 assert.equal(existsSync(box.dropin),false);
 // A second prepare keeps the key and does not rewrite an already pinned file.
 const pinnedBefore=statSync(join(box.state,'ssh/github_known_hosts'));
 const second=box.run('prepare');
 assert.equal(second.status,0,second.stderr);
 assert.doesNotMatch(second.calls,/-t ed25519/,'an existing key is never regenerated');
 assert.equal(statSync(join(box.state,'ssh/github_known_hosts')).ino,pinnedBefore.ino,'the pinned file a running cycle may be reading is left in place');
 assert.equal(box.run().status,0,'prepare is the default mode');
 assert.equal(box.run('rotate').status,2);
});

test('activate proves read access, identity and read-only before it changes the transport',(t)=>{
 const box=host(t);
 box.run('prepare');
 const result=box.run('activate');
 assert.equal(result.status,0,result.stderr);
 assert.equal(readFile(box.dropin,'utf8'),`[Service]\nEnvironment="MCCLUSTER_REPO_URL=${REPO_SSH}"\nEnvironment="GIT_SSH_COMMAND=${box.pinned}"\n`);
 assert.equal(statSync(box.dropin).mode&0o777,0o644);
 const order=['git-upload-pack',' -T git@github.com','git-receive-pack','systemctl daemon-reload','systemctl start mccluster-vps-reconcile.service'].map(needle=>result.calls.indexOf(needle));
 assert.ok(order.every((index,i)=>index>=0&&(i===0||index>order[i-1])),`proofs come before the switch: ${order}`);
 assert.match(result.stdout,/switched to authenticated read-only GitHub SSH after verified ref access\.\n/);
 assert.match(result.stdout,/is a Deploy key of mcclusterishere\/mccluster and GitHub refuses it for writing\.\n/);
 assert.match(result.stdout,/status\nIt exits 0 only when every proof holds\./);
 assert.deepEqual(box.branches(),['refs/heads/deploy/ovh-production','refs/heads/main'],'the write probe pushed nothing');
 assert.deepEqual(readdirSync(join(box.state,'ssh')).sort(),['github_deploy_ed25519','github_deploy_ed25519.pub','github_known_hosts'],'the throwaway probe repository is gone');
 assert.deepEqual(readdirSync(box.dropinDir),['50-github-readonly-ssh.conf']);
 assert.doesNotMatch(result.stdout+result.stderr+result.calls,new RegExp(PRIVATE_MARKER));
 // GitHub may reword the sentence or print a banner first: the identity it greets is what counts.
 // It may also hyphenate "read-only": a refusal that names the key as read only is still that refusal.
 for(const env of [{FAKE_IDENTITY:'reworded'},{FAKE_IDENTITY:'banner'},{FAKE_WRITE:'read-only-reworded'}]){
  rmSync(box.dropin);
  assert.equal(box.run('activate',env).status,0,JSON.stringify(env));
  assert.ok(existsSync(box.dropin),JSON.stringify(env));
 }
});

test('activate refuses a personal key, a writable key and every unproven state before changing anything',(t)=>{
 const box=host(t);
 box.run('prepare');
 const before=box.snapshot();
 const refusals=[
  ['a personal key',{FAKE_IDENTITY:'user'},/GitHub greets this key as 'fixture-user', not as a Deploy key of mcclusterishere\/mccluster/],
  ["another repository's deploy key",{FAKE_IDENTITY:'other-repository'},/greets this key as 'mcclusterishere\/mccluster-mirror', not as a Deploy key/],
  ['a greeting in an unknown form',{FAKE_IDENTITY:'lowercase'},/GitHub's greeting was not recognised\. Refusing to switch the transport\.\nGitHub answered: hi mcclusterishere\/mccluster! you've successfully authenticated\n/],
  ['two greetings',{FAKE_IDENTITY:'two'},/greeting was not recognised/],
  ['no greeting',{FAKE_IDENTITY:'silent'},/greeting was not recognised\. Refusing to switch the transport\.\nGitHub answered: nothing\n/],
  ['a key GitHub does not know',{FAKE_IDENTITY:'denied'},/GitHub answered: git@github\.com: Permission denied \(publickey\)\./],
  ['a key that can write',{FAKE_WRITE:'writable'},/The deploy key has WRITE access\. Turn 'Allow write access' off/],
  ['a refusal that is about the repository, not the key',{FAKE_WRITE:'archived'},/Could not prove the deploy key is read-only; refusing to switch the transport/],
  ['a permission refusal',{FAKE_WRITE:'denied'},/Could not prove the deploy key is read-only/],
  ['a refusal in words the script does not know',{FAKE_WRITE:'unrecognised'},/Could not prove the deploy key is read-only; refusing to switch the transport\.\nThe dry-run push answered: ERROR: Write access is not granted to this key\. /],
  ['a silent refusal',{FAKE_WRITE:'silent'},/Could not prove the deploy key is read-only/],
  ['refs that cannot be read',{FAKE_READ:'denied'},/Cannot read the repository over SSH/],
 ];
 for(const [name,env,message] of refusals){
  const result=box.run('activate',env);
  assert.equal(result.status,3,`${name}: ${result.stderr}`);
  assert.match(result.stderr,message,name);
  assert.equal(existsSync(box.dropinDir),false,`${name}: no drop-in directory`);
  assert.doesNotMatch(result.calls,/systemctl (daemon-reload|start|restart|enable)/,`${name}: the unit is not touched`);
  assert.equal(box.snapshot(),before,`${name}: nothing on the host changed`);
  assert.deepEqual(box.branches(),['refs/heads/deploy/ovh-production','refs/heads/main'],`${name}: nothing was pushed`);
 }
 // The reconciler's own Git would not use SSH for this URL: activation would prove nothing.
 writeFileSync(join(box.state,'.gitconfig'),`[url "https://github.com/"]\n\tinsteadOf = git@github.com:\n`);
 const rewritten=box.run('activate');
 assert.equal(rewritten.status,3);
 assert.match(rewritten.stderr,/rewrites git@github\.com:mcclusterishere\/mccluster\.git; the reconciler would not fetch over SSH/);
 assert.equal(existsSync(box.dropinDir),false);
 rmSync(join(box.state,'.gitconfig'));
 // A key file someone else can read, a key not owned by root, a linked key: refused before any network use.
 chmodSync(join(box.state,'ssh/github_deploy_ed25519'),0o640);
 const open=box.run('activate');
 assert.equal(open.status,2);
 assert.doesNotMatch(open.calls,/^ssh /m);
 chmodSync(join(box.state,'ssh/github_deploy_ed25519'),0o600);
 const foreign=box.run('activate',{FAKE_KEY_OWNER:'1000'});
 assert.equal(foreign.status,2);
 assert.match(foreign.stderr,/must be owned by root/);
 // An existing transport override is left byte for byte as it was by a refused activation.
 assert.equal(box.run('activate').status,0);
 writeFileSync(box.dropin,'[Service]\nEnvironment="MCCLUSTER_REPO_URL=operator-chosen"\n');
 const kept=readFile(box.dropin,'utf8');
 assert.equal(box.run('activate',{FAKE_IDENTITY:'user'}).status,3);
 assert.equal(readFile(box.dropin,'utf8'),kept);
});

test('activate reports a first cycle that fails, and how to go back',(t)=>{
 const box=host(t);
 box.run('prepare');
 const result=box.run('activate',{FAKE_START_RC:'1'});
 assert.equal(result.status,4);
 assert.match(result.stderr,/did not complete its first cycle after the switch\./);
 assert.match(result.stderr,/put back as it was before this run/,'a failed first cycle undoes the switch itself');
 assert.equal(existsSync(box.dropin),false,'no drop-in is left behind: the reconciler keeps its previous transport');
 assert.doesNotMatch(result.stdout,/switched to authenticated/);
 const stopped=box.run('activate',{FAKE_TIMER:'inactive'});
 assert.equal(stopped.status,4);
 assert.match(stopped.stderr,/mccluster-vps-reconcile\.timer is not active/);
});

/*
 * SSH-1. The reconciler is a oneshot its timer starts every two minutes or so. A
 * start request while a cycle runs joins THAT cycle, which keeps the environment
 * it started with: activate's "first cycle" could be an HTTPS timer cycle, and
 * activate called the switch proven and stopped guarding it. The fake systemctl
 * above models both (the job merge, and an environment fixed at the start).
 */
test('activate waits for a cycle the timer already started, so the cycle it starts is a new one over SSH (SSH-1)',(t)=>{
 const box=host(t);
 box.run('prepare');
 // A timer cycle started before the switch, on the transport loaded then (HTTPS), still running.
 writeFileSync(box.p('fixture/running'),`${'e'.repeat(32)} https 3\n`);
 const result=box.run('activate');
 assert.equal(result.status,0,result.stderr);
 const receipt=JSON.parse(readFile(join(box.state,'last-cycle.json'),'utf8'));
 assert.equal(receipt.transport,'ssh','the first cycle after the switch fetched over SSH');
 assert.notEqual(receipt.cycle_id,'e'.repeat(32),'and it is not the cycle that was already running');
 assert.equal(receipt.ssh_key_fingerprint,KEY_FP);
 assert.match(result.stdout,/A reconcile cycle is running; waiting for it to end before switching/);
 const calls=result.calls.split('\n');
 const reload=calls.indexOf('systemctl daemon-reload');
 assert.equal(calls.slice(0,reload).filter((line)=>line==='systemctl show --property=ActiveState --value mccluster-vps-reconcile.service').length,4,
  'three polls while it ran and one that saw it end, all before the switch');
 assert.match(result.stdout,new RegExp(`switched to authenticated read-only GitHub SSH after verified ref access\\.\\nIts first cycle, ${receipt.cycle_id}, fetched over SSH with this key\\.\\n`));
});

test('activate puts the transport back when the cycle it waited for was not a new cycle over SSH with this key (SSH-1)',(t)=>{
 for(const [name,env] of [
  ['the timer started a cycle between the wait and the reload',{FAKE_TIMER_FIRES_BEFORE_RELOAD:'1'}],
  ['the reconciler on the host writes no cycle receipts',{FAKE_NO_RECEIPT:'1'}],
  ['the cycle offered another key',{FAKE_CYCLE_KEY_FINGERPRINT:OTHER_FP}],
 ]){
  const box=host(t);
  box.run('prepare');
  const result=box.run('activate',env);
  assert.equal(result.status,4,`${name}: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr,/The cycle that ran after the switch was not a new cycle over SSH with this key/,name);
  assert.match(result.stderr,/put back as it was before this run/,name);
  assert.equal(existsSync(box.dropin),false,`${name}: the previous transport is back`);
  assert.doesNotMatch(result.stdout,/switched to authenticated/,name);
 }
});

test('activate changes nothing when a cycle that is already running does not end in time (SSH-1)',(t)=>{
 const box=host(t);
 box.run('prepare');
 writeFileSync(box.p('fixture/running'),`${'e'.repeat(32)} https 100000\n`);
 const before=box.snapshot();
 const result=box.run('activate');
 assert.equal(result.status,4,result.stdout+result.stderr);
 assert.match(result.stderr,/A reconcile cycle has been running for over \d+ minutes\. Nothing was changed; run activate again when it has ended\./);
 assert.equal(existsSync(box.dropinDir),false);
 assert.doesNotMatch(result.calls,/systemctl (daemon-reload|start)/);
 assert.equal(box.snapshot(),before);
});

test('activate waits out a running cycle before any change, and checks its own cycle\'s receipt before it calls the switch done (SSH-1)',()=>{
 const unit=readFileSync(new URL('../../core/systemd/mccluster-vps-reconcile.service',import.meta.url),'utf8');
 const limit=Number(unit.match(/^TimeoutStartSec=(\d+)min$/m)?.[1])*60;
 const wait=Number(source.match(/^RECONCILE_IDLE_WAIT_SECONDS=(\d+)$/m)?.[1]);
 assert.ok(limit>0&&wait>limit,`the wait (${wait}s) outlasts a cycle that runs to the unit's start limit (${limit}s)`);
 assert.match(source,/^RECONCILE_IDLE_POLL_SECONDS=2$/m);
 const idle=source.indexOf('if ! mcc_wait_reconciler_idle; then');
 const firstChange=source.indexOf('install -d -o root -g root -m 0755 "${DROPIN_DIR}"');
 assert.ok(idle>0&&idle<firstChange,'the wait comes before the first change');
 const start=source.indexOf('if ! systemctl start "${RECONCILE_UNIT}"; then');
 const proof=source.indexOf('if ! mcc_first_cycle_used_this_key; then');
 const done=source.indexOf('SWITCH_PENDING=0\nsystemctl is-active');
 assert.ok(firstChange<start&&start<proof&&proof<done,'the receipt is checked while the switch is still undone on exit');
 // The receipt fields it reads are the ones the reconciler writes.
 const reconciler=readFileSync(new URL('../../scripts/mccluster-vps-reconcile.sh',import.meta.url),'utf8');
 for(const field of ['cycle_id','outcome','transport','ssh_host_key_pinned','ssh_key_fingerprint'])assert.ok(reconciler.includes(`"${field}":`),field);
 assert.match(reconciler,/^CYCLE_FILE="\$\{STATE_ROOT\}\/last-cycle\.json"$/m);
 assert.match(reconciler,/invocation="\$\{INVOCATION_ID:-\}"/,'cycle_id is the unit\'s invocation id');
});

test('status proves every claim from the host and changes nothing',(t)=>{
 const box=activated(t);
 const before=box.snapshot();
 const result=box.run('status');
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(box.snapshot(),before,'status leaves every file on the host as it found it');
 assert.doesNotMatch(result.calls,/systemctl (start|restart|stop|daemon-reload|enable|disable)/);
 assert.doesNotMatch(result.calls,/ssh-keygen.*-t /,'status never creates a key');
 assert.doesNotMatch(result.stdout+result.stderr+result.calls,new RegExp(PRIVATE_MARKER));
 assert.deepEqual(box.branches(),['refs/heads/deploy/ovh-production','refs/heads/main']);
 const {checked_at,last_verified_cycle_finished_at,last_verified_cycle_age_seconds,...lines}=result.lines;
 assert.match(checked_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
 assert.ok(Number(last_verified_cycle_age_seconds)>=119&&Number(last_verified_cycle_age_seconds)<=125,last_verified_cycle_age_seconds);
 assert.deepEqual(lines,{
  mode:'status',repository:'mcclusterishere/mccluster',
  key_pair:'present',key_fingerprint:KEY_FP,github_host_key:'pinned',dropin:'installed',
  effective_repo_url:REPO_SSH,effective_ssh_command:'pinned_deploy_key',git_url_rewrite:'none',checkout_origin:REPO_SSH,
  github_identity:'deploy_key_of_mcclusterishere/mccluster',write_access:'denied_read_only',
  ssh_main_sha:box.sha,ssh_promoted_sha:box.sha,reconcile_timer:'active',timer_last_trigger:'Mon 2026-11-09 22:40:01 UTC',
  last_verified_cycle_id:'3'.repeat(32),last_verified_cycle_trigger:'timer',last_verified_cycle_transport:'ssh',
  last_verified_cycle_key_fingerprint:KEY_FP,last_verified_cycle:'ssh_with_this_key_and_fresh',
  timer_cycles_over_ssh_with_this_key:'2',timer_cycles_required:'2',proofs_unproven:'none',status:'proven',
 });
 assert.equal(result.timerCycles.length,2,'the cycle started by hand at activation is not a timer cycle');
 assert.match(result.timerCycles[0],new RegExp(`^${'2'.repeat(32)} timer verified_no_change \\d{4}-`));
 assert.equal(last_verified_cycle_finished_at.length,20);
 // systemd may escape the space in an environment entry instead of quoting it.
 assert.equal(box.run('status',{FAKE_ENVIRONMENT_STYLE:'escaped'}).status,0);
});

test('status exits non-zero and names the proof whenever one does not hold',(t)=>{
 const box=activated(t);
 const unproven=(env={})=>{const result=box.run('status',env);assert.equal(result.status,1,result.stdout);assert.equal(result.lines.status,'unproven');return {...result.lines,missing:result.lines.proofs_unproven.split(',')};};
 const fresh=()=>[box.receipt({cycle_id:'2'.repeat(32),minutesAgo:4}),box.receipt({cycle_id:'3'.repeat(32),minutesAgo:2})];

 assert.deepEqual(unproven({FAKE_IDENTITY:'user'}).missing,['github_identity']);
 assert.equal(unproven({FAKE_IDENTITY:'user'}).github_identity,'other_identity:fixture-user');
 assert.equal(unproven({FAKE_IDENTITY:'silent'}).github_identity,'unrecognised');
 // What was not recognised is shown, so GitHub's real wording can be compared with the script's patterns.
 assert.equal(unproven({FAKE_IDENTITY:'lowercase'}).github_identity_answer,"hi mcclusterishere/mccluster! you've successfully authenticated");
 assert.match(unproven({FAKE_WRITE:'unrecognised'}).write_access_answer,/^ERROR: Write access is not granted to this key\. /);
 assert.equal('github_identity_answer' in box.run('status').lines,false,'a recognised answer is not echoed');
 assert.deepEqual(unproven({FAKE_WRITE:'writable'}).missing,['write_access']);
 assert.equal(unproven({FAKE_WRITE:'writable'}).write_access,'WRITE_CAPABLE');
 assert.equal(unproven({FAKE_WRITE:'archived'}).write_access,'unproven');
 assert.deepEqual(box.branches(),['refs/heads/deploy/ovh-production','refs/heads/main'],'a writable key is detected without writing');
 assert.deepEqual(unproven({FAKE_READ:'denied'}).missing,['ssh_refs']);
 assert.deepEqual(unproven({FAKE_TIMER:'inactive'}).missing,['reconcile_timer']);
 assert.deepEqual(unproven({FAKE_KEY_FINGERPRINT:OTHER_FP}).missing,['last_verified_cycle','timer_cycles'],'cycles made with another key prove nothing about this one');
 assert.deepEqual(unproven({FAKE_ENVIRONMENT_STYLE:'bare'}).missing,['effective_ssh_command'],'an environment that cannot be read exactly is not accepted');

 // A later drop-in can put the unit back on HTTPS while ours is still installed.
 writeFileSync(join(box.dropinDir,'60-operator.conf'),'[Service]\nEnvironment="MCCLUSTER_REPO_URL=https://github.com/mcclusterishere/mccluster.git"\n');
 assert.deepEqual(unproven().missing,['effective_repo_url']);
 assert.equal(unproven().dropin,'installed');
 rmSync(join(box.dropinDir,'60-operator.conf'));
 const installed=readFile(box.dropin,'utf8');
 writeFileSync(box.dropin,installed.replace('StrictHostKeyChecking=yes','StrictHostKeyChecking=accept-new'));
 assert.deepEqual(unproven().missing,['dropin','effective_ssh_command']);
 writeFileSync(box.dropin,installed);

 box.checkout('https://github.com/mcclusterishere/mccluster.git');
 assert.deepEqual(unproven().missing,['checkout_origin']);
 box.checkout(REPO_SSH);
 writeFileSync(join(box.state,'.gitconfig'),`[url "https://github.com/"]\n\tinsteadOf = git@github.com:\n`);
 assert.deepEqual(unproven().missing,['git_url_rewrite','checkout_origin'],'a rewrite in the reconciler\'s Git configuration');
 rmSync(join(box.state,'.gitconfig'));

 writeFileSync(join(box.state,'ssh/github_known_hosts'),`${HOST_KEY}\n@cert-authority * ssh-ed25519 AAAAFIXTURECA\n`);
 const widened=unproven();
 assert.equal(widened.github_host_key,'not_pinned');
 assert.deepEqual(widened.missing,['github_host_key','github_identity','write_access','ssh_refs']);
 assert.equal(widened.github_identity,'not_checked','without a pinned host key nothing is sent');
 // A NUL byte ends a shell read early; the bytes after it are still lines ssh honours.
 for(const hidden of [`${HOST_KEY}\n\0\0\n@cert-authority * ssh-ed25519 AAAAFIXTURECA\n`,`${HOST_KEY}\n\0\ngithub.com ssh-ed25519 AAAAFIXTUREOTHERKEY\n`]){
  writeFileSync(join(box.state,'ssh/github_known_hosts'),hidden);
  assert.equal(unproven().github_host_key,'not_pinned','a key hidden behind a NUL byte is still a second key');
 }
 writeFileSync(join(box.state,'ssh/github_known_hosts'),`${HOST_KEY}\n`);

 // Receipts: stale, anonymous, started by hand, too few, or absent.
 box.cycles([box.receipt({cycle_id:'2'.repeat(32),minutesAgo:40}),box.receipt({cycle_id:'3'.repeat(32),minutesAgo:26})]);
 assert.deepEqual(unproven().missing,['last_verified_cycle'],'two timer cycles are on record but the reconciler has since gone quiet');
 box.cycles([...fresh(),box.receipt({cycle_id:'4'.repeat(32),transport:'https',ssh_host_key_pinned:false,ssh_key_fingerprint:'',minutesAgo:1})]);
 assert.deepEqual(unproven().missing,['last_verified_cycle','timer_cycles'],'a cycle over another transport restarts the count: only cycles since the current activation prove it');
 assert.equal(unproven().last_verified_cycle_transport,'https');
 box.cycles([box.receipt({cycle_id:'2'.repeat(32),minutesAgo:4}),box.receipt({cycle_id:'2'.repeat(32),minutesAgo:4}),box.receipt({cycle_id:'5'.repeat(32),trigger:'other',timer_trigger_monotonic_usec:'',minutesAgo:1})]);
 const one=unproven();
 assert.deepEqual(one.missing,['timer_cycles'],'one cycle listed twice is one cycle, and a start by hand is not a timer cycle');
 assert.equal(one.timer_cycles_over_ssh_with_this_key,'1');
 box.cycles([box.receipt({cycle_id:'7'.repeat(32),ssh_host_key_pinned:false,minutesAgo:4}),box.receipt({cycle_id:'2'.repeat(32),minutesAgo:3}),
  box.receipt({cycle_id:'6'.repeat(32),outcome:'failed',stage:'fetch',exit_code:128,minutesAgo:2}),box.receipt({cycle_id:'8'.repeat(32),trigger:'timer_inferred',minutesAgo:1})]);
 assert.equal(box.run('status').status,0,'an inferred timer cycle counts; a failed one is skipped; an unpinned one before them does not count');
 box.cycles([box.receipt({cycle_id:'2'.repeat(32),minutesAgo:4}),box.receipt({cycle_id:'7'.repeat(32),ssh_host_key_pinned:false,minutesAgo:3}),
  box.receipt({cycle_id:'8'.repeat(32),trigger:'timer_inferred',minutesAgo:1})]);
 assert.deepEqual(unproven().missing,['timer_cycles'],'an unpinned cycle breaks the chain: only cycles after it count');
 for(const name of ['last-verified-cycle.json','cycles.jsonl'])rmSync(join(box.state,name));
 const none=unproven();
 assert.deepEqual(none.missing,['last_verified_cycle','timer_cycles']);
 assert.equal(none.last_verified_cycle,'absent');
 writeFileSync(join(box.state,'last-verified-cycle.json'),'{"schema_version":"something-else"}\n');
 assert.equal(unproven().last_verified_cycle,'absent');
});

test('status on a host that was never prepared creates nothing and contacts nothing',(t)=>{
 const box=host(t);
 const before=box.snapshot();
 const result=box.run('status');
 assert.equal(result.status,1);
 assert.equal(box.snapshot(),before);
 assert.equal(existsSync(join(box.state,'ssh')),false,'the key directory is not created by a read-only mode');
 assert.doesNotMatch(result.calls,/^ssh /m);
 assert.doesNotMatch(result.calls,/ssh-keygen.*-t /);
 assert.equal(result.lines.key_pair,'missing');
 assert.equal(result.lines.key_fingerprint,'unavailable');
 assert.equal(result.lines.dropin,'absent');
 assert.equal(result.lines.effective_repo_url,'not_ssh');
 assert.equal(result.lines.github_identity,'not_checked');
 assert.deepEqual(result.lines.proofs_unproven.split(','),['key_pair','key_fingerprint','github_host_key','dropin','effective_repo_url','effective_ssh_command','checkout_origin','github_identity','write_access','ssh_refs','last_verified_cycle','timer_cycles']);
 // After prepare alone the key exists but nothing is switched: identity and read-only are provable, the transport is not.
 box.run('prepare');
 const prepared=box.run('status');
 assert.equal(prepared.status,1);
 assert.equal(prepared.lines.github_identity,'deploy_key_of_mcclusterishere/mccluster');
 assert.equal(prepared.lines.write_access,'denied_read_only');
 assert.deepEqual(prepared.lines.proofs_unproven.split(','),['dropin','effective_repo_url','effective_ssh_command','checkout_origin','last_verified_cycle','timer_cycles']);
});

test('the GitHub answers the script depends on are isolated, matched once and fail closed',()=>{
 const constant=(name)=>{const match=source.match(new RegExp(`^${name}='(.*)'$`,'m'))||source.match(new RegExp(`^${name}="(.*)"$`,'m'));assert.ok(match,name);return match[1];};
 const greeting=new RegExp(constant('GITHUB_GREETING_PATTERN'));
 assert.equal(constant('GITHUB_DEPLOY_KEY_IDENTITY'),'mcclusterishere/mccluster');
 assert.equal(DEPLOY_GREETING.match(greeting)?.[1],'mcclusterishere/mccluster');
 assert.equal("Hi fixture-user! You've successfully authenticated".match(greeting)?.[1],'fixture-user');
 assert.equal('Hi mcclusterishere/mccluster-mirror! x'.match(greeting)?.[1],'mcclusterishere/mccluster-mirror','a longer name is a different identity, not a prefix match');
 for(const text of ['hi mcclusterishere/mccluster!','Hi mcclusterishere/mccluster','Welcome, Hi mcclusterishere/mccluster! ','Hi mcclusterishere/mccluster!x','Hi !'])assert.equal(greeting.test(text),false,text);
 const refusal=new RegExp(constant('GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN').replace('[:cntrl:]','\\x00-\\x1f'),'i');
 assert.ok(refusal.test(READ_ONLY_REFUSAL));
 assert.ok(refusal.test('ERROR: The key you are authenticating with has been marked as read-only.'));
 for(const text of ['ERROR: This repository was archived so it is read-only.','ERROR: Permission to mcclusterishere/mccluster.git denied to fixture-user.','remote: read only','The deploy key you used is marked as read-only.'.replace('key','token')])assert.equal(refusal.test(text),false,text);
 // Each is consulted in exactly one place.
 const uses=(name)=>source.split('\n').filter(line=>!/^\s*#/.test(line)&&line.includes(`\${${name}}`)).length;
 assert.equal(uses('GITHUB_GREETING_PATTERN'),1);
 assert.equal(uses('GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN'),1);
 assert.match(source,/GITHUB BEHAVIOUR THIS SCRIPT DEPENDS ON/);
 assert.match(source,/OVH-510-CONTRACT-AND-AUTH-RUNBOOK\.md/);
});

test('the write probe is always a dry run, and the script never trusts a host key it did not pin',()=>{
 const live=source.split('\n').filter(line=>!/^\s*#/.test(line));
 const pushes=live.filter(line=>/\b(mcc_probe_git|mcc_reconciler_git|git)\s[^\n]*\bpush\s/.test(line));
 assert.equal(pushes.length,1);
 assert.match(pushes[0],/mcc_probe_git -C "\$\{probe\}" push --dry-run "\$\{REPO\}" HEAD:refs\/heads\/mccluster-read-only-probe/);
 assert.doesNotMatch(live.join('\n'),/ssh-keyscan|StrictHostKeyChecking=(no|accept-new|ask)|UserKnownHostsFile=\/dev\/null/);
 // A remote answer is only ever shown as one line of printable ASCII, cut short.
 const printable=source.slice(source.indexOf('mcc_printable() {'),source.indexOf('\n}\n',source.indexOf('mcc_printable() {')));
 const shown=spawnSync('/bin/bash',['-c',`set -Eeuo pipefail\n${printable}\n}\nprintf 'ok\\033[31m red\\r\\nnext\\tline \\001\\377%s' "$(printf 'x%.0s' {1..400})" | mcc_printable`],{encoding:'utf8'});
 assert.equal(shown.status,0,shown.stderr);
 assert.equal(shown.stdout,`ok[31m red next line ${'x'.repeat(279)}`,'no escape, no control character, one line, 300 characters');
 assert.equal(shown.stdout.length,300);
 assert.match(source,/GITHUB_HOST_KEY="github\.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"/,'the pinned host key is the existing constant');
 // status returns before the first statement that writes to the host.
 const status=source.indexOf('if [[ "${MODE}" == "status" ]]; then');
 const firstWrite=source.indexOf('install -d -o root -g root -m 0700 "${KEY_DIR}"');
 assert.ok(status>0&&firstWrite>status&&source.indexOf('exit "${rc}"',status)<firstWrite,'status exits before any setup step');
 const statusBody=source.slice(source.indexOf('mcc_status() {'),source.indexOf('\n}\n',source.indexOf('mcc_status() {')));
 assert.doesNotMatch(statusBody,/systemctl (start|restart|stop|daemon-reload|enable|disable)|install |mv -f|> "\$\{(KNOWN|DROPIN|KEY)|ssh-keygen -q -t/);
 // Every proof in activate sits before the drop-in is written.
 const override=source.indexOf('mv -f "${tmp}" "${DROPIN}"');
 const firstChange=source.indexOf('install -d -o root -g root -m 0755 "${DROPIN_DIR}"');
 assert.ok(firstChange>0&&firstChange<override);
 const activate=source.slice(source.indexOf('# activate. Every proof below comes BEFORE the transport changes'),firstChange);
 for(const proof of ['mcc_probe_git ls-remote "${REPO}"','mcc_github_identity || identity_rc=$?','mcc_deploy_key_write_access || write_rc=$?','mcc_reconciler_rewrites_url'])assert.ok(activate.includes(proof),proof);
 assert.equal((activate.match(/exit 3/g)||[]).length,8,'each proof refuses with exit 3');
 assert.doesNotMatch(activate,/systemctl|install -d/);
});

test('the receipt age is computed without date -d',(t)=>{
 const start=source.indexOf('mcc_utc_epoch() {'), end=source.indexOf('\n}\n',start);
 const fn=source.slice(start,end+3);
 for(const stamp of ['1970-01-01T00:00:00Z','2000-02-29T23:59:59Z','2024-12-31T23:59:60Z','2026-03-01T00:00:00Z','2026-11-09T22:05:00Z','2099-12-31T12:00:00Z']){
  const out=spawnSync('/bin/bash',['-c',`set -Eeuo pipefail\n${fn}\nmcc_utc_epoch "$1"`,'epoch',stamp],{encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);
  assert.equal(Number(out.stdout),Date.UTC(...stamp.match(/\d+/g).map((part,index)=>index===1?Number(part)-1:Number(part)))/1000,stamp);
 }
 for(const stamp of ['','2026-11-09 22:05:00','2026-13-01T00:00:00Z','2026-11-09T22:05:00+00:00','$(touch x)'])
  assert.equal(spawnSync('/bin/bash',['-c',`set -Eeuo pipefail\n${fn}\nmcc_utc_epoch "$1"`,'epoch',stamp],{encoding:'utf8'}).stdout,'',stamp);
});
