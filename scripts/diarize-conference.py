"""Audio-only speaker clustering; identities are assigned separately from transcript evidence.
Requires sherpa-onnx==1.13.8, soundfile==0.13.1 and numpy in a dedicated venv.
"""
import argparse
import json
from pathlib import Path
import soundfile as sf
import sherpa_onnx

def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("output")
    p.add_argument("--segmentation", required=True)
    p.add_argument("--embedding", required=True)
    p.add_argument("--speakers", type=int, default=-1)
    p.add_argument("--threshold", type=float, default=0.5)
    args = p.parse_args()
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=args.segmentation), num_threads=2),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=args.embedding, num_threads=2),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=args.speakers, threshold=args.threshold),
        min_duration_on=0.3, min_duration_off=0.5)
    if not config.validate():
        raise ValueError("Invalid diarization model configuration")
    diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, rate = sf.read(args.audio, dtype="float32", always_2d=True)
    if rate != diarizer.sample_rate or samples.shape[1] != 1:
        raise ValueError("Expected 16kHz mono WAV; convert with FFmpeg first")
    last = -1
    def progress(done, total):
        nonlocal last
        step = int(10 * done / total)
        if step != last:
            print(f"Speaker segmentation {step * 10}%", flush=True)
            last = step
        return 0
    results = diarizer.process(samples[:, 0], callback=progress).sort_by_start_time()
    intervals = [{"start": r.start, "end": r.end, "speaker": f"speaker_{r.speaker}"} for r in results]
    if not intervals:
        raise ValueError("No speech found")
    output = Path(args.output)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps({"version": 1, "method": "sherpa-onnx", "intervals": intervals}, indent=2))
    temporary.replace(output)
    print(f"Saved {len(intervals)} speech intervals, {len(set(r['speaker'] for r in intervals))} speaker clusters", flush=True)

if __name__ == "__main__":
    main()
