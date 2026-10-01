/* =====================================================================
   HE_core.js — socle de l'application

   - connexion Supabase
   - authentification formateur
   - état global S
   - routage entre écrans / onglets
   - petites fonctions transverses ($, esc, toast, confirmer...)
   ===================================================================== */

let sb = null;   // client Supabase

/* --------------------------- état global --------------------------- */
const S = {
  utilisateur: null,      // compte Supabase connecté (formateur)
  profil: null,           // ligne de la table formateurs
  organisme: null,        // ligne de la table organismes
  vision: 'formateur',    // 'admin' | 'formateur' | 'stagiaire'
  accesRefuse: false,     // compte authentifié mais non autorisé dans Habelec
  ecran: 'sessions',      // onglet actif côté formateur
  session: null,          // session de formation ouverte dans l'écran de suivi
  stagiaire: null,        // stagiaire en cours d'évaluation pratique
  referentiel: {          // référentiel normatif chargé une fois
    themes: [], gabarits: [], symboles: [], lignesTitre: [], savoirFaire: [], criteres: [],
  },
  qcm: null,              // sujet en cours côté stagiaire
};

/* ------------------- stockage local préfixé ------------------------ */
/**
 * Toutes les applications BFS sont publiées sur bfsfortecjb.github.io :
 * pour le navigateur, c'est un seul site, donc une seule mémoire locale.
 * Toute clé écrite ici doit être préfixée par le nom de l'application.
 * Ne jamais appeler localStorage directement ailleurs dans le code.
 */
const PREFIXE = 'habelec_';
const MEM = {
  cle: nom => PREFIXE + nom,
  lire(nom, defaut = null) {
    try {
      const v = localStorage.getItem(MEM.cle(nom));
      return v === null ? defaut : JSON.parse(v);
    } catch { return defaut; }
  },
  ecrire(nom, valeur) {
    try { localStorage.setItem(MEM.cle(nom), JSON.stringify(valeur)); } catch { /* quota */ }
  },
  effacer(nom) { try { localStorage.removeItem(MEM.cle(nom)); } catch { /* ignore */ } },
};

/* ------------------------- utilitaires UI -------------------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, type = 'ok', duree = 4000) {
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = message;
  $('#toasts').appendChild(d);
  setTimeout(() => d.classList.add('sortie'), duree - 400);
  setTimeout(() => d.remove(), duree);
}

function confirmer(message) { return window.confirm(message); }

function dateFr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
}

// 2026-09-18 (demande de Jeremy) : sécurité anti-erreur de saisie sur la
// date de naissance des stagiaires — plusieurs avaient mis la date du jour
// au lieu de leur date de naissance (sans doute la date par défaut ouverte
// par le sélecteur). dateNaissanceMax() borne le sélecteur, et
// dateNaissanceValide() est la même règle utilisée à la validation du
// formulaire (côté stagiaire ET côté formateur) : 16 ans révolus minimum.
function dateNaissanceMax() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  return d.toISOString().slice(0, 10);
}

function dateNaissanceValide(valeur) {
  if (!valeur) return false;
  const d = new Date(valeur);
  if (isNaN(d)) return false;
  return d.toISOString().slice(0, 10) <= dateNaissanceMax();
}

/** Affiche un bandeau d'erreur exploitable plutôt qu'un plantage muet. */
function erreurSupabase(contexte, e) {
  const msg = e?.message || String(e);
  DEBUG.erreur(contexte, msg);
  toast(contexte + ' : ' + msg, 'erreur', 8000);
}

/* --------------------------- Supabase ------------------------------ */
function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('VOTRE-PROJET')) {
    document.getElementById('ecran').innerHTML =
      '<div class="ecran-vide"><h1>Configuration requise</h1>'
      + '<p>Ouvre le fichier <code>HE_config.js</code> et renseigne l\'adresse de ton projet '
      + 'Supabase et sa clé « anon public » (Project Settings &rsaquo; API).</p></div>';
    return false;
  }
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    // Règle commune Univers BFS : chaque appli vit dans son propre schéma
    // Postgres, jamais 'public'. Sans ce réglage, le client chercherait ses
    // tables dans 'public' et toutes les requêtes échoueraient.
    db: {
      schema: CONFIG.SUPABASE_SCHEMA || 'habelec',
    },
    auth: {
      // Obligatoire : sans clé propre, toutes les applications BFS publiées sur
      // le même domaine partageraient la même session Supabase.
      storageKey: 'habelec-auth',
      persistSession: true,
      autoRefreshToken: true,
      // Désactivé volontairement : la lecture du fragment d'URL est faite
      // explicitement par recupererSessionDepuisUrl(), pour maîtriser l'ordre
      // des opérations au démarrage (voir plus bas).
      detectSessionInUrl: false,
    },
  });
  DEBUG.info('Client Supabase initialisé');
  return true;
}

