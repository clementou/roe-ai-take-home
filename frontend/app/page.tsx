'use client';

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import axios from 'axios';
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, ChatMessage, SearchResult, StreamingContent, WebSocketResponse } from './types';

const API_BASE_URL = 'http://localhost:8000';
const WS_BASE_URL = 'ws://localhost:8000';
const MAX_VIDEO_SIZE = 180 * 1024 * 1024;

const SUPPORTED_VIDEO_FORMATS = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/x-matroska', // MKV
  'video/quicktime',  // MOV
  'video/x-msvideo',  // AVI
  'video/x-ms-wmv',   // WMV
] as const;

const SUPPORTED_FILE_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.ogg',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv'
] as const;

export default function Home () {
  // Video states
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Chat states
  const [chatMessage, setChatMessage] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [streamingContent, setStreamingContent] = useState<StreamingContent>({
    thinking: '',
    response: ''
  });
  const [isThinkingOpen, setIsThinkingOpen] = useState<boolean>(false);

  // Error state
  const [error, setError] = useState<string>('');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videoUrl = useMemo(() =>
    videoFile ? URL.createObjectURL(videoFile) : null,
    [videoFile]
  );

  const VideoPreviewSection = useMemo(() => {
    if (!videoFile) return null;
    
    return (
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Video Preview</h2>
        <div className="aspect-video w-full">
          <video
            ref={videoRef}
            src={videoUrl || undefined}
            controls
            className="w-full h-full rounded-lg"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </Card>
    );
  }, [videoFile, videoUrl]);

  const handleChatInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setChatMessage(e.target.value);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!videoId || !searchQuery) return;

    try {
      const response = await axios.post<{ results: SearchResult[] }>(
        `${API_BASE_URL}/search/${videoId}?query=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(response.data.results);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      setError(apiError.response?.data?.error || 'Search failed');
    }
  }, [videoId, searchQuery]);

  const handleWebSocketMessage = useCallback((data: WebSocketResponse): void => {
    if (data.error) {
      setError(data.error);
    } else if (data.done && data.full_response) {
      setChatHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.full_response || 'No response received'
        } satisfies ChatMessage
      ]);
      setStreamingContent({ thinking: '', response: '' });
    } else {
      setStreamingContent(prev => ({
        thinking: data.thinking ? prev.thinking + data.thinking : prev.thinking,
        response: data.response ? prev.response + data.response : prev.response
      }));
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const initWebSocket = useCallback((id: string): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    wsRef.current = new WebSocket(`${WS_BASE_URL}/chat/${id}`);

    wsRef.current.onopen = () => {
      setIsConnected(true);
      setError('');
    };

    wsRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WebSocketResponse;
        handleWebSocketMessage(data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
        setError('Communication error');
      }
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
    };

    wsRef.current.onerror = (event) => {
      console.error('WebSocket error:', event);
      setError('WebSocket connection failed');
      setIsConnected(false);
    };
  }, [handleWebSocketMessage]);

  // Clean up resources on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isSupported = SUPPORTED_VIDEO_FORMATS.some(format =>
      file.type === format ||
      (format === 'video/x-matroska' && file.name.toLowerCase().endsWith('.mkv'))
    );

    if (!isSupported) {
      setError(`Unsupported video format. Please upload: ${SUPPORTED_VIDEO_FORMATS
        .map(format => format.split('/')[1].toUpperCase())
        .join(', ')
        }`);
      return;
    }

    if (file.size > MAX_VIDEO_SIZE) {
      setError('Video must be under 3 minutes');
      return;
    }

    setVideoFile(file);
    setIsUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post<{ id: string }>(`${API_BASE_URL}/upload`, formData);
      setVideoId(response.data.id);
      initWebSocket(response.data.id);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      setError(apiError.response?.data?.error || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const sendChatMessage = () => {
    if (!chatMessage.trim() || !wsRef.current || !isConnected) return;

    setChatHistory(prev => [...prev, {
      role: 'user',
      content: chatMessage
    }]);

    wsRef.current.send(chatMessage);
    setChatMessage('');
  };

  const seekToTime = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, videoRef.current.duration));
      videoRef.current.play().catch(err => {
        console.error('Failed to play video:', err);
        setError('Failed to play video');
      });
    }
  };

  const VideoUploadSection = () => (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-4">Upload Video</h2>
      <Input
        type="file"
        accept={[
          ...SUPPORTED_VIDEO_FORMATS,
          ...SUPPORTED_FILE_EXTENSIONS
        ].join(',')}
        onChange={handleFileUpload}
        className="cursor-pointer"
        disabled={isUploading}
      />
      <p className="mt-2 text-sm text-slate-600">
        Supported formats: MP4, WebM, OGG, MKV, MOV, AVI, WMV
      </p>
      {isUploading && (
        <div className="mt-4 flex items-center gap-2 text-slate-600">
          <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
          <p>Processing video... This may take a few moments.</p>
        </div>
      )}
    </Card>
  );

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <main className="max-w-7xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Video Search Engine</h1>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,400px] gap-8">
          {/* Left Column - Upload and Video */}
          <div className="space-y-6">
            <VideoUploadSection />
            {VideoPreviewSection}
          </div>

          {/* Right Column - Search and Chat */}
          <div className="space-y-6">
            {videoId && (
              <>
                {/* Search Section with Results */}
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Search Video Content</h2>
                  <div className="space-y-4">
                    <Input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="What would you like to know about the video?"
                    />
                    <Button
                      onClick={handleSearch}
                      className="w-full"
                    >
                      Search
                    </Button>

                    {/* Search Results */}
                    {searchResults.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-semibold text-slate-600 mb-2">Results</h3>
                        <ScrollArea className="h-[150px]">
                          <div className="space-y-2">
                            {searchResults.map((result, index) => (
                              <div
                                key={index}
                                onClick={() => seekToTime(result.start)}
                                className="p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors"
                              >
                                <p className="font-medium text-sm text-slate-600">
                                  {result.start.toFixed(2)}s - {result.end.toFixed(2)}s
                                </p>
                                <p className="mt-1">{result.text}</p>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Chat Interface */}
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Chat</h2>
                  <div className="space-y-4">
                    <ScrollArea className="h-[300px] pr-4">
                      <div className="space-y-4">
                        {chatHistory.map((msg, idx) => (
                          <div
                            key={idx}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`rounded-lg p-3 max-w-[80%] ${msg.role === 'user'
                                ? 'bg-blue-500 text-white'
                                : 'bg-slate-200 text-slate-900'
                                }`}
                            >
                              {/* Render thinking messages as collapsibles */}
                              {idx > 0 && chatHistory[idx - 1].content === msg.content ? (
                                <Collapsible>
                                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                                    <CollapsibleTrigger className="flex items-center gap-1 hover:text-slate-700">
                                      <ChevronDown size={14} />
                                      <span className="font-semibold">Thinking Process</span>
                                    </CollapsibleTrigger>
                                  </div>
                                  <CollapsibleContent>
                                    <div className="bg-slate-100 p-2 rounded text-slate-600">
                                      <div className="font-mono text-sm border-l-2 border-slate-300 pl-2">
                                        {msg.content}
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              ) : (
                                // Regular message
                                msg.content
                              )}
                            </div>
                          </div>
                        ))}
                        {streamingContent.thinking && (
                          <div className="flex justify-start">
                            <div className="rounded-lg p-3 max-w-[80%] w-full">
                              <Collapsible
                                open={isThinkingOpen}
                                onOpenChange={setIsThinkingOpen}
                                className="w-full"
                              >
                                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                                  <CollapsibleTrigger className="flex items-center gap-1 hover:text-slate-700">
                                    <ChevronUp size={14} />
                                    <span className="font-semibold">Thinking...</span>
                                  </CollapsibleTrigger>
                                </div>
                                <CollapsibleContent>
                                  <div className="bg-slate-100 p-2 rounded text-slate-600">
                                    <div className="font-mono text-sm border-l-2 border-slate-300 pl-2">
                                      {streamingContent.thinking}
                                    </div>
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                          </div>
                        )}
                        {streamingContent.response && (
                          <div className="flex justify-start">
                            <div className="rounded-lg p-3 max-w-[80%] bg-slate-200 text-slate-900">
                              {streamingContent.response}
                            </div>
                          </div>
                        )}
                        <div ref={scrollRef} />
                      </div>
                    </ScrollArea>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={chatMessage}
                        onChange={handleChatInputChange}
                        placeholder="Ask about the video..."
                        onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                        disabled={!isConnected}
                      />
                      <Button
                        onClick={sendChatMessage}
                        disabled={!isConnected}
                      >
                        Send
                      </Button>
                    </div>
                    {!isConnected && (
                      <p className="text-red-500 text-sm">
                        Disconnected from chat. Please refresh the page.
                      </p>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>

        {error && (
          <Card className="p-4 bg-red-50 border-red-200">
            <p className="text-red-700">{error}</p>
          </Card>
        )}
      </main>
    </div>
  );
}
