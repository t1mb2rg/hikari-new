/**
 * Analyze hikari-trace request dumps (enhanced: tool-call args + finding text).
 *
 * Usage: node analyze-requests.mjs <dump.jsonl>
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('usage: node analyze-requests.mjs <dump.jsonl>')
const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0)

const FINDING_PATTERN = /此前的假设|有工具证据支持|已闭合/

for (const line of lines) {
  const request = JSON.parse(line)
  const messages = request.messages ?? []
  const counts = {}
  for (const message of messages) counts[message.role] = (counts[message.role] ?? 0) + 1
  const systemLen = messages.filter((message) => message.role === 'system').reduce((total, message) => total + (message.content?.[0]?.len ?? 0), 0)

  const calls = []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === 'tool-call') calls.push({ name: part.name, args: part.args })
    }
  }

  const readCalls = []
  for (const call of calls) {
    if (call.name !== 'read') continue
    try {
      const parsed = typeof call.args === 'string' ? JSON.parse(call.args) : call.args
      readCalls.push({ path: parsed?.file_path, offset: parsed?.offset ?? 0, limit: parsed?.limit })
    } catch {
      readCalls.push({ path: '(unparsed)', offset: 0 })
    }
  }

  const findingMessages = messages.filter(
    (message) => message.role === 'user' && (message.content ?? []).some((part) => part.text && FINDING_PATTERN.test(part.text)),
  )

  console.log(`\n=== request #${request.index} (${new Date(request.at).toLocaleTimeString()}) messages=${messages.length} counts=${JSON.stringify(counts)} systemChars=${systemLen}`)
  console.log(`tools=${JSON.stringify(request.tools)}`)
  console.log(`toolCalls=${calls.length}`)
  const recentCalls = calls.slice(-8)
  for (const call of recentCalls) console.log(`  call ${call.name} ${call.args}`)
  console.log(`findingMessages=${findingMessages.length}`)
  for (const message of findingMessages.slice(-2)) {
    const text = message.content.find((part) => part.text && FINDING_PATTERN.test(part.text))?.text ?? ''
    console.log(`  [finding-context] ${JSON.stringify(text.slice(0, 700))}`)
  }
  console.log(`toolResults=${messages.filter((message) => message.role === 'tool').length}`)
  const byPath = new Map()
  for (const call of readCalls) {
    const key = `${call.path} (offset ${call.offset})`
    byPath.set(key, (byPath.get(key) ?? 0) + 1)
  }
  console.log(`readCalls=${readCalls.length}`)
  for (const [key, count] of byPath) console.log(`  read x${count} ${key}`)
}
