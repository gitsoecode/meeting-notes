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

// Apple's voice processing (AEC + AGC + noise suppression) is on by
// default. It cancels speaker bleed at capture time when the user is
// recording with built-in speakers + built-in mic. The Settings → Audio
// toggle sets GISTLIST_DISABLE_VOICE_PROCESSING=1 when the user turns
// it off, which is also useful as an internal fallback if a future
// hardware combo turns out to be incompatible.
//
// Enabling VPIO changes the negotiated channel layout: on M-series
// MacBook Pros, the input bus exposes a 9-channel mic-array layout
// where channel 0 is the AEC-processed output. Downstream ffmpeg
// filter chains all demand `aformat=channel_layouts=mono`, so we
// extract channel 0 manually in the tap callback rather than letting
// AVAudioConverter average all channels (which dilutes the AEC).
// See the VPIO regression test in recording-live.test.mjs.
let voiceProcessingEnabled =
  ProcessInfo.processInfo.environment["GISTLIST_DISABLE_VOICE_PROCESSING"] != "1"
if voiceProcessingEnabled {
  if #available(macOS 10.15, *) {
    do {
      try input.setVoiceProcessingEnabled(true)
      stderr.write("VOICE_PROCESSING_ENABLED\n".data(using: .utf8)!)
    } catch {
      stderr.write("VOICE_PROCESSING_FAILED \(error)\n".data(using: .utf8)!)
    }
  } else {
    stderr.write("VOICE_PROCESSING_UNAVAILABLE\n".data(using: .utf8)!)
  }
} else {
  stderr.write("VOICE_PROCESSING_DISABLED_BY_ENV\n".data(using: .utf8)!)
}

// Tap format: whatever the bus delivers.
//
// IMPORTANT: read different format properties depending on whether
// VPIO is engaged. Reading `outputFormat(forBus: 0)` on a passthrough
// (no-VPIO) input node triggers extra initialization inside
// AVAudioEngine that adds ~500-800ms of startup warmup, which is
// enough to push the existing 3s-capture drop-rate test over its 15%
// budget. The pre-VPIO code path used `inputFormat`; preserve that
// exact behavior when VPIO is off so the baseline test stays green.
//
// With VPIO enabled the input node exposes a 9-channel non-interleaved
// float32 mic-array layout via outputFormat. Channel 0 is the
// AEC-processed mono output and channels 1-8 are the raw mic
// elements. We want the AEC output, so when VPIO is on we extract
// channel 0 manually in the tap callback rather than using
// AVAudioConverter (whose generic downmix averages all channels and
// dilutes the AEC result).
let tapFormat: AVAudioFormat = voiceProcessingEnabled
  ? input.outputFormat(forBus: 0)
  : input.inputFormat(forBus: 0)
let needsManualMonoExtract =
  tapFormat.channelCount > 1 && tapFormat.commonFormat == .pcmFormatFloat32
let monoFormat: AVAudioFormat = needsManualMonoExtract
  ? (AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: tapFormat.sampleRate,
      channels: 1,
      interleaved: false
    ) ?? tapFormat)
  : tapFormat
// File format always matches what we'll actually write, so
// AVAudioFile never silently drops buffers on a format mismatch.
let format = monoFormat

// PCM WAV at the input's native rate, with bit depth + float-vs-int
// derived from `format.commonFormat`. The settings must match the
// buffers we're going to hand AVAudioFile.write — int16 buffers need
// an int16 file, float32 buffers need a float file (32-bit). A
// mismatch causes write to silently drop every buffer. Downstream
// (engine drift correction + ASR normalization) re-encodes as needed,
// so float WAVs cost some disk space but no fidelity or compatibility.
let isFloat = format.commonFormat == .pcmFormatFloat32 || format.commonFormat == .pcmFormatFloat64
let bitDepth: Int = {
  switch format.commonFormat {
  case .pcmFormatInt16: return 16
  case .pcmFormatInt32: return 32
  case .pcmFormatFloat32: return 32
  case .pcmFormatFloat64: return 64
  default: return 16
  }
}()
let settings: [String: Any] = [
  AVFormatIDKey: kAudioFormatLinearPCM,
  AVSampleRateKey: format.sampleRate,
  AVNumberOfChannelsKey: format.channelCount,
  AVLinearPCMBitDepthKey: bitDepth,
  AVLinearPCMIsFloatKey: isFloat,
  AVLinearPCMIsBigEndianKey: false,
  AVLinearPCMIsNonInterleaved: !format.isInterleaved,
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

input.installTap(onBus: 0, bufferSize: 4096, format: tapFormat) { buffer, _ in
  // VPIO on M-series MBPs delivers 9-channel float32 buffers where
  // channel 0 is the AEC-processed output and channels 1-8 are the raw
  // mic-array elements. We want channel 0 — that's what enabling VPIO
  // is for. We copy it into a fresh mono buffer rather than using
  // AVAudioConverter, which by default averages all channels and
  // dilutes the AEC result (the average across a near-silent AEC
  // channel and 8 raw-mic channels reads as low-volume mush).
  let frameCount = buffer.frameLength
  let toWrite: AVAudioPCMBuffer
  if needsManualMonoExtract {
    guard let monoBuf = AVAudioPCMBuffer(
      pcmFormat: monoFormat,
      frameCapacity: frameCount > 0 ? frameCount : 4096
    ) else { return }
    guard
      let srcChannels = buffer.floatChannelData,
      let dstChannels = monoBuf.floatChannelData,
      frameCount > 0
    else { return }
    let dst = dstChannels[0]
    let src = srcChannels[0]
    dst.update(from: src, count: Int(frameCount))
    monoBuf.frameLength = frameCount
    toWrite = monoBuf
  } else {
    toWrite = buffer
  }
  writeQueue.async {
    if !firstSamplePrinted {
      firstSamplePrinted = true
      stderr.write("FIRST_SAMPLE\n".data(using: .utf8)!)
    }
    do {
      try outFile?.write(from: toWrite)
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
