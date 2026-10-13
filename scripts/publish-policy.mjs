import {relative, sep} from 'node:path';
// Local research preview is not authorization to redistribute competition data.
export function publishableWebPath(root, source) {
  return !['m5-results','dressipi-results'].includes(relative(root, source).split(sep)[0]);
}
