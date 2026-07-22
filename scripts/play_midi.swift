#!/usr/bin/env swift

import AVFoundation
import Foundation

func fail(_ message: String, status: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(status)
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: play_midi.swift /path/to/file.mid", status: 64)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)

guard FileManager.default.isReadableFile(atPath: path) else {
    fail("MIDI file is not readable: \(path)", status: 66)
}

let player: AVMIDIPlayer
do {
    // On macOS, a nil sound bank selects the system's default MIDI sound bank.
    player = try AVMIDIPlayer(contentsOf: url, soundBankURL: nil)
} catch {
    fail("Could not load MIDI file: \(error.localizedDescription)", status: 65)
}

guard player.duration.isFinite, player.duration >= 0 else {
    fail("The MIDI file reported an invalid duration.", status: 65)
}

player.prepareToPlay()

let completion = DispatchSemaphore(value: 0)
player.play {
    completion.signal()
}

completion.wait()
