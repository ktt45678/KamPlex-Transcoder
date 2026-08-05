import {
  DOWNMIX_CEILING_DBFS, DOWNMIX_GAIN_MAX_DB, DOWNMIX_GAIN_MIN_DB, DOWNMIX_LIMIT_ALLOWANCE_DB, DOWNMIX_LIMITER_LIMIT
} from '../config';

export interface DownmixPlan {
  layout: string;
  supported: boolean;
  unmappedChannels: string[];
  matrix: string;
}

export interface LoudnessMeasurement {
  sourceI: number;
  downmixI: number;
  downmixTP: number;
}

const LAYOUTS: Record<string, string[]> = {
  'mono': ['FC'],
  'stereo': ['FL', 'FR'],
  '2.1': ['FL', 'FR', 'LFE'],
  '3.0': ['FL', 'FR', 'FC'],
  '3.0(back)': ['FL', 'FR', 'BC'],
  '4.0': ['FL', 'FR', 'FC', 'BC'],
  'quad': ['FL', 'FR', 'BL', 'BR'],
  'quad(side)': ['FL', 'FR', 'SL', 'SR'],
  '3.1': ['FL', 'FR', 'FC', 'LFE'],
  '5.0': ['FL', 'FR', 'FC', 'BL', 'BR'],
  '5.0(side)': ['FL', 'FR', 'FC', 'SL', 'SR'],
  '4.1': ['FL', 'FR', 'FC', 'LFE', 'BC'],
  '5.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR'],
  '5.1(side)': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  '6.0': ['FL', 'FR', 'FC', 'BC', 'SL', 'SR'],
  '6.0(front)': ['FL', 'FR', 'FLC', 'FRC', 'SL', 'SR'],
  '3.1.2': ['FL', 'FR', 'FC', 'LFE', 'TFL', 'TFR'],
  'hexagonal': ['FL', 'FR', 'FC', 'BL', 'BR', 'BC'],
  '6.1': ['FL', 'FR', 'FC', 'LFE', 'BC', 'SL', 'SR'],
  '6.1(back)': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'BC'],
  '6.1(front)': ['FL', 'FR', 'LFE', 'FLC', 'FRC', 'SL', 'SR'],
  '7.0': ['FL', 'FR', 'FC', 'BL', 'BR', 'SL', 'SR'],
  '7.0(front)': ['FL', 'FR', 'FC', 'FLC', 'FRC', 'SL', 'SR'],
  '7.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
  '7.1(wide)': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'FLC', 'FRC'],
  '7.1(wide-side)': ['FL', 'FR', 'FC', 'LFE', 'FLC', 'FRC', 'SL', 'SR'],
  '5.1.2': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'TFL', 'TFR'],
  '5.1.2(back)': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'TFL', 'TFR'],
  'octagonal': ['FL', 'FR', 'FC', 'BL', 'BR', 'BC', 'SL', 'SR'],
  'cube': ['FL', 'FR', 'BL', 'BR', 'TFL', 'TFR', 'TBL', 'TBR'],
  '5.1.4': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'TFL', 'TFR', 'TBL', 'TBR'],
  '7.1.2': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR', 'TFL', 'TFR'],
  '7.1.4': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR', 'TFL', 'TFR', 'TBL', 'TBR'],
  '7.2.3': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR', 'TFL', 'TFR', 'TBC', 'LFE2'],
  '9.1.4': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'FLC', 'FRC', 'SL', 'SR', 'TFL', 'TFR', 'TBL', 'TBR'],
  '9.1.6': [
    'FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'FLC', 'FRC', 'SL', 'SR', 'TFL', 'TFR', 'TBL', 'TBR', 'TSL', 'TSR'
  ],
  'hexadecagonal': [
    'FL', 'FR', 'FC', 'BL', 'BR', 'BC', 'SL', 'SR', 'TFL', 'TFC', 'TFR', 'TBL', 'TBC', 'TBR', 'WL', 'WR'
  ],
  'binaural': ['BIL', 'BIR'],
  'downmix': ['DL', 'DR'],
  '22.2': [
    'FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'FLC', 'FRC', 'BC', 'SL', 'SR', 'TC', 'TFL', 'TFC', 'TFR',
    'TBL', 'TBC', 'TBR', 'LFE2', 'TSL', 'TSR', 'BFC', 'BFL', 'BFR'
  ]
};

