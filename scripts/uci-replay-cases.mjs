// Emit frontend replay outputs for independent comparison with the frozen Python model.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyUciManifest,verifyUciCustomer,replayUci} from '../apps/web/uci-static.js';
const root=new URL('../apps/web/uci-results/',import.meta.url),m=verifyUciManifest(JSON.parse(await readFile(new URL('manifest.json',root))));
for(const user of [...m.customers,'new']){const p=verifyUciCustomer(JSON.parse(await readFile(new URL(`${m.version}/customer-${user}.json`,root))),m);
 for(const strategy of m.models)for(const exclude_purchased of [false,true])for(const exploration of m.exploration){const body={customer_id:user,strategy,exclude_purchased,exploration,limit:20},result=replayUci(p,m,body);for(const k of [1,2,10]){const v=replayUci(p,m,{...body,limit:k});if(JSON.stringify(v.items)!==JSON.stringify(result.items.slice(0,k)))throw new Error('Prefix replay mismatch');}
  process.stdout.write(JSON.stringify({body,result})+'\n');}
}
