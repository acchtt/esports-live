import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

const CROP_PATTERN = /^\d+:\d+:\d+:\d+$/;

export function normalizeCrop(value) {
  const crop = String(value ?? '').trim();
  return crop && CROP_PATTERN.test(crop) ? crop : null;
}

export function buildFfmpegArgs({ streamUrl, outputPath, crop }) {
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', streamUrl,
    '-frames:v', '1'
  ];
  const normalizedCrop = normalizeCrop(crop);
  if (normalizedCrop) args.push('-vf', `crop=${normalizedCrop}`);
  args.push('-q:v', '3', outputPath);
  return args;
}

export async function captureFrame({
  streamUrl,
  outputPath,
  crop,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  timeoutMs = 12_000,
  spawnImpl = spawn
}) {
  if (!streamUrl?.trim()) throw new Error('A stream URL is required');
  const args = buildFfmpegArgs({ streamUrl: streamUrl.trim(), outputPath, crop });

  await new Promise((resolve, reject) => {
    const child = spawnImpl(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`FFmpeg capture timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr?.on('data', chunk => {
      stderr += String(chunk).slice(0, 2_000);
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with ${code}: ${stderr.trim()}`));
    });
  });

  const file = await stat(outputPath);
  return {
    outputPath,
    bytes: file.size,
    capturedAt: new Date().toISOString()
  };
}
