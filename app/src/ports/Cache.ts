// Port: redirect destination cache. Only the shorten-slice method is declared
// here; redirect/links slices will extend this with reads + tombstones.
export interface Cache {
  /** Best-effort cache of a resolved destination URL. */
  cacheUrl(code: string, url: string): Promise<void>;
}
