import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FinishReason, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  buildSummaryGenerateOptions,
  collectStreamedText,
  SummaryError,
  summarize,
  type LlmStreamer,
  type SummaryRequest,
} from '../src/summary.js'

/** Stream a fixed chunk list. */
async function* chunks(list: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of list) yield chunk
}

const finish = (reason: FinishReason): StreamChunk => ({ type: 'finish', reason })

describe('collectStreamedText', () => {
  it('collects text deltas once, ignoring the assembled block', async () => {
    const collected = await collectStreamedText(
      chunks([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'Hello' },
        { type: 'text-delta', index: 0, text: ' world' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    )
    assert.equal(collected.text, 'Hello world')
    assert.equal(collected.finish.kind, 'stop')
  })

  it('falls back to assembled text blocks when an adapter streams no deltas', async () => {
    const collected = await collectStreamedText(
      chunks([{ type: 'block-end', index: 0, block: { type: 'text', text: 'block only' } }, finish({ kind: 'stop' })]),
    )
    assert.equal(collected.text, 'block only')
  })

  it('carries provider usage when reported', async () => {
    const collected = await collectStreamedText(
      chunks([
        { type: 'text-delta', index: 0, text: 'ok' },
        { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } },
        finish({ kind: 'stop' }),
      ]),
    )
    assert.deepEqual(collected.usage, { inputTokens: 3, outputTokens: 1 })
  })

  it('fails closed on an error finish', async () => {
    await assert.rejects(
      collectStreamedText(
        chunks([
          { type: 'text-delta', index: 0, text: 'partial' },
          finish({ kind: 'error', failure: { message: 'provider exploded', code: 'PROVIDER' } }),
        ]),
      ),
      (error: unknown) => error instanceof SummaryError && error.code === 'ERROR' && /provider exploded/.test(error.message),
    )
  })

  it('fails closed on an aborted finish, a token ceiling, and a tool-call stop', async () => {
    for (const [reason, code] of [
      [{ kind: 'aborted', failure: { message: 'stopped', code: 'ABORTED' } }, 'ABORTED'],
      [{ kind: 'max-tokens' }, 'MAX_TOKENS'],
      [{ kind: 'tool-calls' }, 'TOOL_CALLS'],
    ] as const) {
      await assert.rejects(collectStreamedText(chunks([finish(reason)])), (error: unknown) => {
        return error instanceof SummaryError && error.code === code
      })
    }
  })

  it('fails closed when the stream ends without a finish chunk or without text', async () => {
    await assert.rejects(collectStreamedText(chunks([{ type: 'text-delta', index: 0, text: 'x' }])), /without a finish chunk/)
    await assert.rejects(collectStreamedText(chunks([finish({ kind: 'stop' })])), /no text output/)
    await assert.rejects(
      collectStreamedText(chunks([{ type: 'text-delta', index: 0, text: '   \n ' }, finish({ kind: 'stop' })])),
      /no text output/,
    )
  })
})

describe('buildSummaryGenerateOptions', () => {
  const request: SummaryRequest = {
    provider: 'deepseek',
    model: 'deepseek-chat',
    system: 'summarize',
    input: 'body',
    maxTokens: 1024,
    signal: new AbortController().signal,
  }

  it('builds a hand-built request that cannot disturb the conversation', () => {
    const options = buildSummaryGenerateOptions(request)
    assert.equal(options.provider, 'deepseek')
    assert.equal(options.model, 'deepseek-chat')
    assert.equal(options.system, 'summarize')
    assert.deepEqual(options.messages, [{ role: 'user', content: [{ type: 'text', text: 'body' }] }])
    assert.equal(options.maxTokens, 1024)
    assert.equal(options.sessionId, undefined)
    assert.equal(options.purpose, undefined)
    assert.equal(options.tools, undefined)
  })
})

describe('summarize', () => {
  it('returns the trimmed model text', async () => {
    const calls: GenerateOptions[] = []
    const llm: LlmStreamer = {
      stream: (options) => {
        calls.push(options)
        return chunks([{ type: 'text-delta', index: 0, text: '  summary text  ' }, finish({ kind: 'stop' })])
      },
    }
    const text = await summarize(llm, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      system: 'summarize',
      input: 'body',
      maxTokens: 512,
      signal: new AbortController().signal,
    })
    assert.equal(text, 'summary text')
    assert.equal(calls.length, 1)
  })
})
