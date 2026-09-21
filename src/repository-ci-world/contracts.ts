import { defineService } from '../runtime/contracts.js';
import type { RepositoryCiWorldSnapshot } from './types.js';

// A service and not an event, for the reason the desktop session world is one: a composed view is
// asked for when somebody wants it. An event would mean this layer deciding when a change in either
// source is worth announcing, which is a judgement about significance and not a composition.
//
// Pull-only. Nothing here observes on its own: no snapshot exists until a caller asks for one.
export interface RepositoryCiWorldService {
  current(): Promise<RepositoryCiWorldSnapshot>;
}

export const repositoryCiWorldService = defineService<RepositoryCiWorldService>(
  'repository-ci-world.current',
  1,
);
