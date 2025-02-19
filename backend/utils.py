import os
from typing import Any, Dict, List

import cv2
import ffmpeg
import numpy as np
import whisper
from sentence_transformers import SentenceTransformer
from ultralytics import YOLO

whisper_model = whisper.load_model("base")
sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
yolo_model = YOLO("yolo11n.pt")


def extract_frames(video_path: str, output_dir: str, interval: float = 1.0) -> List[str]:
    """Extract frames from video at specified interval."""
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = int(fps * interval)
    frame_paths = []

    frame_count = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % frame_interval == 0:
            frame_path = f"{output_dir}/frame_{frame_count / fps:.1f}s.jpg"
            cv2.imwrite(frame_path, frame)
            frame_paths.append(frame_path)

        frame_count += 1

    cap.release()
    return frame_paths


def analyze_frames(frame_paths: List[str]) -> List[Dict]:
    """Run YOLO on frames and return detections."""
    frame_analyses = []

    for frame_path in frame_paths:
        # Get timestamp from filename
        timestamp = float(frame_path.split("_")[-1].replace("s.jpg", ""))

        # Run YOLO
        results = yolo_model(frame_path)

        # Extract detections
        detections = []
        for r in results[0].boxes.data:
            x1, y1, x2, y2, conf, cls = r.tolist()
            class_name = yolo_model.names[int(cls)]
            if conf > 0.3:  # Confidence threshold
                detections.append({"class": class_name, "confidence": conf})

        frame_analyses.append({"timestamp": timestamp, "detections": detections})

    return frame_analyses


def process_video(video_path: str) -> List[Dict[str, Any]]:
    """
    Process video for both audio and visual content.

    Args:
        video_path: Path to the video file

    Returns:
        List of processed segments with transcripts and visual context

    Raises:
        ValueError: If video file is invalid
        RuntimeError: If processing fails
    """
    # Create directory for frames
    video_dir = os.path.dirname(video_path)
    frames_dir = os.path.join(video_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    # Extract and analyze frames
    frame_paths = extract_frames(video_path, frames_dir)
    frame_analyses = analyze_frames(frame_paths)

    # Extract audio and transcribe
    audio_path = video_path.replace(".mp4", ".wav")
    ffmpeg.input(video_path).output(audio_path, acodec="pcm_s16le", ar="16000").run()

    # Transcribe
    result = whisper_model.transcribe(audio_path)
    segments = result["segments"]

    # Prepare combined data
    processed_data = []
    for seg in segments:
        # Find visual detections that occur during this segment
        segment_detections = [
            analysis["detections"] for analysis in frame_analyses if seg["start"] <= analysis["timestamp"] <= seg["end"]
        ]

        # Flatten detections and count occurrences
        objects_seen = {}
        for detections in segment_detections:
            for det in detections:
                obj = det["class"]
                objects_seen[obj] = objects_seen.get(obj, 0) + 1

        # Create enhanced text that combines transcript and visual information
        visual_context = ""
        if objects_seen:
            objects_desc = ", ".join(f"{obj} ({count}x)" for obj, count in objects_seen.items())
            visual_context = f" [Visual context: {objects_desc}]"

        enhanced_text = seg["text"] + visual_context

        # Generate embedding for the enhanced text
        embedding = sentence_model.encode(enhanced_text)

        processed_data.append(
            {
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"],
                "visual_context": visual_context,
                "enhanced_text": enhanced_text,
                "embedding": embedding.tolist(),
            }
        )

    # Cleanup
    os.remove(audio_path)
    for frame_path in frame_paths:
        os.remove(frame_path)
    os.rmdir(frames_dir)

    return processed_data


def search_transcript(data: List[Dict[str, Any]], query: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """
    Search through the enhanced transcript data.

    Args:
        data: List of processed video segments
        query: Search query string
        top_k: Number of results to return

    Returns:
        List of matching segments with similarity scores
    """
    query_embedding = sentence_model.encode([query])[0]

    # Calculate similarities
    similarities = []
    for segment in data:
        seg_embedding = np.array(segment["embedding"])
        sim = np.dot(query_embedding, seg_embedding) / (np.linalg.norm(query_embedding) * np.linalg.norm(seg_embedding))
        similarities.append(sim)

    # Get top results
    sorted_indices = np.argsort(similarities)[::-1][:top_k]
    return [
        {
            "start": data[i]["start"],
            "end": data[i]["end"],
            "text": data[i]["text"],
            "visual_context": data[i]["visual_context"],
            "similarity": similarities[i],
        }
        for i in sorted_indices
    ]
