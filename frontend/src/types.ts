export interface Pelle {
  id: number; code: string; modele: string;
  operateur?: string; statut: string;
}

export interface DumpLink {
  id: number; code: string; nom: string; type: string;
  distance_km: number; duree_min: number;
}

export interface Zone {
  id: number; code: string; nom: string;
  type_minerai: string; couleur: string;
  pelle_id?: number; pelle_code?: string;
  pelle_modele?: string; pelle_operateur?: string; pelle_statut?: string;
  capacite_queue: number;
  nb_engins: number; nb_dispos: number; nb_file: number; nb_en_route: number;
  tonnes_jour: number;
  dumps: DumpLink[];
}

export interface Dump {
  id: number; code: string; nom: string; type: string;
  camions_presents: number; tonnes_recues_jour: number; voyages_jour: number;
}

export interface Engin {
  id: number; numero: string; modele: string;
  zone_id: number; zone_code?: string;
  capacite_t: number; statut: string;
  voyage_actif_id?: number | null;
}

export interface Voyage {
  id: number; engin_id: number; zone_id: number; dump_id: number;
  engin: string; engin_modele: string; capacite_t: number;
  zone_code: string; zone_nom: string; zone_couleur: string;
  dump_code: string; dump_nom: string; dump_type: string;
  operateur?: string; type_materiau?: string; payload_t?: number;
  shift: string; heure_depart: string;
  heure_au_dump?: string; heure_retour?: string;
  statut: string; notes?: string;
  duree_estime_min: number;
  elapsed_min: number; duree_reelle_min: number;
}

export interface Stats {
  voyages_jour: number; en_route: number; au_dump: number;
  dispos: number; tonnes_jour: number;
  cycle_moyen_min: number; engins_actifs: number;
}
