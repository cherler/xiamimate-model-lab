import {relative, sep} from 'node:path';
// Default builds exclude research bundles. Explicit showcases allow verified display files only.
export function publishableWebPath(root, source, competitionPaths = new Set()) {
  const path=relative(root,source).split(sep).join('/');
  if(path==='..'||path.startsWith('../'))return false;
  if(['uplift-results','anticheat-results'].includes(path.split('/')[0]))return false;
  return !['m5-results','dressipi-results'].includes(path.split('/')[0]) || competitionPaths.has(path);
}
