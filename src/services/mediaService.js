import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function writeTempFile(file, suffix = "") {
  const safeSuffix = suffix || "";
  const tempPath = `/tmp/edvolve-${Date.now()}-${Math.random().toString(16).slice(2)}${safeSuffix}`;
  await fs.writeFile(tempPath, file.buffer);
  return tempPath;
}

export async function cleanupFiles(paths) {
  await Promise.all(paths.filter(Boolean).map(async (filePath) => {
    try {
      await fs.unlink(filePath);
    } catch {
      // Temporary cleanup should not mask the request result.
    }
  }));
}

export async function hasVideoStream(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ], { timeout: 10000 });

    return stdout.trim() === "video";
  } catch {
    return false;
  }
}

export async function extractAudio(inputPath) {
  const outputPath = `${inputPath}_processed.wav`;
  const args = [
    "-i", inputPath,
    "-af", "afftdn=nf=-25,highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    outputPath
  ];

  try {
    await execFileAsync("ffmpeg", args);
    return outputPath;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("FFmpeg is not installed or is not available in PATH. Install ffmpeg to extract audio from video-only uploads, or use /api/answer_video_with_audio with a separate audio file.");
    }

    throw new Error(`FFmpeg audio extraction failed: ${error.stderr || error.message}`);
  }
}

export async function analyzeVideo(videoPath) {
  const containsVideo = await hasVideoStream(videoPath);

  if (!containsVideo) {
    return lowQualityMetrics();
  }

  return {
    ...lowQualityMetrics(),
    video_stream_detected: true,
    note: "Node.js port detected a video stream, but MediaPipe face-landmark scoring from the Python backend is not available in this runtime."
  };
}

export function lowQualityMetrics() {
  return {
    face_presence: 0.0,
    visibility: "poor",
    eye_contact: 0.0,
    attention: 0.0,
    stability: 0.0,
    quality_flag: "poor"
  };
}
