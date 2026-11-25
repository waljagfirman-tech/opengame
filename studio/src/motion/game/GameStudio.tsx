import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gameGenres, gameSettings, gameStyles, type GameCard, type GameCreated, type GameGenre, type GameSetting, type GameStyle } from '../../../../shared/game-contract';
import { rankSearchResults } from '../../../../shared/fuzzy-search';
import { buildSuperAgentHandoff } from '../../../../shared/capability-hub';
import { preservePresentation } from '../../../../shared/workspace-url';
import { StudioToastViewport } from '../../components/StudioToastViewport';
import { WebPublishPopover } from '../../components/WebPublishPopover';
import { useToast } from '../../hooks/useToast';
import { useI18n } from '../../i18n/I18n';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { RemixIcon } from '../../icons/RemixIcons';
import { WorkspaceBack } from '../WorkspaceBack';
import { useOptionalWorkspaceChrome } from '../WorkspaceChromeContext';
import { MotionIcon } from '../icons';
import { projectHref } from '../workspaceRouting';
import { Tooltip } from '../../components/ui/Tooltip';
import { GameMasonry, interleavePortrait } from './GameMasonry';
import { bundledGames, communityGames, communityRemixPrompt, composeBrief, coverUrl, formatPlays, gameApi, gameSource, isTopEarningGame, storedInstruction, genreCovers, genreLabels, settingCovers, styleCovers, genrePlaceholders, isLocalOnly, playableUrl, rememberInstruction, settingLabels, styleLabels, TOP_EARNING_TAG } from './gameCatalog';
import { buildGameContextTags, buildGameHiddenInstructions, buildGameUserPrompt, toGameArtifact, toGameCapabilityRef } from './gameSuperAgent';
import { optionId as optionFilter } from '../reporting';
import { reportGameAction, reportGameClick, reportGameCreate, reportGameDetailShown, reportGameHandoffShown, reportGameSearch } from './gameTracking';
import { newTrackingId } from '../reporting';
import './gameStudio.css';

type Menu = 'genre' | 'style' | 'setting';
type Sort = 'relevance' | 'plays' | 'newest';
const pending = (game: GameCard) => game.source === 'mine' && (game.status === 'draft' || game.status === 'building');

/**
 * Game Studio. The page is the game market; the composer is docked at the bottom. Picking a genre, style and
 * setting (and optionally one line of text) creates a local game draft and hands it off to Super Agent (or the
 * user's external MCP Agent) to build, validate and publish through the OpenMotion MCP game tools. Drafts refresh
 * until the Agent finishes, so their state changes here without reloading.
 */
