import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { operatorApi } from '../lib/api';
import { Operator } from '../types';
import { useRole } from '../hooks/useRole';
import { useAuthStore } from '../store';
import { differenceInDays, parseISO, format } from 'date-fns';
import {
  IconPlus, IconEdit, IconTrash, IconSearch, IconX, IconSave,
  IconAlert, IconCheck,
} from '../components/ui/Icons';

const CERT_LEVELS = ['TRAINEE', 'OPERATOR', 'SENIOR', 'SUPERVISOR'] as const;
type CertLevel = typeof CERT_LEVELS[number];

const CERT_CFG: Record<CertLevel, { label: string; color: string }> = {
  TRAINEE:    { label: 'Stagiaire',    color: '#64748b' },
  OPERATOR:   { label: 'Opérateur',   color: '#0ea5e9' },
  SENIOR:     { label: 'Senior',      color: '#f59e0b' },
  SUPERVISOR: { label: 'Superviseur', color: '#a855f7' },
};

const AVAILABLE_CERTS = [
  'CAT 797F', 'CAT 793F', 'Komatsu 930E', 'CAT 6060', 'Liebherr R9600',
  'CAT D11', 'CAT 16M', 'CAT MD6250', 'Conduite Défensive Mine', 'FIFO',
  'Manipulation Explosifs', 'Premiers Secours', 'Sécurité Mine Surface',
  'Opérateur Foreuse', 'Opérateur Chargeuse',
];

function ExpiryBadge({ date, label }: { date?: string; label: string }) {
  if (!date) return <span className="text-[10px] text-slate-600">—</span>;
  const days = differenceInDays(parseISO(date), new Date());
  const color = days < 0 ? '#ef4444' : days < 30 ? '#f59e0b' : '#22c55e';
  const bg    = days < 0 ? '#1c0505' : days < 30 ? '#1c1000' : '#052e16';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="text-[10px] font-mono font-semibold" style={{ color }}>
        {format(parseISO(date), 'dd/MM/yy')}
        {days < 30 && (
          <span className="ml-1 px-1 rounded text-[9px]" style={{ backgroundColor: bg, color }}>
            {days < 0 ? `exp ${Math.abs(days)}j` : `${days}j`}
          </span>
        )}
      </span>
    </div>
  );
}

interface OperatorFormProps {
  operator?: Operator;
  siteId: string;
  onClose: () => void;
  onSaved: () => void;
}

