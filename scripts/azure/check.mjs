import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const binary=process.env.BICEP_BIN;
const temp=mkdtempSync(join(tmpdir(),'rh-staging-bicep-'));
try{
 const run=(tool,args)=>{const result=spawnSync(tool,args,{cwd:root,encoding:'utf8'});if(result.error||result.status!==0||result.stderr.trim())throw Error(result.stderr||'Validation command failed');return result.stdout;};
 const bicep=args=>run(binary||'az',binary?args.filter(a=>a!=='--file'):['bicep',...args]);
 if(!bicep([binary?'--version':'version']).includes('version 0.48.1 '))throw Error('Require Bicep 0.48.1');
 for(const file of ['infra/azure/main.bicep',...readdirSync(join(root,'infra/azure/modules')).filter(f=>f.endsWith('.bicep')).map(f=>'infra/azure/modules/'+f)]){
  bicep(['build','--file',join(root,file),'--outfile',join(temp,file.split('/').at(-1)+'.json')]);bicep(['lint','--file',join(root,file)]);
 }
 run(process.env.SHELLCHECK_BIN||'shellcheck',readdirSync(join(root,'scripts/azure')).filter(f=>f.endsWith('.sh')).map(f=>'scripts/azure/'+f));
 console.log('Staging Bicep build/lint and ShellCheck passed');
}catch(error){console.error(error.message);process.exitCode=1;}finally{rmSync(temp,{recursive:true,force:true});}
