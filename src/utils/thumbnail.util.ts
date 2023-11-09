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
import { fileExists } from './file-helper.util';

type OutputImageFormat = 'webp' | 'jpeg' | 'avif';

interface InputOptions {
  /** The source video file. Must be an FFMPEG supported video format. */
  source: string;

  /** The Output Folder */
  output: string;

  /** Length of the video in seconds. */
  duration: number;

  /** Path to FFmpeg Folder */
  ffmpegDir: string;

  jobId: string | number;

  canceledJobIds: (string | number)[];
}

interface GeneratorOptions {
  /** (Optional) The Thumbnail Width */
  tw?: number;

  /** (Optional) The Thumbnail Height */
  th?: number;

  /** (Optional) Total column */
  pageCols?: number;

  /** (Optional) Total rows */
  pageRows?: number;

  /** (Optional) Output file name prefix */
  prefix?: string;

  /** (Optional) Output WebP Sprite Pages or JPEG? */
  format?: OutputImageFormat;
}

interface GeneratorOutput {
  /** The total amount of Sprite Pages generated */
  pageCount: number;

  /** The total amount of frames present in the Sprite Pages */
  frameCount: number;

  //vttPath: string;

  /** An array of the generated sprites in WebP or JPEG format. */
  spritePaths: string[];
}

const defaultGeneratorOptions: GeneratorOptions = {
  tw: 160,
  th: 160,
  pageCols: 10,
  pageRows: 10,
  prefix: 'M',
  format: 'jpeg'
};

export async function generateSprites(options: InputOptions, generatorOptionsList: GeneratorOptions[] = []): Promise<GeneratorOutput> {
  if (!generatorOptionsList.length) {
    generatorOptionsList = [{ ...defaultGeneratorOptions }];
  } else {
    generatorOptionsList = generatorOptionsList.map(options => ({ ...defaultGeneratorOptions, ...options }));
  }

  const sourceFile = options.source;

  const outputPath = options.output;
  const tempPath = path.join(options.output, 'generated');

  // Make our directories
  await Promise.all([
    mkdirp(outputPath),
    mkdirp(tempPath)
  ]);

  const maxThumbSize = Math.max(...generatorOptionsList.map(o => o.th), ...generatorOptionsList.map(o => o.tw));
  const maxWidth = maxThumbSize;
  const maxHeight = maxThumbSize;

  let predicted = Math.ceil(options.duration);

  // Not 100% sure why the predicted is always 1 lower than the actual.
  //if (doLogging) console.log(`Predicting ${predicted} frames`);
  //console.log(`Predicting ${predicted} frames`);

  let frameCount = await generateThumbnails(sourceFile, tempPath, maxWidth, maxHeight, options);

  //console.log(`Generated: ${f.length} frames.`);

  predicted = frameCount;

  const output: GeneratorOutput = {
    pageCount: 0,
    frameCount: predicted,
    spritePaths: [],
  };

  for (let genOptIndex = 0; genOptIndex < generatorOptionsList.length; genOptIndex++) {
    const generatorOptions = generatorOptionsList[genOptIndex];

    let tw = generatorOptions.tw || 160;
    let th = generatorOptions.th || 160;

    let pageCols = generatorOptions.pageCols || 10;
    let pageRows = generatorOptions.pageRows || 10;

    if (predicted < pageCols) pageCols = predicted;

    let pageTotal = pageCols * pageRows;

    let pages = Math.ceil(predicted / (pageCols * pageRows));

    //console.log(`Predicting ${pages} pages.`);

    output.pageCount = pages;

    let vttString = 'WEBVTT';
    let vttStartTime = 0;
    let vttEndTime = 1;

    const firstThumbPath = path.join(tempPath, 'thumb_1.png');
    if (await fileExists(firstThumbPath)) {
      const thumbMetadata = await sharp(firstThumbPath).metadata();
      if (thumbMetadata.width && thumbMetadata.height) {
        const scaledSizes = getScaledSizes(thumbMetadata.width, thumbMetadata.height, tw, th);
        tw = scaledSizes.width;
        th = scaledSizes.height;
      }
    }

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

      const finalFilenameExt = getFileNameExtension(generatorOptions.format);
      const finalFilename = `${generatorOptions.prefix}${pageID}.${finalFilenameExt}`;

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
        const thumbFrameMeta = await sharp(imagePath).metadata();
        let thumbFrameInput: Buffer | string;

        if (thumbFrameMeta.width === tw && thumbFrameMeta.height === th)
          thumbFrameInput = imagePath;
        else
          thumbFrameInput = await sharp(imagePath).resize({ width: tw, height: th }).toBuffer();

        overlayThumbs.push({ input: thumbFrameInput, top: dy, left: dx });

        //if (vttEndTime > options.duration) continue;
        const startTimeString = Duration.fromObject({ seconds: vttStartTime }).toISOTime();
        const endTimeString = Duration.fromObject({ seconds: vttEndTime }).toISOTime();
        vttString += '\n\n' + frameNumber;
        vttString += '\n' + startTimeString + ' --> ' + endTimeString;
        vttString += '\n' + `${finalFilename}#xywh=${dx},${dy},${tw},${th}`;
        vttStartTime++;
        vttEndTime++;
      }

      canvas
        .composite(overlayThumbs)
        .flatten();

      // Generate the final image.
      const finalPath = path.join(outputPath, finalFilename);

      // Set output format
      if (generatorOptions.format === 'jpeg')
        canvas.jpeg({ mozjpeg: true, progressive: true, quality: 80 });
      else if (generatorOptions.format === 'webp')
        canvas.webp({ quality: 80, alphaQuality: 0, minSize: true, effort: 4 });
      else if (generatorOptions.format === 'avif')
        canvas.avif({ quality: 65, effort: 4 });

      // Save to file
      await canvas.toFile(finalPath);

      output.spritePaths.push(finalPath);
    }

    // Save VTT file
    const finalVTTPath = path.join(outputPath, `${generatorOptions.prefix}.vtt`);
    await fs.promises.writeFile(finalVTTPath, vttString);
  }

  // Perform Clear up.
  //console.log(`Clearing away temporary output directory ${outputPath}`);
  await rimraf(tempPath);

  return output;
}

