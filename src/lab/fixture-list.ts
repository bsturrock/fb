// Plan 13c: the lab fixture select's lists, without the DOM. The review list is REVIEW_SET (src/lab/review-set.ts), each
// option `name · id`; the full list is every registered fixture grouped by milestone, each option `id · title`. The
// filter narrows either list by id, name or title.
import type { FixtureDef } from '../sim/fixture';
import { REVIEW_SET } from './review-set';

export interface ListOption {
  id: string;
  /** Shown in the select. */
  text: string;
  /** Lower-case id, name and full title: what the filter matches. */
  search: string;
}

export interface ListGroup {
  label: string;
  options: ListOption[];
}

/** Longest title shown in a full-list option (the rest is cut, with an ellipsis); the filter still matches all of it. */
export const TITLE_CHARS = 60;

const REVIEW_IDS = new Set(REVIEW_SET.flatMap((g) => g.entries.map((e) => e.id)));

/** Whether `id` is in the review set (a ?fixture= outside it opens the full list). */
export const inReviewSet = (id: string): boolean => REVIEW_IDS.has(id);

/** First fixture of the review set: what the lab opens on without a ?fixture=. */
export const firstReviewId = (): string => REVIEW_SET[0].entries[0].id;

/** The full list's group for a fixture, by milestone. */
export function milestoneGroup(f: FixtureDef): string {
  switch (f.milestone) {
    case 'L1':
      return 'L1 · supplied run clips';
    case 'RH':
      return 'RH · ride height and support';
    case 'L2':
      return 'L2 · support recovery and footwork';
    case 'HC':
      return 'HC · ragdoll handoff during contact';
    case 'L3':
      return 'L3 · locomotion transitions and contact integration';
    case 'L4':
      return 'L4 · active falls and joint limits';
    default:
      return `Gate ${f.gate} · ${f.milestone}`;
  }
}

const shorten = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The review list (`all` false) or the full list (`all` true), in order, grouped. */
export function fixtureList(fixtures: readonly FixtureDef[], all: boolean): ListGroup[] {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  if (!all)
    return REVIEW_SET.map((g) => ({
      label: g.label,
      options: g.entries.map((e) => ({ id: e.id, text: `${e.name} · ${e.id}`, search: `${e.id} ${e.name} ${byId.get(e.id)?.title ?? ''}`.toLowerCase() })),
    }));
  const groups = new Map<string, ListGroup>();
  for (const f of fixtures) {
    const label = milestoneGroup(f);
    let g = groups.get(label);
    if (!g) groups.set(label, (g = { label, options: [] }));
    g.options.push({ id: f.id, text: `${f.id} · ${shorten(f.title, TITLE_CHARS)}`, search: `${f.id} ${f.title}`.toLowerCase() });
  }
  return [...groups.values()];
}

/**
 * The options matching `query`: every whitespace-separated word of it, ignoring case, appears in the option's id, name
 * or title. Groups left empty are dropped; a blank query returns the list unchanged.
 */
export function filterList(groups: ListGroup[], query: string): ListGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups.map((g) => ({ label: g.label, options: g.options.filter((o) => words.every((w) => o.search.includes(w))) })).filter((g) => g.options.length > 0);
}
