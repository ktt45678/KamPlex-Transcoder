import { HDRTransfer } from './mediainfo.util';
import { HDR_FALLBACK_PEAK, HDR_REFERENCE_WHITE, HLG_NOMINAL_PEAK } from '../config';

export interface HDRTonemapSource {
  transfer: HDRTransfer;
  maxCll?: number | null;
  masteringMaxLuminance?: number | null;
}

const HDR_SIDE_DATA_TYPES = [
  'MASTERING_DISPLAY_METADATA',
  'CONTENT_LIGHT_LEVEL',
  'DYNAMIC_HDR_PLUS',
  'DOVI_RPU_BUFFER',
  'DOVI_METADATA'
];

export function hdrStripFilters(): string[] {
  return HDR_SIDE_DATA_TYPES.map(type => `sidedata=mode=delete:type=${type}`);
}

export function resolveHdrPeakNits(source: HDRTonemapSource): number {
  if (source.maxCll && source.maxCll > 0) return source.maxCll;
  if (source.masteringMaxLuminance && source.masteringMaxLuminance > 0) return source.masteringMaxLuminance;
  return HDR_FALLBACK_PEAK;
}

export function hdrTonemapFilters(source: HDRTonemapSource): string[] {
  const peakNits = resolveHdrPeakNits(source);
  const npl = source.transfer === HDRTransfer.HLG ? HLG_NOMINAL_PEAK : HDR_REFERENCE_WHITE;
  const peak = peakNits / npl;

  return [
    `zscale=t=linear:npl=${npl}`,
    'format=gbrpf32le',
    `tonemap=tonemap=hable:desat=0:peak=${peak.toFixed(4)}`,
    'zscale=p=bt709:t=bt709:m=bt709:r=tv:d=error_diffusion',
    'format=yuv420p',
    ...hdrStripFilters()
  ];
}

export function libplaceboTonemapFilters(scaleHeight?: number): string[] {
  const opts = [
    'colorspace=bt709',
    'color_primaries=bt709',
    'color_trc=bt709',
    'range=tv',
    'format=yuv420p'
  ];
  if (scaleHeight) opts.unshift(`w=-2:h=${scaleHeight}`);
  return [
    'hwupload',
    `libplacebo=${opts.join(':')}`,
    'hwdownload',
    'format=yuv420p',
    ...hdrStripFilters()
  ];
}

export const LIBPLACEBO_HW_DEVICE_ARGS = ['-init_hw_device', 'vulkan=vk:0'];
