import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { context, control, publicPlan } from './control.mjs';
import { services } from './services.mjs';

try {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const [action,...args]=process.argv.slice(2);
  if(args.some(a=>a!=='--dry-run'))throw new Error('Only --dry-run is supported');
  const config=JSON.parse(readFileSync(join(root,'infra/azure/environments/staging.json')));
  const c=context(process.env,config,root);
  if(args.includes('--dry-run'))for(const command of publicPlan(action,c))console.log(command);
  else {
    mkdirSync(c.results,{recursive:true}); mkdirSync(c.privateDir,{recursive:true,mode:0o700});
    const env={...process.env,DOCKER_CONFIG:join(c.privateDir,'docker'),SEED_FILE:join(c.privateDir,'seed.json'),DEPLOYMENT_FILE:join(c.results,'deployment.json')};
    // Never print credential-bearing command output/errors; private deployment diagnostics stay in Azure.
    const run=(program,argv)=>{
      const result=spawnSync(program,argv,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});
      if(result.error||result.status!==0)throw new Error(`${program} failed during staging ${action}; inspect private diagnostics`);
      return result.stdout;
    };
    console.log(JSON.stringify(await control(action,c,run,services(c)),null,2));
  }
} catch(error){console.error(error instanceof SyntaxError ? 'Staging JSON could not be decoded; inspect private diagnostics' : error.message);process.exitCode=1;}
