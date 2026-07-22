import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "stages" / "youtube_to_notes"))
sys.path.insert(0, str(ROOT / "scripts"))

import notes_to_midi  # noqa: E402
import play_midi  # noqa: E402
import youtube_to_notes  # noqa: E402


class PipelineIntegrationTests(unittest.TestCase):
    def test_transcription_handoff_converts_and_validates(self):
        document = youtube_to_notes.build_document(
            source={"kind": "test_fixture", "title": "C major arpeggio"},
            note_events=[
                (0.0, 0.25, 60, 0.8, None),
                (0.25, 0.5, 64, 0.8, None),
                (0.5, 1.0, 67, 0.8, None),
            ],
            tempo=120.0,
            tempo_source="test_fixture",
            tempo_estimated=False,
            settings=youtube_to_notes.TranscriptionSettings(),
        )

        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            notes_path = directory_path / "notes.json"
            midi_path = directory_path / "transcription.mid"
            notes_path.write_text(json.dumps(document), encoding="utf-8")

            note_count = notes_to_midi.convert_file(notes_path, midi_path)
            midi_format, track_count, timing = play_midi.validate_midi(midi_path)

        self.assertEqual(note_count, 3)
        self.assertEqual((midi_format, track_count), (0, 1))
        self.assertEqual(timing, "480 ticks/quarter-note")


if __name__ == "__main__":
    unittest.main()
