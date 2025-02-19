'use client';

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import axios from 'axios';
import { useMemo, useRef, useState } from 'react';

interface SearchResult {
  start: number;
  end: number;
  text: string;
}

interface ApiError {
  response?: {
    data?: {
      error?: string;
    };
  };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamingContent {
  thinking: string;
  response: string;
}

export default function Home () {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [wsMessages, setWsMessages] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [currentStreamedMessage, setCurrentStreamedMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [streamingContent, setStreamingContent] = useState<StreamingContent>({
    thinking: '',
    response: ''
  });

  const videoUrl = useMemo(() =>
    videoFile ? URL.createObjectURL(videoFile) : null,
    [videoFile]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoFile(file);
    setIsUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post<{ id: string }>('http://localhost:8000/upload', formData);
      setVideoId(response.data.id);
      initWebSocket(response.data.id);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      setError(apiError.response?.data?.error || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSearch = async () => {
    if (!videoId || !searchQuery) return;

    try {
      const response = await axios.post<{ results: SearchResult[] }>(
        `http://localhost:8000/search/${videoId}?query=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(response.data.results);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      setError(apiError.response?.data?.error || 'Search failed');
    }
  };

  const initWebSocket = (id: string) => {
    wsRef.current = new WebSocket(`ws://localhost:8000/chat/${id}`);

    wsRef.current.onopen = () => {
      setIsConnected(true);
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        setError(data.error);
      } else if (data.done) {
        // When message is complete, add it to chat history
        setChatHistory(prev => [...prev, {
          role: 'assistant',
          content: streamingContent.response || data.full_response
        }]);
        setStreamingContent({ thinking: '', response: '' });
      } else {
        // Update streaming content
        setStreamingContent(prev => ({
          thinking: prev.thinking + (data.thinking || ''),
          response: prev.response + (data.response || '')
        }));
      }
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
    };
  };

  const sendChatMessage = () => {
    if (!chatMessage.trim() || !wsRef.current || !isConnected) return;

    // Add user message to chat history
    setChatHistory(prev => [...prev, {
      role: 'user',
      content: chatMessage
    }]);

    // Send message through WebSocket
    wsRef.current.send(chatMessage);
    setChatMessage('');
  };

  const seekToTime = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <main className="max-w-7xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Video Search Engine</h1>

        {/* Upload Section */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Upload Video</h2>
          <Input
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="cursor-pointer"
          />
          {isUploading && <p className="mt-2 text-slate-600">Uploading...</p>}
        </Card>

        {videoFile && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr,400px] gap-8">
            {/* Video Section - Fixed height */}
            <div className="space-y-8">
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
            </div>

            {/* Right Column - Search and Chat */}
            <div className="space-y-6">
              {videoId && (
                <div className="space-y-6">
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
                          <ScrollArea className="h-[200px]">
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
                      <ScrollArea className="h-[400px] pr-4">
                        <div className="space-y-4">
                          {chatHistory.map((msg, idx) => (
                            <div
                              key={idx}
                              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'
                                }`}
                            >
                              <div
                                className={`rounded-lg p-3 max-w-[80%] ${msg.role === 'user'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-slate-200 text-slate-900'
                                  }`}
                              >
                                {msg.content}
                              </div>
                            </div>
                          ))}
                          {(streamingContent.thinking || streamingContent.response) && (
                            <div className="flex justify-start">
                              <div className="rounded-lg p-3 max-w-[80%] space-y-2">
                                {streamingContent.thinking && (
                                  <div className="bg-slate-100 p-2 rounded text-slate-600">
                                    <div className="text-xs text-slate-500 mb-1 font-semibold">Thinking...</div>
                                    <div className="font-mono text-sm border-l-2 border-slate-300 pl-2">
                                      {streamingContent.thinking}
                                    </div>
                                  </div>
                                )}
                                {streamingContent.response && (
                                  <div className="bg-slate-200 p-2 rounded text-slate-900">
                                    {streamingContent.response}
                                  </div>
                                )}
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
                          onChange={(e) => setChatMessage(e.target.value)}
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
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <Card className="p-4 bg-red-50 border-red-200">
            <p className="text-red-700">{error}</p>
          </Card>
        )}
      </main>
    </div>
  );
}