function OperatorForm({ operator, siteId, onClose, onSaved }: OperatorFormProps) {
  const qc = useQueryClient();
  const isEdit = !!operator;
  const [tab, setTab] = useState<'identity' | 'certs' | 'docs'>('identity');
  const [form, setForm] = useState({
    employeeNo:         operator?.employee_no || '',
    firstName:          operator?.first_name || '',
    lastName:           operator?.last_name || '',
    phone:              operator?.phone || '',
    email:              '',
    certificationLevel: (operator?.certification_level as CertLevel) || 'OPERATOR',
    licenseExpiry:      operator?.license_expiry || '',
    medicalExpiry:      operator?.medical_expiry || '',
    hireDate:           '',
    certifications:     (operator?.certifications || []) as string[],
    active:             operator?.active !== false,
  });
  const [error, setError] = useState('');

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const toggleCert = (cert: string) =>
    setForm(f => ({
      ...f,
      certifications: f.certifications.includes(cert)
        ? f.certifications.filter(c => c !== cert)
        : [...f.certifications, cert],
    }));

  const mutation = useMutation({
    mutationFn: (body: object) => isEdit
      ? operatorApi.update(operator!.operator_id, body)
      : operatorApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operators'] }); onSaved(); },
    onError: (err: unknown) => {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur serveur');
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!form.employeeNo.trim()) { setError('Matricule requis'); return; }
    if (!form.firstName.trim())  { setError('Prénom requis'); return; }
    if (!form.lastName.trim())   { setError('Nom requis'); return; }
    mutation.mutate({
      siteId,
      employeeNo:         form.employeeNo.trim().toUpperCase(),
      firstName:          form.firstName.trim(),
      lastName:           form.lastName.trim().toUpperCase(),
      phone:              form.phone.trim() || undefined,
      email:              form.email.trim() || undefined,
      certificationLevel: form.certificationLevel,
      licenseExpiry:      form.licenseExpiry || undefined,
      medicalExpiry:      form.medicalExpiry || undefined,
      hireDate:           form.hireDate || undefined,
      certifications:     form.certifications.length ? form.certifications : undefined,
      active:             form.active,
    });
  };

  const TABS = [
    { id: 'identity' as const, label: 'Identité' },
    { id: 'certs' as const,    label: 'Qualifications' },
    { id: 'docs' as const,     label: 'Documents' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-[#1a2740] rounded-lg w-full max-w-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a2740]">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              {isEdit ? `Modifier — ${operator.first_name} ${operator.last_name}` : 'Ajouter un opérateur'}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isEdit ? 'Modification du dossier' : 'Enregistrement d\'un nouvel opérateur dans le système'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition-colors"><IconX size={18} /></button>
        </div>

        <div className="flex border-b border-[#1a2740]">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-[12px] font-medium transition-colors border-b-2 ${
                tab === t.id ? 'text-amber-400 border-amber-500' : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}>{t.label}</button>
          ))}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {tab === 'identity' && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className="field-label">Matricule *</label>
                <input value={form.employeeNo} onChange={e => set('employeeNo', e.target.value.toUpperCase())}
                  placeholder="ex: EMP-009" className="field-input" /></div>
              <div><label className="field-label">Niveau certification</label>
                <select value={form.certificationLevel} onChange={e => set('certificationLevel', e.target.value as CertLevel)} className="field-input">
                  {CERT_LEVELS.map(l => <option key={l} value={l}>{CERT_CFG[l].label}</option>)}
                </select></div>
              <div><label className="field-label">Prénom *</label>
                <input value={form.firstName} onChange={e => set('firstName', e.target.value)}
                  placeholder="ex: Moses" className="field-input" /></div>
              <div><label className="field-label">Nom *</label>
                <input value={form.lastName} onChange={e => set('lastName', e.target.value.toUpperCase())}
                  placeholder="ex: BANDA" className="field-input" /></div>
              <div><label className="field-label">Téléphone</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)}
                  placeholder="+260971000001" className="field-input" /></div>
              <div><label className="field-label">Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="m.banda@mine.com" className="field-input" /></div>
              <div><label className="field-label">Date d'embauche</label>
                <input type="date" value={form.hireDate} onChange={e => set('hireDate', e.target.value)} className="field-input" /></div>
              {isEdit && (
                <div className="flex items-center gap-3 pt-5">
                  <button type="button" onClick={() => set('active', !form.active)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${form.active ? 'bg-amber-500' : 'bg-slate-700'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-[12px] text-slate-400">{form.active ? 'Actif' : 'Inactif'}</span>
                </div>
              )}
            </div>
          )}

          {tab === 'certs' && (
            <div>
              <p className="text-[11px] text-slate-500 mb-3">Équipements et formations certifiés :</p>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_CERTS.map(cert => {
                  const active = form.certifications.includes(cert);
                  return (
                    <button key={cert} type="button" onClick={() => toggleCert(cert)}
                      className={`flex items-center gap-2 px-3 py-2 rounded border text-left text-[12px] transition-all ${
                        active ? 'bg-amber-500/10 border-amber-500/60 text-amber-300'
                               : 'bg-[#0d1520] border-[#1a2740] text-slate-400 hover:border-[#2a3750]'
                      }`}>
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                        active ? 'bg-amber-500 border-amber-500' : 'border-slate-600'
                      }`}>
                        {active && <IconCheck size={9} className="text-black" />}
                      </span>
                      {cert}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'docs' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Expiration permis de conduire</label>
                <input type="date" value={form.licenseExpiry} onChange={e => set('licenseExpiry', e.target.value)} className="field-input" />
                <p className="text-[10px] text-slate-600 mt-1">Alerte automatique 30 jours avant expiration</p>
              </div>
              <div>
                <label className="field-label">Expiration visite médicale</label>
                <input type="date" value={form.medicalExpiry} onChange={e => set('medicalExpiry', e.target.value)} className="field-input" />
                <p className="text-[10px] text-slate-600 mt-1">Renouvellement annuel obligatoire</p>
              </div>
              <div className="col-span-2">
                <div className="p-3 bg-[#0d1520] border border-[#1a2740] rounded mt-2">
                  <div className="text-[11px] text-slate-500 mb-2 uppercase tracking-widest">Aperçu alertes documents</div>
                  <div className="flex gap-8">
                    <ExpiryBadge date={form.licenseExpiry || undefined} label="Permis" />
                    <ExpiryBadge date={form.medicalExpiry || undefined} label="Médical" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-1 px-3 py-2 bg-red-950/60 border border-red-700/40 rounded text-[12px] text-red-400 flex items-center gap-2">
            <IconAlert size={13} />{error}
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-t border-[#1a2740]">
          <div className="text-[11px] text-slate-600">* champs obligatoires</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-[13px] px-4 py-2">Annuler</button>
            <button onClick={handleSubmit} disabled={mutation.isPending}
              className="btn-primary text-[13px] px-4 py-2 flex items-center gap-2">
              <IconSave size={14} />
              {mutation.isPending ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Operators() {
  const { isAdmin } = useRole();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [editOp, setEditOp] = useState<Operator | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Operator | null>(null);

  const { data: operators = [], isLoading } = useQuery<Operator[]>({
    queryKey: ['operators'],
    queryFn: async () => (await operatorApi.list()).data,
    refetchInterval: 30_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => operatorApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operators'] }); setConfirmDeactivate(null); },
  });

  const expiringDocs = operators.filter(o => {
    const lic = o.license_expiry ? differenceInDays(parseISO(o.license_expiry), new Date()) : 999;
    const med = o.medical_expiry ? differenceInDays(parseISO(o.medical_expiry), new Date()) : 999;
    return lic < 30 || med < 30;
  });

  const filtered = operators.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      o.first_name.toLowerCase().includes(q) ||
      o.last_name.toLowerCase().includes(q) ||
      o.employee_no.toLowerCase().includes(q) ||
      (o.assigned_equipment || '').toLowerCase().includes(q);
    return matchSearch && (levelFilter === 'ALL' || o.certification_level === levelFilter);
  });

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total opérateurs', value: operators.length, sub: `${operators.filter(o=>o.active).length} actifs`, color: 'text-white' },
          { label: 'En poste', value: operators.filter(o=>o.assigned_equipment).length, sub: 'sur équipement', color: 'text-blue-400' },
          { label: 'Seniors / Superv.', value: operators.filter(o=>['SENIOR','SUPERVISOR'].includes(o.certification_level)).length, sub: 'qualifiés', color: 'text-amber-400' },
          { label: 'Docs expirant', value: expiringDocs.length, sub: '< 30 jours', color: expiringDocs.length > 0 ? 'text-red-400' : 'text-white', alert: expiringDocs.length > 0 },
        ].map(k => (
          <div key={k.label} className={`bg-[#111827] border rounded-lg p-3 ${k.alert ? 'border-red-700/40' : 'border-[#1a2740]'}`}>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{k.label}</div>
            <div className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-[10px] text-slate-500 mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, matricule, équipement..."
            className="w-full bg-[#111827] border border-[#1a2740] rounded px-3 py-2 pl-8 text-[13px] text-slate-200 placeholder-slate-600 focus:border-amber-500/50 focus:outline-none" />
        </div>
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
          className="bg-[#111827] border border-[#1a2740] rounded px-3 py-2 text-[13px] text-slate-300 focus:outline-none">
          <option value="ALL">Tous niveaux</option>
          {CERT_LEVELS.map(l => <option key={l} value={l}>{CERT_CFG[l].label}</option>)}
        </select>
        <div className="text-[11px] text-slate-600 font-mono">{filtered.length} opérateurs</div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-2 text-[13px] px-3 py-2 ml-auto">
            <IconPlus size={14} />Ajouter opérateur
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#111827] border border-[#1a2740] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#1a2740] bg-[#0d1520]">
                {['Matricule','Nom Prénom','Niveau','Affectation','Certifications','Permis','Médical','Statut', isAdmin ? 'Actions' : ''].filter(Boolean).map(h => (
                  <th key={h} className="text-left py-2.5 px-3 text-[10px] text-slate-500 font-semibold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-600">Chargement...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-600">Aucun opérateur trouvé</td></tr>
              ) : filtered.map(op => {
                const certCfg = CERT_CFG[op.certification_level as CertLevel] || { label: op.certification_level, color: '#94a3b8' };
                return (
                  <tr key={op.operator_id}
                    className={`border-b border-[#1a2740]/60 transition-colors ${!op.active ? 'opacity-40' : 'hover:bg-[#1a2740]/30'}`}>
                    <td className="py-3 px-3 font-mono text-amber-400 font-semibold text-[12px]">{op.employee_no}</td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-200">{op.first_name} <span className="font-bold">{op.last_name}</span></div>
                      {op.phone && <div className="text-[10px] text-slate-600 font-mono mt-0.5">{op.phone}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: certCfg.color, backgroundColor: `${certCfg.color}18`, border: `1px solid ${certCfg.color}33` }}>
                        {certCfg.label}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {op.assigned_equipment
                        ? <div><span className="font-mono font-bold text-sky-400 text-[12px]">{op.assigned_equipment}</span>
                            {op.equipment_category && <div className="text-[10px] text-slate-600 mt-0.5">{op.equipment_category}</div>}</div>
                        : <span className="text-[11px] text-slate-600">Disponible</span>}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1">
                        {(op.certifications || []).slice(0,3).map(c => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">{c}</span>
                        ))}
                        {(op.certifications || []).length > 3 && <span className="text-[10px] text-slate-600">+{(op.certifications||[]).length-3}</span>}
                      </div>
                    </td>
                    <td className="py-3 px-3"><ExpiryBadge date={op.license_expiry} label="Permis" /></td>
                    <td className="py-3 px-3"><ExpiryBadge date={op.medical_expiry} label="Médical" /></td>
                    <td className="py-3 px-3">
                      <span className={`text-[11px] font-medium flex items-center gap-1 ${op.active ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {op.active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        {op.active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditOp(op)}
                            className="p-1.5 rounded text-slate-500 hover:text-sky-400 hover:bg-sky-500/10 transition-colors" title="Modifier">
                            <IconEdit size={13} />
                          </button>
                          {op.active && (
                            <button onClick={() => setConfirmDeactivate(op)}
                              className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Désactiver">
                              <IconTrash size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <OperatorForm siteId={user?.siteId||''} onClose={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} />}
      {editOp && <OperatorForm operator={editOp} siteId={user?.siteId||''} onClose={() => setEditOp(null)} onSaved={() => setEditOp(null)} />}

      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111827] border border-red-700/40 rounded-lg w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-950 flex items-center justify-center flex-shrink-0">
                <IconAlert size={16} className="text-red-400" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-white">Désactiver l'opérateur</div>
                <div className="text-[11px] text-slate-500 mt-0.5">L'opérateur sera retiré de toute affectation</div>
              </div>
            </div>
            <p className="text-[13px] text-slate-300 mb-4">
              Confirmer la désactivation de <span className="font-bold text-amber-400">{confirmDeactivate.first_name} {confirmDeactivate.last_name}</span> [{confirmDeactivate.employee_no}] ?
            </p>
            <div className="flex gap-2">
              <button onClick={() => deactivateMutation.mutate(confirmDeactivate.operator_id)}
                disabled={deactivateMutation.isPending}
                className="flex-1 bg-red-900 hover:bg-red-800 text-red-200 text-[13px] font-semibold px-4 py-2 rounded transition-colors">
                {deactivateMutation.isPending ? 'Traitement...' : 'Désactiver'}
              </button>
              <button onClick={() => setConfirmDeactivate(null)} className="flex-1 btn-secondary text-[13px]">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
