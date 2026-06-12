import type { Message } from '../types';

export interface MessageStreamSplit {
  stableMessages: Message[];
  streamingMessage?: Message;
}

export function splitStreamingMessage(messages: Message[]): MessageStreamSplit {
  const streamingIndex = messages.findIndex((message) => message.isStreaming);

  if (streamingIndex === -1) {
    return { stableMessages: messages };
  }

  return {
    stableMessages: messages.filter((_, index) => index !== streamingIndex),
    streamingMessage: messages[streamingIndex],
  };
}
