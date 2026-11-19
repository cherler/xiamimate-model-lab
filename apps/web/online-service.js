import {GITHUB_PAGES} from './hosting-mode.js';

export {GITHUB_PAGES};
export function onlineServiceHtml(hash='#agent?case=retail&view=experience',label='前往虾米伙伴在线使用') {
 // Only carry supported public page parameters; never carry questions or requirement drafts.
 const [page,query='']=String(hash).replace(/^#/,'').split('?');
 const route=['recommend','forecast','classify','retrieve','anomaly','segments','decision','uplift','anticheat','agent','models','learn','expand','delivery'].includes(page)?page:'agent';
 const source=new URLSearchParams(query),params=new URLSearchParams();
 for(const key of ['case','view','business','task','model','baseline','origin','budget','capacity','shortage','section'])if(source.has(key))params.set(key,source.get(key));
 const href='https://xiamimate.com/model-lab/#'+route+(params.size?'?'+params:'');
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<p class="small-note">这里是 GitHub Pages 案例展示版。在线 AI 分析与需求对话可在虾米伙伴使用。</p><p><a class="text-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a></p>`;
}
