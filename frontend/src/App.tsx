import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { Zone, Dump, Voyage, Stats } from './types';
import ZoneCard from './components/ZoneCard';
import VoyageTable from './components/VoyageTable';

type Tab = 'zones' | 'voyages';

export default function App() {
  const [zones,   setZones]   = useState<Zone[]>([]);
  const [dumps,   setDumps]   = useState<Dump[]>([]);
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [tab,     setTab]     = useState<Tab>('zones');
  const [loading, setLoading] = useState(true);

  // Filtres voyages
  const [filterZone,   setFilterZone]   = useState('');
  const [filterStatut, setFilterStatut] = useState('');

  const loadAll = useCallback(async () => {
    const [z, d, v, s] = await Promise.all([
      api.zones(),
      api.dumps(),
      api.voyages({}),
      api.stats(),
    ]);
    setZones(z); setDumps(d); setVoyages(v); setStats(s);
    setLoading(false);
  }, []);

  const loadVoyages = useCallback(async () => {
    const params: Record<string, string> = {};
    if (filterZone)   params.zone_id = filterZone;
    if (filterStatut) params.statut  = filterStatut;
    setVoyages(await api.voyages(params));
    setStats(await api.stats());
  }, [filterZone, filterStatut]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadVoyages(); }, [loadVoyages]);

  return (
    <div className="min-h-screen bg-[#060d18] text-slate-200" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <header className="bg-[#0a1525] border-b border-[#1a2740] px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center text-black font-black text-sm">M</div>
          <div>
            <div className="text-sm font-bold text-white tracking-wide">MINE VOYAGE TRACKER</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">Suivi de transport</div>
          </div>
        </div>

        {/* Stats rapides */}
        {stats && (
          <div className="flex items-center gap-4">
            {[
              { label: 'Voyages aujourd\'hui', value: stats.voyages_today, color: 'text-white' },
              { label: 'En cours',              value: stats.en_cours,      color: 'text-blue-400' },
              { label: 'Tonnes (jour)',          value: `${Number(stats.tonnes_today).toFixed(0)} t`, color: 'text-amber-400' },
              { label: 'Engins',                value: stats.nb_engins,     color: 'text-slate-300' },
            ].map(s => (
              <div key={s.label} className="text-center hidden sm:block">
                <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[9px] text-slate-600 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* ── Tabs ── */}
      <div className="flex border-b border-[#1a2740] px-6">
        {(['zones', 'voyages'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            {t === 'zones' ? `Zones (${zones.length})` : `Voyages (${voyages.length})`}
          </button>
        ))}
      </div>

      <main className="px-4 sm:px-6 py-5">

        {loading ? (
          <div className="flex justify-center py-20 text-slate-500 text-sm">Chargement…</div>
        ) : tab === 'zones' ? (

          /* ── Vue Zones ── */
          <div className="space-y-4 max-w-5xl mx-auto">
            {zones.length === 0 ? (
              <div className="text-center text-slate-600 py-16 text-sm">
                Aucune zone configurée
              </div>
            ) : (
              zones.map(z => (
                <ZoneCard
                  key={z.id}
                  zone={z}
                  allDumps={dumps}
                  onRefresh={loadAll}
                />
              ))
            )}
          </div>

        ) : (

          /* ── Vue Voyages ── */
          <div className="max-w-6xl mx-auto space-y-4">

            {/* Filtres */}
            <div className="flex flex-wrap gap-3 items-center">
              <select value={filterZone} onChange={e => setFilterZone(e.target.value)}
                className="bg-[#0d1520] border border-[#1a2740] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">Toutes les zones</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.nom}</option>)}
              </select>
              <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}
                className="bg-[#0d1520] border border-[#1a2740] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500">
                <option value="">Tous statuts</option>
                <option value="EN_COURS">En cours</option>
                <option value="COMPLETE">Terminés</option>
                <option value="ANNULE">Annulés</option>
              </select>
              <button onClick={loadVoyages}
                className="px-3 py-1.5 bg-[#1a2740] rounded text-xs text-slate-400 hover:text-white transition-colors">
                Actualiser
              </button>
            </div>

            {/* Tableau */}
            <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1a2740]">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Historique des voyages
                </span>
              </div>
              <VoyageTable voyages={voyages} onRefresh={loadVoyages} />
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
