import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LlmConfigEnv,
  type LlmTool,
  createHttpLlmClient,
  resolveLlmConfig,
} from '../src/assistant/llm-client.js'

// Tool calling over the one OpenAI-compatible POST (#381): the answer path hands the model a set of
// tools and loops on its calls, so the client must (a) put the tools on the wire in the OpenAI shape,
// (b) replay an assistant turn that called tools — its tool_calls AND the provider's opaque
// reasoning_details, which Gemini 3 requires back unmodified or the next round is a 400 — plus the
// tool-result turns, and (c) read a tool-calling completion (empty content, finish_reason
// "tool_calls") as a success carrying the calls, not as the empty-completion failure it used to be.

const baseEnv: LlmConfigEnv = {
  ASSISTANT_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'or-key',
  APP_BASE_URL: 'https://app.example',
}

const searchTool: LlmTool = {
  kind: 'function',
  name: 'search_documents',
  description: 'Search the company documents.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
}

const webSearch: LlmTool = {
  kind: 'server',
  type: 'openrouter:web_search',
  parameters: { max_results: 3 },
}

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

describe('createHttpLlmClient — tools on the wire (#381)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends function tools in the OpenAI shape and server tools verbatim, with tool_choice auto', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respond({ choices: [{ message: { content: 'ok' } }] }))
    const client = createHttpLlmClient(resolveLlmConfig(baseEnv))

    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      tools: [searchTool, webSearch],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_documents',
          description: 'Search the company documents.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
      { type: 'openrouter:web_search', parameters: { max_results: 3 } },
    ])
    expect(body.tool_choice).toBe('auto')
  })

  it('sends no tools field at all for a plain request (the pre-#381 wire shape)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respond({ choices: [{ message: { content: 'ok' } }] }))
    await createHttpLlmClient(resolveLlmConfig(baseEnv)).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('replays an assistant tool-calling turn with its reasoning_details and the tool results', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respond({ choices: [{ message: { content: 'done' } }] }))
    const reasoning = [{ type: 'reasoning.encrypted', data: 'opaque', format: 'google-gemini-v1' }]

    await createHttpLlmClient(resolveLlmConfig(baseEnv)).complete({
      messages: [
        { role: 'user', content: 'how many branches?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'branch_directory', arguments: '{}' }],
          reasoningDetails: reasoning,
        },
        { role: 'tool', toolCallId: 'call_1', content: '{"count":46}' },
      ],
      maxTokens: 100,
      tools: [searchTool],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'branch_directory', arguments: '{}' } },
      ],
      reasoning_details: reasoning,
    })
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"count":46}',
    })
  })

  it('reads a tool-calling completion as a success carrying the calls and the reasoning details', async () => {
    const reasoning = [{ type: 'reasoning.text', text: 'thinking', format: 'google-gemini-v1' }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respond({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_9',
                  type: 'function',
                  function: { name: 'search_documents', arguments: '{"query":"נוהל פתיחה"}' },
                },
              ],
              reasoning_details: reasoning,
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )
    const result = await createHttpLlmClient(resolveLlmConfig(baseEnv)).complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [searchTool],
    })
    expect(result).toEqual({
      ok: true,
      content: '',
      toolCalls: [{ id: 'call_9', name: 'search_documents', arguments: '{"query":"נוהל פתיחה"}' }],
      reasoningDetails: reasoning,
      model: 'google/gemini-3.1-pro-preview',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  it('still folds an empty completion with no tool calls into a retryable failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respond({ choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }] }),
    )
    const result = await createHttpLlmClient(resolveLlmConfig(baseEnv)).complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [searchTool],
    })
    expect(result.ok).toBe(false)
  })

  it('surfaces url citations from a web-searched completion, title and url only', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respond({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: 'VAT is 18%.',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://www.gov.il/vat',
                    title: 'VAT rate',
                    content: 'snippet text the reader never needs',
                  },
                },
              ],
            },
          },
        ],
      }),
    )
    const result = await createHttpLlmClient(resolveLlmConfig(baseEnv)).complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [webSearch],
    })
    if (!result.ok) throw new Error('expected success')
    expect(result.citations).toEqual([{ url: 'https://www.gov.il/vat', title: 'VAT rate' }])
  })
})
