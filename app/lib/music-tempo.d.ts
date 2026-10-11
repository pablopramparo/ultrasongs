declare module "music-tempo" {
  class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: Record<string, number>);
    tempo: string | number;
    beats: number[];
  }
  export = MusicTempo;
}
