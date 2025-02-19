import os
import uuid

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mlx_lm import load, stream_generate
from utils import process_video, search_transcript

app = FastAPI()

print("Loading MLX model...")
model, tokenizer = load("deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B")

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
async def websocket_endpoint(websocket: WebSocket, video_id: str):
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
                [f"[{seg['start']:.2f}s - {seg['end']:.2f}s]: {seg['enhanced_text']}" 
                 for seg in VIDEO_DATA[video_id]]
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

            # Apply chat template if available
            if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template is not None:
                messages = [{"role": "user", "content": prompt}]
                prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

            # Stream response with separate thinking/response phases
            full_response = ""
            buffer = ""
            final_response_started = False

            for response in stream_generate(model, tokenizer, prompt, max_tokens=1024):
                chunk = response.text
                full_response += chunk

                # Detect transition from thinking to final response
                if "\n\nThe" in chunk and not final_response_started:
                    final_response_started = True
                    if buffer:
                        await websocket.send_json({"thinking": buffer, "response": "", "done": False})
                        buffer = ""

                # Buffer output for smoother streaming
                buffer += chunk
                if len(buffer) > 20:  # Send in reasonable chunks
                    if final_response_started:
                        await websocket.send_json({"thinking": "", "response": buffer, "done": False})
                    else:
                        await websocket.send_json({"thinking": buffer, "response": "", "done": False})
                    buffer = ""

            # Send any remaining buffered content
            if buffer:
                if final_response_started:
                    await websocket.send_json({"thinking": "", "response": buffer, "done": False})
                else:
                    await websocket.send_json({"thinking": buffer, "response": "", "done": False})

            # Extract and send final response
            final_response = full_response.split("\n\nThe")[-1].strip()
            await websocket.send_json(
                {"thinking": "", "response": "", "done": True, "full_response": "The " + final_response}
            )

    except WebSocketDisconnect:
        print("Client disconnected")
