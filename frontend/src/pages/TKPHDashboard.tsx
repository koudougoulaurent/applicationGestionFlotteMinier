/**
 * TKPHDashboard.tsx — Gestion pneus avec calcul TKPH
 * TKPH = Tonnes × Kilomètres / Heure
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { tyreApi } from '../lib/api';
import { IconTKPH, IconRefresh, IconAlert } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TyreTkph {
  position:    string;
  tkphActual:  number;
  tkphNominal: number;
  loadPct:     number;
  tempEstC:    number;
  status:      'OK' | 'WARNING' | 'CRITICAL';
}

interface TKPHEquipment {
  equipmentId: string;
  fleetNumber: string;
  tyres:       TyreTkph[];
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  OK:       'text-emerald-400 bg-emerald-950/40 border-emerald-700/40',
  WARNING:  'text-amber-400   bg-amber-950/40   border-amber-700/40',
  CRITICAL: 'text-red-400     bg-red-950/40     border-red-700/40',
};

const STATUS_BAR: Record<string, string> = {
  OK:       'bg-emerald-500',
  WARNING:  'bg-amber-500',
  CRITICAL: 'bg-red-500',
};

function StatusBadge({ status }: { status: 'OK' | 'WARNING' | 'CRITICAL' }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.OK;
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${s}`}>
      {status}
    </span>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function TKPHDashboard() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';
  const params: Record<string, string> = siteId ? { siteId } : {};

  const [equipment,     setEquipment]     = useState<TKPHEquipment[]>([]);
  const [overloaded,    setOverloaded]    = useState<TKPHEquipment[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [calculating,   setCalculating]   = useState(false);
  const [calcMsg,       setCalcMsg]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eqRes, ovRes] = await Promise.all([
        tyreApi.tkph(params),
        tyreApi.overloaded(params),
      ]);
      setEquipment((eqRes.data as TKPHEquipment[]) || []);
      setOverloaded((ovRes.data as TKPHEquipment[]) || []);
    } catch {
      setError('Erreur de chargement des données TKPH');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const handleRecalculate = async () => {
    setCalculating(true);
    setCalcMsg('');
    try {
      await tyreApi.calculate({ siteId });
      setCalcMsg('Recalcul terminé');
      await load();
    } catch {
      setCalcMsg('Erreur lors du recalcul');
    } finally {
      setCalculating(false);
    }
  };

  // Compteur pneus en alerte (loadPct > 85)
  const alertCount = equipment.flatMap(e => e.tyres).filter(t => t.status !== 'OK').length;

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconTKPH size={20} className="text-amber-400" />
            Pneus TKPH
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Surveillance thermique des pneumatiques — Tonnes × km / h</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleRecalculate}
            disabled={calculating}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
          >
            <IconRefresh size={14} className={calculating ? 'animate-spin' : ''} />
            {calculating ? 'Calcul…' : 'Recalculer tout'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/40 rounded text-xs text-red-400">
          <IconAlert size={13} />{error}
        </div>
      )}
      {calcMsg && (
        <div className={`px-3 py-2 rounded text-xs border ${calcMsg.includes('Erreur') ? 'bg-red-950/50 border-red-700/40 text-red-400' : 'bg-emerald-950/50 border-emerald-700/40 text-emerald-400'}`}>
          {calcMsg}
        </div>
      )}

      {/* Compteur alertes + explication pédagogique */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`bg-[#0f1e30] border rounded-xl p-4 ${alertCount > 0 ? 'border-red-700/40' : 'border-[#1a2740]'}`}>
          <div className={`text-3xl font-bold ${alertCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {alertCount}
          </div>
          <div className="text-xs text-slate-400 mt-1">Pneus en alerte (TKPH &gt; 85% nominal)</div>
          {overloaded.length > 0 && (
            <div className="text-xs text-orange-400 mt-1">{overloaded.length} équipement{overloaded.length > 1 ? 's' : ''} surchargé{overloaded.length > 1 ? 's' : ''}</div>
          )}
        </div>

        <div className="md:col-span-2 bg-blue-950/20 border border-blue-700/30 rounded-xl p-4">
          <div className="text-xs font-semibold text-blue-300 mb-2 flex items-center gap-1">
            <IconTKPH size={12} />Comment fonctionne le TKPH ?
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-300">TKPH = Tonnes × Kilomètres / Heure.</strong>{' '}
            C'est la mesure de travail d'un pneu par heure. Chaque pneu a un TKPH nominal (capacité max).{' '}
            <strong className="text-amber-400">Dépasser 85% du nominal = surchauffe pneu</strong> — risque d'éclatement,
            de fusion du caoutchouc interne, et d'accident. Le TKPH actuel se calcule sur la fenêtre roulante des 12 dernières heures.
          </p>
        </div>
      </div>

      {/* Tableau par équipement */}
      {loading && equipment.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 animate-pulse">
              <div className="h-5 bg-slate-800 rounded w-32 mb-3" />
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-16 bg-slate-800 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : equipment.length === 0 ? (
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <IconAlert size={24} className="text-slate-700" />
            <p className="text-sm text-slate-500">Aucune donnée TKPH disponible</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {equipment.map(eq => (
            <EquipmentTKPHCard key={eq.equipmentId} equipment={eq} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Carte par équipement ───────────────────────────────────────────────────────

function EquipmentTKPHCard({ equipment: eq }: { equipment: TKPHEquipment }) {
  const worstStatus = eq.tyres.some(t => t.status === 'CRITICAL') ? 'CRITICAL'
    : eq.tyres.some(t => t.status === 'WARNING') ? 'WARNING' : 'OK';

  const borderCls = worstStatus === 'CRITICAL' ? 'border-red-700/40'
    : worstStatus === 'WARNING' ? 'border-amber-700/40' : 'border-[#1a2740]';

  return (
    <div className={`bg-[#0f1e30] border ${borderCls} rounded-xl p-4`}>
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono font-bold text-white">{eq.fleetNumber}</span>
        <StatusBadge status={worstStatus} />
        <span className="text-xs text-slate-500 ml-auto">{eq.tyres.length} pneus</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {eq.tyres.map(t => (
          <TyreCell key={t.position} tyre={t} />
        ))}
      </div>
    </div>
  );
}

function TyreCell({ tyre: t }: { tyre: TyreTkph }) {
  const bar = STATUS_BAR[t.status] ?? STATUS_BAR.OK;
  const barW = Math.min(t.loadPct, 100);

  return (
    <div className={`border rounded-lg p-2 ${STATUS_STYLE[t.status] ?? STATUS_STYLE.OK}`}>
      <div className="text-[10px] font-bold mb-1">{t.position}</div>
      <div className="text-sm font-bold">{t.tkphActual.toFixed(0)}</div>
      <div className="text-[10px] opacity-70">/ {t.tkphNominal.toFixed(0)} TKPH</div>

      {/* Barre de charge */}
      <div className="h-1.5 bg-black/30 rounded-full mt-1.5 mb-1 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${barW}%` }} />
      </div>

      <div className="flex justify-between text-[9px] opacity-80">
        <span>{t.loadPct.toFixed(0)}%</span>
        <span>{t.tempEstC.toFixed(0)}°C</span>
      </div>
      <div className="mt-1">
        <StatusBadge status={t.status} />
      </div>
    </div>
  );
}
