import { SourceCandidate, StremioStream } from "../core/types";
import { compareCandidates } from "../core/releaseMatch";

type ResolvePayload = {
  nzbUrl: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  seasonPack?: boolean;
  title?: string;
};

function encodeResolvePayload(candidate: SourceCandidate): string {
  const payload: ResolvePayload = {
    nzbUrl: candidate.nzbUrl!,
    season: candidate.season,
    episode: candidate.episode,
    absoluteEpisode: candidate.absoluteEpisode,
    seasonPack: candidate.seasonPack,
    title: candidate.title
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sourceLabel(candidate: SourceCandidate): string {
  if (candidate.origin === "deepbrid-official") return "Deepbrid Official";
  if (candidate.origin === "easynews-direct") return "Easynews Direct";
  if (candidate.origin === "newshosting-direct") return "Newshosting";
  if (candidate.origin === "deepbrid-torrent-library") return "Deepbrid Library";
  if (candidate.origin === "external-torrent") return "External Torrent";
  if (candidate.origin === "stremio-addon-torrent") return "Stremio Addon";
  const displayMatch = candidate.displayName.match(/^\[([^\]]+)\]/);
  if (displayMatch) return displayMatch[1];
  return candidate.origin
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatStreams(candidates: SourceCandidate[], baseUrl: string, token: string = "default_token"): StremioStream[] {
  candidates.sort(compareCandidates);

  return candidates.map(candidate => {
    const resString = candidate.resolution !== "unknown" ? candidate.resolution : "UNK";
    const nameStr = `[DB] ${resString}`;
    
    let gb = "";
    if (candidate.sizeBytes) {
      gb = (candidate.sizeBytes / 1073741824).toFixed(2) + " GB";
    }

    const videoTags = [];
    if (candidate.quality && candidate.quality !== "unknown") videoTags.push(candidate.quality);
    if (candidate.codec && candidate.codec !== "unknown") videoTags.push(candidate.codec);
    if (candidate.hdr && candidate.hdr !== "unknown") videoTags.push(candidate.hdr);
    if (candidate.seasonPack) videoTags.push("Season Pack");

    const titleStr = candidate.title || candidate.displayName;
    const originStr = sourceLabel(candidate);

    let secondLine = [];
    if (gb) secondLine.push(`📦 ${gb}`);
    if (videoTags.length > 0) secondLine.push(`📺 ${videoTags.join(" ")}`);
    if (candidate.audio) secondLine.push(`🔊 ${candidate.audio}`);
    if (candidate.releaseGroup) secondLine.push(`🏷 ${candidate.releaseGroup}`);

    let thirdLine = `📥 ${originStr}`;
    if (candidate.status === "ready") {
      if (candidate.origin === "deepbrid-official") {
        thirdLine += " ⚡ Ready";
      } else if (candidate.origin === "easynews-direct") {
        thirdLine += " ✅ Direct CDN";
      } else {
        thirdLine += " ✅ Deepbrid";
      }
    } else {
      thirdLine += " ⚡ (Instant Resolve)";
    }

    const titleLines = [
      `🎥 ${titleStr}`,
      secondLine.join("  |  "),
      thirdLine
    ];

    if (candidate.status === "ready") {
      return {
        name: nameStr,
        title: titleLines.join("\n"),
        url: candidate.playableUrl!
      };
    } else {
      const encodedNzbUrl = encodeResolvePayload(candidate);
      return {
        name: nameStr,
        title: titleLines.join("\n"),
        url: `${baseUrl}/${token}/resolve/${encodedNzbUrl}`
      };
    }
  });
}
