# Video Search Engine

## Overview

This project is a video search engine that allows you to search for videos by their content.

## Dependencies

ffmpeg

```bash
brew install ffmpeg
```

uv (Poetry should work too)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Run

```bash
cd backend
uv run uvicorn main:app --reload
```

In another terminal, run the frontend:

```bash
cd frontend
npm install
npm run build
npm run start
```

## My Approach

I used FastAPI for the backend, since it's lightweight and easy to use. I considered using Django, but it includes a lot of extra functionality that I didn't need and didn't think was necessary to have in an MVP.

When the user uploads a video, the backend processes the video by:

1. Generating a transcript of the video using Whisper.
2. Extracting frames from the video every 1 second.
3. Using YOLO to detect objects in the frames.
4. Concatenating the transcript and the objects detected in the frames.
5. Generating an embedding for the concatenated text.
6. Storing the transcript, the objects detected, and the embedding in memory.

When the user searches in the video, the backend calculates the cosine similarity between the query and the embeddings of the transcripts. It then returns the top 3 most similar segments.

When the user asks a question about the video, the backend uses an LLM (Deepseek-R1-Distill-Qwen-1.5B) to generate a response. The LLM is given the full transcript (including the objects detected in the frames) and the user's question as context. I run the LLM locally using MLX.

I considered using third-party APIs for the visual understanding, similarity search, and the LLM, but considering the size of the data (3-min videos), and the example question, I thought the extra performance was not necessary for a demo, where easy setup might be preferred.

I also considered using a Video Language Model, but that would be too large to run locally, and might not be necessary for the example use case of speech-heavy videos.

For the frontend, I used Next.js and Shadcn/UI.
