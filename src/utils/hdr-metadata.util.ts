import { Logger } from 'winston';
import child_process from 'child_process';
import { stdout } from 'process';

const x265ValidColorMatrix: string[] = [
  'gbr', 'bt709', 'unknown', 'reserved', 'fcc', 'bt470bg', 'smpte170m', 'smpte240m', 'ycgco',
  'bt2020nc', 'bt2020c', 'smpte2085', 'chroma-derived-nc', 'chroma-derived-c', 'ictcp'
];

const x265ColorMatrixMapping: { [key: string]: string } = { 'bt2020_ncl': 'bt2020nc', 'bt2020_cl': 'bt2020c' };

const libaomValidMatrixCoefficients: string[] = [
  'bt709', 'fcc73', 'bt470bg', 'bt601', 'smpte240', 'ycgco',
  'bt2020ncl', 'bt2020cl', 'smpte2085', 'chromncl', 'chromcl', 'ictcp'
];

const libaomMatrixCoefficientsMapping: { [key: string]: string } = {
  'fcc': 'fcc73',
  'smpte240m': 'smpte240',
  'bt2020nc': 'bt2020ncl',
  'bt2020_ncl': 'bt2020ncl',
  'bt2020c': 'bt2020cl',
  'bt2020_cl': 'bt2020cl',
  'chroma-derived-nc': 'chromncl',
  'chroma-derived-c': 'chromcl'
};

function libaomGetMatrixCoefficients(colorSpace: string): string | null {
  if (libaomValidMatrixCoefficients.includes(colorSpace)) {
    return colorSpace;
  } else if (colorSpace in libaomMatrixCoefficientsMapping) {
    return libaomMatrixCoefficientsMapping[colorSpace];
  }
  return null;
}

const libsvtav1ColorPrimariesMapping: { [key: string]: number } = {
  'bt709': 1,
  'bt470m': 4,
  'bt470bg': 5,
  'bt601': 6,
  'smpte240': 7,
  'film': 8,
  'bt2020': 9,
  'xyz': 10,
  'smpte431': 11,
  'smpte432': 12,
  'ebu3213': 22
};

function libsvtav1GetCpCode(colorPrimaries: string): number {
  return libsvtav1ColorPrimariesMapping[colorPrimaries] || 2;
}

const libsvtav1TransferCharacteristicsMapping: { [key: string]: number } = {
  'bt709': 1,
  'bt470m': 4,
  'bt470bg': 5,
  'bt601': 6,
  'smpte240': 7,
  'linear': 8,
  'log100': 9,
  'log100-sqrt10': 10,
  'iec61966': 11,
  'bt1361': 12,
  'srgb': 13,
  'bt2020-10': 14,
  'bt2020-12': 15,
  'smpte2084': 16,
  'smpte428': 17,
  'hlg': 18
};

function libsvtav1GetTchCode(transferCharacteristics: string): number {
  return libsvtav1TransferCharacteristicsMapping[transferCharacteristics] || 2;
}

export interface ParsedHDRMetadataResult {
  ffmpegParams: string[];
  x265Params: string;
  libsvtav1Params: string;
  libaomav1Params: string;
}

class MdItem {
  rawvalue: string;
  numerator: number;
  denominator: number;
  floatValue: number;

  constructor(rawValue: string) {
    this.rawvalue = rawValue;
    const valList = rawValue.split('/');
    this.numerator = parseInt(valList[0]);
    this.denominator = parseInt(valList[1]);
    this.floatValue = this.numerator / this.denominator;
  }

  toString(): string {
    return this.rawvalue;
  }

  expandToRatio(denominator: number): number {
    return Math.round(this.numerator * (denominator / this.denominator));
  }
}

class MdItemColorXy {
  prefix: string;
  xData: MdItem;
  yData: MdItem;

  constructor(sideData: any, prefix: string) {
    this.prefix = prefix;
    this.xData = new MdItem(sideData[prefix + '_x']);
    this.yData = new MdItem(sideData[prefix + '_y']);
  }

  toString(): string {
    return `${this.prefix}_x: ${this.xData}\n${this.prefix}_y: ${this.yData}`;
  }

