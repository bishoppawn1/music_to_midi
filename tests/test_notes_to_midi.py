import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from notes_to_midi import ConversionError, build_midi, note_name_to_midi  # noqa: E402


class NotesToMidiTests(unittest.TestCase):
    def test_note_names(self):
        self.assertEqual(note_name_to_midi("C4"), 60)
        self.assertEqual(note_name_to_midi("F#3"), 54)
        self.assertEqual(note_name_to_midi("Db5"), 73)

    def test_builds_format_zero_midi_from_seconds(self):
        midi, count = build_midi(
            {
                "tempo": 120,
                "time_unit": "seconds",
                "instrument": 40,
                "notes": [
                    {"name": "C4", "start": 0, "duration": 0.5, "velocity": 100},
                    {"pitch": 64, "start": 0.5, "duration": 0.5},
                ],
            }
        )
        self.assertEqual(count, 2)
        self.assertEqual(midi[:4], b"MThd")
        self.assertEqual(struct.unpack(">HHH", midi[8:14]), (0, 1, 480))
        self.assertIn(bytes((0xC0, 40)), midi)
        self.assertIn(bytes((0x90, 60, 100)), midi)
        self.assertIn(bytes((0x90, 64, 96)), midi)
        self.assertTrue(midi.endswith(b"\x00\xff\x2f\x00"))

    def test_explicit_beat_fields(self):
        midi, count = build_midi(
            {
                "tempo": 90,
                "notes": [{"pitch_midi": 69, "start_beats": 1, "duration_beats": 2}],
            }
        )
        self.assertEqual(count, 1)
        self.assertIn(bytes((0x90, 69, 96)), midi)

    def test_rejects_same_pitch_overlap(self):
        with self.assertRaisesRegex(ConversionError, "overlaps"):
            build_midi(
                {
                    "tempo": 120,
                    "time_unit": "beats",
                    "notes": [
                        {"pitch": 60, "start": 0, "duration": 2},
                        {"pitch": 60, "start": 1, "duration": 2},
                    ],
                }
            )

    def test_cli_writes_file(self):
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            input_path = directory_path / "notes.json"
            output_path = directory_path / "result.mid"
            input_path.write_text(
                json.dumps(
                    {
                        "tempo": 120,
                        "time_unit": "seconds",
                        "notes": [{"pitch": "A4", "start": 0, "duration": 0.25}],
                    }
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "notes_to_midi.py"),
                    "--input",
                    str(input_path),
                    "--output",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output_path.read_bytes().startswith(b"MThd"))


if __name__ == "__main__":
    unittest.main()
