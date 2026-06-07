export type ParsedRelease = {
  resolution: "2160p" | "1080p" | "720p" | "480p" | "unknown";
  quality: "REMUX" | "BluRay" | "WEB-DL" | "WEBRip" | "HDTV" | "unknown";
  codec: "x265" | "x264" | "AV1" | "unknown";
  hdr: "HDR10" | "DV" | "HDR10+" | "none" | "unknown";
  audio?: string;
  releaseGroup?: string;
  normalizedTitle: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  episodeRange?: { start: number; end: number };
  seasonPack?: boolean;
  sizeBytes?: number;
};

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSizeBytes(title: string): number | undefined {
  const match = title.match(/(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toLowerCase();
  return Math.round(value * (unit.startsWith("g") ? 1073741824 : 1048576));
}

function normalizeTitle(title: string, releaseGroup?: string): string {
  let normalized = title;
  if (releaseGroup) {
    normalized = normalized.replace(new RegExp(`(?:[-_.\\s]|\\[)${releaseGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\])?$`, "i"), " ");
  }
  return normalized
    .replace(/\[[^\]]+\]|\([^)]+\)/g, " ")
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dv|dovi|dolby vision|remux|blu-?ray|web-?dl|webrip|hdtv|x26[45]|h26[45]|hevc|avc|av1|aac|ac3|eac3|ddp?5\.1|ddp?7\.1|atmos|truehd|dts(?:[.\s-]*hd)?(?:[.\s-]*ma)?|ma|flac|proper|repack|internal|multi|subbed|dubbed|dual audio|complete|season\s*\d{1,2}|season|pack|mkv|mp4|avi|rar|7z|zip)\b/gi, " ")
    .replace(/\bs\d{1,2}(?:[\s._-]*e\d{1,3}(?:[\s._-]*e\d{1,3})?)?\b/gi, " ")
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, " ")
    .replace(/\b(?:ep|episode)\s*\d{1,4}\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:gb|gib|mb|mib)\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[-_.]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function parseRelease(title: string): ParsedRelease {
  const lowerTitle = title.toLowerCase();
  
  let resolution: ParsedRelease["resolution"] = "unknown";
  if (/\b(2160p|4k|uhd)\b/i.test(title)) resolution = "2160p";
  else if (/\b1080p\b/i.test(title)) resolution = "1080p";
  else if (/\b720p\b/i.test(title)) resolution = "720p";
  else if (/\b480p\b/i.test(title)) resolution = "480p";

  let quality: ParsedRelease["quality"] = "unknown";
  if (/\bremux\b/i.test(title)) quality = "REMUX";
  else if (/\bblu-?ray\b/i.test(title)) quality = "BluRay";
  else if (/\bweb-?dl\b/i.test(title)) quality = "WEB-DL";
  else if (/\bwebrip\b/i.test(title)) quality = "WEBRip";
  else if (/\bhdtv\b/i.test(title)) quality = "HDTV";

  let codec: ParsedRelease["codec"] = "unknown";
  if (/\b(x265|h265|hevc)\b/i.test(title)) codec = "x265";
  else if (/\b(x264|h264|avc)\b/i.test(title)) codec = "x264";
  else if (/\bav1\b/i.test(title)) codec = "AV1";

  let hdr: ParsedRelease["hdr"] = "unknown";
  if (/(?:^|[\s._-])(?:hdr10\+|hdr10plus)(?:$|[\s._-])/i.test(title)) hdr = "HDR10+";
  else if (/\b(dv|dovi|dolby vision)\b/i.test(title)) hdr = "DV";
  else if (/\bhdr(?:10)?\b/i.test(title)) hdr = "HDR10";
  else hdr = "none";

  const audioMatch = title.match(/\b(?:truehd(?:[.\s-]*atmos)?|atmos|dts[.\s-]*hd(?:[.\s-]*ma)?|dts|ddp?7\.1|ddp?5\.1|eac3|ac3|aac|flac)\b/i);
  const releaseGroupMatch = title.match(/(?:^|[-_.\s])([A-Za-z0-9]{2,})$/) || title.match(/\[([A-Za-z0-9]{2,})\]\s*$/);
  const sxeMatch = title.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._-]*E?(\d{1,3}))?\b/i);
  const xMatch = title.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const seasonEpisodeMatch = title.match(/\bSeason\s*(\d{1,2}).*?\b(?:Episode|Ep)\s*(\d{1,3})\b/i);
  const seasonOnlyMatch = title.match(/\bS(?:eason)?\s*(\d{1,2})\b/i);
  const absoluteMatches = [...title.matchAll(/(?:^|[\s._-])(?:E(?:P|pisode)?\s*)?(\d{2,4})(?:\s*[-~]\s*(\d{2,4}))?(?=$|[\s._\[\]-])/gi)];
  const seasonPack = !sxeMatch && (/\b(?:complete|season\s*\d{1,2}|s\d{1,2})\b.*\b(?:season|pack|complete)\b/i.test(title) || /\bS\d{1,2}\b(?![\s._-]*E\d{1,3})/i.test(title));

  const season = parseNumber(sxeMatch?.[1] || xMatch?.[1] || seasonEpisodeMatch?.[1] || seasonOnlyMatch?.[1]);
  const episode = parseNumber(sxeMatch?.[2] || xMatch?.[2] || seasonEpisodeMatch?.[2]);
  const absoluteMatch = absoluteMatches.find(match => {
    const value = parseNumber(match[1]);
    if (!value || (value >= 1900 && value <= 2099)) return false;
    const next = title[match.index! + match[0].length];
    return !(next === "." && /\d/.test(title[match.index! + match[0].length + 1] || ""));
  });
  const rangeEnd = parseNumber(sxeMatch?.[3]);
  const absoluteEpisode = episode ? undefined : parseNumber(absoluteMatch?.[1]);
  const absoluteRangeEnd = parseNumber(absoluteMatch?.[2]);
  const episodeRange = (rangeEnd || absoluteRangeEnd) && (episode || absoluteEpisode) ? { start: episode || absoluteEpisode!, end: rangeEnd || absoluteRangeEnd! } : undefined;
  const releaseGroup = releaseGroupMatch?.[1] && !/^(2160p|1080p|720p|480p|4k|uhd|hevc|x265|x264|h264|h265|avc|av1|webdl|webrip|bluray|remux|dv|dovi|hdr|hdr10|aac|ac3|eac3|dts|truehd|atmos)$/i.test(releaseGroupMatch[1]) ? releaseGroupMatch[1] : undefined;
  let normalizedTitle = normalizeTitle(title, releaseGroup);
  if (absoluteEpisode) {
    normalizedTitle = normalizedTitle.replace(new RegExp(`\\b0*${absoluteEpisode}\\b`, "g"), " ").replace(/\s+/g, " ").trim();
  }

  return {
    resolution,
    quality,
    codec,
    hdr,
    audio: audioMatch?.[0],
    releaseGroup,
    normalizedTitle,
    season,
    episode,
    absoluteEpisode,
    episodeRange,
    seasonPack,
    sizeBytes: parseSizeBytes(title)
  };
}
