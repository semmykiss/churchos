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
import fs from 'fs'
import type { ChatCompletionMessage } from './types'

// ---------------------------------------------------------------------------
// Vercel bootstrap — the z-ai SDK reads its config from a FILE at one of:
//   process.cwd()/.z-ai-config  →  os.homedir()/.z-ai-config  →  /etc/.z-ai-config
// On Vercel the lambda cwd (/var/task) is read-only and neither home nor /etc
// has the config, so ZAI.create() throws "Configuration file not found" and
// every AI request 500s. Fix: ship the config via the ZAI_CONFIG_B64 env var
// (base64 of the JSON), write it to /tmp on cold start, and point HOME at
// /tmp so os.homedir() resolves there. /tmp is writable on Vercel.
// ---------------------------------------------------------------------------
let _configBootstrapped = false
function bootstrapZaiConfig(): void {
  if (_configBootstrapped || !process.env.VERCEL) return
  const b64 = process.env.ZAI_CONFIG_B64
  if (!b64) {
    console.error('[ai] VERCEL detected but ZAI_CONFIG_B64 is not set — AI will fail.')
    _configBootstrapped = true
    return
  }
  try {
    const dest = '/tmp/.z-ai-config'
    fs.accessSync(dest)
    _configBootstrapped = true // already written by an earlier invocation in this lambda
    return
  } catch { /* not present yet — write below */ }
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8')
    JSON.parse(json) // validate before writing
    const tmp = `/tmp/.z-ai-config.${process.pid}.tmp`
    fs.writeFileSync(tmp, json)
    fs.renameSync(tmp, '/tmp/.z-ai-config') // atomic
    process.env.HOME = '/tmp' // os.homedir() returns $HOME on POSIX
    _configBootstrapped = true
  } catch (err) {
    console.error('[ai] Failed to bootstrap z-ai config on Vercel:', err)
    _configBootstrapped = true
  }
}

// Cache the SDK instance — don't recreate per request.
let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null
async function getZai() {
  if (!_zai) {
    bootstrapZaiConfig()
    _zai = await ZAI.create()
  }
  return _zai
}

export interface CompleteOptions {
  systemPrompt: string
  messages: ChatCompletionMessage[]
  /** Max history messages to send (oldest trimmed first). Default 20. */
  maxMessages?: number
}

// ---------------------------------------------------------------------------
// Public LLM fallback (OpenAI-compatible).
// The sandbox z-ai gateway (internal-api.z.ai) resolves to PRIVATE IPs that
// are unreachable from Vercel. When LLM_BASE_URL + LLM_API_KEY are set, use
// any OpenAI-compatible endpoint instead (OpenAI, OpenRouter, Groq, Z.ai
// public API, local Ollama, …). LLM_MODEL defaults to gpt-4o-mini.
// ---------------------------------------------------------------------------
function getPublicLlmConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim()
  const apiKey = process.env.LLM_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini' }
}

function openaiMessages(systemPrompt: string, trimmed: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return [{ role: 'system', content: systemPrompt }, ...trimmed]
}

async function openaiComplete(cfg: { baseUrl: string; apiKey: string; model: string }, msgs: ChatCompletionMessage[]): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: msgs, stream: false }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`LLM API error ${res.status}: ${t.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content || !String(content).trim()) {
    throw new Error('The AI model returned an empty response. Please try again.')
  }
  return String(content).trim()
}

async function openaiStream(
  cfg: { baseUrl: string; apiKey: string; model: string },
  msgs: ChatCompletionMessage[],
  onChunk: (chunk: StreamChunk) => void,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: msgs, stream: true }),
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`LLM API error ${res.status}: ${t.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
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
      } catch { /* ignore malformed */ }
    }
  }
  return full
}

/** Single-shot completion. Returns the assistant message text. */
export async function completeChat({ systemPrompt, messages, maxMessages = 20 }: CompleteOptions): Promise<string> {
  const trimmed = messages.slice(-maxMessages)
  const publicCfg = getPublicLlmConfig()
  if (publicCfg) {
    return openaiComplete(publicCfg, openaiMessages(systemPrompt, trimmed))
  }
  const zai = await getZai()
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

/** Wrap unreachable-gateway errors with an actionable hint on Vercel. */
function wrapLlmError(e: unknown): Error {
  if (process.env.VERCEL && !getPublicLlmConfig()) {
    return new Error(
      'The AI gateway is unreachable from this deployment. Add LLM_BASE_URL and LLM_API_KEY environment variables in your Vercel project settings (any OpenAI-compatible provider works, e.g. https://api.openai.com/v1) to enable the AI assistant.',
    )
  }
  return e instanceof Error ? e : new Error(String(e))
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
  const trimmed = messages.slice(-maxMessages)
  const publicCfg = getPublicLlmConfig()
  if (publicCfg) {
    const msgs = openaiMessages(systemPrompt, trimmed)
    let full = ''
    try {
      full = await openaiStream(publicCfg, msgs, onChunk)
    } catch {
      // Stream failed — fall back to single-shot.
      const text = await openaiComplete(publicCfg, msgs)
      full = text
      onChunk({ delta: text })
    }
    if (!full.trim()) {
      throw new Error('The AI model returned an empty response. Please try again.')
    }
    return full.trim()
  }

  const zai = await getZai()
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
    // Gateway unreachable (e.g. private-network sandbox gateway on Vercel) —
    // surface an actionable message instead of retrying into the same wall.
    if (process.env.VERCEL && !getPublicLlmConfig()) throw wrapLlmError(e)
    // Otherwise fall back to single-shot.
    const text = await completeChat({ systemPrompt, messages: trimmed, maxMessages })
    full = text
    onChunk({ delta: text })
  }

  if (!full.trim()) {
    throw new Error('The AI model returned an empty response. Please try again.')
  }
  return full.trim()
}
