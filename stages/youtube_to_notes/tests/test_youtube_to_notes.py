import json
import sys
import tempfile
import unittest
from pathlib import Path


STAGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STAGE_DIR))

import youtube_to_notes as subject


class MidiNoteNameTests(unittest.TestCase):
    def test_scientific_pitch_names(self):
        self.assertEqual(subject.midi_note_name(0), "C-1")
        self.assertEqual(subject.midi_note_name(60), "C4")
        self.assertEqual(subject.midi_note_name(127), "G9")

    def test_out_of_range_pitch_is_rejected(self):
        with self.assertRaises(ValueError):
            subject.midi_note_name(128)


class UrlTests(unittest.TestCase):
    def test_youtube_hosts(self):
        self.assertTrue(subject.is_youtube_url("https://youtu.be/abc"))
        self.assertTrue(subject.is_youtube_url("https://music.youtube.com/watch?v=abc"))

    def test_lookalike_and_non_http_hosts_are_rejected(self):
        self.assertFalse(subject.is_youtube_url("https://youtube.com.example.test/watch?v=abc"))
        self.assertFalse(subject.is_youtube_url("file://youtube.com/tmp/audio"))


class DocumentTests(unittest.TestCase):
    def test_events_are_normalized_and_sorted(self):
        events = [
            (1.0, 1.5, 64, 0.5, None),
            (0.0, 0.25, 60, 1.0, [0, 3]),
        ]
        notes = subject.normalize_note_events(events)
        self.assertEqual([note["pitch"] for note in notes], [60, 64])
        self.assertEqual(notes[0]["name"], "C4")
        self.assertEqual(notes[0]["velocity"], 127)
        self.assertEqual(notes[0]["pitch_bend"], [0, 3])
        self.assertEqual(notes[1]["duration"], 0.5)

    def test_document_matches_handoff_fields(self):
        settings = subject.TranscriptionSettings()
        document = subject.build_document(
            source={"kind": "local_audio", "path": "/tmp/test.wav"},
            note_events=[(0.0, 0.5, 60, 0.75, None)],
            tempo=100.0,
            tempo_source="user",
            tempo_estimated=False,
            settings=settings,
        )
        self.assertEqual(document["tempo"], 100.0)
        self.assertEqual(document["time_unit"], "seconds")
        self.assertEqual(document["channel"], 0)
        self.assertEqual(document["instrument"], 0)
        self.assertEqual(document["notes"][0]["pitch"], 60)

    def test_write_protects_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "notes.json"
            subject.write_document({"notes": []}, output, force=False)
            self.assertEqual(json.loads(output.read_text()), {"notes": []})
            with self.assertRaises(subject.PipelineError):
                subject.write_document({"notes": [1]}, output, force=False)
            subject.write_document({"notes": [1]}, output, force=True)
            self.assertEqual(json.loads(output.read_text()), {"notes": [1]})


if __name__ == "__main__":
    unittest.main()
