export interface SearchResult {
  start: number;
  end: number;
  text: string;
  visual_context: string;
  similarity: number;
}

export interface ApiError {
  response?: {
    data?: {
      error?: string;
    };
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamingContent {
  thinking: string;
  response: string;
}

export interface WebSocketResponse {
  thinking?: string;
  response?: string;
  error?: string;
  done?: boolean;
  full_response?: string;
}