import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { STATUTS_ACTIFS } from './constants';
import type { Zone, Dump, Engin, Voyage, Stats } from './types';
import Header       from './components/Header';
import VoyageModal  from './components/VoyageModal';
import TerrainView  from './views/TerrainView';
import HistoriqueView from './views/HistoriqueView';
import ConfigView   from './views/config/ConfigView';

type View = 'terrain' | 'historique' | 'config';

export default function App() {
  const [zones,  setZones]  = useState<Zone[]>([]);
  const [dumps,  setDumps]  = useState<Dump[]>([]);
  const [engins, setEngins] = useState<Engin[]>([]);
  const [stats,  setStats]  = useState<Stats | null>(null);
  const [actifs, setActifs] = useState<Voyage[]>([]);
  const [view,   setView]   = useState<View>('terrain');
  const [modal,  setModal]  = useState<{ open: boolean; zoneId?: number }>({ open: false });

  const loadAll = useCallback(async () => {
    const [z, d, e, s, v] = await Promise.all([
      api.zones(), api.dumps(), api.engins(), api.stats(), api.voyages(),
    ]);
    setZones(z); setDumps(d); setEngins(e); setStats(s);
    setActifs((v as Voyage[]).filter((x: Voyage) => STATUTS_ACTIFS.includes(x.statut as typeof STATUTS_ACTIFS[number])));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#d4d8e2', fontFamily: 'ui-monospace,SFMono-Regular,monospace', fontSize: 13, display: 'flex', flexDirection: 'column' }}>

      <Header
        stats={stats}
        view={view}
        onChangeView={setView}
        onNewVoyage={() => setModal({ open: true })}
        onRefresh={loadAll}
      />

      <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {view === 'terrain' && (
          <TerrainView
            zones={zones} dumps={dumps} engins={engins} actifs={actifs}
            onRefresh={loadAll}
            onDispatch={zoneId => setModal({ open: true, zoneId })}
          />
        )}
        {view === 'historique' && (
          <HistoriqueView zones={zones} dumps={dumps} />
        )}
        {view === 'config' && (
          <ConfigView zones={zones} dumps={dumps} engins={engins} onRefresh={loadAll} />
        )}
      </div>

      {modal.open && (
        <VoyageModal
          zones={zones}
          defaultZoneId={modal.zoneId}
          onClose={() => setModal({ open: false })}
          onSaved={() => { setModal({ open: false }); loadAll(); }}
        />
      )}
    </div>
  );
}
