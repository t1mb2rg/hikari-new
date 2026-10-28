// PoC-03 / s2：契约键编码——单射、可逆、保留完整 id 与 version。
//
// 任务书明确禁止「把截断 hash 无条件宣称为单射」。所以这里不用 hash：
// 编码就是 `id@version`，解码按最后一个 `@` 切。单射性靠约束（version 是正整数）而不是靠运气，
// 下面用真实契约全集 + 构造用例穷举证明。
//
// 运行：node experiments/poc-03-contract-layer/key-codec.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// 复用 PoC-02 的扫描器：同一份真实契约全集口径，避免两轮实验各扫一遍还扫出不同数字。
import { services, events } from '../poc-02-runtime-contract/collect-contracts.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 编码 / 解码

/**
 * 契约键编码。
 *
 * 约束（编码时校验，不满足就抛，不静默降级）：
 * - id 非空字符串
 * - version 是正整数
 *
 * 在这个约束下 `id@version` 的最后一个 `@` 一定是分隔点（version 是纯数字、不含 `@`），
 * 所以 (id, version) -> id@version 是单射，decode 是它的左逆。
 */
export function encodeContractKey(id, version) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`contract id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`contract version must be a positive integer, got ${JSON.stringify(version)}`);
  }
  return `${id}@${version}`;
}

/** encodeContractKey 的左逆：decode(encode(id, v)) 必须等于 (id, v)。 */
export function decodeContractKey(key) {
  if (typeof key !== 'string') throw new TypeError('contract key must be a string');
  const cut = key.lastIndexOf('@');
  if (cut <= 0 || cut === key.length - 1) {
    throw new TypeError(`not a contract key: ${JSON.stringify(key)}`);
  }
  const id = key.slice(0, cut);
  const versionText = key.slice(cut + 1);
  if (!/^[0-9]+$/.test(versionText)) {
    throw new TypeError(`not a contract key (bad version): ${JSON.stringify(key)}`);
  }
  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`not a contract key (version out of range): ${JSON.stringify(key)}`);
  }
  return { id, version };
}

// ---------------------------------------------------------------- 真实契约全集

const real = [
  ...services.map((c) => ({ kind: 'service', id: c.id, version: c.version, file: c.file })),
  ...events.map((c) => ({ kind: 'event', id: c.id, version: c.version, file: c.file })),
];
const realKeys = real.map((c) => ({ ...c, key: encodeContractKey(c.id, c.version) }));

// ---------------------------------------------------------------- 构造用例

const SYNTHETIC = [
  // 不同 ID，编码后必须不同（PoC-02 里这两个会撞成 foo_bar_v1）
  { id: 'foo.bar', version: 1, why: '点号与下划线同形，PoC-02 的旧编码会撞' },
  { id: 'foo_bar', version: 1, why: '同上' },
  // 同 ID 不同版本
  { id: 'repository-ci-awareness.current', version: 1, why: '真实 id + v1' },
  { id: 'repository-ci-awareness.current', version: 2, why: '真实 id + v2' },
  { id: 'repository-ci-awareness.current', version: 10, why: '真实 id + v10，两位版本号' },
  // id 本身含 @
  { id: 'weird@id', version: 3, why: 'id 含分隔符本身' },
  { id: 'weird@id@nested', version: 3, why: 'id 含多个分隔符' },
  // id 含版本样式的数字
  { id: 'service.v1', version: 2, why: 'id 自带版本样式' },
  // 空与非法（应被拒）
  { id: '', version: 1, why: '空 id 必须被拒', expectThrows: true },
  { id: 'ok.id', version: 0, why: 'version 0 必须被拒', expectThrows: true },
  { id: 'ok.id', version: -1, why: '负 version 必须被拒', expectThrows: true },
  { id: 'ok.id', version: 1.5, why: '非整数 version 必须被拒', expectThrows: true },
  { id: 'ok.id', version: '1', why: '字符串 version 必须被拒', expectThrows: true },
];

// ---------------------------------------------------------------- 检查

const problems = [];
const syntheticResults = [];

for (const item of SYNTHETIC) {
  const entry = { ...item };
  try {
    entry.key = encodeContractKey(item.id, item.version);
    entry.encoded = true;
  } catch (error) {
    entry.encoded = false;
    entry.error = String(error.message ?? error);
  }
  if (item.expectThrows) {
    entry.passed = entry.encoded === false;
    if (!entry.passed) problems.push(`应被拒但编码成功: ${JSON.stringify(item)}`);
  } else {
    entry.passed = entry.encoded === true;
    if (!entry.passed) problems.push(`应编码成功但失败: ${JSON.stringify(item)}`);
    if (entry.encoded) {
      const back = decodeContractKey(entry.key);
      entry.roundTrip = back;
      entry.roundTripOk = back.id === item.id && back.version === item.version;
      if (!entry.roundTripOk) problems.push(`往返不一致: ${JSON.stringify(item)} -> ${entry.key} -> ${JSON.stringify(back)}`);
    }
  }
  syntheticResults.push(entry);
}

// 真实全集：编码唯一 + 往返
const realKeysSeen = new Map();
for (const c of realKeys) {
  if (realKeysSeen.has(c.key)) {
    problems.push(`真实契约键碰撞: ${c.key}（${realKeysSeen.get(c.key)} 与 ${c.id}）`);
  }
  realKeysSeen.set(c.key, c.id);
  const back = decodeContractKey(c.key);
  if (back.id !== c.id || back.version !== c.version) {
    problems.push(`真实契约往返不一致: ${c.key} -> ${JSON.stringify(back)}`);
  }
}

// 真实 + 构造合并去重后，仍要满足「不同 (id,version) => 不同 key」
const allPairs = [
  ...real.map((c) => ({ id: c.id, version: c.version, source: 'real' })),
  ...SYNTHETIC.filter((s) => !s.expectThrows).map((s) => ({ id: s.id, version: s.version, source: 'synthetic' })),
];
const byKey = new Map();
const collisions = [];
for (const pair of allPairs) {
  const key = encodeContractKey(pair.id, pair.version);
  const prev = byKey.get(key);
  if (prev && (prev.id !== pair.id || prev.version !== pair.version)) {
    collisions.push({ key, a: prev, b: pair });
  }
  byKey.set(key, pair);
}

// 单射性论证的反例搜索：穷举 id 里的分隔符变体
const separatorIds = ['a.b', 'a_b', 'a-b', 'a:b', 'a/b', 'a b', 'a@b'];
const separatorCollisions = [];
for (const a of separatorIds) {
  for (const b of separatorIds) {
    if (a === b) continue;
    const ka = encodeContractKey(a, 1);
    const kb = encodeContractKey(b, 1);
    if (ka === kb) separatorCollisions.push({ a, b, key: ka });
  }
}

const out = {
  environment: { node: process.version, cordis: '4.0.5', dsh: '0.2.1-rc.2' },
  scheme: {
    encode: 'id@version（完整 id + 完整 version，无 hash、无截断）',
    decode: '按最后一个 @ 切分；version 必须是纯数字',
    constraints: ['id 非空字符串', 'version 为正整数'],
    injectivityArgument:
      'version 是纯数字、不含 @，所以 key 的最后一个 @ 一定是分隔点；' +
      '给定 key 必唯一还原出 (id, version)，反过来给定 (id, version) 必唯一得到 key。',
  },
  real: { count: realKeys.length, items: realKeys },
  synthetic: syntheticResults,
  separatorPairTest: { ids: separatorIds, collisions: separatorCollisions },
  collisions: { realOrMixed: collisions, count: collisions.length },
  problems,
  verdict: {
    realSetCollisionFree: !problems.some((p) => p.includes('真实契约键碰撞')),
    roundTripAllOk: !problems.some((p) => p.includes('往返不一致')),
    syntheticNoCollision: collisions.length === 0,
    rejectsInvalid: syntheticResults.filter((s) => s.expectThrows).every((s) => s.passed),
    problems,
  },
};

writeFileSync(resolve(here, 'key-codec.json'), `${JSON.stringify(out, null, 2)}\n`);

// ---------------------------------------------------------------- 打印

console.log('真实契约:', realKeys.length, '个（service + event）');
console.log('  前三个键:', realKeys.slice(0, 3).map((c) => c.key).join('  '));
console.log('');
console.log('构造用例:');
for (const s of syntheticResults) {
  const line = s.encoded
    ? `${JSON.stringify(s.id)} v${s.version} -> ${s.key}  往返=${s.roundTripOk ? 'ok' : 'FAIL'}`
    : `${JSON.stringify(s.id)} v${s.version} -> 拒绝（${s.error}）`;
  console.log(`  ${s.passed ? '✓' : '✗'} ${line}`);
}
console.log('');
console.log('分隔符两两组合碰撞:', separatorCollisions.length);
console.log('真实+构造合并碰撞:', collisions.length);
console.log('问题:', problems.length ? problems : '(无)');
console.log('');
console.log('判定:', JSON.stringify({ ...out.verdict, problems: undefined }));
