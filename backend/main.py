import os
import uuid
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from utils import process_video, search_transcript

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Your frontend URL
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

VIDEO_DATA = {}

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    try:
        # Generate unique ID
        video_id = str(uuid.uuid4())
        os.makedirs(f"uploads/{video_id}", exist_ok=True)
        
        # Save video file
        video_path = f"uploads/{video_id}/video.mp4"
        with open(video_path, "wb") as f:
            f.write(await file.read())
        
        # Process video
        transcript_data = process_video(video_path)
        VIDEO_DATA[video_id] = transcript_data
        
        return JSONResponse({
            "id": video_id,
            "message": "Video processed successfully"
        })
    except Exception as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=500
        )

@app.post("/search/{video_id}")
async def search_video(video_id: str, query: str):
    if video_id not in VIDEO_DATA:
        return JSONResponse(
            {"error": "Video not found"},
            status_code=404
        )
    
    results = search_transcript(VIDEO_DATA[video_id], query)
    return {"results": results}

# Bonus: WebSocket Chat
@app.websocket("/chat/{video_id}")
async def websocket_endpoint(websocket: WebSocket, video_id: str):
    await websocket.accept()
    try:
        while True:
            query = await websocket.receive_text()
            if video_id not in VIDEO_DATA:
                await websocket.send_json({"error": "Video not found"})
                continue
            
            # Simple demo response
            result = search_transcript(VIDEO_DATA[video_id], query)
            response = f"Found at {result[0]['timestamp']}: {result[0]['text']}"
            await websocket.send_json({"response": response})
    except WebSocketDisconnect:
        print("Client disconnected")