  toX265(): string {
    return `(${this.xData.expandToRatio(50000)},${this.yData.expandToRatio(50000)})`;
  }

  toLibsvtav1(): string {
    return `(${this.xData.floatValue.toFixed(4)},${this.yData.floatValue.toFixed(4)})`;
  }
}

class MasteringDisplayData {
  red: MdItemColorXy;
  green: MdItemColorXy;
  blue: MdItemColorXy;
  whitePoint: MdItemColorXy;
  minLuminance: MdItem;
  maxLuminance: MdItem;

  constructor(sideData: any) {
    this.red = new MdItemColorXy(sideData, 'red');
    this.green = new MdItemColorXy(sideData, 'green');
    this.blue = new MdItemColorXy(sideData, 'blue');
    this.whitePoint = new MdItemColorXy(sideData, 'white_point');
    this.minLuminance = new MdItem(sideData['min_luminance']);
    this.maxLuminance = new MdItem(sideData['max_luminance']);
  }

  toString(): string {
    return `${this.red}\n${this.green}\n${this.blue}\n${this.whitePoint}\n` +
      `min_luminance: ${this.minLuminance}\nmax_luminance${this.maxLuminance}`;
  }

  toX265Params(): string {
    return `display=G${this.green.toX265()}B${this.blue.toX265()}R${this.red.toX265()}` +
      `WP${this.whitePoint.toX265()}` +
      `L(${this.maxLuminance.expandToRatio(10000)},${this.minLuminance.expandToRatio(10000)})`;
  }

  toLibsvtav1Params(): string {
    return `mastering-display=G${this.green.toLibsvtav1()}B${this.blue.toLibsvtav1()}` +
      `R${this.red.toLibsvtav1()}WP${this.whitePoint.toLibsvtav1()}` +
      `L(${this.maxLuminance.floatValue.toFixed(4)},${this.minLuminance.floatValue.toFixed(4)})`;
  }
}

class ContentLightLevelData {
  maxContent: number;
  maxAverage: number;

  constructor(sideData: any) {
    this.maxContent = sideData['max_content'];
    this.maxAverage = sideData['max_average'];
  }

  toString(): string {
    return `max_content: ${this.maxContent}, max_average ${this.maxAverage}`;
  }

  toX265Params(): string {
    return `max-cll=${this.maxContent},${this.maxAverage}`;
  }

  toLibsvtav1Params(): string {
    return `content-light=${this.maxContent},${this.maxAverage}`;
  }
}

class ColorData {
  pixFmt: string;
  colorSpace: string;
  colorPrimaries: string;
  colorTransfer: string;

  constructor(frameData: any) {
    this.pixFmt = frameData['pix_fmt'];
    this.colorSpace = frameData['color_space'];
    this.colorPrimaries = frameData['color_primaries'];
    this.colorTransfer = frameData['color_transfer'];
  }

  toString(): string {
    return 'pix_fmt: ' + this.pixFmt + '\ncolor_space: ' + this.colorSpace +
      '\ncolor_primaries: ' + this.colorPrimaries + '\ncolor_transfer: ' + this.colorTransfer;
  }

  toFfmpegOptions(): string {
    return `-pix_fmt ${this.pixFmt} -colorspace ${this.colorSpace} ` +
      `-color_trc ${this.colorTransfer} -color_primaries ${this.colorPrimaries}`;
  }

  toFfmpegOptionsArray(): string[] {
    return [
      '-pix_fmt', this.pixFmt,
      '-colorspace', this.colorSpace,
      '-color_trc', this.colorTransfer,
      '-color_primaries', this.colorPrimaries
    ];
  }

  toX265Params(): string {
    if (x265ValidColorMatrix.includes(this.colorSpace)) {
      return `colormatrix=${this.colorSpace}`;
    } else if (this.colorSpace in x265ColorMatrixMapping) {
      return `colormatrix=${x265ColorMatrixMapping[this.colorSpace]}`;
    }
    return '';
  }

  toLibaomAv1Params(): string {
    let res = `color-primaries=${this.colorPrimaries}:transfer-characteristics=${this.colorTransfer}`;
    const mc = libaomGetMatrixCoefficients(this.colorSpace);
    if (mc !== null) {
      res += `:matrix-coefficients=${mc}`;
    }
    return res;
  }

