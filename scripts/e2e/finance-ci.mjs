// Own the isolated fixture server lifecycle so CI cannot leave it running.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const preview=spawn(process.execPath,['scripts/finance-preview.mjs'],{stdio:['ignore','pipe','inherit']});
let buffer='';
try {
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Finance fixture startup timed out')),60000);
    preview.once('exit',code=>{clearTimeout(timer);reject(Error('Finance fixture exited: '+code));});
    preview.stdout.on('data',chunk=>{
      const text=String(chunk);process.stdout.write(text);buffer=(buffer+text).slice(-8000);
      const found=buffer.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(found){clearTimeout(timer);resolve(found[0]);}
    });
  });
  const browser=spawn(process.execPath,['scripts/e2e/finance-globe.e2e.mjs',process.env.FINANCE_PROOF_DIR||'/tmp/finance-globe-proof'],{
    env:{...process.env,FINANCE_PREVIEW_URL:url},stdio:'inherit'});
  const [code]=await once(browser,'exit');
  if(code!==0)throw Error('Finance globe acceptance failed: '+code);
} finally {
  if(preview.exitCode===null){preview.kill('SIGTERM');await once(preview,'exit');}
}
