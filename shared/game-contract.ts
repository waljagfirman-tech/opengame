/**
 * Game Studio contract shared by Studio (studio/src/motion/game) and the local
 * service (game-projects.ts, mounted at /api/games/).
 *
 * Flow: pick genre / style / setting → one-line single-player brief → the Agent
 * interviews, fixes a style formula, writes the game and validates it → the game
 * is published to the local game market where anyone can play it and remix it.
 */

export const gameGenres = ['shooter', 'platformer', 'story', 'casual', 'racing', 'horror'] as const;
export const gameStyles = ['pixel', 'minimal', 'ascii', 'voxel', 'anime', '3d'] as const;
export const gameSettings = ['medieval', 'cyberpunk', 'retro', 'modern', 'space', 'fantasy'] as const;

export type GameGenre = typeof gameGenres[number];
export type GameStyle = typeof gameStyles[number];
export type GameSetting = typeof gameSettings[number];

/** Lifecycle of a game project. Only `published` games appear in Explore. */
export type GameStatus = 'draft' | 'building' | 'ready' | 'published' | 'failed';

export type GameBrief = {
  prompt: string;
  genre: GameGenre | null;
  style: GameStyle | null;
  setting: GameSetting | null;
  multiplayer: boolean;
  /** Screen shape the game is built for; portrait is a 9:16 phone layout. Defaults to landscape. */
  orientation?: 'landscape' | 'portrait';
  /** Portrait only: build a playable ad (instant play, hand tutorial, short levels, end card with a call to action) instead of a regular game. */
  playableAd?: boolean;
};

export type GameCard = {
  id: string;
  title: string;
  /** The workspace owner named the game explicitly. Keep it when the Agent revises the game. */
  titleCustomized?: boolean;
  description: string;
  genre: GameGenre;
  style: GameStyle | null;
  setting: GameSetting | null;
  multiplayer: boolean;
  /** Max players per room; 1 for single-player games. */
  maxPlayers: number;
  /** Portrait games are built for a phone held upright (9:16); the stage shows them in a phone-shaped frame. */
  orientation?: 'portrait' | 'landscape';
  /** True when the game was built as a playable ad. */
  playableAd?: boolean;
  status: GameStatus;
  /** Studio-relative or absolute URL of the cover image. */
  cover: string | null;
  /** URL that loads the playable game (an HTML page). */
  playUrl: string;
  plays: number;
  likes: number;
  dislikes: number;
  /** The current viewer's reaction and favourite state. */
  reaction: -1 | 0 | 1;
  favorite: boolean;
  /** `template` games ship with OpenMotion; `mine` games were made in this workspace; `community` games are external links. */
  source: 'template' | 'mine' | 'community';
  /** Community games open on the creator's own site and cannot be remixed here. */
  external?: { url: string; author: string; postUrl: string; model: string; embeddable: boolean };
  remixOf: string | null;
  controls: string;
  /** Optional per-locale title, description and controls shipped with the game (e.g. { 'zh-CN': { title, description } }). */
  i18n?: Record<string, { title?: string; description?: string; controls?: string }>;
  /** Optional featured curation tags (e.g. "TOP赚钱") exposed as visible card badges and market filters. */
  tags?: string[];
  /** Latest trailer job for this game, if one was started. */
  trailer?: GameTrailer;
  createdAt: string;
  updatedAt: string;
};

/**
 * Trailer pipeline: the server records gameplay headlessly, then composes a short trailer as an OpenMotion video
 * project (title card from the cover, gameplay highlights, controls/invite end card) and renders an MP4.
 * POST /api/games/:id/trailer starts or restarts it; GET /api/games/:id/trailer reads the latest job.
 */
export type GameTrailerStatus = 'recording' | 'composing' | 'rendering' | 'ready' | 'failed';
export type GameTrailer = {
  status: GameTrailerStatus;
  /** 0–1 overall progress, when known. */
  progress?: number;
  /** Served MP4 of the finished trailer (game-relative URL under /api/games/:id/play/). */
  videoUrl?: string;
  /** Raw gameplay clips recorded for the trailer. */
  clips?: string[];
  /** The OpenMotion video project, so the user can keep editing the trailer in the Motion editor. */
  projectId?: string;
  error?: string;
  updatedAt: string;
};

