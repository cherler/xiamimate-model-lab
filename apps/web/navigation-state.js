// Keep the visible selection in the URL without rerendering the entire page.
export function saveSelection(page,values){
 const q=new URLSearchParams(location.hash.split('?')[1]||'');
 for(const [key,value] of Object.entries(values))if(value!=null)q.set(key,String(value));
 history.replaceState(null,'',`#${page}?${q}`);
 window.dispatchEvent(new Event('selectionchange'));
}
