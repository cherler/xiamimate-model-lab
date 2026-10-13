import {relative, sep} from 'node:path';
// Local research preview is not authorization to redistribute competition data.
export function publishableWebPath(root, source) {
  return relative(root, source).split(sep)[0] !== 'm5-results';
}
