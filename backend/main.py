import os
import uuid

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mlx_lm import load, stream_generate

from utils import process_video, search_transcript

app = FastAPI()

# Load the MLX model instead of vLLM
print("Loading MLX model...")
model, tokenizer = load("deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_DATA = {}


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    try:
        video_id = str(uuid.uuid4())
        os.makedirs(f"uploads/{video_id}", exist_ok=True)

        video_path = f"uploads/{video_id}/video.mp4"
        with open(video_path, "wb") as f:
            f.write(await file.read())

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
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_text()
            
            if video_id not in VIDEO_DATA:
                await websocket.send_json({"error": "Video not found"})
                continue

            transcript = "\n".join([
                f"[{seg['start']:.2f}s - {seg['end']:.2f}s]: {seg['text']}"
                for seg in VIDEO_DATA[video_id]
            ])
            
            prompt = f"""You are a helpful AI assistant that answers questions about video content. 
You will be given a video transcript and a question. Please provide a clear, concise response based on the video content.
If you're unsure about something, say so rather than making assumptions.

Video Transcript:
{transcript}

Question: {message}

Please provide a helpful response based on the video content."""

            # Apply chat template if available
            if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template is not None:
                messages = [{"role": "user", "content": prompt}]
                prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

            # Stream the response
            full_response = ""
            thinking_mode = False
            thinking_content = ""
            
            for response in stream_generate(model, tokenizer, prompt, max_tokens=1024):  # Increased max_tokens
                text = response.text
                full_response += text
                
                # Check for thinking tags
                if "<think>" in text:
                    thinking_mode = True
                    continue
                elif "</think>" in text:
                    thinking_mode = False
                    await websocket.send_json({
                        "response": "",
                        "thinking": thinking_content,
                        "done": False
                    })
                    thinking_content = ""
                    continue
                
                if thinking_mode:
                    thinking_content += text
                    await websocket.send_json({
                        "response": "",
                        "thinking": text,
                        "done": False
                    })
                else:
                    await websocket.send_json({
                        "response": text,
                        "thinking": "",
                        "done": False
                    })

            # Get the final response (everything after the last </think> tag)
            final_response = full_response.split("</think>")[-1].strip()
            
            # Send final message with complete response
            await websocket.send_json({
                "response": "",
                "thinking": "",
                "done": True,
                "full_response": final_response
            })

    except WebSocketDisconnect:
        print("Client disconnected")
