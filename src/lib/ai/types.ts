// AI Assistant — shared types.

export interface ChatCompletionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiMessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  metadata: string | null
  createdAt: string
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}