export function GameStudio({
  onExplore,
  onOpenMcp,
  initialGameId = null,
}: {
  onExplore: () => void;
  onOpenMcp: () => void;
  initialGameId?: string | null;
}) {
  const { t, locale } = useI18n();
  const chrome = useOptionalWorkspaceChrome();
  const getGameTitle = useGameTitle();
  const toast = useToast();
  const [genre, setGenre] = useState<GameGenre | null>('shooter');
  const [style, setStyle] = useState<GameStyle | null>(null);
  const [setting, setSetting] = useState<GameSetting | null>(null);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  // Portrait games default to a playable ad.
  const [playableAd, setPlayableAd] = useState(true);
  const adBuild = orientation === 'portrait' && playableAd;
  const [prompt, setPrompt] = useState('');
  const [menu, setMenu] = useState<Menu>('genre');
  const [submitting, setSubmitting] = useState(false);
  const [games, setGames] = useState<GameCard[]>(bundledGames);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameGenre | 'all' | 'portrait' | 'top-earning'>('all');
  const [sort, setSort] = useState<Sort>('relevance');
  // The open project is tracked by id so polling updates reach it.
  // ?game=<id> opens that game's detail page directly (used by links from Assets and Super Agent).
  const [openId, setOpenIdState] = useState<string | null>(() => initialGameId ?? new URLSearchParams(location.search).get('game'));
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set('game', id); else url.searchParams.delete('game');
    history.replaceState(history.state, '', url);
  };
  useEffect(() => {
    if (initialGameId) setOpenIdState(initialGameId);
  }, [initialGameId]);
  useEffect(() => {
    const onPopState = () => setOpenIdState(new URLSearchParams(location.search).get('game'));
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);
  // The full composer sits at the top of the page. Once it scrolls away, a docked copy floats over the bottom edge: one line
  // while scrolling down, full size while scrolling up. It overlays the page, so its size never moves the content.
  const [scrolledUp, setScrolledUp] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const hero = useRef<HTMLElement>(null);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const expanded = toggled ?? (scrolledUp || focused);
  const notify = (message: string, tone: 'info' | 'error') => toast.showToast(message, tone);

  const statuses = useRef(new Map<string, GameCard['status']>());
  const loaded = useRef(false), openRef = useRef(openId);
  openRef.current = openId;
  const load = () => gameApi.catalog().then(catalog => {
    // A draft that appears without this page creating it was started by an Agent from its own chat (openmotion_game_create).
    // Jump to it when nothing else is open; otherwise point to the side list without interrupting the game being played.
    if (loaded.current) {
      const fresh = catalog.games.find(game => game.source === 'mine' && pending(game) && !statuses.current.has(game.id));
      if (fresh) {
        if (!openRef.current) setOpenId(fresh.id);
        else notify(t('Your Agent started {title}. Find it in My games.', { title: fresh.title }), 'info');
      }
    }
    loaded.current = true;
    // Announce drafts that the Agent finished or abandoned since the last refresh.
    for (const game of catalog.games) {
      const before = statuses.current.get(game.id);
      if (before && before !== game.status && game.source === 'mine') {
        if (game.status === 'published' || game.status === 'ready') notify(t('{title} is ready to play.', { title: game.title }), 'info');
        if (game.status === 'failed') notify(t('{title} could not be finished. Hand it to your Agent again.', { title: game.title }), 'error');
      }
      statuses.current.set(game.id, game.status);
    }
    setGames(catalog.games); setOffline(false);
  }).catch(() => { setGames(current => current.some(game => game.source === 'mine') ? current : bundledGames); setOffline(true); });
  useEffect(() => { void load(); }, []);
  // Poll every 4 s while the page is visible, so drafts an Agent starts from its chat show up and open on their own.
  useVisibilityPolling(() => load(), { intervalMs: 4000, immediate: false });
  useEffect(() => {
    const scroller = root.current;
    if (!scroller) return;
    let last = scroller.scrollTop, settledAt = 0;
    const onScroll = () => {
      const top = scroller.scrollTop;
      // Ignore small movements and anything within 250 ms of the previous change so the dock never oscillates.
      if (performance.now() - settledAt < 250) { last = top; return; }
      if (top < last - 24) { setScrolledUp(true); settledAt = performance.now(); }
      else if (top > last + 24) { setScrolledUp(false); settledAt = performance.now(); }
      else return;
      if (Math.abs(top - last) > 6) setToggled(null);
      last = top;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new IntersectionObserver(([entry]) => { setHeroVisible(entry.isIntersecting); if (entry.isIntersecting) { setScrolledUp(false); setToggled(null); } }, { root: scroller, threshold: 0.15 });
    if (hero.current) observer.observe(hero.current);
    return () => { scroller.removeEventListener('scroll', onScroll); observer.disconnect(); };
  }, []);
  const update = (card: GameCard) => setGames(list => list.map(game => game.id === card.id ? card : game));

  const brief = composeBrief({ prompt, genre, style, setting, multiplayer: false });
  const failure = (error: unknown) => error instanceof TypeError || offline
    ? t('The local game service is not available. Update OpenMotion and try again.')
    : t('The game could not be created: {reason}', { reason: (error as Error).message });
  const started = (created: GameCreated): 'super_agent' | 'detail' => {
    rememberInstruction(created.game.id, created.agentInstruction);
    statuses.current.set(created.game.id, created.game.status);
    setGames(list => [created.game, ...list.filter(game => game.id !== created.game.id)]);
    if (chrome?.openInSuperAgent) {
      const displayTitle = getGameTitle(created.game);
      const ready = created.game.status === 'ready' || created.game.status === 'published';
      setOpenIdState(null);
      const handoff = buildSuperAgentHandoff(toGameCapabilityRef(created.game, displayTitle), {
        prompt: buildGameUserPrompt(created.game, locale),
        hiddenInstructions: buildGameHiddenInstructions(created.game, created.agentInstruction),
        contextTags: buildGameContextTags(created.game, t),
        locale,
        newChat: true,
        autoSend: true,
        ...(ready ? { initialArtifact: toGameArtifact(created.game, displayTitle) } : {}),
      });
      chrome.openInSuperAgent({ ...handoff, title: ready ? displayTitle : undefined });
      return 'super_agent';
    }
    setOpenId(created.game.id);
    return 'detail';
  };
  const createError = (error: unknown) => error instanceof TypeError || offline ? 'service_unavailable' as const : 'rejected' as const;
  const continueInSuperAgent = (game: GameCard, instruction: string) => {
    if (!chrome?.openInSuperAgent || game.multiplayer) return;
    const displayTitle = getGameTitle(game);
    setOpenIdState(null);
    const handoff = buildSuperAgentHandoff(toGameCapabilityRef(game, displayTitle), {
      prompt: buildGameUserPrompt(game, locale),
      hiddenInstructions: buildGameHiddenInstructions(game, instruction),
      contextTags: buildGameContextTags(game, t),
      locale,
      newChat: true,
      autoSend: true,
    });
    chrome.openInSuperAgent({ ...handoff, title: undefined });
  };
  const editInSuperAgent = (game: GameCard) => {
    if (!chrome?.openInSuperAgent || game.multiplayer) return;
    const displayTitle = getGameTitle(game);
    setOpenIdState(null);
    chrome.openInSuperAgent({
      ...buildSuperAgentHandoff(toGameCapabilityRef(game, displayTitle), {
        locale,
        newChat: true,
        autoSend: false,
        initialArtifact: toGameArtifact(game, displayTitle),
      }),
      prompt: '',
    });
  };
  const submit = async () => {
    if (!brief || submitting) return;
    setSubmitting(true);
    const tracked = { brief: { genre, style, setting, orientation, multiplayer: false, playableAd: adBuild, hasPrompt: Boolean(prompt.trim()) } };
    // Choosing options without typing is enough to start: the composed brief becomes the prompt.
    try {
      const created = await gameApi.create({ prompt: prompt.trim() || brief, genre, style, setting, multiplayer: false, orientation, playableAd: adBuild });
      reportGameCreate('brief', { game: created.game, handoff: started(created) }, tracked); setPrompt('');
    }
    catch (error) { reportGameCreate('brief', { error: createError(error) }, tracked); notify(failure(error), 'error'); }
    finally { setSubmitting(false); }
  };
  const remix = async (game: GameCard) => {
    if (game.multiplayer) return;
    // Community games are not copied: a new original game is briefed from their genre, style and description.
    try {
      const created = game.external
        ? await gameApi.create({ prompt: communityRemixPrompt(game), genre: game.genre, style: game.style, setting: game.setting, multiplayer: false, orientation: game.orientation ?? 'landscape' })
        : await gameApi.remix(game.id);
      reportGameCreate('remix', { game: created.game, handoff: started(created) }, { source: game });
    }
    catch (error) { reportGameCreate('remix', { error: createError(error) }, { source: game }); notify(failure(error), 'error'); }
  };
  const open = (game: GameCard, area: 'game_market' | 'game_sidebar' = 'game_market', position?: number) => {
    reportGameClick(area, 'open_game', game, position === undefined ? {} : { position });
    // Sites that refuse to be embedded open in a new window; everything else plays in the project view.
    setOpenId(game.id);
  };

  // Popular games from social media lead the market, followed by the built-in templates and the user's games.
  const all = useMemo(() => [...communityGames, ...games], [games]);
  const opened = openId ? all.find(game => game.id === openId) ?? null : null;
  const fanned = all.filter(game => game.source !== 'mine' && game.status === 'published' && coverUrl(game)).slice(0, 5);
  const visible = useMemo(() => {
    const needle = query.trim();
    // Explore lists templates and community games only; games made here live in Assets → Games.
    const byCategory = all.filter(game => game.source !== 'mine' && game.status === 'published'
      && (category === 'all'
        || (category === 'portrait' ? game.orientation === 'portrait'
          : category === 'top-earning' ? isTopEarningGame(game)
          : game.genre === category)));
    const list = needle
      ? rankSearchResults(byCategory, needle, game => ({
          id: game.id,
          title: game.i18n?.[locale]?.title ?? game.title,
          subtitle: t(genreLabels[game.genre]),
          description: game.i18n?.[locale]?.description ?? game.description,
          tags: [game.genre, ...(game.style ? [game.style] : []), ...(game.setting ? [game.setting] : []), ...(game.tags ?? [])],
          aliases: [
            game.title,
            game.description,
            ...Object.values(game.i18n ?? {}).flatMap(loc => [loc?.title ?? '', loc?.description ?? '']),
          ],
        })).map(r => r.item)
      : byCategory;
    if (sort === 'plays') return [...list].sort((a, b) => b.plays - a.plays);
    if (sort === 'newest') return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return needle ? list : interleavePortrait(list);
  }, [all, category, query, sort, t, locale]);
  // The user's own games, newest first, live in the side list like projects in the Motion editor.
  const mine = useMemo(() => games.filter(game => game.source === 'mine').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [games]);
  const lastSearchKey = useRef('');
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { lastSearchKey.current = ''; return; }
    const key = `${trimmed}\0${category}\0${visible.length}`;
    if (key === lastSearchKey.current) return;
    const timer = window.setTimeout(() => {
      lastSearchKey.current = key;
      reportGameSearch(newTrackingId(), trimmed, visible.length, category);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query, category, visible.length]);
  const browsing = category === 'all' && !query.trim();
  const rows = [
    ...(browsing ? [
      { id: 'featured', title: t('Templates'), icon: 'gamepad-line', games: visible },
    ] : [{
      id: 'all',
      title: category === 'all' ? t('All games') : category === 'portrait' ? t('Portrait games') : category === 'top-earning' ? TOP_EARNING_TAG : t('{genre} games', { genre: t(genreLabels[category]) }),
      icon: category === 'top-earning' ? 'sparkling-fill' : 'gamepad-line',
      games: visible,
    }]),
  ];

  const options: { id: string; label: string; cover?: string | null; selected: boolean; pick: () => void }[] = menu === 'genre'
    ? gameGenres.map(id => ({ id, label: t(genreLabels[id]), cover: genreCovers[id], selected: genre === id, pick: () => setGenre(genre === id ? null : id) }))
    : menu === 'style' ? gameStyles.map(id => ({ id, label: t(styleLabels[id]), cover: styleCovers[id], selected: style === id, pick: () => { setStyle(style === id ? null : id); setMenu('genre'); } }))
    : gameSettings.map(id => ({ id, label: t(settingLabels[id]), cover: settingCovers[id], selected: setting === id, pick: () => { setSetting(setting === id ? null : id); setMenu('genre'); } }));

  // The same composer renders inline at the top of the page and, once that scrolls away, docked at the bottom.
  const renderComposer = (mode: 'hero' | 'dock') =>
    <div className="om-game-composer" data-mode={mode} onFocus={() => mode === 'dock' && setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
        {mode === 'dock' && <IconButton variant="ghost" className="motion-icon-button om-game-dock-toggle" aria-expanded={expanded} aria-label={expanded ? t('Collapse') : t('Expand')}
          onClick={() => { setToggled(!expanded); if (expanded) { setFocused(false); setMenu('genre'); input.current?.blur(); } }} icon={<RemixIcon name={expanded ? 'arrow-down-s-line' : 'arrow-up-s-line'} size={18} />} />}
        <div className="om-game-options" role="group" aria-label={menu === 'genre' ? t('Genre') : menu === 'style' ? t('Style') : t('Setting')} data-menu={menu} data-collapsed={mode === 'dock' && !expanded}>
          {options.map(option => <Button key={option.id} variant="plain" className="om-game-option" aria-pressed={option.selected} onClick={() => { reportGameClick('game_composer', 'game_option', null, { game_option_kind: menu, selected: !option.selected, ...optionFilter(option.id) }); option.pick(); }}>
            {option.cover !== undefined && <span className="om-game-option-art">{option.cover && <img src={option.cover} alt="" />}</span>}
            <span>{option.label}</span>
          </Button>)}
        </div>
        <div className="om-game-input">
          <textarea ref={mode === 'hero' ? input : undefined} rows={3} maxLength={600} value={prompt} placeholder={t(genrePlaceholders[genre ?? 'none'])} aria-label={t('Describe your game')}
            onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (brief && !submitting) reportGameClick('game_composer', 'submit_game'); void submit(); } }} />
          <div className="om-game-input-bar">
            {genre && <span className="om-game-chip" data-active="true"><span className="om-game-chip-art">{genreCovers[genre] && <img src={genreCovers[genre]!} alt="" />}</span>{t(genreLabels[genre])}
              <IconButton variant="plain" className="om-game-chip-clear" aria-label={t('Remove genre')} onClick={() => setGenre(null)} icon={<RemixIcon name="close-line" size={14} />} /></span>}
            <Button variant="plain" className="om-game-chip" aria-expanded={menu === 'style'} data-active={Boolean(style)} onClick={() => { setToggled(null); setMenu(menu === 'style' ? 'genre' : 'style'); }}>
              <RemixIcon name="brush-line" size={15} />{style ? t(styleLabels[style]) : t('Style')}</Button>
            <Button variant="plain" className="om-game-chip" aria-expanded={menu === 'setting'} data-active={Boolean(setting)} onClick={() => { setToggled(null); setMenu(menu === 'setting' ? 'genre' : 'setting'); }}>
              <RemixIcon name="landscape-line" size={15} />{setting ? t(settingLabels[setting]) : t('Setting')}</Button>
            <span className="om-game-ratio" role="radiogroup" aria-label={t('Aspect ratio')}>
              {(['landscape', 'portrait'] as const).map(id => <Button key={id} variant="plain" role="radio" className="om-game-ratio-option" aria-checked={orientation === id} onClick={() => { if (orientation !== id) reportGameClick('game_composer', 'game_option', null, { game_option_kind: 'orientation', selected: true, ...optionFilter(id) }); if (id === 'portrait' && orientation !== 'portrait') setPlayableAd(true); setOrientation(id); }}>
                <RemixIcon name={id === 'portrait' ? 'smartphone-line' : 'computer-line'} size={15} />{t(id === 'portrait' ? 'Portrait' : 'Landscape')}</Button>)}
            </span>
            {orientation === 'portrait' && <label className="om-game-switch"><input type="checkbox" role="switch" checked={playableAd} onChange={event => { reportGameClick('game_composer', 'game_option', null, { game_option_kind: 'playable_ad', selected: event.target.checked }); setPlayableAd(event.target.checked); }} /><span aria-hidden="true" />{t('Playable ad')}</label>}
            <IconButton variant="ghost" className="om-game-send" aria-label={t('Start building')} disabled={!brief || submitting} onClick={() => { reportGameClick('game_composer', 'submit_game'); void submit(); }}
              icon={<RemixIcon name={submitting ? 'loader-4-line' : 'arrow-up-line'} size={18} />} />
          </div>
        </div>
      </div>;

  return <div className="om-game-studio">
    <GameSidebar games={mine} openId={openId} onOpen={game => open(game, 'game_sidebar')} />
    <div className="om-game-main">
    <div ref={root} className="om-game-scroll">
    <div className="om-game-page">
      <WorkspaceBack fallback={onExplore} />
      <section className="om-game-showcase" aria-label={t('Game Studio')}>
        {/* The five most popular games fan out above the headline; each opens its detail page. */}
        <div className="om-game-fan">{fanned.map((game, index) => <Button key={game.id} variant="plain" className="om-game-fan-card" data-slot={index} aria-label={t('Play {title}', { title: game.title })} onClick={() => open(game, 'game_market', index)}>
          {coverUrl(game) && <img src={coverUrl(game)!} alt="" />}<span className="om-game-fan-label">{t(genreLabels[game.genre])}</span>
        </Button>)}</div>
        <h1 className="om-game-headline">{t('Create your own game in minutes')}</h1>
      </section>
      <section ref={hero} className="om-game-hero" aria-label={t('Describe your game')}>{renderComposer('hero')}</section>
      <section className="om-game-market" aria-label={t('Game market')}>
        <h2 className="om-title om-game-explore-title">{t('Explore templates')}</h2>
        <div className="om-game-filters">
          <div className="om-game-genres" role="tablist" aria-label={t('Category')}>
            <Button variant="plain" role="tab" className="om-game-genre-chip" aria-selected={category === 'all'} onClick={() => { if (category !== 'all') reportGameClick('game_market', 'category_select', null, optionFilter('all')); setCategory('all'); }}>
              <RemixIcon name="layout-grid-line" size={15} />{t('All')}</Button>
            <Button variant="plain" role="tab" className="om-game-genre-chip om-game-genre-chip--featured" aria-selected={category === 'top-earning'} onClick={() => { if (category !== 'top-earning') reportGameClick('game_market', 'category_select', null, optionFilter('top-earning')); setCategory('top-earning'); }}>
              <RemixIcon name="sparkling-fill" size={15} />{TOP_EARNING_TAG}</Button>
            {gameGenres.map(id => <Button key={id} variant="plain" role="tab" className="om-game-genre-chip" aria-selected={category === id} onClick={() => { if (category !== id) reportGameClick('game_market', 'category_select', null, optionFilter(id)); setCategory(id); }}>
              {genreCovers[id] && <img src={genreCovers[id]!} alt="" />}{t(genreLabels[id])}</Button>)}
            <Button variant="plain" role="tab" className="om-game-genre-chip" aria-selected={category === 'portrait'} onClick={() => { if (category !== 'portrait') reportGameClick('game_market', 'category_select', null, optionFilter('portrait')); setCategory('portrait'); }}><RemixIcon name="smartphone-line" size={15} />{t('Portrait')}</Button>
          </div>
          <span className="om-game-selects">
            <span className="om-field om-game-search"><RemixIcon name="search-line" size={15} /><input value={query} placeholder={t('Search')} aria-label={t('Search games')} onFocus={() => reportGameClick('game_market', 'search_focus')} onChange={event => setQuery(event.target.value)} /></span>
            <label className="om-field"><RemixIcon name="sort-desc" size={15} /><select value={sort} aria-label={t('Sort')} onChange={event => { reportGameClick('game_market', 'sort_option', null, optionFilter(event.target.value)); setSort(event.target.value as Sort); }}>
              <option value="relevance">{t('Relevance')}</option><option value="plays">{t('Most played')}</option><option value="newest">{t('Newest')}</option></select></label>
          </span>
        </div>
        {offline && <p className="om-muted om-game-note">{t('Showing the built-in games. Your games appear once the local game service is running.')}</p>}
        {rows.filter(row => row.games.length || row.id === 'all').map(row => <section key={row.id} className="om-game-row" aria-label={row.title}>
          {row.id !== 'featured' && <header><h2 className="om-subtitle"><RemixIcon name={row.icon} size={16} />{row.title}</h2></header>}
          {row.games.length ? <GameMasonry games={row.games} minColumn={280} render={game => <GameTile key={game.id} game={game} locale={locale} onOpen={() => open(game)} />} />
            : <div className="om-discovery-empty"><span>{t('No games match these filters.')}</span></div>}
        </section>)}
      </section>
    </div>

    </div>
    {/* Kept mounted so it can slide in and out; inert while the inline composer is on screen. */}
    <div className="om-game-dock" data-visible={!heroVisible} data-expanded={expanded} inert={heroVisible || undefined} aria-hidden={heroVisible || undefined}>{renderComposer('dock')}</div>
    </div>

    {/* The detail page covers the whole window, so it renders outside the workspace frame that clips fixed layers. */}
    {opened && createPortal(<GameProject key={opened.id} game={opened} offline={offline} onClose={() => setOpenId(null)} onRemix={() => { reportGameClick('game_detail', 'remix_game', opened); void remix(opened); }} onChange={update} onOpenMcp={onOpenMcp} onContinueInSuperAgent={chrome?.openInSuperAgent ? (instruction => { reportGameClick('game_handoff', 'continue_in_agent', opened); continueInSuperAgent(opened, instruction); }) : undefined} onEditInSuperAgent={chrome?.openInSuperAgent ? (() => { reportGameClick('game_detail', 'edit_in_agent', opened); editInSuperAgent(opened); }) : undefined} notify={notify} />, document.body)}
    <StudioToastViewport toasts={toast.toasts} dismissToast={toast.dismissToast} />
  </div>;
}

