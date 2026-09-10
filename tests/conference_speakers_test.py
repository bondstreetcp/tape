import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from importlib import import_module
align = import_module("align-conference-speakers").align

class SpeakerAlignmentTests(unittest.TestCase):
    def test_zero_duration_words_inside_speech_are_not_unknown(self):
        raw = "Hello there.\n\nThanks for joining."
        timed = {"transcription":[
            {"text":"Hello there.","offsets":{"from":1000,"to":1000}},
            {"text":"Thanks for joining.","offsets":{"from":4000,"to":5000}}]}
        result = align(raw,timed,[{"start":0,"end":2,"speaker":"speaker_0"},{"start":3,"end":6,"speaker":"speaker_1"}])
        self.assertEqual([t["speaker"] for t in result["turns"]],["speaker_0","speaker_1"])
        self.assertEqual(" ".join(t["text"] for t in result["turns"]),"Hello there. Thanks for joining.")

    def test_overlapping_voices_remain_unidentified(self):
        timed={"transcription":[{"text":"Hello there","offsets":{"from":1000,"to":2000}}]}
        result=align("Hello there",timed,[{"start":0,"end":3,"speaker":"speaker_0"},{"start":0,"end":3,"speaker":"speaker_1"}])
        self.assertEqual(result["turns"][0]["speaker"],"unknown")

    def test_wrong_transcript_is_rejected(self):
        with self.assertRaises(ValueError):
            align("Completely different words",{"transcription":[{"text":"Revenue grew ten percent","offsets":{"from":0,"to":5000}}]},[{"start":0,"end":6,"speaker":"speaker_0"}])

if __name__ == "__main__": unittest.main()
