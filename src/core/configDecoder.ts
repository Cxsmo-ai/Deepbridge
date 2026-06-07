export interface IndexerConfig {
  name?: string;
  url: string;
  key: string;
  limits?: {
    "2160p": number | "all";
    "1080p": number | "all";
    "720p": number | "all";
    "SD": number | "all";
  };
}

export interface UserConfig {
  deepbridApiKey: string;
  // Legacy
  indexerUrl?: string;
  indexerApiKey?: string;
  // New multiple indexers
  indexers?: IndexerConfig[];
  limits?: {
    "2160p": number | "all";
    "1080p": number | "all";
    "720p": number | "all";
    "SD": number | "all";
  };
}

export function decodeConfig(configString: string): UserConfig | null {
  try {
    // Revert URL-safe base64
    let base64 = configString.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && parsed.deepbridApiKey) {
      return parsed as UserConfig;
    }
    return null;
  } catch(e) {
    return null;
  }
}
