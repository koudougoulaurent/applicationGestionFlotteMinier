/**
 * DelayAccounting.tsx — Gestion des codes de délai et disponibilité
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { delayApi } from '../lib/api';
import { IconDelay, IconRefresh, IconAlert, IconPlus, IconCheck } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DelayCategory {
  catId:  string;
  code:   string;
  label:  string;
  type:   string;
}

interface DelayEvent {
  eventId:       string;
  equipmentName: string;
  catCode:       string;
  catLabel:      string;
  type:          string;
  startedAt:     string;
  endedAt:       string | null;
  durationMin:   number;
  auto:          boolean;
}

interface DelaySummary {
  maPercent:  number;
  paPercent:  number;
  uaPercent:  number;
  byCategory: Array<{ code: string; label: string; type: string; count: number; totalMin: number }>;
}

// ── Couleurs par type délai ────────────────────────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  MECHANICAL: 'text-red-400',
  OPERATIONAL: 'text-amber-400',
  STANDBY: 'text-blue-400',
  PLANNED: 'text-slate-400',
};

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function DelayAccounting() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';
  const params: Record<string, string> = siteId ? { siteId } : {};

  const [activeDelays,  setActiveDelays]  = useState<DelayEvent[]>([]);
  const [shiftDelays,   setShiftDelays]   = useState<DelayEvent[]>([]);
  const [summary,       setSummary]       = useState<DelaySummary | null>(null);
  const [categories,    setCategories]    = useState<DelayCategory[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  // Formulaire nouveau délai
  const [equipmentId,  setEquipmentId]   = useState('');
  const [catCode,      setCatCode]       = useState('');
  const [notes,        setNotes]         = useState('');
  const [submitting,   setSubmitting]    = useState(false);
  const [submitMsg,    setSubmitMsg]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [activeRes, summaryRes, shiftRes, catsRes] = await Promise.all([
        delayApi.active(params),
        delayApi.summary(params),
        delayApi.shift(params),
        delayApi.categories(),
      ]);
      setActiveDelays((activeRes.data as DelayEvent[]) || []);
      setSummary(summaryRes.data as DelaySummary);
      setShiftDelays((shiftRes.data as DelayEvent[]) || []);
      setCategories((catsRes.data as DelayCategory[]) || []);
    } catch {
      setError('Erreur de chargement des délais');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const handleOpenDelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catCode) return;
    setSubmitting(true);
    setSubmitMsg('');
    try {
      await delayApi.open({ siteId, equipmentId, catCode, notes });
      setSubmitMsg('Délai ouvert avec succès');
      setEquipmentId(''); setCatCode(''); setNotes('');
      await load();
    } catch {
      setSubmitMsg('Erreur lors de l\'ouverture du délai');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseDelay = async (eventId: string) => {
    try {
      await delayApi.close(eventId);
      await load();
    } catch { /* silencieux */ }
  };

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconDelay size={20} className="text-amber-400" />
            Codes Délais
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Disponibilité mécanique · physique · utilisation</p>
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

      {/* Grands indicateurs MA% / PA% / UA% */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <AvailCard label="MA%" value={summary.maPercent} tooltip="Disponibilité Mécanique — temps sans panne mécanique" color="text-emerald-400" />
          <AvailCard label="PA%" value={summary.paPercent} tooltip="Disponibilité Physique — temps où l'engin peut travailler" color="text-blue-400" />
          <AvailCard label="UA%" value={summary.uaPercent} tooltip="Utilisation — temps réellement productif" color="text-amber-400" />
        </div>
      )}

      {/* Délais actifs */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full bg-red-500 ${activeDelays.length > 0 ? 'animate-pulse' : ''}`} />
          <h2 className="text-sm font-semibold text-slate-300">
            Délais actifs
            {activeDelays.length > 0 && (
              <span className="ml-2 px-2 py-0.5 text-[10px] bg-red-950/60 text-red-400 border border-red-700/40 rounded-full">
                {activeDelays.length} en cours
              </span>
            )}
          </h2>
        </div>
        {activeDelays.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-sm text-emerald-400">
            <IconCheck size={14} />
            Aucun délai actif
          </div>
        ) : (
          <div className="space-y-2">
            {activeDelays.map(d => (
              <div key={d.eventId} className="flex items-center justify-between p-2 bg-red-950/20 border border-red-700/30 rounded gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-mono text-xs font-bold text-white">{d.equipmentName}</span>
                  <span className="text-[10px] text-slate-500">|</span>
                  <span className={`text-xs font-medium ${TYPE_COLOR[d.type] ?? 'text-slate-400'}`}>{d.catCode}</span>
                  <span className="text-xs text-slate-400 truncate">{d.catLabel}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-slate-500">
                    depuis {new Date(d.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    onClick={() => handleCloseDelay(d.eventId)}
                    className="px-2 py-0.5 text-[10px] bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 rounded hover:bg-emerald-800/50 transition-colors"
                  >
                    Clore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulaire nouveau délai */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <IconPlus size={14} className="text-amber-400" />
          Ouvrir un délai manuellement
        </h2>
        <form onSubmit={handleOpenDelay} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Équipement</label>
            <input
              type="text"
              value={equipmentId}
              onChange={e => setEquipmentId(e.target.value)}
              placeholder="ex: EQ-001"
              className="bg-[#0a1628] border border-[#1a2740] rounded px-2 py-1.5 text-xs text-slate-300 w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Catégorie *</label>
            <select
              value={catCode}
              onChange={e => setCatCode(e.target.value)}
              required
              className="bg-[#0a1628] border border-[#1a2740] rounded px-2 py-1.5 text-xs text-slate-300 w-44"
            >
              <option value="">— Sélectionner —</option>
              {categories.map(c => (
                <option key={c.catId} value={c.code}>{c.code} — {c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-32">
            <label className="text-xs text-slate-400">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Description optionnelle"
              className="bg-[#0a1628] border border-[#1a2740] rounded px-2 py-1.5 text-xs text-slate-300 w-full"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !catCode}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-xs font-semibold text-white transition-colors"
          >
            {submitting ? 'Ouverture…' : 'Ouvrir'}
          </button>
          {submitMsg && (
            <span className={`text-xs ${submitMsg.includes('succès') ? 'text-emerald-400' : 'text-red-400'}`}>
              {submitMsg}
            </span>
          )}
        </form>
      </div>

      {/* Tableau délais du poste */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Délais du poste</h2>
        {shiftDelays.length === 0 ? (
          <EmptyState message="Aucun délai enregistré ce poste" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Équipement</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Durée</th>
                  <th className="px-3 py-2 text-center">Origine</th>
                  <th className="px-3 py-2 text-center">Statut</th>
                </tr>
              </thead>
              <tbody>
                {shiftDelays.map(d => (
                  <tr key={d.eventId} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2 font-mono text-white text-xs">{d.equipmentName}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-slate-300" title={d.catLabel}>{d.catCode}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${TYPE_COLOR[d.type] ?? 'text-slate-400'}`}>{d.type}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300 text-xs">{fmtMin(d.durationMin)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.auto ? 'bg-blue-950/50 text-blue-400' : 'bg-amber-950/50 text-amber-400'}`}>
                        {d.auto ? 'AUTO' : 'MANUEL'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {d.endedAt ? (
                        <span className="text-[10px] text-slate-500">Clôturé</span>
                      ) : (
                        <span className="text-[10px] text-red-400 animate-pulse">En cours</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Résumé par catégorie */}
      {summary && summary.byCategory.length > 0 && (
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Résumé par catégorie</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Libellé</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Nb</th>
                  <th className="px-3 py-2 text-right">Durée totale</th>
                </tr>
              </thead>
              <tbody>
                {summary.byCategory.map((c, i) => (
                  <tr key={i} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2 font-mono text-xs text-white">{c.code}</td>
                    <td className="px-3 py-2 text-slate-300 text-xs">{c.label}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${TYPE_COLOR[c.type] ?? 'text-slate-400'}`}>{c.type}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{c.count}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{fmtMin(c.totalMin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composants utilitaires ─────────────────────────────────────────────────────

function AvailCard({ label, value, tooltip, color }: { label: string; value: number; tooltip: string; color: string }) {
  return (
    <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 relative group">
      <div className={`text-2xl font-bold ${color}`}>{value.toFixed(1)}<span className="text-sm ml-0.5">%</span></div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
      <div className="h-2 bg-[#0a1628] rounded-full mt-2 overflow-hidden">
        <div className={`h-full rounded-full bg-current opacity-70 ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 border border-[#1a2740] rounded text-[10px] text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        {tooltip}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <IconAlert size={24} className="text-slate-700" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
