export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'text';
  size: number;
  mimeType: string;
  previewUrl?: string;
  extension?: 'jpg' | 'png' | 'txt' | 'md';
  /** 原始 File 对象引用，提交时用于读取内容 */
  fileObj?: File;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  badges?: string[];
}

export interface ModelProviderOption {
  provider: string;
  models: SelectOption[];
}

/** Maps reasoning level labels to their actual API values. null = unsupported for this model. */
export type ThinkingLevelMap = Record<string, string | null>;

export interface SlashCommandOption {
  id: string;
  name: string;
  label: string;
  description?: string;
  category?: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'thinking' | 'error';

export type MessageStatus = 'pending' | 'running' | 'success' | 'error';

export interface MessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type?: string;
  isStreaming?: boolean;
  toolCallId?: string;
  toolName?: string;
  status?: MessageStatus;
  usage?: MessageUsage;
  collapsed?: boolean;
}
