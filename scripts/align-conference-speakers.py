"""Keep the original transcript's words; align them to timed ASR and audio speaker clusters."""
import argparse
import difflib
import json
import re
from pathlib import Path

def normalize(word):
    return re.sub(r"[^\w]", "", word.casefold())

def align(raw, whisper, intervals):
    words = list(re.finditer(r"\S+", raw))
    timed = []
    for segment in whisper["transcription"]:
        parts = segment["text"].split()
        start, end = segment["offsets"]["from"] / 1000, segment["offsets"]["to"] / 1000
        for i, word in enumerate(parts):
            timed.append((word, start + (end-start)*i/len(parts), start+(end-start)*(i+1)/len(parts)))
    if not words or not timed or not intervals:
        raise ValueError("Missing transcript, timestamps or speaker intervals")
    matches = difflib.SequenceMatcher(None, [normalize(w.group()) for w in words], [normalize(w[0]) for w in timed], autojunk=False)
    anchors = {}
    for a, b, size in matches.get_matching_blocks():
        for k in range(size):
            anchors[a+k] = (timed[b+k][1], timed[b+k][2])
    coverage = len(anchors) / len(words)
    if coverage < 0.85:
        raise ValueError(f"Timed ASR differs too much from original transcript ({coverage:.1%} matched)")
    turns = []
    for index, word in enumerate(words):
        stamp = anchors.get(index)
        # Unmatched ASR words remain explicit unknowns unless bounded by nearby matched words.
        if stamp is None:
            before = next((anchors[i][1] for i in range(index-1, max(-1,index-12), -1) if i in anchors), None)
            after = next((anchors[i][0] for i in range(index+1, min(len(words),index+12)) if i in anchors), None)
            stamp = (before, after) if before is not None and after is not None and 0 <= after-before <= 5 else None
        speaker = "unknown"
        if stamp:
            start, end = stamp
            overlaps = sorted(((max(0, min(end,r["end"])-max(start,r["start"])),r["speaker"]) for r in intervals), reverse=True)
            if overlaps and overlaps[0][0] > 0:
                # Don't assign ambiguous overlapped voices to a named individual.
                if len(overlaps) < 2 or overlaps[1][1] == overlaps[0][1] or overlaps[1][0] < overlaps[0][0]*0.8:
                    speaker = overlaps[0][1]
            else:
                midpoint = (start+end)/2
                containing = {r["speaker"] for r in intervals if r["start"] <= midpoint <= r["end"]}
                if len(containing) == 1:
                    speaker = containing.pop()
                elif not containing:
                    nearest = min(intervals,key=lambda r:min(abs(midpoint-r["start"]),abs(midpoint-r["end"])))
                    if min(abs(midpoint-nearest["start"]),abs(midpoint-nearest["end"])) < 0.6:
                        speaker = nearest["speaker"]
        if turns and turns[-1]["speaker"] == speaker:
            turns[-1]["to"] = word.end()
        else:
            turns.append({"speaker": speaker, "from": word.start(), "to": word.end(), "start": stamp[0] if stamp else None})
    for turn in turns:
        turn["text"] = raw[turn["from"]:turn["to"]]
    assert " ".join(" ".join(t["text"].split()) for t in turns) == " ".join(raw.split())
    return {"version":1, "method":"audio-diarization-aligned-to-original-text", "matchedWordFraction":coverage, "turns":turns}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("transcript"); p.add_argument("whisper"); p.add_argument("diarization"); p.add_argument("output")
    args = p.parse_args()
    result = align(Path(args.transcript).read_text(), json.loads(Path(args.whisper).read_text()), json.loads(Path(args.diarization).read_text())["intervals"])
    out = Path(args.output); tmp = out.with_suffix(out.suffix+".tmp")
    tmp.write_text(json.dumps(result,indent=2)); tmp.replace(out)
    print(f"Aligned {len(result['turns'])} turns; {result['matchedWordFraction']:.1%} of words anchored; original words preserved")
if __name__ == "__main__": main()
