// M2-a 四条缺陷的复现与复核探针。
// 修复前跑：四项断言应当全部失败（打印 FAIL 行）；
// 修复后再跑：应当全部 PASS。
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../../hikari-native/memory/store.mjs'

const rows = []
const check = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'm2a-defect-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// 1. 尾部残片恢复的数据丢失路径：
//    meta.corruptLines 指向一个「其实是合法记录」的行号时，那条记录不应被跳过。
{
  const { dir, cleanup } = await fresh()
  try {
    const store = await MemoryStore.open({ storeDir: dir })
    const a = await store.append({ text: '第一条' })
    const b = await store.append({ text: '第二条' })
    await store.close()
    // 手工把 meta 的 corruptLines 指向第 2 行——第 2 行本身是合法记录（模拟行号漂移 / 人工改坏 meta）
    const metaPath = join(dir, 'memory.meta.json')
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    meta.corruptLines = [2]
    await writeFile(metaPath, JSON.stringify(meta, null, 2))

    const again = await MemoryStore.open({ storeDir: dir })
    const ids = again.all().map((r) => r.memoryId)
    const lost = !ids.includes(b.memoryId) && ids.includes(a.memoryId)
    check(
      '1. corruptLines 指向合法行时不得丢记录',
      ids.includes(b.memoryId),
      `重开后 records=${ids.length}（期望 2），第二条${lost ? '被静默跳过' : '仍在'}`,
    )
    await again.close()
  } finally {
    await cleanup()
  }
}

// 1b. 尾部残片：写完一整条 JSON 但没写行尾换行（写到一半崩了），
//     此时再 append 必须先把残片封成独立一行，否则两条会粘成一行、一起坏掉。
{
  const { dir, cleanup } = await fresh()
  try {
    const store = await MemoryStore.open({ storeDir: dir })
    const a = await store.append({ text: '第一条' })
    await store.close()

    // 模拟「写完 JSON、没写换行就崩了」：去掉文件最后那个换行符
    const jsonlPath = join(dir, 'memory.jsonl')
    const raw = await readFile(jsonlPath, 'utf8')
    await writeFile(jsonlPath, raw.replace(/\n$/, ''))
    await rm(join(dir, 'memory.meta.json'), { force: true })

    const again = await MemoryStore.open({ storeDir: dir })
    const b = await again.append({ text: '第二条' })
    await again.close()

    const lines = (await readFile(jsonlPath, 'utf8')).split('\n').filter((l) => l.trim().length > 0)
    const parsed = lines.map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    check(
      '1b. 缺行尾换行的残片后 append 不得粘行',
      lines.length === 2 && parsed.every((p) => p !== null) && parsed[0].memoryId === a.memoryId && parsed[1].memoryId === b.memoryId,
      `${lines.length} 行，可解析 ${parsed.filter(Boolean).length} 条（期望 2 行 2 条）`,
    )
  } finally {
    await cleanup()
  }
}

// 2. 只读快照的引用泄漏：改返回值不应影响存储内部。
{
  const { dir, cleanup } = await fresh()
  try {
    const store = await MemoryStore.open({ storeDir: dir })
    const rec = await store.append({ text: '带来源', source: { kind: 'finding', ref: 'f-001' } })
    const snapshot = store.get(rec.memoryId)
    try {
      snapshot.source.kind = 'polluted'
    } catch {
      /* freeze 生效时会抛 */
    }
    const after = store.get(rec.memoryId).source.kind
    check('2. 快照不得泄漏内部 source 引用', after === 'finding', `内部 source.kind 实测 "${after}"（期望 finding）`)
    const list = store.all()
    try {
      list[0].source.ref = 'polluted'
    } catch {
      /* ignore */
    }
    check(
      '2b. all() 快照同样不得泄漏',
      store.get(rec.memoryId).source.ref === 'f-001',
      `内部 source.ref 实测 "${store.get(rec.memoryId).source.ref}"（期望 f-001）`,
    )
    await store.close()
  } finally {
    await cleanup()
  }
}

// 3. 并发追加：seq 必须唯一且连续。
{
  const { dir, cleanup } = await fresh()
  try {
    const store = await MemoryStore.open({ storeDir: dir })
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ text: `并发-${i}` })))
    const seqs = store.all().map((r) => r.seq)
    const unique = new Set(seqs)
    check(
      '3. 并发 append 的 seq 必须唯一',
      unique.size === 20,
      `20 条并发写入得到 ${unique.size} 个不同 seq（期望 20）；重复值 ${[...seqs].filter((s, i, a) => a.indexOf(s) !== i).join(',') || '无'}`,
    )
    await store.close()
  } finally {
    await cleanup()
  }
}

// 4. meta 更新失败时的部分提交语义：jsonl 已写入就不该让 append 表现为失败。
{
  const { dir, cleanup } = await fresh()
  try {
    const store = await MemoryStore.open({ storeDir: dir })
    await store.append({ text: '先写一条' })
    // 把 meta 路径换成目录，让 writeFile 必然失败
    const metaPath = join(dir, 'memory.meta.json')
    await rm(metaPath, { force: true })
    await mkdir(metaPath, { recursive: true })

    let threw = null
    let returned = null
    try {
      returned = await store.append({ text: 'meta 写不进去时写了这条' })
    } catch (error) {
      threw = error.code ?? error.message
    }
    const sizeAfter = store.size
    const ok = cameBackSane({ threw, sizeAfter })
    check(
      '4. meta 写失败不得把已提交的记录报成失败',
      ok,
      threw === null
        ? `append 正常返回，size=${sizeAfter}，damage.metaWriteFailed=${store.damage.metaWriteFailed}`
        : `append 抛了 ${threw}，但 size=${sizeAfter}（jsonl 已写入 → 调用方重试会造成重复）`,
    )
    if (returned) {
      await store.close()
    }
  } finally {
    await cleanup()
  }
}

function cameBackSane({ threw, sizeAfter }) {
  // 正确的语义：jsonl 写成功就算提交成功，meta 写失败只记 damage，不抛错。
  return threw === null && sizeAfter === 2
}

const failed = rows.filter((r) => !r.ok)
console.log(`\n=== ${rows.length - failed.length}/${rows.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项：')
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`)
  process.exitCode = 1
}
