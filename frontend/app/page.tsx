'use client';

import axios from 'axios';
import { useRef, useState } from 'react';

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

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setWsMessages(prev => [...prev, data.response]);
    };
  };

  const sendChatMessage = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(searchQuery);
    }
  };

  const seekToTime = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  return (
    <div className="min-h-screen p-8">
      <main className="max-w-4xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Video Search Engine</h1>

        {/* Upload Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Upload Video</h2>
          <input
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
          {isUploading && <p>Uploading...</p>}
        </section>

        {/* Video Player */}
        {videoFile && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Video Preview</h2>
            <video
              ref={videoRef}
              src={URL.createObjectURL(videoFile)}
              controls
              className="w-full rounded-lg"
            >
              Your browser does not support the video tag.
            </video>
          </section>
        )}

        {/* Search Section */}
        {videoId && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Search Video Content</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="What would you like to know about the video?"
                className="flex-1 p-2 border rounded"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Search
              </button>
              <button
                onClick={sendChatMessage}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Chat
              </button>
            </div>
          </section>
        )}

        {/* Results Section */}
        {searchResults.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Results</h2>
            <div className="space-y-2">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="p-4 border rounded cursor-pointer hover:bg-gray-50"
                  onClick={() => seekToTime(result.start)}
                >
                  <p className="font-medium">Time: {result.start.toFixed(2)}s - {result.end.toFixed(2)}s</p>
                  <p>{result.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Chat Messages */}
        {wsMessages.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Chat History</h2>
            <div className="space-y-2">
              {wsMessages.map((msg, index) => (
                <div key={index} className="p-4 bg-gray-100 rounded">
                  <p>{msg}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
