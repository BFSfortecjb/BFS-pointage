// =========================================================================
// Pointage BFS — PT_core.js
// =========================================================================
// Socle : client Supabase, authentification, état global S, fonctions
// transverses. Le métier (écrans, formulaires) vit dans PT_app.js.
// =========================================================================

// --- Client Supabase, sur le schéma "pointage" (sinon il cherche ses
// tables dans "public") --------------------------------------------------
const ptSupabase = supabase.createClient(PT_CONFIG.SUPABASE_URL, PT_CONFIG.SUPABASE_ANON_KEY, {
  db: { schema: PT_CONFIG.SUPABASE_SCHEMA },
  auth: { storageKey: PT_CONFIG.STORAGE_KEY_AUTH },
});

// --- État global unique ---------------------------------------------------
const S = {
  session: null,
  profil: null, // ligne de pointage.profils correspondant à l'utilisateur connecté
  parametres: {}, // { cle: valeur } chargé depuis pointage.parametres
  ongletActif: 'pointage',
  horodatagesJour: [],
  activitesJour: [],
  centres: [],
  deplacementsRecents: [],
  horodatagesTrajetTous: [],
  suiviNbJours: 14,
  suiviHorodatages: [],
  suiviActivites: [],
};

// --- Onglets disponibles par rôle, dispatch par objet plutôt que cascade
// de if/else --------------------------------------------------------------
const PT_ONGLETS_PAR_ROLE = {
  technicien: [{ id: 'pointage', label: 'Pointage' }, { id: 'suivi', label: 'Suivi' }],
  admin: [{ id: 'pointage', label: 'Pointage' }, { id: 'suivi', label: 'Suivi' }, { id: 'admin', label: 'Administration' }],
  secretariat: [{ id: 'pointage', label: 'Pointage' }, { id: 'suivi', label: 'Suivi' }, { id: 'secretariat', label: 'Gestion' }],
};

// --- Auth -------------------------------------------------------------
async function ptConnecter(email, motDePasse) {
  const { data, error } = await ptSupabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw error;
  S.session = data.session;
  return data;
}

async function ptDeconnecter() {
  await ptSupabase.auth.signOut();
  S.session = null;
  S.profil = null;
}

async function ptChargerSession() {
  const { data } = await ptSupabase.auth.getSession();
  S.session = data.session;
  return S.session;
}

// --- Chargement du profil et des paramètres --------------------------------
async function ptChargerProfil() {
  if (!S.session) return null;
  const { data, error } = await ptSupabase
    .from('profils')
    .select('*')
    .eq('id', S.session.user.id)
    .maybeSingle();
  if (error) throw error;
  S.profil = data;
  return data;
}

async function ptChargerParametres() {
  const { data, error } = await ptSupabase.from('parametres').select('cle, valeur');
  if (error) throw error;
  S.parametres = {};
  for (const ligne of data) S.parametres[ligne.cle] = ligne.valeur;
  return S.parametres;
}

function ptParametreActif(cle) {
  return S.parametres[cle] === 'true';
}

async function ptChargerCentres() {
  const { data, error } = await ptSupabase
    .from('centres')
    .select('code, libelle')
    .eq('actif', true)
    .order('libelle');
  if (error) throw error;
  S.centres = data;
  return data;
}

// --- Utilitaires date/heure ------------------------------------------------
function ptDateDuJour() {
  // Toujours raisonner en heure de Paris, cohérent avec le défaut en base.
  const maintenant = new Date();
  return maintenant.toLocaleDateString('sv-SE'); // format AAAA-MM-JJ stable
}

function ptFormatHeure(dateIso) {
  return new Date(dateIso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// --- Géolocalisation (optionnelle, non bloquante) ---------------------------
function ptCapturerGeoloc() {
  return new Promise((resolve) => {
    if (!ptParametreActif('geoloc_active') || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({ latitude: null, longitude: null }),
      { timeout: 4000 }
    );
  });
}
