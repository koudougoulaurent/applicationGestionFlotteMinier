/**
 * MaterialTracking.tsx — Suivi de la matière extraite (minerai vs stérile)
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { materialApi } from '../lib/api';
import { IconMaterial, IconRefresh, IconAlert } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MaterialBreakdown {
  byType:       Array<{ type: string; tonnes: number; pct: number; avgGrade: number }>;
  totalTonnes:  number;
  avgGradeCu:   number;
  oreTonnes:    number;
  wasteTonnes:  number;
}

interface MaterialFlow {
  flows: Array<{ source: string; materialType: string; destination: string; tonnes: number }>;
}

interface MisdirectedLoad {
  loadId:         string;
  fleetNumber:    string;
  materialType:   string;
  actualDest:     string;
  expectedDest:   string;
  payloadTonnes:  number;
  loadedAt:       string;
}

// ── Couleurs par type matière ─────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  OXIDE:      'text-amber-400   bg-amber-950/40   border-amber-700/40',
  SULPHIDE:   'text-blue-400    bg-blue-950/40    border-blue-700/40',
  WASTE:      'text-slate-400   bg-slate-800/60   border-slate-700/40',
  LOW_GRADE:  'text-orange-400  bg-orange-950/40  border-orange-700/40',
};

// ── Composant principal ────────────────────────────────────────────────────────

export default function MaterialTracking() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';
  const params: Record<string, string> = siteId ? { siteId } : {};

  const [breakdown,    setBreakdown]    = useState<MaterialBreakdown | null>(null);
  const [flow,         setFlow]         = useState<MaterialFlow | null>(null);
  const [misdirected,  setMisdirected]  = useState<MisdirectedLoad[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bdRes, flowRes, misRes] = await Promise.all([
        materialApi.breakdown(params),
        materialApi.flow(params),
        materialApi.misdirected({ ...params, hours: '24' }),
      ]);
      setBreakdown(bdRes.data as MaterialBreakdown);
      setFlow(flowRes.data as MaterialFlow);
      setMisdirected((misRes.data as MisdirectedLoad[]) || []);
    } catch {
      setError('Erreur de chargement des données matière');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconMaterial size={20} className="text-amber-400" />
            Suivi Matière
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Minerai vs stérile — poste en cours</p>
        </div>
        <button onClick={load} className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
          <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/40 rounded text-xs text-red-400">
          <IconAlert size={13} />{error}
        </div>
      )}

      {/* Alerte mauvaise destination */}
      {misdirected.length > 0 && (
        <div className="bg-red-950/40 border border-red-600/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconAlert size={16} className="text-red-400" />
            <span className="text-sm font-bold text-red-400">
              {misdirected.length} chargement{misdirected.length > 1 ? 's' : ''} mal dirigé{misdirected.length > 1 ? 's' : ''} — 24 dernières heures
            </span>
          </div>
          <div className="space-y-1">
            {misdirected.slice(0, 5).map(m => (
              <div key={m.loadId} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-mono text-white">{m.fleetNumber}</span>
                <span className="text-slate-500">|</span>
                <span className="text-orange-400">{m.materialType}</span>
                <span className="text-slate-500">|</span>
                <span>{m.payloadTonnes.toFixed(0)} t</span>
                <span className="text-slate-500">|</span>
                <span className="text-red-400">envoyé à {m.actualDest}</span>
                <span className="text-slate-500">→ attendu</span>
                <span className="text-emerald-400">{m.expectedDest}</span>
                <span className="text-slate-600">{new Date(m.loadedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            {misdirected.length > 5 && (
              <div className="text-xs text-slate-500">+ {misdirected.length - 5} autres…</div>
            )}
          </div>
        </div>
      )}

      {/* Cartes récapitulatives par type */}
      {loading && !breakdown ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 animate-pulse">
              <div className="h-8 bg-slate-800 rounded mb-2" />
              <div className="h-3 bg-slate-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : breakdown ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['OXIDE', 'SULPHIDE', 'WASTE', 'LOW_GRADE'] as const).map(type => {
              const found = breakdown.byType.find(b => b.type === type);
              const colorClass = TYPE_COLORS[type] ?? 'text-slate-400 bg-slate-800/40 border-slate-700/40';
              const [textC] = colorClass.split(' ');
              return (
                <div key={type} className={`border rounded-xl p-4 ${colorClass}`}>
                  <div className={`text-2xl font-bold ${textC}`}>
                    {found ? found.tonnes.toLocaleString('fr-FR') : '—'}
                    <span className="text-sm font-normal ml-1 text-slate-500">t</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{type}</div>
                  {found && (
                    <>
                      <div className="text-[10px] text-slate-500 mt-0.5">{found.pct.toFixed(1)}% du total</div>
                      {found.avgGrade > 0 && (
                        <div className="text-[10px] text-amber-400 mt-0.5">Cu: {found.avgGrade.toFixed(2)}%</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Grade moyen */}
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 mb-1">Total tonnes</div>
              <div className="text-2xl font-bold text-white">{breakdown.totalTonnes.toLocaleString('fr-FR')} t</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400 mb-1">Grade moyen Cu</div>
              <div className="inline-block px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-lg font-bold text-amber-400">
                {breakdown.avgGradeCu.toFixed(2)}% Cu
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400 mb-1">Minerai / Stérile</div>
              <div className="text-sm">
                <span className="text-blue-400">{breakdown.oreTonnes.toLocaleString('fr-FR')} t</span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-slate-400">{breakdown.wasteTonnes.toLocaleString('fr-FR')} t</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Flux matière */}
      {flow && flow.flows.length > 0 && (
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Flux matière — Source → Type → Destination</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Destination</th>
                  <th className="px-3 py-2 text-right">Tonnes</th>
                </tr>
              </thead>
              <tbody>
                {flow.flows.map((f, i) => {
                  const tc = TYPE_COLORS[f.materialType]?.split(' ')[0] ?? 'text-slate-400';
                  return (
                    <tr key={i} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                      <td className="px-3 py-2 text-slate-300">{f.source}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium ${tc}`}>{f.materialType}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{f.destination}</td>
                      <td className="px-3 py-2 text-right text-amber-400">{f.tonnes.toLocaleString('fr-FR')} t</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tableau des derniers chargements */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Chargements mal dirigés — 24h</h2>
        {misdirected.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="text-2xl">✓</span>
            <p className="text-sm text-emerald-400">Aucun chargement mal dirigé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Heure</th>
                  <th className="px-3 py-2 text-left">Camion</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Payload</th>
                  <th className="px-3 py-2 text-left">Dest. réelle</th>
                  <th className="px-3 py-2 text-left">Dest. attendue</th>
                  <th className="px-3 py-2 text-center">Statut</th>
                </tr>
              </thead>
              <tbody>
                {misdirected.map(m => (
                  <tr key={m.loadId} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {new Date(m.loadedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-mono text-white">{m.fleetNumber}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${TYPE_COLORS[m.materialType]?.split(' ')[0] ?? 'text-slate-400'}`}>
                        {m.materialType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-amber-400">{m.payloadTonnes.toFixed(0)} t</td>
                    <td className="px-3 py-2 text-red-400 text-xs">{m.actualDest}</td>
                    <td className="px-3 py-2 text-emerald-400 text-xs">{m.expectedDest}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/50 text-red-400 border border-red-700/40">
                        INCORRECT
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
