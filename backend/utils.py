import ffmpeg
import whisper
import numpy as np
from sentence_transformers import SentenceTransformer
from typing import List, Dict

model = whisper.load_model("base")
sentence_model = SentenceTransformer('all-MiniLM-L6-v2')

def process_video(video_path: str) -> List[Dict]:
    # Check duration
    probe = ffmpeg.probe(video_path)
    duration = float(probe['format']['duration'])
    if duration > 180:  # 3 minutes
        raise ValueError("Video exceeds 3 minute limit")
    
    # Extract audio
    audio_path = video_path.replace(".mp4", ".wav")
    ffmpeg.input(video_path).output(audio_path, acodec='pcm_s16le', ar='16000').run()
    
    # Transcribe
    result = model.transcribe(audio_path)
    segments = result["segments"]
    
    # Generate embeddings
    texts = [seg['text'] for seg in segments]
    embeddings = sentence_model.encode(texts)
    
    # Prepare data
    return [{
        "start": seg['start'],
        "end": seg['end'],
        "text": seg['text'],
        "embedding": emb.tolist()
    } for seg, emb in zip(segments, embeddings)]

def search_transcript(data: List[Dict], query: str, top_k: int = 3) -> List[Dict]:
    # Encode query
    query_embedding = sentence_model.encode([query])[0]
    
    # Calculate similarities
    similarities = []
    for segment in data:
        seg_embedding = np.array(segment["embedding"])
        sim = np.dot(query_embedding, seg_embedding) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(seg_embedding))
        similarities.append(sim)
    
    # Get top results
    sorted_indices = np.argsort(similarities)[::-1][:top_k]
    return [data[i] for i in sorted_indices]