# Conference speaker turns

Whisper supplies speech text and timing. A separate local sherpa-onnx pass clusters the voices in the original audio. The alignment step matches the timed words back to the original saved transcript, preserves every original word, and leaves overlapping/ambiguous speech unidentified. It rejects alignment when fewer than 85% of the original words match timed ASR. Names require reviewed evidence from introductions and conversational handoffs; a voice cluster alone does not identify a person.

Install `sherpa-onnx==1.13.8`, `soundfile==0.13.1`, and NumPy in a dedicated Python environment on the Mac. The [sherpa-onnx model documentation](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html) describes the segmentation and speaker embedding models. Add this block to the Mac runner config (adjust absolute paths):

```json
{
  "diarization": {
    "python": "/Users/YOUR_USER/TapeConferenceWorker/.conference-runner/diarization-venv/bin/python",
    "segmentationModel": "/Users/YOUR_USER/TapeConferenceWorker/.conference-runner/diarization-models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
    "embeddingModel": "/Users/YOUR_USER/TapeConferenceWorker/.conference-runner/diarization-models/wespeaker_en_voxceleb_resnet34_LM.onnx",
    "threshold": 0.8
  }
}
```

The runner invokes speaker processing at the transcript checkpoint, before new AI summaries. Existing saved raw transcripts can also be enriched separately:

```sh
npm run conference:speakers -- 1769358 1773017
```

`speakers/settings.json` within a talk directory can specify a known `numSpeakers` and reviewed voice labels. Do not infer the number of audible voices solely from an attendee roster. Without a supplied count, clustering estimates it. Example structure (cluster IDs are recording-specific):

```json
{
  "numSpeakers": 4,
  "labels": {
    "speaker_0": {
      "name": "Moderator",
      "role": "Analyst at Barclays",
      "evidence": "An exact source passage supporting this attribution"
    }
  }
}
```

Labels without exact source evidence are rejected. Unknown clusters display numbered speakers with unconfirmed identities. Automated clustering can confuse similar voices and brief interjections: inspect the aligned turns against explicit handoffs before assigning names or publishing. Store the reviewed labels with the recording so reruns are repeatable.

When clustering merges different people, `settings.json` supports `reviewedBoundaries: { sourceHash, turns: [{ start, speaker }] }`. Each `start` is an exact, ordered source fragment, `speaker` references a reviewed label (or `unknown`), and `sourceHash` is the SHA-256 of the original raw transcript. Boundaries must begin at character zero and cover the entire source without changing words. These are contextual corrections, not an assertion that the acoustic model identified the person. Freshpet's pilot uses this path because the tested acoustic models merged some male voices; short ambiguous greetings remain unidentified. The raw acoustic output is retained for inspection.

Outputs: `transcript.speakers.txt`, audio intervals, word alignment, and provenance under `speakers/`. The original `transcript.txt` is preserved. Speaker processing uses a per-talk lock. The archive importer recognizes the labeled transcript and verifies its raw-source hash; it can replace an existing unlabeled conference record while preserving the summary. Ship both raw/labeled text and `speakers/completed.json` when publishing.
