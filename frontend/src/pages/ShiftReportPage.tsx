/**
 * ShiftReportPage.tsx — Rapports de poste automatiques
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { shiftReportApi } from '../lib/api';
import { IconReport, IconRefresh, IconAlert, IconTruck } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ShiftReport {
  reportId:     string;
  shiftId:      string;
  generatedAt:  string;
  totalTonnes:  number;
  targetTonnes: number;
  achievementPct: number;
  totalCycles:  number;
  maPct:        number;
  paPct:        number;
  uaPct:        number;
  totalDelayMin: number;
  oreTonnes:    number;
  wasteTonnes:  number;
  avgGradeCu:   number;
  trucksActive: number;
  trucksDown:   number;
  topTrucks:    Array<{ rank: number; fleetNumber: string; tonnes: number; cycles: number }>;
  incidents:    Array<{ type: string; equipment: string; description: string }>;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function achievementColor(pct: number) {
  if (pct >= 90) return 'text-emerald-400';
  if (pct >= 75) return 'text-amber-400';
  return 'text-red-400';
}
function achievementBadge(pct: number) {
  if (pct >= 90) return 'bg-emerald-950/60 text-emerald-400 border-emerald-700/40';
  if (pct >= 75) return 'bg-amber-950/60 text-amber-400 border-amber-700/40';
  return 'bg-red-950/60 text-red-400 border-red-700/40';
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function ShiftReportPage() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';
  const params: Record<string, string> = siteId ? { siteId } : {};

  const [reports,       setReports]       = useState<ShiftReport[]>([]);
  const [selected,      setSelected]      = useState<ShiftReport | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [generateMsg,   setGenerateMsg]   = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await shiftReportApi.list(params);
      setReports((data as ShiftReport[]) || []);
    } catch {
      setError('Erreur de chargement des rapports');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { loadList(); }, [loadList]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateMsg('');
    try {
      const { data } = await shiftReportApi.generate({ siteId });
      setGenerateMsg('Rapport généré avec succès');
      // Insert at top
      setReports(prev => [data as ShiftReport, ...prev]);
    } catch {
      setGenerateMsg('Erreur lors de la génération du rapport');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelect = async (shiftId: string) => {
    setDetailLoading(true);
    try {
      const { data } = await shiftReportApi.get(shiftId);
      setSelected(data as ShiftReport);
    } catch { /* silencieux */ }
    finally { setDetailLoading(false); }
  };

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconReport size={20} className="text-amber-400" />
            Rapports de Poste
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Synthèse automatique à chaque fin de poste</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadList} className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
          >
            <IconReport size={14} />
            {generating ? 'Génération…' : 'Générer rapport actuel'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/40 rounded text-xs text-red-400">
          <IconAlert size={13} />{error}
        </div>
      )}
      {generateMsg && (
        <div className={`px-3 py-2 rounded text-xs border ${generateMsg.includes('succès') ? 'bg-emerald-950/50 border-emerald-700/40 text-emerald-400' : 'bg-red-950/50 border-red-700/40 text-red-400'}`}>
          {generateMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Liste des rapports */}
        <div className="lg:col-span-1 bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Derniers rapports</h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 bg-slate-800 rounded animate-pulse" />
              ))}
            </div>
          ) : reports.length === 0 ? (
            <EmptyState message="Aucun rapport disponible" />
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {reports.map(r => (
                <button
                  key={r.reportId}
                  onClick={() => handleSelect(r.shiftId)}
                  className={`w-full text-left p-3 rounded border transition-colors ${
                    selected?.reportId === r.reportId
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-[#0a1628] border-[#1a2740] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-slate-300 truncate">{r.shiftId}</div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(r.generatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-bold ${achievementBadge(r.achievementPct)}`}>
                      {r.achievementPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-slate-500">
                    <span>{r.totalTonnes.toLocaleString('fr-FR')} t</span>
                    <span>MA {r.maPct.toFixed(0)}%</span>
                    <span>{r.totalCycles} cy</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Vue détaillée */}
        <div className="lg:col-span-2">
          {detailLoading ? (
            <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-8">
              <div className="flex items-center gap-3 justify-center">
                <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Chargement du rapport…</span>
              </div>
            </div>
          ) : selected ? (
            <ReportDetail report={selected} />
          ) : (
            <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-8 flex flex-col items-center gap-3">
              <IconReport size={32} className="text-slate-700" />
              <p className="text-sm text-slate-500">Sélectionnez un rapport pour voir le détail</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vue détaillée d'un rapport ────────────────────────────────────────────────

function ReportDetail({ report: r }: { report: ShiftReport }) {
  return (
    <div className="flex flex-col gap-3">

      {/* En-tête rapport */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-white">{r.shiftId}</div>
            <div className="text-xs text-slate-400">
              Généré le {new Date(r.generatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <span className={`text-xl font-bold ${achievementColor(r.achievementPct)}`}>
            {r.achievementPct.toFixed(1)}%
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniKpi label="Production"     value={`${r.totalTonnes.toLocaleString('fr-FR')} t`}   sub={`/ ${r.targetTonnes.toLocaleString('fr-FR')} t`} />
          <MiniKpi label="Cycles"         value={r.totalCycles.toString()}                         />
          <MiniKpi label="Camions actifs" value={r.trucksActive.toString()}                        sub={`${r.trucksDown} en panne`} />
          <MiniKpi label="Délais"         value={fmtMin(r.totalDelayMin)}                          />
        </div>
      </div>

      {/* Disponibilités */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Disponibilités</h3>
        <div className="grid grid-cols-3 gap-3">
          <MiniKpi label="MA%" value={`${r.maPct.toFixed(1)}%`} color="text-emerald-400" />
          <MiniKpi label="PA%" value={`${r.paPct.toFixed(1)}%`} color="text-blue-400" />
          <MiniKpi label="UA%" value={`${r.uaPct.toFixed(1)}%`} color="text-amber-400" />
        </div>
      </div>

      {/* Matière */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Matière</h3>
        <div className="grid grid-cols-3 gap-3">
          <MiniKpi label="Minerai"      value={`${r.oreTonnes.toLocaleString('fr-FR')} t`}  color="text-blue-400" />
          <MiniKpi label="Stérile"      value={`${r.wasteTonnes.toLocaleString('fr-FR')} t`} color="text-slate-400" />
          <MiniKpi label="Grade Cu moy" value={`${r.avgGradeCu.toFixed(2)}%`}                color="text-amber-400" />
        </div>
      </div>

      {/* Top camions */}
      {r.topTrucks.length > 0 && (
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <IconTruck size={12} />Top camions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {r.topTrucks.slice(0, 6).map(t => (
              <div key={t.rank} className="flex items-center gap-2 p-2 bg-[#0a1628] rounded">
                <span className={`text-xs font-bold w-5 ${t.rank === 1 ? 'text-amber-400' : t.rank === 2 ? 'text-slate-300' : t.rank === 3 ? 'text-orange-400' : 'text-slate-600'}`}>
                  #{t.rank}
                </span>
                <span className="font-mono text-xs text-white">{t.fleetNumber}</span>
                <span className="ml-auto text-xs text-amber-400">{t.tonnes.toLocaleString('fr-FR')} t</span>
                <span className="text-xs text-slate-500">{t.cycles} cy</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents */}
      {r.incidents.length > 0 && (
        <div className="bg-red-950/20 border border-red-700/30 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <IconAlert size={12} />Incidents du poste
          </h3>
          <div className="space-y-2">
            {r.incidents.map((inc, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-slate-300">{inc.equipment}</span>
                <span className="text-amber-400">[{inc.type}]</span>
                <span className="text-slate-400">{inc.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composants utilitaires ─────────────────────────────────────────────────────

function MiniKpi({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <IconAlert size={24} className="text-slate-700" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
