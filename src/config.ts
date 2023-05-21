export const PORT = 3001;
export const ADDRESS = '0.0.0.0';
export const SNOWFLAKE_EPOCH = 1609459200000;
export const SNOWFLAKE_MACHINE_ID = 2;
export const ENCODING_QUALITY = [2160, 1440, 1080, 720, 480, 360];
export const AUDIO_PARAMS = ['-c:a', 'libfdk_aac', '-vbr', '5', '-ac', '2'];
export const AUDIO_SPEED_PARAMS = ['-c:a', 'libopus', '-vbr', 'on', '-ac', '2'];
export const AUDIO_SURROUND_PARAMS = ['-c:a', 'libfdk_aac', '-vbr', '5'];
export const AUDIO_SURROUND_OPUS_PARAMS = ['-c:a', 'libopus', '-vbr', 'on'];
export const VIDEO_H264_PARAMS = ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '18'];
export const VIDEO_VP9_PARAMS = ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0'];
export const VIDEO_AV1_PARAMS = ['-c:v', 'libaom-av1', '-crf', '24', '-b:v', '0'];
export const BYPASS_PRODUCER_CHECK_FILE = 'data/bypass-producer-check';
export const PRODUCER_DOMAINS_FILE = 'data/producer-domains.txt';