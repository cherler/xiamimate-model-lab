"""Export audited paired rows only; no new model, labels, or routing policy."""
import json
from pathlib import Path
from services.adoption.uci import ROOT,PROTOCOL,read,digest,load_sources,normalize,audit

def export():
    p,m,data,model=load_sources();a=audit(p,m,data,model)
    if a!=read(ROOT/'docs/evaluation/uci-adoption-audit-v1.json'):raise ValueError('Frozen audit changed')
    rows,_=normalize(p,data,model)
    payload={'schema':'uci-adoption-v1','parent_run':m['run_id'],'parent_version':m['version'],
             'protocol':p,'protocol_sha256':digest(PROTOCOL.read_bytes()),'audit':a,'records':rows,
             'source_code_sha256':{name:digest((ROOT/name).read_bytes()) for name in ['services/adoption/uci.py','services/adoption/export.py']},
             'notice':'UCI Online Retail II, Chen (2012), DOI 10.24432/C5CG6D, CC BY 4.0. Derived paired development diagnostics; not an independent evaluation or business outcome.'}
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode();sha=digest(raw);path=f'{sha[:16]}/case.json';out=ROOT/'apps/web/uci-adoption-results'
    (out/path).parent.mkdir(parents=True,exist_ok=True);(out/path).write_bytes(raw)
    manifest={'schema':'uci-adoption-v1','path':path,'sha256':sha,'parent_run':m['run_id'],'parent_version':m['version'],'protocol_sha256':payload['protocol_sha256']}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (ROOT/'docs/evaluation/uci-adoption-export-v1.json').write_text(json.dumps({**manifest,'bytes':len(raw),'rows':len(rows),'source_code_sha256':payload['source_code_sha256']},indent=2)+'\n')
    print(f'Exported {len(rows)} paired customer-windows, {len(raw)} bytes; original predictions unchanged.')
if __name__=='__main__':export()
