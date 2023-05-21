import fs from 'fs';
import { Parser as M3U8Parser } from 'm3u8-parser';
import { XMLParser } from 'fast-xml-parser';
import { Duration } from 'luxon';

import { HlsManifest, HlsSegmentGroup, ParsedXMLMPD } from '../common/interfaces';

export class StreamManifest {
  manifest: HlsManifest;

  constructor() {
    this.manifest = {
      version: 7,
      videoTracks: [],
      audioTracks: [],
      targetDuration: 0, // Will be set later
      segmentDuration: 6,
      mediaSequence: 0,
      playlistType: 'VOD'
    };
  }

  async appendVideoPlaylist(options: {
    mpdPath: string, m3u8PlaylistPath: string, width: number, height: number, format: string, mimeType: string, frameRate: number,
    codec: number, uri: string
  }) {
    const { mpdPath, m3u8PlaylistPath, width, height, format, mimeType, frameRate, codec, uri } = options;
    const mpd = await fs.promises.readFile(mpdPath, { encoding: 'utf8' });
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true, ignoreDeclaration: true, parseAttributeValue: true });
    const mpdManifest = <ParsedXMLMPD>xmlParser.parse(mpd);
    const videoPlaylist = mpdManifest.MPD.Period.AdaptationSet;
    const mpdIndexRange = videoPlaylist.Representation.SegmentBase.indexRange.split('-');
    const mpdInitRange = videoPlaylist.Representation.SegmentBase.Initialization.range.split('-');
    this.manifest.targetDuration = Duration.fromISO(mpdManifest.MPD.mediaPresentationDuration).as('seconds');
    this.manifest.videoTracks.push({
      codec: videoPlaylist.Representation.codecs,
      codecID: codec,
      width: width,
      height: height,
      par: videoPlaylist.par,
      bandwidth: videoPlaylist.Representation.bandwidth,
      duration: Duration.fromISO(mpdManifest.MPD.Period.duration).as('seconds'),
      format: format,
      mimeType: mimeType,
      frameRate: frameRate,
      hlsSegment: await this.createSegmentsFromFile(m3u8PlaylistPath),
      dashSegment: {
        minBufferTime: Duration.fromISO(mpdManifest.MPD.minBufferTime).as('seconds'),
        mediaPresentationDuration: Duration.fromISO(mpdManifest.MPD.mediaPresentationDuration).as('seconds'),
        maxSubsegmentDuration: Duration.fromISO(mpdManifest.MPD.maxSubsegmentDuration).as('seconds'),
        indexRange: {
          start: +mpdIndexRange[0],
          end: +mpdIndexRange[1]
        },
        initRange: {
          start: +mpdInitRange[0],
          end: +mpdInitRange[1]
        }
      },
      uri: uri
    });
  }

  async appendAudioPlaylist(options: {
    mpdPath: string, m3u8PlaylistPath: string, format: string, mimeType: string, isDefault: boolean,
    language: string, channels: number, samplingRate: number, codec: number, uri: string
  }) {
    const { mpdPath, m3u8PlaylistPath, format, mimeType, isDefault, language = 'en', channels, samplingRate, codec, uri } = options;
    const mpd = await fs.promises.readFile(mpdPath, { encoding: 'utf8' });
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true, ignoreDeclaration: true, parseAttributeValue: true });
    const mpdManifest = <ParsedXMLMPD>xmlParser.parse(mpd);
    const audioPlaylist = mpdManifest.MPD.Period.AdaptationSet;
    const mpdIndexRange = audioPlaylist.Representation.SegmentBase.indexRange.split('-');
    const mpdInitRange = audioPlaylist.Representation.SegmentBase.Initialization.range.split('-');
    this.manifest.audioTracks.push({
      name: this.getAudioName(format, channels, codec),
      group: 'audio',
      default: isDefault,
      autoselect: isDefault,
      language: language,
      format: format,
      channels: channels,
      samplingRate: samplingRate,
      codec: audioPlaylist.Representation.codecs?.toLowerCase() || '',
      codecID: codec,
      bandwidth: audioPlaylist.Representation.bandwidth || 0,
      duration: Duration.fromISO(mpdManifest.MPD.Period.duration).as('seconds'),
      mimeType: mimeType,
      hlsSegment: await this.createSegmentsFromFile(m3u8PlaylistPath),
      dashSegment: {
        minBufferTime: Duration.fromISO(mpdManifest.MPD.minBufferTime).as('seconds'),
        mediaPresentationDuration: Duration.fromISO(mpdManifest.MPD.mediaPresentationDuration).as('seconds'),
        maxSubsegmentDuration: Duration.fromISO(mpdManifest.MPD.maxSubsegmentDuration).as('seconds'),
        indexRange: {
          start: +mpdIndexRange[0],
          end: +mpdIndexRange[1]
        },
        initRange: {
          start: +mpdInitRange[0],
          end: +mpdInitRange[1]
        }
      },
      uri: uri
    });
  }

  private async createSegmentsFromFile(path: string) {
    const m3u8 = await fs.promises.readFile(path, { encoding: 'utf8' });
    const parser = new M3U8Parser();
    parser.push(m3u8);
    parser.end();
    if (!parser.manifest.segments.length) return;
    const segmentGroup: HlsSegmentGroup = {
      byterange: parser.manifest.segments[0].map.byterange,
      segments: []
    };
    for (let i = 0; i < parser.manifest.segments.length; i++) {
      const segment = parser.manifest.segments[i];
      segmentGroup.segments.push({
        timeline: segment.timeline,
        duration: segment.duration,
        byterange: segment.byterange
      });
    }
    return segmentGroup;
  }

  private getAudioName(format: string, channels: number, codec: number) {
    if (channels === 1)
      return format + ' ' + 'Mono';
    if (channels === 2)
      return format + ' ' + 'Stereo';
    return format + ' ' + (channels - 1) + '.1' + ' - ' + codec;
  }

  saveFile(path: string) {
    const json = JSON.stringify(this.manifest);
    return fs.promises.writeFile(path, json, { encoding: 'utf8' });
  }
}