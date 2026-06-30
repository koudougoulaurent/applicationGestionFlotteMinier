export interface Dump  { id: number; code: string; nom: string; }
export interface Engin { id: number; numero: string; zone_id: number; capacite_t: number; statut_voyage?: string | null; }
export interface Zone  {
  id: number; code: string; nom: string;
  materiau?: string; couleur?: string;
  nb_engins: number; dumps: Dump[];
}
export interface Voyage {
  id: number; engin: string; zone_code: string; zone_nom: string;
  dump_code: string; dump_nom: string; operateur?: string;
  materiau?: string; payload_t?: number; shift: string;
  heure_depart: string; heure_arrivee?: string;
  statut: string; notes?: string; duree_min?: number;
}
export interface Stats {
  voyages_today: number; en_cours: number;
  tonnes_today: number; nb_engins: number;
}