/** A game's own translation of a text field, falling back to the English original. */
const localized = (game: GameCard, field: 'description' | 'controls', locale: string) => game.i18n?.[locale]?.[field] ?? game[field];

/** Drafts started from options alone carry the composed English brief as their title; show the picked options instead. */
export function useGameTitle() {
  const { t, locale } = useI18n();
  return (game: GameCard) => game.i18n?.[locale]?.title ? game.i18n[locale]!.title!
    : game.source === 'mine' && /^Make an original game in the spirit of "([^"]+)"/.test(game.title) ? t('Remix') + ' · ' + /"([^"]+)"/.exec(game.title)![1]
    : game.source === 'mine' && /\b(style|setting)\b|with multiplayer/.test(game.title)
    ? [game.setting && t(settingLabels[game.setting]), game.style && t(styleLabels[game.style]), t(genreLabels[game.genre]), game.multiplayer && t('Multiplayer')].filter(Boolean).join(' · ')
    : game.title;
}

/** Canonical editor URL for opening a game's rendered trailer project in Motion. */
export function trailerProjectHref(projectId: string, currentSearch = ''): string {
  return preservePresentation(projectHref(projectId), currentSearch);
}

// One-click trailers are hidden this release; the service and MCP tool stay available.
const trailersEnabled = false;

const trailerSteps: Record<'recording' | 'composing' | 'rendering' | 'ready' | 'failed', string> = {
  recording: 'Recording gameplay…', composing: 'Cutting the trailer…', rendering: 'Rendering video…', ready: 'Watch the trailer', failed: 'Make a trailer' };

// A draft waits for the user's Agent until the Agent itself sets building (openmotion_game_set_status).
const statusLabels: Partial<Record<GameCard['status'], string>> = { draft: 'Waiting for your Agent', building: 'Agent is running', ready: 'Ready to publish', failed: 'Not finished' };

function GameTile({ game, locale, onOpen }: { game: GameCard; locale: string; onOpen: () => void }) {
  const { t } = useI18n();
  const title = useGameTitle()(game);
  // A draft has no cover until the Agent makes one; the genre artwork stands in.
  const cover = coverUrl(game) ?? (game.source === 'mine' ? genreCovers[game.genre] : null);
  const status = game.source === 'mine' ? statusLabels[game.status] : undefined;
  const topEarning = isTopEarningGame(game);
  const label = pending(game) || game.status === 'failed' ? t('Show the Agent instruction for {title}', { title }) : t('Play {title}', { title });
  return <article className="om-game-tile" data-status={game.status} data-orientation={game.orientation === 'portrait' ? 'portrait' : undefined}>
    <Button variant="plain" className="om-game-tile-cover" onClick={onOpen} aria-label={label}>
      {/* Portrait games share the 16:9 card: the cover sits whole in the middle over a blurred copy of itself. */}
      {cover && game.orientation === 'portrait' && <img className="om-game-tile-backdrop" src={cover} alt="" loading="lazy" decoding="async" />}
      {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <span className="om-game-tile-placeholder">{title}</span>}
      {topEarning && !status && !(game.external && !game.external.embeddable) && <span className="om-game-tag-featured"><RemixIcon name="sparkling-fill" size={12} />{TOP_EARNING_TAG}</span>}
      {game.orientation === 'portrait' && !game.multiplayer && <span className="om-game-badge"><RemixIcon name="smartphone-line" size={13} />{t('Portrait')}</span>}
      {status && <span className="om-game-status" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={13} />}{t(status)}</span>}
      {game.external && !game.external.embeddable && <span className="om-game-status"><RemixIcon name="external-link-line" size={13} />{t('External link')}</span>}
      {game.multiplayer && <span className="om-game-badge"><RemixIcon name="group-line" size={13} />{t('{count} players', { count: game.maxPlayers })}</span>}
    </Button>
    <div className="om-game-tile-meta">
      <span className="om-game-tile-icon">{cover && <img src={cover} alt="" />}</span>
      <strong>{title}</strong>
      {game.external ? <a className="om-muted" href={game.external.postUrl} target="_blank" rel="noopener noreferrer">{game.external.author}</a>
        : game.plays > 0 && <span className="om-muted"><RemixIcon name="play-circle-line" size={14} />{formatPlays(game.plays, locale)}</span>}
    </div>
  </article>;
}

