import importlib.util
import io
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "play_midi.py"
SPEC = importlib.util.spec_from_file_location("play_midi", MODULE_PATH)
play_midi = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(play_midi)


def format_zero_midi() -> bytes:
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480)
    track_data = b"\x00\xff\x2f\x00"
    return header + b"MTrk" + struct.pack(">I", len(track_data)) + track_data


class ValidateMidiTests(unittest.TestCase):
    def write_fixture(self, data: bytes) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "fixture.mid"
        path.write_bytes(data)
        return path

    def test_accepts_minimal_format_zero_file(self):
        result = play_midi.validate_midi(self.write_fixture(format_zero_midi()))
        self.assertEqual(result, (0, 1, "480 ticks/quarter-note"))

    def test_rejects_non_midi_file(self):
        path = self.write_fixture(b"not midi")
        with self.assertRaisesRegex(play_midi.MidiValidationError, "missing MThd"):
            play_midi.validate_midi(path)

    def test_rejects_truncated_track(self):
        path = self.write_fixture(format_zero_midi()[:-1])
        with self.assertRaisesRegex(play_midi.MidiValidationError, "Truncated MIDI chunk data"):
            play_midi.validate_midi(path)

    def test_rejects_wrong_track_count(self):
        data = bytearray(format_zero_midi())
        data[10:12] = struct.pack(">H", 2)
        path = self.write_fixture(bytes(data))
        with self.assertRaisesRegex(play_midi.MidiValidationError, "exactly one track"):
            play_midi.validate_midi(path)

    def test_check_mode_validates_without_starting_player(self):
        path = self.write_fixture(format_zero_midi())
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--check", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Valid Standard MIDI: format 0", result.stdout)
        self.assertNotIn("Selected player", result.stdout)

    def test_dry_run_selects_backend_without_launching_it(self):
        path = self.write_fixture(format_zero_midi())
        output = io.StringIO()
        with (
            mock.patch.object(
                sys,
                "argv",
                ["play_midi.py", "--dry-run", "--player", "vlc", str(path)],
            ),
            mock.patch.object(
                play_midi,
                "player_commands",
                return_value={"vlc": ["fake-vlc", str(path)]},
            ),
            mock.patch.object(play_midi.subprocess, "run") as run,
            redirect_stdout(output),
        ):
            self.assertEqual(play_midi.main(), 0)
        run.assert_not_called()
        self.assertIn("Selected player: vlc", output.getvalue())
        self.assertIn("Command: fake-vlc", output.getvalue())


if __name__ == "__main__":
    unittest.main()