/** A game folder the catalog could not read (an interrupted create or a malformed game.json); the other games still load. */
export type GameCatalogIssue = { id: string; message: string };
export type GameCatalog = { games: GameCard[]; issues?: GameCatalogIssue[] };

/** POST /api/games and POST /api/games/:id/remix return the new project and the Agent brief. */
export type GameCreated = { game: GameCard; agentInstruction: string };
/** GET /api/games/:id/handoff — the full instruction to give the user's Agent for a workspace draft. */
export type GameHandoff = { gameId: string; status: GameStatus; agentInstruction: string };

/**
 * Server-authoritative multiplayer rules (logic.js). The room server calls these;
 * the client only sends inputs (about 10 per second) and draws `viewFor` results.
 * logic.js must be deterministic: no imports, no Math.random, no Date.now —
 * use ctx.random() and ctx.now instead.
 */
export type GameLogicModule<State = unknown, Action = unknown, View = unknown> = {
  meta: { minPlayers: number; maxPlayers: number; tickRate?: number };
  setup(ctx: GameLogicContext, players: string[]): State;
  validateAction(state: State, playerId: string, action: Action, ctx: GameLogicContext): boolean;
  applyAction(state: State, playerId: string, action: Action, ctx: GameLogicContext): State;
  isGameOver(state: State, ctx: GameLogicContext): { over: boolean; winners?: string[] };
  viewFor(state: State, playerId: string, ctx: GameLogicContext): View;
};

export type GameLogicContext = { random(): number; now: number; tick: number };

/** Room socket: ws(s)://<host>/api/games/:id/rooms/:room */
export type RoomClientMessage =
  | { type: 'join'; name?: string; /** Returned in 'joined'; reclaims the same player within 30 s after a refresh. */ reconnectToken?: string }
  | { type: 'input'; action: unknown }
  | { type: 'start' };
export type RoomServerMessage =
  | { type: 'joined'; playerId: string; room: string; players: { id: string; name: string }[]; maxPlayers: number; reconnectToken: string }
  | { type: 'state'; view: unknown; tick: number }
  | { type: 'over'; winners?: string[] }
  | { type: 'error'; message: string };

export const gameAssetInstructions = 'Pure code-driven gameplay-first games where procedural visuals and Web Audio deliver a complete game stay outside media setup, sign-in, and upgrade prompts — build and deliver the playable game directly without calling, suggesting, or prompting for media generation. For planned generated media (character portraits, anime/realistic characters, illustrations/covers, sprites, textures, background music, character voice, or video), follow openmotion-media routing in openmotion://workflow/game/start: discover live models via openmotion_media_use (action="inspect" with modality for the specific asset type, then models with refresh:true and reference — or capability meta-tools when exposed), preferring usable OpenDesign models (mediaEntitlement included or signed-in unknown, not not-included). When the user explicitly asks for generated multimodal assets and no fitting provider is usable for that modality (signed out, Free/Go mediaEntitlement not-included, or rejected key), call openmotion_open_preview with the modality-scoped settingsHandoff from openmotion_media_use(action="inspect", modality=...) and pause in one turn with two clear choices: (1) sign in / upgrade to OpenDesign Plus (or save an API key) and reply to continue with AI assets, or (2) build a playable code-placeholder prototype first. Do not pre-block Plus+ accounts on cached hasBalance; if a real generation request fails with insufficient balance / balance is too low, stop without retrying, call openmotion_open_preview(target="providers", entry="agent_media_balance_low"), and ask the user to top up and reply to resume. When a usable model is ready, obtain one batched spend-consent check when required (skip if already granted or enforced by a host tool-approval gate; stop after PLAN + that consent question if waiting), submit concurrently via openmotion_assets_use(action="generate") (or live capability tools), author game logic/UI while jobs run, inspect via batch read, and embed literal /motion-api/assets/<assetId>/versions/<versionId>/media URLs (or import local .glb models into the asset library).';