const COUNT_FALLBACK: Record<number, string> = {
  1: 'mono', 2: 'stereo', 3: '3.0', 4: 'quad', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1'
};

const UNITY = 1;
const FOLD_3DB = 0.70710678;
const FOLD_6DB = 0.5;
const FOLD_9DB = 0.35355339;
const FOLD_LFE = 0.22360680;

const CHANNEL_ORDER: [string, number, number][] = [
  ['FL', UNITY, 0],
  ['FR', 0, UNITY],
  ['FC', FOLD_3DB, FOLD_3DB],
  ['FLC', UNITY, 0],
  ['FRC', 0, UNITY],
  ['SL', FOLD_3DB, 0],
  ['BL', FOLD_3DB, 0],
  ['SR', 0, FOLD_3DB],
  ['BR', 0, FOLD_3DB],
  ['BC', FOLD_6DB, FOLD_6DB],
  ['LFE', FOLD_LFE, FOLD_LFE],
  ['TFL', FOLD_6DB, 0],
  ['TSL', FOLD_6DB, 0],
  ['TBL', FOLD_6DB, 0],
  ['TFR', 0, FOLD_6DB],
  ['TSR', 0, FOLD_6DB],
  ['TBR', 0, FOLD_6DB],
  ['TFC', FOLD_9DB, FOLD_9DB],
  ['TC', FOLD_9DB, FOLD_9DB],
  ['TBC', FOLD_9DB, FOLD_9DB]
];

const COEFFICIENTS = new Map(CHANNEL_ORDER.map(([name, left, right]) => [name, [left, right]] as const));

const FALLBACK_MATRIX = 'aformat=sample_fmts=fltp,aresample=ochl=stereo';

function term(coeff: number, channel: string): string {
  return coeff === UNITY ? channel : `${coeff}*${channel}`;
}

export function buildDownmixPlan(channelLayout: string | undefined, channels: number): DownmixPlan {
  const resolvedName = (channelLayout && LAYOUTS[channelLayout]) ? channelLayout : COUNT_FALLBACK[channels];
  const layout = resolvedName || channelLayout || `${channels}ch`;

  if (channels <= 2)
    return { layout, supported: true, unmappedChannels: [], matrix: 'aformat=sample_fmts=fltp' };

  if (!resolvedName)
    return { layout, supported: false, unmappedChannels: [layout], matrix: FALLBACK_MATRIX };

  const layoutChannels = LAYOUTS[resolvedName];
  const unmappedChannels = layoutChannels.filter(channel => !COEFFICIENTS.has(channel));
  if (unmappedChannels.length)
    return { layout: resolvedName, supported: false, unmappedChannels, matrix: FALLBACK_MATRIX };

  const channelSet = new Set(layoutChannels);
  const left: string[] = [];
  const right: string[] = [];
  for (const [name, leftCoeff, rightCoeff] of CHANNEL_ORDER) {
    if (!channelSet.has(name))
      continue;
    if (leftCoeff)
      left.push(term(leftCoeff, name));
    if (rightCoeff)
      right.push(term(rightCoeff, name));
  }

  const stages = ['aformat=sample_fmts=fltp'];
  if (channelSet.has('LFE'))
    stages.push('lowpass=c=LFE:f=120');
  stages.push(`pan=stereo|FL=${left.join('+')}|FR=${right.join('+')}`);

  return { layout: resolvedName, supported: true, unmappedChannels: [], matrix: stages.join(',') };
}

export function buildDownmixFilter(plan: DownmixPlan, gainDb: number): string {
  const stages = [plan.matrix];
  const gain = gainDb.toFixed(2);
  if (gain !== '0.00' && gain !== '-0.00')
    stages.push(`volume=${gain}dB`);
  stages.push(`alimiter=limit=${DOWNMIX_LIMITER_LIMIT}:level=false:latency=true`);
  return stages.join(',');
}

export function computeDownmixGain(measurement: LoudnessMeasurement | null): number {
  if (!measurement)
    return 0;

  const want = measurement.sourceI - measurement.downmixI;
  const headroom = DOWNMIX_CEILING_DBFS - measurement.downmixTP;
  const gain = Math.min(want, headroom + DOWNMIX_LIMIT_ALLOWANCE_DB);
  return Math.min(Math.max(gain, DOWNMIX_GAIN_MIN_DB), DOWNMIX_GAIN_MAX_DB);
}
