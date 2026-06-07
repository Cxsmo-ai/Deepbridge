import { MediaRequest } from "../deepbrid/apiClient";

export function makeMediaKey(media: MediaRequest): string {
  if (media.type === "movie") {
    return `movie:${media.imdbId}`;
  }
  return `series:${media.imdbId}:${media.season}:${media.episode}`;
}
