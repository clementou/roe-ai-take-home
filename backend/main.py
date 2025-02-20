import os
import uuid

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mlx_lm import load, stream_generate
from openai import OpenAI
from functools import lru_cache
from pydantic_settings import BaseSettings
from utils import process_video, search_transcript
from mlx_lm.sample_utils import make_sampler


class Settings(BaseSettings):
    openai_api_key: str | None = None
    use_mlx: bool = True

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()


app = FastAPI()

print("Loading MLX model...")
mlx_model, mlx_tokenizer = load("deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B") if get_settings().use_mlx else (None, None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# TODO: Replace with persistent storage
VIDEO_DATA = {}


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)) -> JSONResponse:
    """
    Process uploaded video file and generate transcript data.

    Args:
        file: Uploaded video file

    Returns:
        JSONResponse with video ID and success message

    Raises:
        HTTPException: If video processing fails
    """
    try:
        video_id = str(uuid.uuid4())
        os.makedirs(f"uploads/{video_id}", exist_ok=True)

        video_path = f"uploads/{video_id}/video.mp4"
        with open(video_path, "wb") as f:
            f.write(await file.read())

        # Process video returns combined transcript and visual analysis
        transcript_data = process_video(video_path)
        VIDEO_DATA[video_id] = transcript_data

        return JSONResponse({"id": video_id, "message": "Video processed successfully"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/search/{video_id}")
async def search_video(video_id: str, query: str):
    if video_id not in VIDEO_DATA:
        return JSONResponse({"error": "Video not found"}, status_code=404)

    results = search_transcript(VIDEO_DATA[video_id], query)
    return {"results": results}


@app.websocket("/chat/{video_id}")
async def websocket_endpoint(websocket: WebSocket, video_id: str, settings: Settings = Depends(get_settings)):
    """
    Handle WebSocket connections for real-time chat.

    Args:
        websocket: WebSocket connection
        video_id: ID of the processed video

    Raises:
        WebSocketDisconnect: When client disconnects
    """
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_text()

            if video_id not in VIDEO_DATA:
                await websocket.send_json({"error": "Video not found"})
                continue

            # Combine transcript segments with timestamps for context
            transcript = "\n".join(
                [f"[{seg['start']:.2f}s - {seg['end']:.2f}s]: {seg['enhanced_text']}" for seg in VIDEO_DATA[video_id]]
            )

            prompt = f"""You are a helpful AI assistant that answers questions about video content. 
You will be given a video transcript that includes both spoken content and visual observations. 
The visual observations are marked with [Visual context: ...].
Please provide a clear, concise response based on both the spoken and visual content.
If you're unsure about something, say so rather than making assumptions.

Video Transcript:
{transcript}

Question: {message}

Please provide a helpful response based on both the spoken and visual content."""

            if settings.use_mlx:
                # MLX model path
                if hasattr(mlx_tokenizer, "apply_chat_template") and mlx_tokenizer.chat_template is not None:
                    messages = [{"role": "user", "content": prompt}]
                    prompt = mlx_tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

                sampler = make_sampler(temp=0.6)
                
                full_response = ""
                buffer = ""
                final_response_started = False

                for response in stream_generate(mlx_model, mlx_tokenizer, prompt, max_tokens=1024, sampler=sampler):
                    chunk = response.text
                    full_response += chunk

                    if "</think>\n\n" in chunk and not final_response_started:
                        final_response_started = True
                        if buffer:
                            await websocket.send_json({"thinking": buffer, "response": "", "done": False})
                            buffer = ""
                        # Remove the marker from the response
                        chunk = chunk.replace("</think>\n\n", "")

                    buffer += chunk
                    if len(buffer) > 20:
                        if final_response_started:
                            await websocket.send_json({"thinking": "", "response": buffer, "done": False})
                        else:
                            await websocket.send_json({"thinking": buffer, "response": "", "done": False})
                        buffer = ""

                if buffer:
                    if final_response_started:
                        await websocket.send_json({"thinking": "", "response": buffer, "done": False})
                    else:
                        await websocket.send_json({"thinking": buffer, "response": "", "done": False})

                final_response = full_response.split("</think>\n\n")[-1].strip()
                await websocket.send_json(
                    {"thinking": "", "response": "", "done": True, "full_response": final_response}
                )

            else:
                # OpenAI API path
                if not settings.openai_api_key:
                    await websocket.send_json({"error": "OpenAI API key not configured"})
                    continue

                client = OpenAI(api_key=settings.openai_api_key)

                messages = [
                    {
                        "role": "system",
                        "content": "You are a helpful AI assistant that answers questions about video content.",
                    },
                    {"role": "user", "content": prompt},
                ]

                stream = client.chat.completions.create(model="gpt-4o-mini", messages=messages, stream=True)

                full_response = ""
                for chunk in stream:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_response += content
                        await websocket.send_json({"thinking": "", "response": content, "done": False})

                await websocket.send_json(
                    {"thinking": "", "response": "", "done": True, "full_response": full_response}
                )

    except WebSocketDisconnect:
        print("Client disconnected")
