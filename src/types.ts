export interface Account { id: string; name: string; premium: boolean | null; premiumDays?: number }
export interface Status { account: Account | null; mirror: string; capabilities: { progress: boolean; watched: boolean; episodeSync?: boolean }; warnings?: string[] }
export interface Content { id: string; url: string; title: string; poster?: string; meta?: string; type: 'movie' | 'series'; rating?: string; status?: string }
export interface Page<T = Content> { items: T[]; page: number; hasMore: boolean }
export interface Translator { id: string; name: string }
export interface Episode { season: number; episode: number; title?: string; watched?: boolean }
export interface Rating { source: 'IMDb' | 'Кинопоиск' | 'World Art' | 'HDRezka'; score: string; votes?: string }
export interface Details extends Content { description: string; translators: Translator[]; episodes: Episode[]; year?: string; genres?: string[]; duration?: string; originalTitle?: string; releaseDate?: string; countries?: string[]; ageRating?: string; ratings?: Rating[]; selectedTranslatorId?: string }
export interface StreamVariant { id: string; label: string; url: string; height?: number; mime?: string; hdr?: string; audio?: string }
export interface Subtitle { id: string; label: string; language?: string; url: string; format?: string }
export interface PlaybackSource { variants: StreamVariant[]; subtitles: Subtitle[]; translatorId: string; season?: number; episode?: number }
export interface BookmarkList { id: string; name: string; count?: number }
export interface Progress { id: string; url?: string; translatorId?: string; providerTranslatorId?: string; season?: number; episode?: number; position: number | null; duration?: number; completed: boolean; updatedAt?: string; saveId?: string; positionSource?: 'local' | 'unavailable' }
export interface ContinueItem extends Content { progress: Progress }
export interface SaveProgress extends Omit<Progress, 'position'> { position: number; duration: number; localOnly?: boolean }
export interface ServiceFailure { code: string; message: string; retryable: boolean }
export interface Preferences { quality: string; translatorId: string; subtitleId: string; autoNext: boolean }

export interface Methods {
  status: { params: Record<string, never>; result: Status }
  configure: { params: { mirror: string }; result: Status }
  login: { params: { username: string; password: string }; result: Status }
  logout: { params: Record<string, never>; result: Status }
  catalog: { params: { category?: string; sort?: 'new' | 'popular'; page?: number }; result: Page }
  search: { params: { query: string; page?: number }; result: Page }
  details: { params: { url: string; translatorId?: string }; result: Details }
  streams: { params: { id: string; url: string; translatorId: string; season?: number; episode?: number }; result: PlaybackSource }
  subtitle: { params: { url: string }; result: { text: string } }
  bookmarkLists: { params: Record<string, never>; result: BookmarkList[] }
  bookmarks: { params: { listId?: string; page?: number }; result: Page }
  setBookmark: { params: { id: string; listId: string; added: boolean }; result: { success: true } }
  setEpisodeWatched: { params: { url: string; season: number; episode: number; watched: boolean }; result: { success: true } }
  continueWatching: { params: { page?: number }; result: Page<ContinueItem> }
  progress: { params: { id: string; url: string; translatorId?: string; season?: number; episode?: number }; result: Progress | null }
  saveProgress: { params: SaveProgress; result: { success: true; progress: Progress; localSaved: true; episodeSynced: boolean; syncError?: ServiceFailure } }
}