function generateThumbnails(inputFile: string, outputFolder: string, maxWidth: number, maxHeight: number, input: InputOptions) {
  return new Promise<number>((resolve, reject) => {
    let isCancelled = false;

    const args = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-vf', `"fps=1/1,scale=if(gte(iw\\,ih)\\,min(${maxWidth}\\,iw)\\,-2):if(lt(iw\\,ih)\\,min(${maxHeight}\\,ih)\\,-2)"`,
      '-qmin', '1',
      '-qscale:v', '1',
      '-f', 'image2',
      `"${outputFolder}/thumb_%d.png"`
    ];

    let generatedFrames = 0;

    const ffmpeg = child_process.spawn(`"${input.ffmpegDir}/ffmpeg"`, args, { shell: true });

    ffmpeg.stdout.setEncoding('utf8');
    ffmpeg.stdout.on('data', async (data: string) => {
      const progress = parseProgress(data);
      generatedFrames = progress.frame || 0;
      const percent = progressPercent(progress.outTimeMs, input.duration * 1000000);
      stdout.write(`Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime}\r`);
    });

    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (data) => {
      stdout.write(data);
    });

    const cancelledJobChecker = setInterval(() => {
      const index = input.canceledJobIds.findIndex(j => +j === +input.jobId);
      if (index === -1) return;

      input.canceledJobIds = input.canceledJobIds.filter(id => +id > +input.jobId);
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

function getScaledSizes(srcWidth: number, srcHeight: number, maxWidth: number, maxHeight: number) {
  let newWidth = srcWidth;
  let newHeight = srcHeight;

  // Check if the source width exceeds the maximum width
  if (srcWidth > maxWidth) {
    newWidth = maxWidth;
    newHeight = (newWidth * srcHeight) / srcWidth;

    // Check if the new height exceeds the maximum height
    if (newHeight > maxHeight) {
      newHeight = maxHeight;
      newWidth = (newHeight * srcWidth) / srcHeight;
    }
  } else if (srcHeight > maxHeight) {
    // Check if the source height exceeds the maximum height
    newHeight = maxHeight;
    newWidth = (newHeight * srcWidth) / srcHeight;

    // Check if the new width exceeds the maximum width
    if (newWidth > maxWidth) {
      newWidth = maxWidth;
      newHeight = (newWidth * srcHeight) / srcWidth;
    }
  }

  return { width: newWidth, height: newHeight };
}

function getFileNameExtension(format: OutputImageFormat) {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'webp':
      return 'webp';
    case 'avif':
      return 'avif';
    default:
      return 'jpg';
  }
}