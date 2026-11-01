import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  buildSummaryRequestText,
  composeHandoffTask,
  extractFirstPromptFromEvents,
  extractFirstPromptFromMessages,
  isHumanUserMessage,
  readTitleInputFirstPrompt,
  renderTranscript,
  textOfContent,
} from '../src/prompt.js'
import { assistantMessage, userEvent, userMessage } from './helpers/host.js'

describe('textOfContent', () => {
  it('keeps text and names non-text attachments while dropping reasoning and tool calls', () => {
    const content = [
      { type: 'text', text: 'run the tests' },
      { type: 'reasoning', text: 'private chain of thought' },
      { type: 'image', attachment: { attachmentId: 'img', width: 1, height: 1 } },
      { type: 'file', attachment: { attachmentId: 'f', name: 'report.pdf', bytes: 10 } },
      { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{}' },
    ] as unknown as ContentBlock[]
    assert.equal(textOfContent(content), 'run the tests\n[image]\n[file: report.pdf]')
  })

  it('returns an empty string for content without text', () => {
    assert.equal(textOfContent([]), '')
    assert.equal(textOfContent([{ type: 'reasoning', text: 'hmm' }] as ContentBlock[]), '')
  })
})

describe('first prompt extraction', () => {
  it('skips injected context and returns the first direct human prompt', () => {
    const events = [
      userEvent(1, 'injected skill context', 'injected'),
      userEvent(2, 'first real prompt'),
      userEvent(3, 'second human message'),
    ]
    assert.equal(extractFirstPromptFromEvents(events), 'first real prompt')
  })

  it('returns undefined when the log has no human prompt', () => {
    assert.equal(extractFirstPromptFromEvents([userEvent(1, 'notice', 'injected')]), undefined)
    assert.equal(extractFirstPromptFromEvents([]), undefined)
  })

  it('reads the same rule from compacted history', () => {
    const messages = [
      userMessage('m1', 'context', 'injected'),
      userMessage('m2', 'the original task'),
      assistantMessage('m3', 'working on it'),
    ]
    assert.equal(extractFirstPromptFromMessages(messages), 'the original task')
    assert.equal(isHumanUserMessage(messages[0]!), false)
    assert.equal(isHumanUserMessage(messages[1]!), true)
  })

  it('validates the titleInput projection state defensively', () => {
    assert.equal(readTitleInputFirstPrompt({ first: { text: '  hello  ' }, count: 1, lastSeq: 0 }), 'hello')
    assert.equal(readTitleInputFirstPrompt({ first: { text: '   ' }, count: 1, lastSeq: 0 }), undefined)
    assert.equal(readTitleInputFirstPrompt({ first: null, count: 0, lastSeq: null }), undefined)
    assert.equal(readTitleInputFirstPrompt(undefined), undefined)
    assert.equal(readTitleInputFirstPrompt('garbage'), undefined)
    assert.equal(readTitleInputFirstPrompt({ first: { text: 42 } }), undefined)
  })
})

describe('renderTranscript', () => {
  it('renders only human prompts and assistant text, newest first within the budget', () => {
    const messages = [
      userMessage('m1', 'first prompt'),
      assistantMessage('m2', 'did the first thing'),
      { ...userMessage('m3', 'hook output'), source: { kind: 'injected' } },
      assistantMessage('m4', 'did the second thing'),
    ] as never
    const transcript = renderTranscript(messages, { maxChars: 10_000 })
    assert.equal(transcript, 'User: first prompt\nAssistant: did the first thing\nAssistant: did the second thing')
  })

  it('keeps the newest lines and marks omitted history', () => {
    const messages = [
      userMessage('m1', 'x'.repeat(80)),
      assistantMessage('m2', 'y'.repeat(80)),
      userMessage('m3', 'latest'),
    ]
    const transcript = renderTranscript(messages, { maxChars: 60 })
    assert.ok(transcript.startsWith('[earlier messages omitted to fit the input budget]'))
    assert.ok(transcript.includes('User: latest'))
    assert.ok(!transcript.includes('x'.repeat(10)))
  })

  it('returns a placeholder for an empty history', () => {
    assert.equal(renderTranscript([], { maxChars: 100 }), '(no conversation transcript available)')
  })
})

describe('composeHandoffTask', () => {
  const vars = {
    firstPrompt: 'Fix the flaky upload test',
    summary: '## Original Task\nFix the flaky upload test',
    sessionId: 'session-1',
    turn: 4,
    reason: 'completed',
  }

  it('substitutes every known placeholder', () => {
    const task = composeHandoffTask(
      'session={{sessionId}} turn={{turn}} reason={{reason}}\n{{firstPrompt}}\n{{summary}}',
      vars,
    )
    assert.equal(task, 'session=session-1 turn=4 reason=completed\nFix the flaky upload test\n## Original Task\nFix the flaky upload test')
  })

  it('appends the mandatory sections when a template omits their placeholders', () => {
    const task = composeHandoffTask('Continue the task.', vars)
    assert.ok(task.includes('## Original first user prompt (verbatim)\nFix the flaky upload test'))
    assert.ok(task.includes('## Handoff summary\n## Original Task\nFix the flaky upload test'))
  })

  it('leaves unknown placeholders untouched', () => {
    assert.equal(composeHandoffTask('keep {{unknown}}', vars).split('\n')[0], 'keep {{unknown}}')
  })
})

describe('buildSummaryRequestText', () => {
  it('always quotes the first prompt and includes the transcript', () => {
    const text = buildSummaryRequestText({
      firstPrompt: 'Add pagination to the upload list',
      transcript: 'User: Add pagination to the upload list\nAssistant: added the page state',
    })
    assert.ok(text.includes('Add pagination to the upload list'))
    assert.ok(text.includes('Assistant: added the page state'))
    assert.ok(text.includes('verbatim'))
  })
})