/* ------------- session transmise par le portail Univers BFS -------- */
/**
 * Le portail peut ouvrir l'application avec une session déjà établie :
 *   .../habelec/#access_token=...&refresh_token=...
 * On installe cette session, on nettoie l'URL, et on laisse le démarrage
 * normal se poursuivre.
 *
 * Ce bloc DOIT s'exécuter avant tout routage : sinon l'agent verrait
 * l'écran de connexion alors qu'il arrive déjà authentifié.
 *
 * Le portail reste un raccourci : si le fragment est absent, invalide ou
 * expiré, l'application retombe sur son écran de connexion habituel.
 *
 * Paramètre facultatif `route` : permet au portail de viser un écran
 * précis (ex. `&route=stagiaire`), sans être écrasé par le nettoyage.
 */
async function recupererSessionDepuisUrl() {
  const brut = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!brut.includes('access_token')) return false;

  const p = new URLSearchParams(brut);
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  const route = p.get('route') || '';
  let installee = false;

  if (!access_token || !refresh_token) {
    DEBUG.erreur('Fragment de session incomplet',
      { access_token: !!access_token, refresh_token: !!refresh_token });
    toast('Session du portail incomplète — connecte-toi normalement', 'erreur', 7000);
  } else {
    try {
      const { error } = await sb.auth.setSession({ access_token, refresh_token });
      if (error) throw new Error(error.message);
      installee = true;
      DEBUG.info('Session installée depuis le portail Univers BFS');
    } catch (e) {
      DEBUG.erreur('Session du portail refusée', e.message);
      toast('La session transmise par le portail n\'est plus valide — '
        + 'connecte-toi normalement', 'erreur', 8000);
    }
  }

  // Nettoyage de l'URL : on retire les jetons, on conserve la route demandée.
  // replaceState ne déclenche pas hashchange, le routage n'est donc pas perturbé.
  history.replaceState(null, '',
    location.pathname + location.search + (route ? '#' + route : ''));

  return installee;
}

/** Appel d'une fonction SQL (RPC) avec remontée d'erreur lisible. */
async function rpc(nom, params = {}) {
  DEBUG.info('RPC ' + nom, params);
  const { data, error } = await sb.rpc(nom, params);
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------ authentification ------------------------- */
async function connexion(email, motDePasse) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error(error.message);
  return data.user;
}

async function deconnexion() {
  await sb.auth.signOut();
  S.utilisateur = null; S.profil = null; S.organisme = null;
  location.hash = '';
  router();
}

/**
 * Charge la fiche formateur de l'utilisateur connecté.
 *
 * Règle BFS : chaque application gère ses propres comptes et refuse tout
 * compte authentifié qui n'y est pas explicitement autorisé. Aucune création
 * de profil à la volée, aucune promotion automatique en administrateur, même
 * pour le premier compte. L'amorçage se fait en SQL (voir MEMOIRE_PROJET.md).
 *
 * Retourne 'ok', 'anonyme' (pas de session) ou 'non_autorise'.
 */
async function chargerProfil() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return 'anonyme';
  S.utilisateur = user;

  const { data: profil, error } = await sb.from('formateurs')
    .select('*').eq('id', user.id).maybeSingle();
  if (error) throw new Error(error.message);

  if (!profil) {
    DEBUG.erreur('Compte authentifié sans autorisation dans Habelec', user.email);
    S.utilisateur = null; S.profil = null; S.organisme = null;
    await sb.auth.signOut();
    return 'non_autorise';
  }

  S.profil = profil;
  S.vision = profil.role === 'admin' ? 'admin' : 'formateur';

  const { data: org } = await sb.from('organismes')
    .select('*').eq('id', profil.organisme_id).maybeSingle();
  S.organisme = org;
  return 'ok';
}

