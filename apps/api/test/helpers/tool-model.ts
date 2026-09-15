import type { LlmCompletionRequest, LlmCompletionResult } from '../../src/assistant/llm-client.js'

// The obedient tool-using model (#381) for the answer-path suites: a responder that, with no tool
// result in hand, asks for one named tool, and once the fenced result is back answers from it. The
// answer callback receives the tool results exactly as the model reads them, so a case asserts
// what the scoped read admitted without peeking at the prompt string — the same posture the
// one-shot suites had, moved from the system turn to the tool turn.

export const toolResults = (request: LlmCompletionRequest): string =>
  request.messages
    .filter((message) => message.role === 'tool')
    .map((message) => message.content)
    .join('\n')

// The question being answered: the newest user turn, which in a tool round is no longer the
// last message.
export const lastQuestion = (request: LlmCompletionRequest): string =>
  [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? ''

export const toolThenAnswer =
  (
    tool: string,
    args: (question: string) => Record<string, unknown>,
    answer: (results: string, question: string) => string,
  ) =>
  (request: LlmCompletionRequest): LlmCompletionResult => {
    const question = lastQuestion(request)
    const results = toolResults(request)
    if (results.length === 0) {
      return {
        ok: true,
        content: '',
        toolCalls: [{ id: `call-${tool}`, name: tool, arguments: JSON.stringify(args(question)) }],
      }
    }
    return { ok: true, content: answer(results, question) }
  }

// Search the documents with the question as the query, then answer from the excerpts.
export const searchThenAnswer = (answer: (results: string, question: string) => string) =>
  toolThenAnswer('search_documents', (question) => ({ query: question }), answer)

// Read the task board, then answer from it.
export const tasksThenAnswer = (answer: (results: string, question: string) => string) =>
  toolThenAnswer('my_tasks', () => ({}), answer)
