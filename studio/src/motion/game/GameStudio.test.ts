import { describe, expect, it } from 'vitest';
import { trailerProjectHref } from './GameStudio';
import { bundledGames, needsGameService } from './gameCatalog';

describe('trailerProjectHref', () => {
  it('routes to the canonical /editor/:projectId URL instead of reusing the Game Studio pathname', () => {
    expect(trailerProjectHref('trailer-proj-1', '?game=space-shooter')).toBe(
      '/editor/trailer-proj-1#project/trailer-proj-1',
    );
  });

  it('preserves orthogonal presentation and tracking query params while dropping Game Studio params', () => {
    const trackingId = '11111111-2222-3333-4444-555555555555';
    expect(
      trailerProjectHref(
        'proj with space',
        `?game=space-shooter&embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}`,
      ),
    ).toBe(
      `/editor/proj%20with%20space?embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}#project/proj%20with%20space`,
    );
  });
});

describe('gameCatalog multi-file detection and internal tags', () => {
  it('requires the local game service for sibling assets, src bundles, and relative script/style files', () => {
    expect(needsGameService('<script src="src/system.bundle.js"></script>')).toBe(true);
    expect(needsGameService('<link rel="stylesheet" href="style.css">')).toBe(true);
    expect(needsGameService('<script>fetch("./assets/app.part0.js")</script>')).toBe(true);
    expect(needsGameService('<script>fetch("./app.part0.js")</script>')).toBe(true);
    expect(needsGameService('<!doctype html><script>console.log("inline")</script>')).toBe(false);
  });

  it('preserves internal top赚钱 tags on bundled templates for downstream category grouping', () => {
    const tagged = bundledGames
      .filter(game => game.tags?.some(tag => tag.trim().toLowerCase() === 'top赚钱'))
      .map(game => game.id)
      .sort();
    expect(tagged).toEqual([
      'ball-match',
      'block-blast',
      'catch-piggy',
      'chinese-chess-solo',
      'cube-chain-2048',
      'fruit-slash-frenzy',
      'jump-jump-3d',
      'life-restart-sim',
      'mahjong-pairs',
      'number-link-2248',
      'one-stroke-dots',
      'pipe-twist-flow',
      'screw-puzzle',
      'soccer-blitz-2d',
      'tile-stack',
      'tower-stack-3d',
      'vice-beach-motor-club',
    ]);
  });
});
