export interface ParsedXMLMPD {
  MPD: MPD;
}

interface MPD {
  ProgramInformation: ProgramInformation;
  Period: Period;
  xmlns: string;
  minBufferTime: string;
  type: string;
  mediaPresentationDuration: string;
  maxSubsegmentDuration: string;
  profiles: string;
}

interface Period {
  AdaptationSet: AdaptationSet;
  duration: string;
}

interface AdaptationSet {
  Representation: Representation;
  segmentAlignment: boolean;
  par?: string;
  lang: string;
  startWithSAP: number;
  subsegmentAlignment: boolean;
  subsegmentStartsWithSAP: number;
}

interface Representation {
  AudioChannelConfiguration?: AudioChannelConfiguration;
  BaseURL: string;
  SegmentBase: SegmentBase;
  id: number;
  mimeType: string;
  codecs: string;
  audioSamplingRate: number;
  bandwidth: number;
}

interface SegmentBase {
  Initialization: Initialization;
  indexRangeExact: boolean;
  indexRange: string;
}

interface Initialization {
  range: string;
}

interface AudioChannelConfiguration {
  schemeIdUri: string;
  value: number;
}

interface ProgramInformation {
  Title: string;
  moreInformationURL: string;
}