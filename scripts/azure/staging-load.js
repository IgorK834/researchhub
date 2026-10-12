import http from 'k6/http';
import { check, sleep, fail } from 'k6';
const seed=JSON.parse(open(__ENV.SEED_FILE));
const deployment=JSON.parse(open(__ENV.DEPLOYMENT_FILE));
const base=deployment.outputs.frontendUrl;
if(deployment.environment!=='staging'||seed.synthetic!==true||seed.users.some(u=>!u.email.endsWith('@rc-demo.example.test')))fail('Only synthetic staging is permitted');
export const options={vus:5,duration:'2m',thresholds:{http_req_failed:['rate<0.01'],checks:['rate>0.99']}};
let ready=false;
export default function(){
  if(!ready){const user=seed.users[__VU];if(!user)fail('Missing synthetic account');
    http.get(base+'/api/auth/csrf');let csrf=http.cookieJar().cookiesForURL(base)['XSRF-TOKEN'][0];
    const response=http.post(base+'/api/auth/login',JSON.stringify({email:user.email,password:user.password}),{headers:{'Content-Type':'application/json','X-XSRF-TOKEN':decodeURIComponent(csrf)}});
    check(response,{login:r=>r.status===200});if(response.status!==200)fail('Login failed');ready=true;}
  const response=http.get(base+`/api/workspaces/${seed.workspaceId}`);
  check(response,{workspace:r=>r.status===200});sleep(1);
}
