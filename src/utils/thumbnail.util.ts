// https://github.com/tmfksoft/thumbnail-generator/blob/master/src/index.ts
import { rimraf } from 'rimraf';
import { mkdirp } from 'mkdirp';
import { stdout } from 'process';
import { Duration } from 'luxon';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import child_process from 'child_process';

import { parseProgress, progressPercent } from './ffmpeg-helper.util';
import { RejectCode } from '../enums/reject-code.enum';

interface GeneratorOptions {
  /** The source video file. Must be an FFMPEG supported video format. */
  source: string,

  /** The Output Folder */
  output: string,

  /** Length of the video in seconds. */
  duration: number,

  /** Path to FFmpeg Folder */
  ffmpegDir: string,

  jobId: string | number,

  canceledJobIds: (string | number)[],

  /** (Optional) The Thumbnail Width */
  tw?: number,
  /** (Optional) The Thumbnail Height */
  th?: number,

  /** (Optional) Output WebP Sprite Pages instead of PNG? */
  toWebp?: boolean,
}

interface GeneratorOutput {
  /** The total amount of Sprite Pages generated */
  pageCount: number,

  /** The total amount of frames present in the Sprite Pages */
  frameCount: number,

  vttPath: string,

  /** An array of the generated sprites in WebP or JPEG format. */
  spritePaths: string[],
}

export async function generateSprites(options: GeneratorOptions): Promise<GeneratorOutput> {

  const sourceFile = options.source;

  const tw = options.tw || 160;
  const th = options.th || 90;

  //const toWebp = options.toWebp || false;

  const outputPath = options.output;
  const tempPath = path.join(options.output, 'generated');

  // Make our directories
  await Promise.all([
    mkdirp(outputPath),
    mkdirp(tempPath)
  ]);

  let predicted = Math.ceil(options.duration);

  // Not 100% sure why the predicted is always 1 lower than the actual.
  //if (doLogging) console.log(`Predicting ${predicted} frames`);
  //console.log(`Predicting ${predicted} frames`);

  let frameCount = await generateThumbnails(sourceFile, tempPath, tw, th, options);

  //console.log(`Generated: ${f.length} frames.`);

  predicted = frameCount;

  let pageCols = 10;
  let pageRows = 10;

  if (predicted < pageCols) pageCols = predicted;

  let pageTotal = pageCols * pageRows;

  let pages = Math.ceil(predicted / (pageCols * pageRows));

  //console.log(`Predicting ${pages} pages.`);

  const output = {
    pageCount: pages,
    frameCount: predicted,
    spritePaths: [],
  } as GeneratorOutput;

  let vttString = 'WEBVTT';
  let vttStartTime = 0;
  let vttEndTime = 1;

  for (let pageID = 0; pageID < pages; pageID++) {

    // How many can we fit on this sheet?
    let remainder = predicted - (pageID * pageTotal);
    if (remainder > pageTotal) remainder = pageTotal;

    let width = Math.ceil(tw * pageCols);
    let height = Math.ceil(th * Math.ceil(remainder / pageRows));

    //console.log(`Canvas size: ${width} x ${height}`);

    let canvas = sharp({
      create: {
        width: width,
        height: height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    });

    const finalFilename = `M${pageID}.jpg`;

    //console.log(`Images left: ${remainder}`);

    const overlayThumbs: sharp.OverlayOptions[] = [];
    // Load and place the images.
    for (let i = 0; i < remainder; i++) {
      let offset = pageTotal * pageID;
      const frameNumber = offset + i + 1;
      let imagePath = path.join(tempPath, `thumb_${frameNumber}.png`);
      //console.log(`Loading ${imagePath}`);

      let dx = Math.floor((i % pageCols) * tw);
      let dy = Math.floor(i / pageCols) * th;

      //console.log(`Drawing thumb_${frameNumber}.png at ${dx}x${dy}`);

      overlayThumbs.push({ input: imagePath, top: dy, left: dx });

      //if (vttEndTime > options.duration) continue;
      const startTimeString = Duration.fromObject({ seconds: vttStartTime }).toISOTime();
      const endTimeString = Duration.fromObject({ seconds: vttEndTime }).toISOTime();
      vttString += '\n\n' + frameNumber;
      vttString += '\n' + startTimeString + ' --> ' + endTimeString;
      vttString += '\n' + `${finalFilename}#xywh=${dx},${dy},${tw},${th}`;
      vttStartTime++;
      vttEndTime++;
    }

    canvas.composite(overlayThumbs);

    // Generate the final image.
    const finalPath = path.join(outputPath, finalFilename);
    await canvas.jpeg().toFile(finalPath);

    output.spritePaths.push(finalPath);
  }

  // Save VTT file
  const finalVTTPath = path.join(outputPath, 'M.vtt');
  await fs.promises.writeFile(finalVTTPath, vttString);

  // Perform Clear up.
  //console.log(`Clearing away temporary output directory ${outputPath}`);
  await rimraf(tempPath);

  return output;
}

function generateThumbnails(inputFile: string, outputFolder: string, tw: number, th: number, options: GeneratorOptions) {
  return new Promise<number>((resolve, reject) => {
    let isCancelled = false;

    const args = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-vf', `fps=1/1,scale=${tw}:${th}`,
      '-qmin', '1',
      '-qscale:v', '1',
      '-f', 'image2',
      `"${outputFolder}/thumb_%d.png"`
    ];

    let generatedFrames = 0;

    const ffmpeg = child_process.spawn(`${options.ffmpegDir}/ffmpeg`, args, { shell: true });

    ffmpeg.stdout.setEncoding('utf8');
    ffmpeg.stdout.on('data', async (data: string) => {
      const progress = parseProgress(data);
      generatedFrames = progress.frame || 0;
      const percent = progressPercent(progress.outTimeMs, options.duration * 1000000);
      stdout.write(`Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime}\r`);
    });

    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (data) => {
      stdout.write(data);
    });

    const cancelledJobChecker = setInterval(() => {
      const index = options.canceledJobIds.findIndex(j => +j === +options.jobId);
      if (index === -1) return;

      options.canceledJobIds = options.canceledJobIds.filter(id => +id > +options.jobId);
      isCancelled = true;
      ffmpeg.stdin.write('q');
      ffmpeg.stdin.end();
    }, 5000)

    ffmpeg.on('exit', (code: number) => {
      stdout.write('\n');
      clearInterval(cancelledJobChecker);
      if (isCancelled) {
        reject(RejectCode.JOB_CANCEL);
      } else if (code !== 0) {
        reject(`FFmpeg exited with status code: ${code}`);
      } else {
        resolve(generatedFrames);
      }
    });
  });
}