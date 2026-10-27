// PoC-02 / s4：Service 契约键编码的碰撞检查。
//
// 三件事：
//   1) 真实契约全集（24 个 service）编码后是否互不相同；
//   2) 构造用例：编码函数 `id.replace(/[^A-Za-z0-9]/g,'_') + '_v' + version` 是否单射；
//   3) 两侧在「同名不同版本」与「编码撞车」两种情形下的实际行为。
//
// 运行：node experiments/poc-02-runtime-contract/key-collision.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { services } from './collect-contracts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));

const hikariKey = (c) => `${c.id}@${c.version}`;
const cordisName = (c) => `${c.id.replace(/[^A-Za-z0-9]/g, '_')}_v${c.version}`;

const results = {};

// ── 1) 真实契约全集 ────────────────────────────────────────────────────
{
  const byHikari = new Map();
  const byCordis = new Map();
  for (const c of services) {
    byHikari.set(hikariKey(c), (byHikari.get(hikariKey(c)) ?? 0) + 1);
    byCordis.set(cordisName(c), (byCordis.get(cordisName(c)) ?? 0) + 1);
  }
  const hikariDup = [...byHikari].filter(([, n]) => n > 1).map(([k]) => k);
  const cordisDup = [...byCordis].filter(([, n]) => n > 1).map(([k]) => k);
  results.realContracts = {
    count: services.length,
    versions: [...new Set(services.map((c) => c.version))],
    hikariKeysUnique: hikariDup.length === 0,
    cordisNamesUnique: cordisDup.length === 0,
    hikariDuplicates: hikariDup,
    cordisDuplicates: cordisDup,
    sample: services.slice(0, 4).map((c) => ({ hikari: hikariKey(c), cordis: cordisName(c) })),
  };
}

// ── 2) 编码是否单射：构造用例 ──────────────────────────────────────────
{
  const cases = [
    { label: '点 vs 连字符', a: { id: 'github-ci.run-materials', version: 1 }, b: { id: 'github-ci.run.materials', version: 1 } },
    { label: '点 vs 下划线', a: { id: 'foo.bar', version: 1 }, b: { id: 'foo_bar', version: 1 } },
    { label: '版本进键', a: { id: 'foo', version: 1 }, b: { id: 'foo', version: 2 } },
    { label: '版本当后缀', a: { id: 'foo', version: 3 }, b: { id: 'foo_v3', version: 1 } },
    { label: '大版本号双位', a: { id: 'foo', version: 12 }, b: { id: 'foo', version: 1 } },
  ];
  results.injectiveCases = cases.map(({ label, a, b }) => ({
    label,
    a: { hikari: hikariKey(a), cordis: cordisName(a) },
    b: { hikari: hikariKey(b), cordis: cordisName(b) },
    hikariDistinct: hikariKey(a) !== hikariKey(b),
    cordisDistinct: cordisName(a) !== cordisName(b),
  }));
}

// ── 3a) Hikari：同名不同版本能否并存 ───────────────────────────────────
{
  const foo1 = { id: 'poc02.foo', version: 1 };
  const foo2 = { id: 'poc02.foo', version: 2 };
  const provider = (contract, value) => ({
    id: `poc02-provider-v${contract.version}`,
    version: '1.0.0',
    requires: [],
    provides: [contract],
    setup(context) {
      context.services.provide(contract, value);
    },
  });
  const consumer = {
    id: 'poc02-consumer',
    version: '1.0.0',
    requires: [foo1],
    provides: [],
    setup(context) {
      results.sameIdDifferentVersion = {
        ...results.sameIdDifferentVersion,
        consumerRead: context.services.get(foo1),
      };
    },
  };

  const runtime = new Runtime();
  let loadError = null;
  try {
    await runtime.loadPlugin(provider(foo1, 'value-from-v1'));
    await runtime.loadPlugin(provider(foo2, 'value-from-v2'));
    await runtime.loadPlugin(consumer);
  } catch (error) {
    loadError = error;
  }
  results.sameIdDifferentVersion = {
    coExists: loadError === null,
    error: loadError ? `${loadError.constructor.name}: ${loadError.message}` : null,
    ...results.sameIdDifferentVersion,
  };
  await runtime.shutdown();
}

// ── 3b) Cordis：同名不同版本（编码后不同名）与真正的编码撞车 ───────────
{
  // 编码后不同名 → 可并存
  const root = new Context();
  const foo1 = { id: 'poc02.foo', version: 1 };
  const foo2 = { id: 'poc02.foo', version: 2 };
  let coexistError = null;
  try {
    root.plugin((ctx) => {
      ctx.provide(cordisName(foo1), 'value-from-v1');
    });
    root.plugin((ctx) => {
      ctx.provide(cordisName(foo2), 'value-from-v2');
    });
    await new Promise((r) => setTimeout(r, 100));
  } catch (error) {
    coexistError = error;
  }
  const readBack = {
    v1: root.get(cordisName(foo1), false),
    v2: root.get(cordisName(foo2), false),
  };

  // 编码撞车 → 两个不同的 Hikari 契约映射到同一个 Cordis 名
  const collideA = { id: 'poc02.a.b', version: 1 };
  const collideB = { id: 'poc02.a-b', version: 1 };
  let collideError = null;
  let collisionFiber = null;
  const root2 = new Context();
  try {
    root2.plugin((ctx) => {
      ctx.provide(cordisName(collideA), 'from-a');
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = root2.plugin((ctx) => {
      ctx.provide(cordisName(collideB), 'from-b');
    });
    await new Promise((r) => setTimeout(r, 150));
    collisionFiber = {
      state: second.state,
      error: second.error ? String(second.error.message ?? second.error) : null,
      valueAfter: root2.get(cordisName(collideA), false),
    };
  } catch (error) {
    collideError = error;
  }

  results.cordisBehavior = {
    sameIdDifferentVersion: {
      coexists: coexistError === null,
      names: [cordisName(foo1), cordisName(foo2)],
      readBack,
      error: coexistError ? `${coexistError.constructor.name}: ${coexistError.message}` : null,
    },
    encodingCollision: {
      hikariKeysDistinct: hikariKey(collideA) !== hikariKey(collideB),
      cordisNames: [cordisName(collideA), cordisName(collideB)],
      cordisNamesEqual: cordisName(collideA) === cordisName(collideB),
      secondProvideError: collideError ? String(collideError.message ?? collideError) : null,
      collisionFiber,
    },
  };

  await root.fiber.dispose();
  await root2.fiber.dispose();
}

writeFileSync(resolve(here, 'key-collision.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