/* -------------------------- référentiel ---------------------------- */
async function chargerReferentiel() {
  const [themes, gabarits, symboles, lignes, sf, criteres, quotas, liens] = await Promise.all([
    sb.from('themes').select('*').order('ordre_affichage'),
    sb.from('gabarits').select('*').order('code'),
    sb.from('symboles').select('*').eq('actif', true).order('ordre_affichage'),
    sb.from('lignes_titre').select('*').order('ordre_affichage'),
    sb.from('gabarit_savoir_faire').select('*, criteres_savoir_faire(code, famille, numero, libelle)').order('position'),
    sb.from('criteres_savoir_faire').select('*').order('famille').order('numero'),
    sb.from('gabarit_quotas').select('*'),
    sb.from('symbole_gabarits').select('*'),
  ]);
  // Correspondance symbole -> gabarits, utilisée pour l'aperçu du plan de tirage
  const gabaritsParSymbole = {};
  (liens.data || []).forEach(l =>
    (gabaritsParSymbole[l.symbole_code] ||= []).push(l.gabarit_code));

  S.referentiel = {
    themes: themes.data || [], gabarits: gabarits.data || [],
    symboles: symboles.data || [], lignesTitre: lignes.data || [],
    // savoirFaire : lignes gabarit_savoir_faire (une par critère RETENU pour ce titre),
    // criteres : catalogue national complet (E1..E15 / NE1..NE12), pour l'admin
    savoirFaire: sf.data || [], criteres: criteres.data || [],
    quotas: quotas.data || [], gabaritsParSymbole,
  };
  DEBUG.info('Référentiel chargé', {
    themes: S.referentiel.themes.length,
    gabarits: S.referentiel.gabarits.length,
    symboles: S.referentiel.symboles.length,
  });
}

const libelleTheme = code =>
  (S.referentiel.themes.find(t => t.code === code) || {}).libelle || code;
const libelleGabarit = code =>
  (S.referentiel.gabarits.find(g => g.code === code) || {}).libelle || code;
const libelleSymbole = code =>
  (S.referentiel.symboles.find(s => s.code === code) || {}).libelle || code;

/* ---------------------------- routage ------------------------------ */
/**
 * Deux mondes distincts :
 *  - #stagiaire  -> passation du QCM, sans compte, avec le code de session
 *  - le reste    -> espace formateur, authentifié
 */
async function router() {
  const cible = document.getElementById('ecran');
  if (location.hash.startsWith('#stagiaire')) {
    S.vision = 'stagiaire';
    return ecranStagiaire(cible);
  }
  // 2026-09-03 : QCM de positionnement (entraînement libre) — même principe
  // que #stagiaire (sans compte), mais sujet différent (réponses visibles,
  // rien n'est enregistré). Voir HE_entrainement.js.
  if (location.hash.startsWith('#entrainement')) {
    S.vision = 'entrainement';
    return ecranEntrainement(cible);
  }
  if (!S.utilisateur) return ecranConnexion(cible);
  // 2026-10-01 (demande de Jeremy) : écran pratique d'UN SEUL stagiaire, sans
  // la coquille (onglets/en-tête) de l'espace formateur — utilisé en iframe
  // par la « Pratique multiple » (voir HE_pratique.js) pour afficher 2
  // grilles d'évaluation côte à côte, chacune dans son propre contexte
  // JavaScript totalement indépendant (même session Supabase, partagée via
  // le localStorage du même site). Authentification formateur obligatoire
  // (comme pour tout l'espace formateur) — déjà vérifiée juste au-dessus.
  if (location.hash.startsWith('#pratique-solo')) return ecranPratiqueSolo(cible);
  return ecranFormateur(cible);
}

async function demarrer() {
  if (CONFIG.DEBUG || MEM.lire('debug', false)) DEBUG.basculer();
  if (!initSupabase()) return;

  // AVANT tout routage : session éventuellement transmise par le portail.
  await recupererSessionDepuisUrl();

  window.addEventListener('hashchange', router);
  try {
    if (!location.hash.startsWith('#stagiaire') && !location.hash.startsWith('#entrainement')) {
      const etat = await chargerProfil();
      if (etat === 'ok') await chargerReferentiel();
      else if (etat === 'non_autorise') {
        // Session valide mais compte inconnu d'Habelec : on l'annonce clairement
        // plutôt que de laisser l'utilisateur devant un écran vide.
        S.accesRefuse = true;
      }
    } else {
      await chargerReferentiel();
    }
  } catch (e) {
    erreurSupabase('Chargement initial', e);
  }
  router();
}
