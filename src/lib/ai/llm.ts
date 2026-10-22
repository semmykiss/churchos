// AI Assistant — LLM completion wrapper around z-ai-web-dev-sdk.
//
// Keeps the SDK usage isolated to the backend (per project rules) and exposes
// two functions:
//   - completeChat()  — single-shot (used as fallback)
//   - streamChat()    — SSE stream via the underlying ReadableStream
//
// The SDK's `stream: true` option returns a Web ReadableStream of raw SSE bytes
// (data: {...}\n\n chunks). We consume that stream and parse each SSE event to
// extract the delta content.

import ZAI from 'z-ai-web-dev-sdk'
import type { ChatCompletionMessage } from './types'

// Cache the SDK instance — don't recreate per request.
let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
async function getZai() {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

export interface CompleteOptions {
  systemPrompt: string
  messages: ChatCompletionMessage[]
  /** Max history messages to send (oldest trimmed first). Default 20. */
  maxMessages?: number
}

/** Single-shot completion. Returns the assistant message text. */
export async function completeChat({ systemPrompt, messages, maxMessages = 20 }: CompleteOptions): Promise<string> {
  const zai = await getZai()
  const trimmed = messages.slice(-maxMessages)
  const finalMessages: ChatCompletionMessage[] = [
    { role: 'assistant', content: systemPrompt },
    ...trimmed,
  ]

  const completion = await zai.chat.completions.create({
    messages: finalMessages as any,
    thinking: { type: 'disabled' },
  })

  const content = completion.choices?.[0]?.message?.content
  if (!content || !content.trim()) {
    throw new Error('The AI model returned an empty response. Please try again.')
  }
  return content.trim()
}

export interface StreamChunk {
  delta: string
}

/**
 * Streaming completion. The SDK returns a Web ReadableStream of SSE bytes —
 * we read it with a reader, parse each SSE event, and call onChunk for each delta.
 * Returns the full accumulated text when done.
 */
export async function streamChat(
  { systemPrompt, messages, maxMessages = 20 }: CompleteOptions,
  onChunk: (chunk: StreamChunk) => void,
): Promise<string> {
  const zai = await getZai()
  const trimmed = messages.slice(-maxMessages)
  const finalMessages: ChatCompletionMessage[] = [
    { role: 'assistant', content: systemPrompt },
    ...trimmed,
  ]

  let full = ''

  // First, try streaming. If anything goes wrong, fall back to single-shot.
  try {
    const stream: any = await zai.chat.completions.create({
      messages: finalMessages as any,
      thinking: { type: 'disabled' },
      stream: true,
    })

    if (stream instanceof ReadableStream || (stream && typeof stream.getReader === 'function')) {
      // Web ReadableStream of SSE bytes — consume manually.
      const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE events are separated by \n\n. Parse each complete event.
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          // Each event may have multiple `data:` lines (we only expect one).
          const dataLines = rawEvent
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
          if (dataLines.length === 0) continue
          const dataStr = dataLines.join('')
          if (!dataStr || dataStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(dataStr)
            const delta = parsed?.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              full += delta
              onChunk({ delta })
            }
          } catch {
            // Ignore malformed events — keep reading.
          }
        }
      }
    } else if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      // Async iterable of parsed deltas (some SDK versions).
      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          full += delta
          onChunk({ delta })
        }
      }
    } else if (stream?.choices?.[0]?.message?.content) {
      // Non-streaming response (SDK ignored stream:true).
      full = stream.choices[0].message.content
      onChunk({ delta: full })
    } else {
      throw new Error('Unexpected SDK response shape during streaming.')
    }
  } catch (e) {
    // Fall back to single-shot.
    const text = await completeChat({ systemPrompt, messages: trimmed, maxMessages })
    full = text
    onChunk({ delta: text })
  }

  if (!full.trim()) {
    throw new Error('The AI model returned an empty response. Please try again.')
  }
  return full.trim()
}
