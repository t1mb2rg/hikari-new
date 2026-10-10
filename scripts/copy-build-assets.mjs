// Non-TypeScript files the compiled tree needs at runtime.
//
// `tsc` copies only what it compiles, so anything a module reads by path from beside itself has to be
// put there on purpose. There is one such file today: `walk.ps1`, the UIA walk that
// `src/desktop-content-read/uia.ts` runs as `powershell.exe -File`. It is a file rather than a string
// assembled on a command line -- that module's comments record why, and the short version is that a
// script carried in `-EncodedCommand` shares one 32,767-character CreateProcess command line with the
// interpreter -- and a file has to be shipped.
//
// Not a build system, and it should not become one: two paths and a copy. If this ever needs to do
// more than copy, it has outgrown itself and the repository should decide what replaces it.
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['desktop-content-read/walk.ps1'];

for (const asset of ASSETS) {
  const from = join(ROOT, 'src', asset);
  const to = join(ROOT, 'dist', asset);

  if (!existsSync(from)) {
    throw new Error(`构建资源缺失：${from}`);
  }
  // The destination directory belongs to `tsc`. Requiring it rather than creating it is what makes
  // the build order checkable: creating it would let this script produce a `dist/` that has the
  // asset and none of the code, and the build would report success.
  if (!existsSync(dirname(to))) {
    throw new Error(`编译产物目录不存在：${dirname(to)}（应当先运行 tsc）`);
  }

  copyFileSync(from, to);
  console.log(`copied ${asset} (${statSync(to).size} bytes)`);
}
