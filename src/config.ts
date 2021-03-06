export const PORT = 3001;
export const ADDRESS = '0.0.0.0';
export const SNOWFLAKE_MACHINE_ID = 2;
export const ENCODING_QUALITY = [2160, 1440, 1080, 720, 480, 360];
export const AUDIO_PARAMS = ['-c:a', 'libfdk_aac', '-vbr', '5'];
export const VIDEO_H264_PARAMS = ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '18'];
export const VIDEO_VP9_PARAMS = ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0'];
export const VIDEO_AV1_PARAMS = ['-c:v', 'libaom-av1', '-crf', '24', '-b:v', '0'];