  toLibsvtav1Params(): string {
    let res = `color-primaries=${libsvtav1GetCpCode(this.colorPrimaries)}`;
    res += `:transfer-characteristics=${libsvtav1GetTchCode(this.colorTransfer)}`;
    if (this.colorSpace.includes('bt2020')) {
      res += ':matrix-coefficients=9';
    }
    return res;
  }
}

export class HDRMetadataHelper {
  private parseFrameData(frameData: any, logger?: Logger) {
    const colorParams = ['pix_fmt', 'color_space', 'color_primaries', 'color_transfer'];

    const missingParams = colorParams.filter(x => !(x in frameData));
    if (missingParams.length !== 0) {
      logger?.warning(`Missing ${missingParams} parameters in frame metadata!. Probably not an HDR stream. Skipping...`);
      return null;
    }

    const colorData = new ColorData(frameData);
    logger?.debug('Color Data:');
    logger?.debug(colorData.toString());

    let x265Params: string = colorData.toX265Params();
    const libaomAv1Params: string = colorData.toLibaomAv1Params();
    let libsvtav1Params: string = colorData.toLibsvtav1Params();

    const sideDataList = frameData['side_data_list'];
    for (const sideData of sideDataList) {
      if (sideData['side_data_type'] === 'Mastering display metadata') {
        const masteringDisplayData = new MasteringDisplayData(sideData);
        x265Params += ':' + masteringDisplayData.toX265Params();
        libsvtav1Params += ':' + masteringDisplayData.toLibsvtav1Params();
        logger?.debug('Mastering display metadata:');
        logger?.debug(masteringDisplayData.toString());

      } else if (sideData['side_data_type'] === 'Content light level metadata') {
        const contentLightLevelData = new ContentLightLevelData(sideData);
        x265Params += ':' + contentLightLevelData.toX265Params();
        libsvtav1Params += ':' + contentLightLevelData.toLibsvtav1Params();
        logger?.debug('Content light level metadata:');
        logger?.debug(contentLightLevelData.toString());
      }
    }

    logger?.debug(`FFmpeg options: ${colorData.toFfmpegOptions()}`);
    logger?.debug(`x265 params: ${x265Params}`);
    logger?.debug(`libsvtav1 params: ${libsvtav1Params}`);
    logger?.debug(`libaom-av1 params: ${libaomAv1Params}`);

    const result: ParsedHDRMetadataResult = {
      ffmpegParams: colorData.toFfmpegOptionsArray(),
      x265Params: x265Params,
      libsvtav1Params: libsvtav1Params,
      libaomav1Params: libaomAv1Params
    };

    return result;
  }

  getHdrMetadata(inputFile: string, videoTrackIndex: number, ffprobeDir: string, logger?: Logger) {
    const args: string[] = [
      '-hide_banner', '-loglevel', 'warning',
      '-select_streams', String(videoTrackIndex),
      '-print_format', 'json', '-show_frames', '-read_intervals', '%+#1',
      '-show_entries',
      'stream=codec_type:' +
      'frame=pix_fmt,color_space,color_primaries,color_transfer,side_data_list',
      '-i', `"${inputFile}"`
    ];

    return new Promise<ParsedHDRMetadataResult | null>((resolve, reject) => {
      const ffmpeg = child_process.spawn(`"${ffprobeDir}/ffprobe"`, args, { shell: true });

      let outputJson = '';
      ffmpeg.stdout.setEncoding('utf8');
      ffmpeg.stdout.on('data', async (data: string) => {
        outputJson += data;
      });

      ffmpeg.on('exit', (code: number) => {
        if (code !== 0) {
          reject({ code, message: `FFmpeg exited with status code: ${code}` });
        } else {
          const metadata = JSON.parse(outputJson);
          const streamCodecType = metadata['streams'][0]['codec_type'];
          if (streamCodecType === 'video') {
            const result = this.parseFrameData(metadata['frames'][0]);
            resolve(result);
          } else {
            logger?.warning(`Selected stream type '${streamCodecType}' is not a video stream. Skipping...`);
            resolve(null);
          }
        }
      });
    });
  }
}

export const hdrMetadataHelper = new HDRMetadataHelper();