// mic-capture — minimal CoreAudio mic capture helper.
//
// Replaces ffmpeg's AVFoundation audio demuxer for microphone capture.
// That demuxer drops ~10–12 % of samples continuously on USB
// microphones under macOS 14+; this helper uses AVAudioEngine directly
// and only loses a fixed ~300–500 ms at startup (before the hardware
// begins delivering buffers), which our drift-correction step stretches
// back to wall-clock.
//
// Usage:
//   mic-capture <output.wav>
//
// Stops on SIGINT/SIGTERM. Prints status lines on stderr so the parent
// process can anchor a first-sample timestamp:
//   ENGINE_STARTED      — engine.start() returned successfully
//   FIRST_SAMPLE        — the first tap callback fired (≈ first-sample
//                         arrival, within one buffer of ground truth)
//   SHUTDOWN_COMPLETE   — file has been flushed and closed
//
// Dependencies: system-only (AVFAudio, Foundation, Dispatch, Swift
// runtime). No third-party dylibs, no Homebrew.

import AVFoundation
import Foundation

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(
    "usage: mic-capture <output.wav>\n".data(using: .utf8)!)
  exit(2)
}
let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])

let stderr = FileHandle.standardError

let engine = AVAudioEngine()
let input = engine.inputNode

// Toggle Apple's voice processing (AEC + AGC + noise suppression) before
// reading the input format — enabling it can change the negotiated sample
// rate / channel count. The Node side passes
// GISTLIST_DISABLE_VOICE_PROCESSING=1 when the user has turned the
// Settings → Audio toggle off; otherwise voice processing is enabled.
// All four resolved states are logged so support can tell from run.log
// which path the helper actually took.
let voiceProcessingDisabled =
  ProcessInfo.processInfo.environment["GISTLIST_DISABLE_VOICE_PROCESSING"] == "1"
if voiceProcessingDisabled {
  stderr.write("VOICE_PROCESSING_DISABLED_BY_ENV\n".data(using: .utf8)!)
} else if #available(macOS 10.15, *) {
  do {
    try input.setVoiceProcessingEnabled(true)
    stderr.write("VOICE_PROCESSING_ENABLED\n".data(using: .utf8)!)
  } catch {
    stderr.write("VOICE_PROCESSING_FAILED \(error)\n".data(using: .utf8)!)
  }
} else {
  stderr.write("VOICE_PROCESSING_UNAVAILABLE\n".data(using: .utf8)!)
}

let format = input.inputFormat(forBus: 0)

// Write 16-bit PCM WAV at the input's native rate. Downstream (engine
// drift correction + ASR normalization) re-samples as needed.
let settings: [String: Any] = [
  AVFormatIDKey: kAudioFormatLinearPCM,
  AVSampleRateKey: format.sampleRate,
  AVNumberOfChannelsKey: format.channelCount,
  AVLinearPCMBitDepthKey: 16,
  AVLinearPCMIsFloatKey: false,
  AVLinearPCMIsBigEndianKey: false,
  AVLinearPCMIsNonInterleaved: false,
]

var outFile: AVAudioFile?
do {
  outFile = try AVAudioFile(forWriting: outputURL, settings: settings)
} catch {
  FileHandle.standardError.write(
    "failed to open output file: \(error)\n".data(using: .utf8)!)
  exit(3)
}

var firstSamplePrinted = false
let writeQueue = DispatchQueue(label: "mic-capture.writer")

input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
  // AVAudioPCMBuffer is retained by reference; cross-queue dispatch is
  // safe without a deep copy.
  let captured = buffer
  writeQueue.async {
    if !firstSamplePrinted {
      firstSamplePrinted = true
      stderr.write("FIRST_SAMPLE\n".data(using: .utf8)!)
    }
    do {
      try outFile?.write(from: captured)
    } catch {
      // best-effort; tolerate a transient disk blip rather than crash
    }
  }
}

// Ignore default signal disposition so the DispatchSource can deliver
// shutdown to the main queue (signal handlers can't safely call into
// AVFoundation / close files).
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

let sigIntSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let sigTermSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)

func gracefulShutdown() {
  // Remove the tap first so no further buffers get queued.
  input.removeTap(onBus: 0)
  engine.stop()

  // Drain any in-flight writes that the tap enqueued before shutdown,
  // then release the file (AVAudioFile flushes & closes the WAV header
  // on deinit) before exiting.
  writeQueue.sync {
    outFile = nil
  }
  stderr.write("SHUTDOWN_COMPLETE\n".data(using: .utf8)!)
  exit(0)
}

sigIntSrc.setEventHandler(handler: gracefulShutdown)
sigTermSrc.setEventHandler(handler: gracefulShutdown)
sigIntSrc.resume()
sigTermSrc.resume()

do {
  try engine.start()
  stderr.write("ENGINE_STARTED\n".data(using: .utf8)!)
} catch {
  stderr.write("failed to start engine: \(error)\n".data(using: .utf8)!)
  exit(4)
}

RunLoop.main.run()
