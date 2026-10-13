import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = fileURLToPath(new URL('../.venv/bin/python', import.meta.url));
if (!existsSync(python)) {
  console.error('请先运行 uv sync --python 3.12，再运行 npm run train。');
  process.exit(1);
}
const child = spawn(python, ['services/server.py', '--port', process.env.MODEL_LAB_PORT || '5328'], {cwd:root, stdio:'inherit'});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