/**
 * Project view: details, Agent hand-off and actions on the left; the playable game on the right.
 * Drafts show the Agent's progress and load the game as soon as it is ready.
 */
function GameProject({ game, offline, onClose, onRemix, onChange, onOpenMcp, onContinueInSuperAgent, onEditInSuperAgent, notify }: {
  game: GameCard; offline: boolean; onClose: () => void; onRemix: () => void; onChange: (game: GameCard) => void; onOpenMcp: () => void; onContinueInSuperAgent?: (instruction: string) => void; onEditInSuperAgent?: () => void; notify: (message: string, tone: 'info' | 'error') => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<'preview' | 'code' | 'trailer'>('preview');
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null), close = useRef<HTMLButtonElement>(null), stage = useRef<HTMLDivElement>(null);
  // One play result per opened game: success when the game frame finished loading, failure when no playable page could be resolved.
  // Reloads and the catalogue swapping the built-in copy for the served game are not new plays.
  const playReported = useRef(false);
  const gameTitle = useGameTitle();
  const mine = game.source === 'mine';
  const playable = !pending(game) && game.status !== 'failed';
  const hasCode = playable && !game.external;
  // Trailer: record gameplay headlessly, compose an OpenMotion video and render it (runs in the local service).
  const trailer = game.trailer;
  const trailerBusy = trailer && ['recording', 'composing', 'rendering'].includes(trailer.status);
  const trailerReady = trailersEnabled && trailer?.status === 'ready' && Boolean(trailer.videoUrl);
  const canTrailer = trailersEnabled && playable && !game.external && !offline;
  const status = mine ? statusLabels[game.status] : undefined;
  useEffect(() => {
    if (!playable) { setUrl(null); return; }
    let revoked: string | null = null, cancelled = false;
    // Multiplayer games join a room straight away: the preview supplies one, so nobody types a room code.
    const withRoom = (value: string) => {
      if (!game.multiplayer || value.startsWith('blob:') || game.external) return value;
      const target = new URL(value, location.href); if (!target.searchParams.has('room')) target.searchParams.set('room', 'play-' + Math.random().toString(36).slice(2, 8));
      return target.pathname + target.search;
    };
    void playableUrl(game).then(withRoom).then(next => { if (cancelled) { if (next.startsWith('blob:')) URL.revokeObjectURL(next); return; } if (next.startsWith('blob:')) revoked = next; setUrl(next); })
      .catch(() => { if (cancelled) return; if (!playReported.current) { playReported.current = true; reportGameAction('play', 'failure', game); } notify(t('This game could not be loaded.'), 'error'); });
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
    // playUrl changes from the built-in copy to the served game once the catalogue loads; follow it so ./assets resolve.
  }, [game.id, game.playUrl, playable, reload]);
  useEffect(() => { if (playable && !offline && !game.external) gameApi.play(game.id).then(onChange).catch(() => {}); }, [game.id, playable]);
  // Re-read the source on every reload too, so the Code tab never stays on "Loading game…" after Reload.
  useEffect(() => {
    if (view !== 'code' || !playable || source !== null) return;
    let live = true;
    void gameSource(game).then(text => { if (live) setSource(text); }).catch(() => { if (live) setSource(''); });
    return () => { live = false; };
  }, [view, playable, source, reload]);
  useEffect(() => {
    if (!trailerBusy) return;
    const timer = setInterval(() => { void gameApi.trailer(game.id).then(next => onChange({ ...game, trailer: next })).catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [game.id, trailerBusy]);
  const startTrailer = async (regenerate = false) => {
    reportGameClick('game_detail', regenerate ? 'regenerate_trailer' : 'create_trailer', game);
    try {
      const next = await gameApi.startTrailer(game.id);
      reportGameAction(regenerate ? 'regenerate_trailer' : 'start_trailer', 'success', game);
      onChange({ ...game, trailer: next });
      notify(t('Making the trailer. It takes a few minutes; you can keep playing.'), 'info');
    }
    catch (error) {
      reportGameAction(regenerate ? 'regenerate_trailer' : 'start_trailer', 'failure', game);
      notify(t('The trailer could not be started: {reason}', { reason: (error as Error).message }), 'error');
    }
  };
  const openTrailerProject = () => {
    if (!trailer?.projectId) return;
    reportGameClick('game_detail', 'open_trailer_project', game);
    reportGameAction('open_trailer_project', 'success', game);
    window.location.assign(trailerProjectHref(trailer.projectId, location.search));
  };
  useEffect(() => { reportGameDetailShown(game); }, [game.id]);
  useEffect(() => { close.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && document.activeElement !== frame.current && !(document.activeElement instanceof Element && document.activeElement.closest('.om-web-publish-popover'))) onClose(); }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  const act = (action: 'favorite' | 'unfavorite' | 'like' | 'dislike' | 'clear_reaction', request: () => Promise<GameCard>) => {
    if (offline) { reportGameAction(action, 'unavailable', game); notify(t('Start the local game service to save reactions.'), 'info'); return; }
    void request().then(next => { reportGameAction(action, 'success', game); onChange(next); }).catch(() => { reportGameAction(action, 'failure', game); notify(t('Could not save. Try again.'), 'error'); });
  };
  // Games are published to this computer only. The link is copied for local use and labelled as such.
  const share = async () => {
    reportGameClick('game_detail', 'copy_game_link', game);
    if (!url || url.startsWith('blob:')) { reportGameAction('copy_link', 'unavailable', game); notify(t('This game has no shareable link yet.'), 'info'); return; }
    const link = new URL(url, location.href).href;
    const canShareOnline = playable && !game.external && !offline;
    try { await navigator.clipboard.writeText(link); reportGameAction('copy_link', 'success', game); notify(isLocalOnly(link) ? t(canShareOnline ? 'Local link copied. It only opens on this computer — use Share to publish online.' : 'Local link copied. It only opens on this computer.') : t('Game link copied.'), 'info'); }
    catch { reportGameAction('copy_link', 'failure', game); notify(t('Could not copy the link.'), 'error'); }
  };
  const popout = () => { if (url) reportGameClick('game_detail', 'open_external', game); if (url) window.open(url.startsWith('blob:') ? url : new URL(url, location.href).href, '_blank', 'noopener'); };
  return <div className="om-game-project" role="dialog" aria-modal="true" aria-label={game.title}>
    <header className="om-game-project-top">
      <IconButton ref={close} variant="ghost" className="motion-icon-button" aria-label={t('All games')} onClick={onClose} icon={<RemixIcon name="arrow-left-line" size={18} />} />
      <h1 className="om-subtitle">{gameTitle(game)}</h1>
      {isTopEarningGame(game) && <span className="om-game-tag-pill"><RemixIcon name="sparkling-fill" size={13} />{TOP_EARNING_TAG}</span>}
    </header>
    <aside className="om-game-project-side">
      <div className="om-game-project-body">
        {status && <p className="om-game-status-line" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={14} />}{t(status)}</p>}
        {(gameTitle(game) === game.title || game.i18n?.[locale]?.title) && <p>{localized(game, 'description', locale)}</p>}
        <dl className="om-game-facts">
          <div><dt>{t('Genre')}</dt><dd>{t(genreLabels[game.genre])}</dd></div>
          {game.style && <div><dt>{t('Style')}</dt><dd>{t(styleLabels[game.style])}</dd></div>}
          {game.setting && <div><dt>{t('Setting')}</dt><dd>{t(settingLabels[game.setting])}</dd></div>}
          <div><dt>{t('Players')}</dt><dd>{game.multiplayer ? t('{count} players', { count: game.maxPlayers }) : t('Single player')}</dd></div>
          {game.controls && <div><dt>{t('Controls')}</dt><dd>{localized(game, 'controls', locale)}</dd></div>}
        </dl>
        {/* While the Agent works, the panel shows only status and facts; the instruction stays out of the way. */}
      </div>
      {game.external && <footer className="om-game-actions">
        {!game.multiplayer && <Button variant="ghost" className="om-button h-auto" data-primary onClick={onRemix}><RemixIcon name="add-line" size={16} />{t('Remix')}</Button>}
        <a className="om-button h-auto" href={game.external.postUrl} target="_blank" rel="noopener noreferrer"><RemixIcon name="external-link-line" size={15} />{t('Made by {author} · {model}', { author: game.external.author, model: game.external.model })}</a></footer>}
      {canTrailer && <div className="om-game-trailer">
        {trailerBusy ? <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" disabled><RemixIcon name="loader-4-line" size={16} />{t(trailerSteps[trailer!.status])}{typeof trailer!.progress === 'number' ? ` · ${Math.round(trailer!.progress * 100)}%` : ''}</Button>
          : trailerReady ? <>
            <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" onClick={() => setView('trailer')}><RemixIcon name="film-line" size={16} />{t('Trailer')}</Button>
            <span className="om-game-actions">
              {trailer!.projectId && <Button variant="ghost" className="om-button h-auto" onClick={openTrailerProject}><RemixIcon name="edit-line" size={15} />{t('Edit in Motion')}</Button>}
              <Button variant="ghost" className="om-button h-auto" onClick={() => void startTrailer(true)}><RemixIcon name="refresh-line" size={15} />{t('Regenerate')}</Button>
            </span></>
          : <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" onClick={() => void startTrailer(false)}><RemixIcon name="film-line" size={16} />{t('Create trailer')}</Button>}
        {trailer?.status === 'failed' && <p className="om-game-trailer-error">{t('The trailer could not be made: {reason}', { reason: trailer.error ?? '' })}</p>}
      </div>}
      {playable && !game.external && !mine && <footer className="om-game-actions" role="toolbar" aria-label={t('Game actions')}>
        {!game.multiplayer && <Button variant="ghost" className="om-button h-auto" data-primary onClick={onRemix}><RemixIcon name="add-line" size={16} />{t('Remix')}</Button>}
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.favorite} aria-label={game.favorite ? t('Remove from favorites') : t('Add to favorites')} onClick={() => { reportGameClick('game_detail', 'favorite_game', game, { selected: !game.favorite }); act(game.favorite ? 'unfavorite' : 'favorite', () => gameApi.favorite(game.id, !game.favorite)); }} icon={<RemixIcon name={game.favorite ? 'bookmark-fill' : 'bookmark-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.reaction === 1} aria-label={t('Like')} onClick={() => { reportGameClick('game_detail', 'like_game', game, { selected: game.reaction !== 1 }); act(game.reaction === 1 ? 'clear_reaction' : 'like', () => gameApi.react(game.id, game.reaction === 1 ? 0 : 1)); }} icon={<RemixIcon name={game.reaction === 1 ? 'thumb-up-fill' : 'thumb-up-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.reaction === -1} aria-label={t('Dislike')} onClick={() => { reportGameClick('game_detail', 'dislike_game', game, { selected: game.reaction !== -1 }); act(game.reaction === -1 ? 'clear_reaction' : 'dislike', () => gameApi.react(game.id, game.reaction === -1 ? 0 : -1)); }} icon={<RemixIcon name={game.reaction === -1 ? 'thumb-down-fill' : 'thumb-down-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Copy link')} onClick={() => void share()} icon={<RemixIcon name="share-forward-line" size={17} />} />
      </footer>}
      {playable && !game.external && mine && <footer className="om-game-actions" role="toolbar" aria-label={t('Game actions')}>
        {!game.multiplayer && onEditInSuperAgent && <Button variant="ghost" className="om-button h-auto" data-primary onClick={onEditInSuperAgent}><RemixIcon name="gamepad-line" size={16} />{t('Edit in Agent')}</Button>}
        <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Copy link')} onClick={() => void share()} icon={<RemixIcon name="share-forward-line" size={17} />} />
      </footer>}
    </aside>
    <section className="om-game-preview" aria-label={t('Preview')}>
      <header>
        {/* The code tab only exists for games whose source is ours to show. */}
        {hasCode || trailerReady ? <div className="om-segmented" role="tablist">
          <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'preview'} onClick={() => { if (view !== 'preview') reportGameClick('game_detail', 'game_tab', game, { game_view: 'preview' }); setView('preview'); }}><RemixIcon name="play-fill" size={15} />{t('Preview')}</Button>
          {hasCode && <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'code'} onClick={() => { if (view !== 'code') reportGameClick('game_detail', 'game_tab', game, { game_view: 'code' }); setView('code'); }}><RemixIcon name="code-s-slash-line" size={15} />{t('Code')}</Button>}
          {trailerReady && <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'trailer'} onClick={() => { if (view !== 'trailer') reportGameClick('game_detail', 'game_tab', game, { game_view: 'trailer' }); setView('trailer'); }}><RemixIcon name="film-line" size={15} />{t('Trailer')}</Button>}
        </div> : <span />}
        <span className="om-game-preview-tools">
          {playable && !game.external && !offline && (
            <WebPublishPopover
              targetKind="game"
              targetId={game.id}
              title={gameTitle(game)}
              revisionKey={game.updatedAt}
              onNotify={(message, tone) => notify(message, tone ?? 'info')}
            />
          )}
          <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Reload game')} disabled={!playable} onClick={() => { reportGameClick('game_detail', 'reload_game', game); setSource(null); setReload(value => value + 1); }} icon={<RemixIcon name="refresh-line" size={17} />} />
          <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Full screen')} disabled={!url} onClick={() => { reportGameClick('game_detail', 'fullscreen_game', game); void (view === 'preview' ? frame.current : stage.current)?.requestFullscreen?.(); }} icon={<RemixIcon name="fullscreen-line" size={17} />} />
          <Button variant="ghost" className="om-button h-auto" disabled={!url} onClick={popout}><RemixIcon name="external-link-line" size={15} />{t('Open external')}</Button>
        </span>
      </header>
      <div ref={stage} className="om-game-stage" data-orientation={game.orientation === 'portrait' && playable && view === 'preview' ? 'portrait' : undefined}>
        {!playable && game.multiplayer ? <div className="om-game-waiting"><strong>{t('Game generation only supports single-player games.')}</strong></div>
          : !playable && game.status !== 'building' ? <GameHandoff game={game} notify={notify} onContinueInSuperAgent={onContinueInSuperAgent} />
          : !playable ? <div className="om-game-waiting"><RemixIcon name="loader-4-line" size={28} />
            <strong>{t('Agent is running…')}</strong>
            <span className="om-muted">{t('The game will load here when it is ready.')}</span></div>
          : view === 'code' ? <pre className="om-game-code" tabIndex={0}>{source ?? t('Loading game…')}</pre>
          : view === 'trailer' && trailerReady ? <video className="om-game-trailer-video" src={trailer!.videoUrl!.replace(/^\/api\//, '/motion-api/')} controls autoPlay playsInline />
          // A creator's own site keeps its own origin; local games stay script-only.
          : game.external && !game.external.embeddable ? <div className="om-game-external">
              {coverUrl(game) && <img src={coverUrl(game)!} alt="" />}
              <div><strong>{t('This game only runs on the creator’s site.')}</strong>
                <Button variant="ghost" className="om-button h-auto" data-primary onClick={popout}><RemixIcon name="external-link-line" size={15} />{t('Open original')}</Button></div>
            </div>
          : url ? <iframe key={reload} ref={frame} src={url} title={game.title} onLoad={() => { if (!playReported.current) { playReported.current = true; reportGameAction('play', 'success', game); } }} sandbox={game.external ? 'allow-scripts allow-same-origin allow-pointer-lock allow-popups' : 'allow-scripts allow-forms allow-pointer-lock'} allow="fullscreen; gamepad; autoplay; clipboard-write" />
          : <span className="om-muted">{t('Loading game…')}</span>}
      </div>
    </section>
  </div>;
}

/** The user's games, like the project list in the Motion editor: what the Agent is still making, then finished games. */
function GameSidebar({ games, openId, onOpen }: { games: GameCard[]; openId: string | null; onOpen: (game: GameCard) => void }) {
  const { t } = useI18n();
  const title = useGameTitle();
  const [query, setQuery] = useState('');
  // Collapsing works like the Motion editor's project list; the choice is remembered on this device.
  const [collapsed, setCollapsedState] = useState(() => { try { return localStorage.getItem('om-game-sidebar') === 'collapsed'; } catch { return false; } });
  const setCollapsed = (value: boolean) => { setCollapsedState(value); try { localStorage.setItem('om-game-sidebar', value ? 'collapsed' : 'open'); } catch { /* storage unavailable */ } };
  const toggleLabel = t(collapsed ? 'Show my games' : 'Hide my games');
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? games.filter(game => title(game).toLocaleLowerCase().includes(needle)) : games;
  return <aside className="om-game-sidebar" data-collapsed={collapsed} aria-label={t('My games')}>
    <div className="om-game-sidebar-head">
      {!collapsed && <h2 className="om-game-sidebar-title">{t('My games')}</h2>}
      <Tooltip label={toggleLabel} wrap><IconButton variant="ghost" type="button" className="motion-icon-button" aria-expanded={!collapsed} aria-label={toggleLabel} onClick={() => setCollapsed(!collapsed)} icon={<MotionIcon name="sidebar" size={16} />} /></Tooltip>
    </div>
    {!collapsed && games.length > 0 && <span className="om-field om-game-sidebar-search"><RemixIcon name="search-line" size={15} /><input value={query} placeholder={t('Search my games')} aria-label={t('Search my games')} onChange={event => setQuery(event.target.value)} /></span>}
    <nav className="om-game-sidebar-list">
      {shown.map(game => {
        const cover = coverUrl(game) ?? genreCovers[game.genre];
        const status = game.status === 'draft' ? t('Waiting for your Agent') : game.status === 'building' ? t('Agent is running') : game.status === 'failed' ? t('Not finished') : game.status === 'ready' ? t('Ready to publish') : t('Finished');
        return <Button key={game.id} variant="plain" className="om-game-sidebar-row" aria-label={collapsed ? `${title(game)} · ${status}` : undefined} aria-current={openId === game.id ? 'page' : undefined} onClick={() => onOpen(game)}>
          <span className="om-game-sidebar-thumb">{cover && <img src={cover} alt="" />}{collapsed && pending(game) && <RemixIcon name="loader-4-line" size={12} />}</span>
          {!collapsed && <span className="om-game-sidebar-text"><strong>{title(game)}</strong>
            <span className="om-muted" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={12} />}{status}</span></span>}
        </Button>;
      })}
      {!games.length && !collapsed && <p className="om-muted om-game-sidebar-empty">{t('Games you make appear here.')}</p>}
    </nav>
  </aside>;
}

/**
 * Handoff for a draft (or a game the Agent stopped on): OpenMotion does not run its own game Agent, so the user's
 * MCP Agent receives the complete instruction — game id, brief and execution steps — by opening Codex with it
 * prefilled or by copying it into any other Agent. The page switches to "Agent is running" once the Agent sets building.
 */
function GameHandoff({ game, notify, onContinueInSuperAgent }: { game: GameCard; notify: (message: string, tone: 'info' | 'error') => void; onContinueInSuperAgent?: (instruction: string) => void }) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState<string | null>(() => storedInstruction(game.id));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    reportGameHandoffShown(game);
    let live = true;
    void gameApi.handoff(game.id).then(handoff => { if (!live) return; setInstruction(handoff.agentInstruction); rememberInstruction(game.id, handoff.agentInstruction); }).catch(() => { /* keep the stored copy, if any */ });
    return () => { live = false; };
  }, [game.id]);
  const copy = async () => {
    if (!instruction) return;
    reportGameClick('game_handoff', 'copy_instruction', game);
    try { await navigator.clipboard.writeText(instruction); reportGameAction('copy_instruction', 'success', game); setCopied(true); notify(t('Instruction copied'), 'info'); }
    catch { reportGameAction('copy_instruction', 'failure', game); notify(t('Could not copy. Select the instruction and copy it.'), 'error'); }
  };
  const stopped = game.status === 'failed';
  return <div className="om-game-handoff" data-tone={game.status}>
    <RemixIcon name={stopped ? 'error-warning-line' : 'robot-line'} size={26} />
    <strong>{stopped ? t('The Agent stopped before finishing this game.') : t('Hand this game to your Agent')}</strong>
    <ol className="om-game-handoff-steps">
      <li>{t('Open Codex, Claude Code or another Agent connected to OpenMotion MCP.')}</li>
      <li>{t('Send the instruction below. It names this game, the brief and the steps.')}</li>
      <li>{t('This page shows “Agent is running” once the Agent starts, and the game when it is ready.')}</li>
    </ol>
    <div className="om-game-handoff-actions">
      {onContinueInSuperAgent && <Button variant="ghost" className="om-button h-auto" data-primary disabled={!instruction} onClick={() => instruction && onContinueInSuperAgent(instruction)}><RemixIcon name="gamepad-line" size={15} />{t('Continue in Super Agent')}</Button>}
      {/* Copy works with every Agent; the Codex link needs the Codex desktop app and only prefills a new chat (it does not send). */}
      <Button variant="ghost" className="om-button h-auto" {...(!onContinueInSuperAgent ? { 'data-primary': true } : {})} disabled={!instruction} onClick={() => void copy()}><RemixIcon name={copied ? 'check-line' : 'file-copy-line'} size={15} />{copied ? t('Instruction copied') : t('Copy instruction')}</Button>
      <a className="om-button om-game-handoff-link" title={t('Needs the Codex desktop app. Opens a new chat with the instruction filled in; press send yourself.')} aria-disabled={!instruction || undefined} onClick={() => { if (instruction) reportGameClick('game_handoff', 'open_in_codex', game); }} href={instruction ? `codex://new?prompt=${encodeURIComponent(instruction)}` : undefined}><RemixIcon name="external-link-line" size={15} />{t('Open in Codex')}</a>
    </div>
    <pre className="om-game-handoff-text" tabIndex={0} aria-label={t('Agent instruction')}>{instruction ?? t('Loading instruction…')}</pre>
  </div>;
}
