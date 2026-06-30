const BASE = 'http://localhost:4000/api';

const get  = (url: string) => fetch(BASE + url).then(r => r.json());
const post = (url: string, body: unknown) =>
  fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const patch = (url: string, body?: unknown) =>
  fetch(BASE + url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(r => r.json());
const del  = (url: string) => fetch(BASE + url, { method: 'DELETE' }).then(r => r.json());

export const api = {
  zones:      () => get('/zones'),
  addZone:    (b: unknown) => post('/zones', b),
  editZone:   (id: number, b: unknown) => patch(`/zones/${id}`, b),
  delZone:    (id: number) => del(`/zones/${id}`),
  linkDump:   (zoneId: number, dump_id: number) => post(`/zones/${zoneId}/dumps`, { dump_id }),
  unlinkDump: (zoneId: number, dumpId: number)  => del(`/zones/${zoneId}/dumps/${dumpId}`),

  dumps:    () => get('/dumps'),
  addDump:  (b: unknown) => post('/dumps', b),
  delDump:  (id: number) => del(`/dumps/${id}`),

  engins:    (zone_id?: number) => get(`/engins${zone_id ? `?zone_id=${zone_id}` : ''}`),
  addEngin:  (b: unknown) => post('/engins', b),
  editEngin: (id: number, b: unknown) => patch(`/engins/${id}`, b),
  delEngin:  (id: number) => del(`/engins/${id}`),

  voyages:     (params?: Record<string, string>) =>
    get('/voyages' + (params ? '?' + new URLSearchParams(params) : '')),
  addVoyage:   (b: unknown) => post('/voyages', b),
  terminer:    (id: number, heure?: string) => patch(`/voyages/${id}/terminer`, { heure_arrivee: heure }),
  delVoyage:   (id: number) => del(`/voyages/${id}`),

  stats: () => get('/stats'),
};
