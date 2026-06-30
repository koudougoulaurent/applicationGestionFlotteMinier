const B = 'http://localhost:4000/api';
const h = { 'Content-Type': 'application/json' };
const get  = (u: string) => fetch(B + u).then(r => r.json());
const post = (u: string, b: unknown) =>
  fetch(B + u, { method: 'POST', headers: h, body: JSON.stringify(b) }).then(r => r.json());
const patch = (u: string, b?: unknown) =>
  fetch(B + u, { method: 'PATCH', headers: h, body: JSON.stringify(b ?? {}) }).then(r => r.json());
const del = (u: string) => fetch(B + u, { method: 'DELETE' }).then(r => r.json());

export const api = {
  pelles:    () => get('/pelles'),
  addPelle:  (b: unknown) => post('/pelles', b),
  editPelle: (id: number, b: unknown) => patch(`/pelles/${id}`, b),
  delPelle:  (id: number) => del(`/pelles/${id}`),

  zones:      () => get('/zones'),
  addZone:    (b: unknown) => post('/zones', b),
  editZone:   (id: number, b: unknown) => patch(`/zones/${id}`, b),
  delZone:    (id: number) => del(`/zones/${id}`),
  linkDump:   (zid: number, b: unknown) => post(`/zones/${zid}/dumps`, b),
  unlinkDump: (zid: number, did: number) => del(`/zones/${zid}/dumps/${did}`),

  dumps:    () => get('/dumps'),
  addDump:  (b: unknown) => post('/dumps', b),
  editDump: (id: number, b: unknown) => patch(`/dumps/${id}`, b),
  delDump:  (id: number) => del(`/dumps/${id}`),

  engins:    (zone_id?: number) => get('/engins' + (zone_id ? `?zone_id=${zone_id}` : '')),
  addEngin:  (b: unknown) => post('/engins', b),
  editEngin: (id: number, b: unknown) => patch(`/engins/${id}`, b),
  delEngin:  (id: number) => del(`/engins/${id}`),

  voyages:   (p: Record<string, string> = {}) =>
    get('/voyages' + (Object.keys(p).length ? '?' + new URLSearchParams(p) : '')),
  addVoyage: (b: unknown) => post('/voyages', b),
  auDump:    (id: number) => patch(`/voyages/${id}/au-dump`),
  retour:    (id: number) => patch(`/voyages/${id}/retour`),
  delVoyage: (id: number) => del(`/voyages/${id}`),

  stats: () => get('/stats'),
};
