export type SourceCandidate = {
  id: string;

  mediaType: "movie" | "series";
  imdbId: string;
  season?: number;
  episode?: number;
  mediaKey: string;

  origin:
    | "deepbrid-official"
    | "newznab"
    | "prowlarr"
    | "nzbhydra"
    | "althub"
    | "easynews-direct"
    | "manual-nzb";

  title: string;
  displayName: string;

  status:
    | "ready"
    | "needs_deepbrid_submit"
    | "submitted"
    | "caching"
    | "ready_from_cache"
    | "failed";

  playableUrl?: string;

  nzbUrl?: string;
  nzbFileId?: string;
  originalIndexerUrl?: string;
  sourceService?: "deepbrid" | "easynews";

  resolution?: "2160p" | "1080p" | "720p" | "480p" | "unknown";
  quality?: "REMUX" | "BluRay" | "WEB-DL" | "WEBRip" | "HDTV" | "unknown";
  codec?: "x265" | "x264" | "AV1" | "unknown";
  audio?: string;
  hdr?: "HDR10" | "DV" | "HDR10+" | "none" | "unknown";
  sizeBytes?: number;
  releaseGroup?: string;
  language?: string;
  normalizedTitle?: string;
  parsedSeason?: number;
  parsedEpisode?: number;
  absoluteEpisode?: number;
  seasonPack?: boolean;
  matchScore?: number;
  matchReason?: string;

  score: number;

  createdAt: string;
  expiresAt?: string;
};

export type StremioStream = {
  name: string;
  title: string;
  url: string;
  behaviorHints?: {
    notWebReady?: boolean;
  };
};
