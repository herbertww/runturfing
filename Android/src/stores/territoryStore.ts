import { create } from 'zustand';
import { territoryApi } from '../services/apiClient';
import { TerritoryCell, ZoneSummary, CellState } from '../types';
import { buildDemoCells, demoUserStats } from '../utils/demoTerritory';

// Cell state colors matching the iOS design
// Fills sit on the paper map, so they carry more opacity than they did on the
// old dark canvas or they wash out. Every cell is outlined in ink: the border
// is what makes a claim read as claimed, and it holds at any zoom.
export const CELL_COLORS: Record<CellState, string> = {
  neutral: 'rgba(156,163,175,0.20)',
  visited: 'rgba(96,165,250,0.35)',
  familiar: 'rgba(37,99,235,0.45)',
  claimed: 'rgba(67,45,215,0.60)',
  defended: 'rgba(22,163,74,0.65)',
  contested: 'rgba(220,38,38,0.60)',
  decaying: 'rgba(217,119,6,0.50)',
};

export const CELL_STROKE_COLORS: Record<CellState, string> = {
  neutral: 'rgba(28,41,60,0.35)',
  visited: 'rgba(28,41,60,0.55)',
  familiar: 'rgba(28,41,60,0.70)',
  claimed: '#1C293C',
  defended: '#1C293C',
  contested: '#1C293C',
  decaying: '#1C293C',
};

/**
 * Fill for a cell, weighted by how much of the ring around it the same leader
 * also holds.
 *
 * One hex tells you who leads it and nothing about whether that lead is a
 * fluke. Painting every cell at the same strength made a runner's daily commute
 * look identical to a neighbourhood they have held for a month. Scaling the
 * alpha turns clusters into one dense region and leaves isolated cells faint,
 * so leadership reads off the map as an area rather than a scattering of tiles.
 *
 * The floor is deliberately well above zero: a lone claimed cell must still be
 * visible, it just should not shout.
 */
const DENSITY_FLOOR = 0.55;

export function cellFill(state: CellState, density = 0): string {
  const base = CELL_COLORS[state];
  const match = base.match(/rgba\(([^)]+)\)/);
  if (!match) return base;

  const parts = match[1].split(',').map((p) => p.trim());
  if (parts.length < 4) return base;

  const baseAlpha = parseFloat(parts[3]);
  const clamped = Math.max(0, Math.min(1, density));
  const alpha = baseAlpha * (DENSITY_FLOOR + (1 - DENSITY_FLOOR) * clamped);
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha.toFixed(3)})`;
}

interface TerritoryState {
  cells: TerritoryCell[];
  zones: ZoneSummary[];
  userStats: {
    totalCells: number;
    claimedCells: number;
    contestedCells: number;
    totalMeters: number;
  } | null;
  isLoading: boolean;
  lastViewport: string | null;
  /** Simulated territory for demos. Never fetches, never writes. */
  demoMode: boolean;

  fetchViewport: (swLat: number, swLng: number, neLat: number, neLng: number) => Promise<void>;
  clearCells: () => void;
  toggleDemo: () => void;
}

const initialDemoCells = buildDemoCells();

export const useTerritoryStore = create<TerritoryState>((set, get) => ({
  cells: initialDemoCells,
  zones: [],
  userStats: demoUserStats(initialDemoCells),
  isLoading: false,
  lastViewport: null,
  demoMode: true,

  // Simulated territory around Jurong Lake, generated on the phone. Deliberately
  // not persisted: a demo should never survive into the next real session and
  // get mistaken for ground somebody actually holds.
  toggleDemo: () => {
    const on = !get().demoMode;
    if (!on) {
      set({ demoMode: false, cells: [], userStats: null, lastViewport: null });
      return;
    }
    const cells = buildDemoCells();
    set({
      demoMode: true,
      cells,
      zones: [],
      userStats: demoUserStats(cells),
      isLoading: false,
      lastViewport: null,
    });
  },

  fetchViewport: async (swLat, swLng, neLat, neLng) => {
    // The demo city is the whole world while it is on. Fetching would replace
    // it with real territory the moment the map was panned.
    if (get().demoMode) return;

    // Deduplicate rapid viewport changes
    const key = `${swLat.toFixed(3)},${swLng.toFixed(3)},${neLat.toFixed(3)},${neLng.toFixed(3)}`;
    if (get().lastViewport === key) return;

    set({ isLoading: true, lastViewport: key });
    try {
      const { data } = await territoryApi.getViewport({ swLat, swLng, neLat, neLng });
      set({
        cells: data.cells,
        zones: data.zones,
        userStats: data.userStats,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  clearCells: () => set({ cells: [], zones: [], lastViewport: null }),
}));
