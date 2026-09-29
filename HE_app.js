/* =====================================================================
   HE_app.js — écrans de l'espace formateur

   Sommaire :
     1. Connexion
     2. Coquille (en-tête + onglets)
     3. Onglet Sessions
     4. Détail d'une session : stagiaires, génération des QCM, suivi
     5. Import / export Excel de la liste des stagiaires
     6. Onglet Banque de questions (couverture, import GIFT, relecture)
     7. Onglet Scénarios pratiques
     8. Onglet Organisme
     9. Onglet Comptes
   ===================================================================== */

/* ====================== 1. Connexion ================================ */
function ecranConnexion(cible) {
  cible.innerHTML = `
    <div class="connexion">
      <h1>${esc(CONFIG.NOM_APPLICATION)}</h1>
      <p class="sous-titre">Évaluation et suivi — NF C18-510</p>
      ${S.accesRefuse ? `
      <div class="carte refus">
        <b>Accès refusé</b>
        <p>Ce compte est bien authentifié, mais il n'est pas autorisé dans
           Habelec. Chaque application BFS gère ses propres comptes :
           demande à l'administrateur d'Habelec de t'ajouter.</p>
      </div>` : ''}
      <form id="form-connexion" class="carte">
        <label>Adresse e-mail
          <input type="email" name="email" required autocomplete="username">
        </label>
        <label>Mot de passe
          <input type="password" name="mdp" required autocomplete="current-password">
        </label>
        <button class="principal" type="submit">Se connecter</button>
        <p class="aide">Les stagiaires n'ont pas de compte : ils utilisent le
           <a href="#stagiaire">lien de connexion stagiaire</a> et le code affiché en salle.</p>
      </form>
    </div>`;

  $('#form-connexion').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await connexion(f.email.value.trim(), f.mdp.value);
      await chargerProfil();
      await chargerReferentiel();
      router();
    } catch (e) { erreurSupabase('Connexion', e); }
  });
}

/* ====================== 2. Coquille ================================= */
const ONGLETS = {
  sessions:      'Sessions',
  banque:        'Banque de questions',
  scenarios:     'Mises en situation',
  titres:        'Titres',
  verification:  'Vérification',
  organisme:     'Organisme',
  comptes:       'Comptes',
  motsdepasse:   'Mots de passe',
  moncompte:     'Mon compte',
};

// Onglets réservés à l'administrateur (réglages qui touchent tous les organismes
// ou tous les stagiaires, pas seulement l'organisme courant)
const ONGLETS_ADMIN = new Set(['titres', 'verification', 'organisme', 'comptes']);

// Onglet ouvert au rôle Secrétariat en plus de l'administrateur (2026-09-09,
// demande de Jeremy : la secrétaire doit pouvoir débloquer un formateur qui a
// oublié son mot de passe, sans passer par l'administrateur ni par Supabase).
const ONGLETS_SECRETARIAT = new Set(['motsdepasse']);

function ongletsVisibles() {
  return Object.entries(ONGLETS).filter(([id]) => {
    if (ONGLETS_ADMIN.has(id)) return S.vision === 'admin';
    if (ONGLETS_SECRETARIAT.has(id)) return S.vision === 'admin' || S.profil?.role === 'secretariat';
    return true;
  });
}

const RENDU = {
  sessions:     rendreSessions,
  session:      rendreDetailSession,
  banque:       rendreBanque,
  scenarios:    rendreScenarios,
  titres:       rendreTitres,
  verification: rendreVerification,
  organisme:    rendreOrganisme,
  comptes:      rendreComptes,
  motsdepasse:  rendreMotsDePasse,
  moncompte:    rendreMonCompte,
  pratique:     rendrePratique,     // défini dans HE_pratique.js
};

function ecranFormateur(cible) {
  cible.innerHTML = `
    <header class="entete">
      <div class="titre">${esc(CONFIG.NOM_APPLICATION)}
        <span class="badge">${esc(S.organisme?.raison_sociale || '')}</span></div>
      <nav class="onglets">
        ${ongletsVisibles().map(([id, lib]) =>
          `<button data-onglet="${id}" class="${S.ecran === id ? 'actif' : ''}">${esc(lib)}</button>`).join('')}
      </nav>
      <div class="compte">
        <span>${esc(S.utilisateur.email)}</span>
        <button class="lien" onclick="deconnexion()" title="Se déconnecter">Déconnexion</button>
      </div>
    </header>
    <main id="contenu"></main>`;

  $$('.onglets button').forEach(b => b.addEventListener('click', () => {
    S.ecran = b.dataset.onglet; S.session = null; ecranFormateur(cible);
  }));

  (RENDU[S.ecran] || rendreSessions)($('#contenu'));
}

function retour(ecran) { S.ecran = ecran; ecranFormateur($('#ecran')); }

/* ====================== 3. Onglet Sessions ========================== */
async function rendreSessions(zone) {
  zone.innerHTML = '<p class="chargement">Chargement des sessions…</p>';
  const { data, error } = await sb.from('sessions_formation')
    .select('*, stagiaires(count)').order('date_debut', { ascending: false });
  if (error) return erreurSupabase('Lecture des sessions', error);

  zone.innerHTML = `
    <div class="barre-actions">
      <h2>Sessions de formation</h2>
      <button class="principal" onclick="nouvelleSession()">+ Nouvelle session</button>
    </div>
    <table class="tableau">
      <thead><tr><th>Intitulé</th><th>N° Galaxy</th><th>Entreprise</th><th>Début</th><th>Type</th>
        <th>Code d'accès</th><th>Statut</th><th>Stagiaires</th><th>Secrétariat</th><th></th></tr></thead>
      <tbody>${(data || []).map(s => `
        <tr>
          <td><a href="#" onclick="ouvrirSession('${s.id}');return false">${esc(s.intitule)}</a></td>
          <td>${esc(s.numero_session_galaxy)}</td>
          <td>${esc(s.entreprise)}</td>
          <td>${dateFr(s.date_debut)}</td>
          <td>${s.type_formation === 'recyclage' ? 'Recyclage' : 'Initiale'}</td>
          <td><code class="code-acces">${esc(s.code_acces)}</code></td>
          <td><span class="etat ${s.statut}">${esc(s.statut.replace(/_/g, ' '))}</span></td>
          <td>${s.stagiaires?.[0]?.count ?? 0}</td>
          <td>${rendreStatutEnvoiSecretariat(s)}</td>
          <td><button class="icone" title="Supprimer la session"
                onclick="supprimerSession('${s.id}')">🗑</button></td>
        </tr>`).join('') || '<tr><td colspan="10" class="vide">Aucune session pour le moment.</td></tr>'}
      </tbody>
    </table>`;
}

// 2026-09-23 (demande de Jeremy) : pastille de confirmation d'envoi au
// secrétariat sur le tableau de bord des sessions — reflète le dernier
// statut CONFIRMÉ par le serveur (envoyerSecretariat() ne l'écrit qu'après
// réponse effective de la fonction d'envoi, jamais au simple clic du
// bouton) : vert = dernier envoi réussi, rouge = dernier envoi en échec,
// orange = jamais envoyé pour cette session.
function rendreStatutEnvoiSecretariat(s) {
  const quand = s.envoi_secretariat_le ? dateFr(s.envoi_secretariat_le) : '';
  if (s.envoi_secretariat_statut === 'ok') {
    return `<span title="Envoyé au secrétariat le ${quand}" style="color:#1a9c4a;font-size:1.3em">●</span>`;
  }
  if (s.envoi_secretariat_statut === 'echec') {
    return `<span title="Échec du dernier envoi (${quand}) — ${esc(s.envoi_secretariat_detail || '')}"
      style="color:#c0392b;font-weight:bold">✕</span>`;
  }
  return `<span title="Jamais envoyé au secrétariat" style="color:#e08a1e;font-size:1.3em">●</span>`;
}

async function nouvelleSession() {
  // N° Galaxy demandé en premier et obligatoire : c'est la référence
  // administrative prioritaire, on redemande tant que le champ est vide.
  let numeroGalaxy = null;
  while (numeroGalaxy === null || numeroGalaxy.trim() === '') {
    numeroGalaxy = prompt('N° de session Galaxy (obligatoire) :', numeroGalaxy || '');
    if (numeroGalaxy === null) return; // annulé
  }
  const intitule = prompt('Intitulé de la session :', 'Habilitation électrique — ' + new Date().getFullYear());
  if (!intitule) return;
  const lieu = await demanderLieuFormation();
  if (lieu === null) return;
  const code = genererCodeAcces();
  const { error } = await sb.from('sessions_formation').insert({
    organisme_id: S.organisme.id, formateur_id: S.profil.id,
    intitule, numero_session_galaxy: numeroGalaxy.trim(), code_acces: code, statut: 'brouillon', lieu,
    // Seuil de réussite : réglage d'organisme (2026-09-09), plus modifiable
    // session par session — voir onglet Organisme.
    seuil_global: S.organisme.seuil_reussite_defaut ?? 0.70,
  });
  if (error) return erreurSupabase('Création de la session', error);
  toast('Session créée — code d\'accès ' + code);
  rendreSessions($('#contenu'));
}

// Lieu de la formation (Briec / Sèvremont) : détermine la marque et le
// téléphone affichés sur le volet 3 du titre d'habilitation (voir
// HE_pdf.js, constante SITES). Valeurs stockées telles quelles dans
// sessions_formation.lieu — pas d'enum SQL, juste ces deux libellés exacts.
async function demanderLieuFormation(valeurActuelle) {
  let choix = null;
  while (choix === null) {
    const reponse = prompt(
      'Lieu de la formation — tape B pour Briec ou S pour Sèvremont :',
      valeurActuelle === 'Sèvremont' ? 'S' : 'B');
    if (reponse === null) return null; // annulé
    const c = reponse.trim().toUpperCase();
    if (c === 'B') choix = 'Briec';
    else if (c === 'S') choix = 'Sèvremont';
    else toast('Réponds B (Briec) ou S (Sèvremont)', 'erreur');
  }
  return choix;
}

async function modifierNumeroGalaxy() {
  const numeroGalaxy = prompt('N° de session Galaxy :', S.session.numero_session_galaxy || '');
  if (numeroGalaxy === null || numeroGalaxy.trim() === '') return;
  const { error } = await sb.from('sessions_formation')
    .update({ numero_session_galaxy: numeroGalaxy.trim() }).eq('id', S.session.id);
  if (error) return erreurSupabase('Modification du n° Galaxy', error);
  await ouvrirSession(S.session.id);
}

async function modifierLieuFormation() {
  const lieu = await demanderLieuFormation(S.session.lieu);
  if (lieu === null) return;
  const { error } = await sb.from('sessions_formation').update({ lieu }).eq('id', S.session.id);
  if (error) return erreurSupabase('Modification du lieu', error);
  await ouvrirSession(S.session.id);
}

// 2026-09-22 (bug remonté par Jeremy) : l'avis d'habilitation affichait
// jusqu'ici le formateur CONNECTÉ (S.profil) au moment de la génération,
// pas forcément celui affecté à la session — problématique quand un
// formateur corrige/édite la session d'un collègue. sessions_formation a
// déjà une colonne formateur_id (par défaut celui qui crée la session,
// voir nouvelleSession) ; genererTitrePdf/genererPreuveExamenPdf (HE_pdf.js)
// utilisent désormais ce formateur-là plutôt que S.profil.
async function changerFormateurSession(formateurId) {
  const { error } = await sb.from('sessions_formation')
    .update({ formateur_id: formateurId }).eq('id', S.session.id);
  if (error) return erreurSupabase('Modification du formateur de la session', error);
  S.session.formateur_id = formateurId;
  toast('Formateur de la session mis à jour');
}

function genererCodeAcces() {
  // Sans caractères ambigus (0/O, 1/I) : le code est dicté à voix haute en salle
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join('');
}

async function supprimerSession(id) {
  if (!confirmer('Supprimer définitivement cette session et tous ses résultats ?')) return;
  const { error } = await sb.from('sessions_formation').delete().eq('id', id);
  if (error) return erreurSupabase('Suppression', error);
  toast('Session supprimée');
  rendreSessions($('#contenu'));
}

async function ouvrirSession(id) {
  const { data, error } = await sb.from('sessions_formation').select('*').eq('id', id).single();
  if (error) return erreurSupabase('Ouverture de la session', error);
  S.session = data; S.ecran = 'session';
  ecranFormateur($('#ecran'));
}

/* ============ 4. Détail d'une session : stagiaires et suivi ========= */
async function rendreDetailSession(zone) {
  const s = S.session;
  zone.innerHTML = '<p class="chargement">Chargement…</p>';

  const [{ data: stagiaires }, { data: suivi }, { data: formateurs }] = await Promise.all([
    sb.from('stagiaires').select('*, stagiaire_symboles(symbole_code)')
      .eq('session_id', s.id).order('ordre').order('nom'),
    sb.from('v_suivi_session').select('*').eq('session_id', s.id),
    // 2026-09-22 (demande de Jeremy) : liste des formateurs de l'organisme,
    // pour le sélecteur "Formateur de la session" — c'est LUI qui doit
    // apparaître sur l'avis/titre généré, pas forcément la personne
    // actuellement connectée (qui peut juste corriger/éditer la session).
    sb.from('formateurs').select('id, nom, prenom').eq('organisme_id', S.organisme.id).order('nom'),
  ]);
  const suiviPar = Object.fromEntries((suivi || []).map(x => [x.stagiaire_id, x]));

  // Statut par titre visé (gris/vert clair/vert foncé/rouge sur les puces) : nécessite
  // resultats_symbole, calculé après correction théorie et/ou clôture pratique.
  const idsStagiaires = (stagiaires || []).map(st => st.id);
  const { data: resultats } = idsStagiaires.length
    ? await sb.from('resultats_symbole').select('*').in('stagiaire_id', idsStagiaires)
    : { data: [] };
  const resultatsParStagiaire = {};
  (resultats || []).forEach(r => {
    (resultatsParStagiaire[r.stagiaire_id] ||= {})[r.symbole_code] = r;
  });
  // Code inclus dans le lien : le QR scanné saute la saisie manuelle du code.
  const lienStagiaire = location.origin + location.pathname
    + '#stagiaire?code=' + encodeURIComponent(s.code_acces);
  // QCM de positionnement (2026-09-03) : même code de session, autre route
  // (#entrainement) — entraînement libre, sans impact sur le dossier.
  const lienEntrainement = location.origin + location.pathname
    + '#entrainement?code=' + encodeURIComponent(s.code_acces);

  zone.innerHTML = `
    <button class="lien" onclick="retour('sessions')">← Toutes les sessions</button>
    <div class="barre-actions">
      <h2>${esc(s.intitule)}</h2>
      <div>
        <button onclick="ouvrirParametresSession()" title="Paramètres de l'évaluation">⚙ Paramètres</button>
        <button onclick="genererTousLesQcm()" title="Générer un sujet par stagiaire">🎲 Générer les QCM</button>
        <button onclick="voirJournalSession('${s.id}')" title="Historique des interventions manuelles du formateur">🗂 Journal</button>
        ${s.statut !== 'cloturee' ? `<button class="principal" onclick="basculerOuverture()">
          ${s.statut === 'ouverte' ? '⏸ Fermer l\'accès stagiaires' : '▶ Ouvrir l\'accès stagiaires'}</button>` : ''}
        ${s.statut !== 'cloturee'
          ? `<button title="Supprime les infos personnelles des stagiaires (sauf nom/prénom), une fois tous les titres/avis générés"
                onclick="cloturerSession()">🔒 Clôturer la session</button>`
          : '<span class="etat cloturee">🔒 Session clôturée</span>'}
      </div>
    </div>

    <div class="carte info-passation">
      <div><b>Code à dicter en salle</b><div class="code-geant">${esc(s.code_acces)}</div></div>
      <div><b>Adresse de connexion stagiaires</b><div><code>${esc(lienStagiaire)}</code></div>
        <button class="lien" onclick="navigator.clipboard.writeText('${esc(lienStagiaire)}');toast('Lien copié')">Copier le lien</button></div>
      <div><b>N° de session Galaxy</b><div>${esc(s.numero_session_galaxy) || '<i>non renseigné</i>'}</div>
        <button class="lien" onclick="modifierNumeroGalaxy()">Modifier</button></div>
      <div><b>Lieu de la formation</b><div>${esc(s.lieu) || '<i>non renseigné</i>'}</div>
        <button class="lien" onclick="modifierLieuFormation()">Modifier</button></div>
      <div><b>Formateur de la session</b>
        <div><select onchange="changerFormateurSession(this.value)"
          title="C'est ce formateur qui apparaît sur l'avis d'habilitation, pas forcément la personne connectée — par défaut celui qui a créé la session.">
          ${(formateurs || []).map(f => `<option value="${f.id}" ${f.id === s.formateur_id ? 'selected' : ''}>
            ${esc(f.nom)} ${esc(f.prenom)}</option>`).join('')}
        </select></div></div>
      <details class="qr-repliable">
        <summary><b>QCM de positionnement (entraînement libre)</b></summary>
        <div id="qr-entrainement"></div>
        <p class="aide">QR différent de l'examen : le stagiaire choisit ses titres visés et
          s'entraîne avec les réponses affichées, sans impact sur son dossier.</p>
        <div><code>${esc(lienEntrainement)}</code></div>
        <button class="lien" onclick="navigator.clipboard.writeText('${esc(lienEntrainement)}');toast('Lien copié')">Copier le lien</button>
        <button class="lien" onclick="voirPositionnementsSession()">📊 Voir tous les positionnements de la session</button>
      </details>
      <details class="qr-repliable">
        <summary><b>QR code examen</b></summary>
        <div id="qr-passation"></div>
        <p id="qr-erreur" class="erreur-discrete" hidden></p>
        <button class="lien" onclick="telechargerQrPassation()">Télécharger l'image</button>
      </details>
      <div><b>Règle de réussite</b>
        <div>${Math.round(s.seuil_global * 100)} % de bonnes réponses
          ${s.exiger_fondamentales ? '<br>+ 100 % des questions fondamentales' : ''}</div></div>
    </div>

    ${tableauBordGroupe(stagiaires, resultatsParStagiaire)}

    <div class="barre-actions">
      <h3>Stagiaires (${(stagiaires || []).length})</h3>
      <div>
        <button onclick="modeleExcelStagiaires()" title="Télécharger un modèle Excel">⬇ Modèle Excel</button>
        <label class="bouton-fichier" title="Importer une liste de stagiaires">⬆ Importer Excel
          <input type="file" accept=".xlsx,.xls,.csv" hidden onchange="importerStagiairesExcel(this)"></label>
        <button title="Envoie l'avis d'habilitation + la preuve d'examen de chaque stagiaire ayant un titre au secrétariat"
          onclick="envoyerSecretariat()">✉️ Envoi secrétariat</button>
        ${S.organisme?.drive_bouton_test_actif ? `<button title="Envoie un petit fichier de test dans le dossier Drive de cette session, sans envoyer aucun mail — pour vérifier la configuration Google Drive"
          onclick="testerSauvegardeDrive()">☁️ Tester Drive</button>` : ''}
        <button title="Télécharge un ZIP avec l'avis d'habilitation + la preuve d'examen de chaque stagiaire ayant un titre"
          onclick="telechargerZipTitres()">🗜 Télécharger ZIP</button>
        <button class="principal" onclick="nouveauStagiaire()">+ Ajouter</button>
      </div>
    </div>

    <table class="tableau">
      <thead><tr><th>Nom</th><th>Prénom</th><th>Fonction</th><th>Titres visés</th>
        <th>Domaines</th><th>Théorie</th><th>Pratique</th><th>Actions</th></tr></thead>
      <tbody>${(stagiaires || []).map(st =>
        ligneStagiaire(st, suiviPar[st.id], resultatsParStagiaire[st.id] || {})).join('')
        || '<tr><td colspan="8" class="vide">Aucun stagiaire. Ajoute-les un par un ou importe un fichier Excel.</td></tr>'}
      </tbody>
    </table>`;

  // La bibliothèque QRCode vient d'un CDN (voir index.html) : si elle n'a pas
  // pu charger (réseau, bloqueur de scripts...), on l'affiche clairement au
  // lieu de laisser un carré vide sans explication. Cette bibliothèque dessine
  // elle-même (canvas ou <img> selon le navigateur) dans le conteneur fourni,
  // sans callback : toute erreur est donc synchrone.
  try {
    if (typeof QRCode === 'undefined') throw new Error('bibliothèque QRCode non chargée');
    $('#qr-passation').innerHTML = '';
    new QRCode($('#qr-passation'), { text: lienStagiaire, width: 140, height: 140 });
    $('#qr-entrainement').innerHTML = '';
    new QRCode($('#qr-entrainement'), { text: lienEntrainement, width: 140, height: 140 });
  } catch (e) { afficherErreurQr(e.message); }
}

function afficherErreurQr(message) {
  DEBUG.erreur('QR code', message);
  const p = $('#qr-erreur');
  if (p) { p.hidden = false; p.textContent = 'QR code indisponible (' + message + ')'; }
}

function telechargerQrPassation() {
  const conteneur = $('#qr-passation');
  // Selon le navigateur, la bibliothèque dessine soit un <canvas>, soit un <img>.
  const source = conteneur?.querySelector('canvas') || conteneur?.querySelector('img');
  if (!source) return toast('QR code indisponible', 'erreur');
  const lien = document.createElement('a');
  lien.download = 'qr-passation-' + S.session.code_acces + '.png';
  lien.href = source.tagName === 'CANVAS' ? source.toDataURL('image/png') : source.src;
  lien.click();
}

function copierLienEntrainementPermanent() {
  const lien = $('#lien-entrainement-permanent')?.textContent;
  if (!lien) return;
  navigator.clipboard.writeText(lien);
  toast('Lien copié');
}

function telechargerQrEntrainementPermanent() {
  const conteneur = $('#qr-entrainement-permanent');
  const source = conteneur?.querySelector('canvas') || conteneur?.querySelector('img');
  if (!source) return toast('QR code indisponible', 'erreur');
  const lien = document.createElement('a');
  lien.download = 'qr-entrainement-permanent.png';
  lien.href = source.tagName === 'CANVAS' ? source.toDataURL('image/png') : source.src;
  lien.click();
}

// Couleur d'une puce « titre visé » selon resultats_symbole (2026-09-09,
// grille complète demandée par Jeremy — theorie_ok et pratique_ok sont
// chacun true/false/NULL, NULL voulant dire "pas encore évalué") :
//  - pas de ligne, ou theorie_ok NULL         -> gris clair : en attente
//  - theorie_ok true,  pratique_ok NULL       -> vert clair : théorie réussie, pratique en attente
//  - theorie_ok false, pratique_ok NULL       -> rouge clair : théorie échouée
//  - theorie_ok true,  pratique_ok true       -> vert foncé : théorie + pratique réussies
//  - theorie_ok false, pratique_ok false      -> rouge foncé : théorie + pratique échouées
//  - theorie_ok false, pratique_ok true       -> orange foncé : théorie échouée, pratique réussie
//  - theorie_ok true,  pratique_ok false      -> orange clair : théorie réussie, pratique échouée
function classeTitre(resultat) {
  if (!resultat || resultat.theorie_ok === null || resultat.theorie_ok === undefined) return 'titre-gris-clair';
  const t = resultat.theorie_ok, p = resultat.pratique_ok;
  if (p === null || p === undefined) return t ? 'titre-vert-clair' : 'titre-rouge-clair';
  if (t && p) return 'titre-vert-fonce';
  if (!t && !p) return 'titre-rouge-fonce';
  if (!t && p) return 'titre-orange-fonce';
  return 'titre-orange-clair'; // t && !p
}

// Libellé humain associé à chaque classe (info-bulle des puces).
const LIBELLE_CLASSE_TITRE = {
  'titre-gris-clair': 'En attente (pas encore évalué)',
  'titre-vert-clair': 'Théorie réussie, pratique en attente',
  'titre-rouge-clair': 'Théorie échouée',
  'titre-vert-fonce': 'Théorie et pratique réussies',
  'titre-rouge-fonce': 'Théorie et pratique échouées',
  'titre-orange-fonce': 'Théorie échouée, pratique réussie',
  'titre-orange-clair': 'Théorie réussie, pratique échouée',
};

/* --------- Tableau de bord formateur : validation des titres du groupe (2026-08) ---------
 * Vue d'ensemble en tête de session — évite de parcourir stagiaire par stagiaire pour
 * savoir où en est le groupe sur chaque titre visé. Purement dérivé des mêmes données
 * que les puces par stagiaire (resultatsParStagiaire) : aucune requête supplémentaire. */
function tableauBordGroupe(stagiaires, resultatsParStagiaire) {
  const parTitre = {};
  (stagiaires || []).forEach(st => {
    (st.stagiaire_symboles || []).forEach(x => {
      const code = x.symbole_code;
      const c = (parTitre[code] ||= { total: 0, valides: 0, pratiqueAttente: 0, pratiqueKo: 0, theorieKo: 0, echecMixte: 0, nonEvalues: 0 });
      c.total++;
      switch (classeTitre((resultatsParStagiaire[st.id] || {})[code])) {
        case 'titre-vert-fonce': c.valides++; break;
        case 'titre-vert-clair': c.pratiqueAttente++; break;
        case 'titre-orange-clair': c.pratiqueKo++; break;
        case 'titre-rouge-clair': c.theorieKo++; break;
        case 'titre-rouge-fonce': case 'titre-orange-fonce': c.echecMixte++; break;
        default: c.nonEvalues++;
      }
    });
  });
  const titres = Object.entries(parTitre).sort((a, b) => a[0].localeCompare(b[0]));
  if (!titres.length) return '';

  // 2026-09-22 (demande de Jeremy) : toujours replié par défaut à l'ouverture
  // d'une session — plus de mémorisation (localStorage) de l'état précédent,
  // qui pouvait le laisser ouvert d'une session à l'autre.
  return `
    <details class="carte tableau-bord-groupe">
      <summary><b>Tableau de bord — validation des titres du groupe</b></summary>
      <table class="tableau compact">
        <thead><tr><th>Titre</th><th>Stagiaires</th><th>Validés</th>
          <th>Théorie OK, pratique en attente</th><th>Théorie OK, pratique en échec</th>
          <th>Théorie échouée</th><th>Échec mixte / atypique</th><th>Non évalués</th></tr></thead>
        <tbody>${titres.map(([code, c]) => `
          <tr>
            <td><b>${esc(libelleSymbole(code))}</b></td>
            <td>${c.total}</td>
            <td>${c.valides ? `<span class="etat ok">${c.valides}</span>` : '—'}</td>
            <td>${c.pratiqueAttente ? `<span class="etat encours">${c.pratiqueAttente}</span>` : '—'}</td>
            <td>${c.pratiqueKo ? `<span class="etat ko">${c.pratiqueKo}</span>` : '—'}</td>
            <td>${c.theorieKo ? `<span class="etat ko">${c.theorieKo}</span>` : '—'}</td>
            <td>${c.echecMixte ? `<span class="etat ko">${c.echecMixte}</span>` : '—'}</td>
            <td>${c.nonEvalues || '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </details>`;
}

function ligneStagiaire(st, suivi, resultatsSymboles) {
  const symb = (st.stagiaire_symboles || []).map(x => ({
    code: x.symbole_code, libelle: libelleSymbole(x.symbole_code),
    classe: classeTitre((resultatsSymboles || {})[x.symbole_code]),
  }));
  let theorie = '<span class="etat neutre">à générer</span>';
  if (suivi?.statut_theorie === 'corrigee') {
    theorie = `<span class="etat ${suivi.theorie_reussie ? 'ok' : 'ko'}">`
      + `${suivi.score_brut}/${suivi.score_total} — ${Math.round(suivi.taux * 100)} %`
      + `${suivi.fondamentales_ok === false ? ' ⚠ fondamentale ratée' : ''}</span>`;
  } else if (suivi?.statut_theorie === 'en_cours') {
    theorie = `<span class="etat encours">en cours ${suivi.nb_repondues}/${suivi.score_total || '?'}</span>`;
  } else if (suivi?.statut_theorie) {
    theorie = '<span class="etat neutre">prêt</span>';
  }
  const prat = suivi && suivi.nb_pratiques > 0
    ? `<span class="etat ${suivi.nb_pratiques_ok === suivi.nb_pratiques ? 'ok' : 'neutre'}">`
      + `${suivi.nb_pratiques_ok}/${suivi.nb_pratiques} validées</span>`
    : '<span class="etat neutre">—</span>';

  return `<tr>
    <td>${esc(st.nom)}</td><td>${esc(st.prenom)}</td><td>${esc(st.fonction)}</td>
    <td>${symb.map(x => `<span class="puce ${x.classe}" title="${esc(LIBELLE_CLASSE_TITRE[x.classe] || 'Non évalué')}">${esc(x.libelle)}</span>`)
      .join(' ') || '<i>aucun</i>'}</td>
    <td>${(st.domaines || []).join(', ')}</td>
    <td>${theorie}</td><td>${prat}</td>
    <td class="actions">
      <button class="icone" title="Plus d'actions (modifier, avis, documents, suppression...)"
        onclick="ouvrirActionsStagiaire('${st.id}', '${esc(st.nom)}', '${esc(st.prenom)}', ${st.evaluation_externe ? 'true' : 'false'})">👁</button>
      <button class="icone" title="Évaluation pratique" onclick="ouvrirPratique('${st.id}')">🔧</button>
      <button class="icone" title="QCM de rattrapage : uniquement sur le(s) titre(s) en échec au premier passage"
        onclick="proposerRattrapage('${st.id}')">🔁</button>
      <button class="icone" title="Préconisation du formateur en cas d'échec (affichée sur l'avis)"
        onclick="saisirPreconisations('${st.id}')">✏️</button>
    </td></tr>`;
}

/* ---------- Popup "Plus d'actions" (2026-09-04, demande de Jeremy) -----
 * La ligne stagiaire ne garde que les 3 actions les plus fréquentes en
 * salle (pratique, rattrapage, préconisation) — tout le reste (modifier,
 * documents, résultat externe, suppression) part dans ce popup ouvert par
 * l'icône œil, pour désencombrer le tableau. */
function ouvrirActionsStagiaire(id, nom, prenom, evaluationExterne) {
  ouvrirModale(`${nom} ${prenom}`, `
    <div class="liste-actions-stagiaire">
      <button onclick="fermerModale();editerStagiaire('${id}')">✎ Modifier le stagiaire et ses titres</button>
      <button onclick="fermerModale();voirCopie('${id}')">📄 Voir la copie corrigée</button>
      <button onclick="fermerModale();genererTitrePdf('${id}')">🏅 Générer le titre d'habilitation (PDF)</button>
      <button onclick="fermerModale();genererPreuveExamenPdf('${id}')">🧾 Télécharger la preuve d'examen (PDF)</button>
      <button onclick="fermerModale();saisirResultatExterne('${id}')">📋 Saisir un résultat de formateur externe${evaluationExterne ? ' ✓' : ''}</button>
      <button onclick="fermerModale();voirPositionnements('${id}', '${esc(nom)}', '${esc(prenom)}')">📊 Positionnement (entraînement libre)</button>
      <button class="danger" onclick="fermerModale();supprimerStagiaire('${id}')">🗑 Supprimer le stagiaire</button>
    </div>`);
}

/* ---------- Positionnement (entraînement libre) — consultation formateur
 * (2026-09-09, demande de Jeremy) : quand le stagiaire s'est entraîné DANS
 * la session (voir HE_entrainement.js), le résultat est conservé dans
 * habelec.positionnements. On les liste ici du plus récent au plus ancien,
 * et pour chaque tentative on fait remonter EN PREMIER les questions
 * ratées (plutôt que de les diluer parmi les bonnes réponses), regroupées
 * par thématique et triées par nombre d'erreurs décroissant, pour que le
 * formateur repère vite les axes de travail. */
// 2026-09-17 (demande de Jeremy) : code couleur par titre sur les résultats
// de positionnement, pour voir d'un coup d'œil lesquels seraient validés.
// Approximatif par nature : le QCM de positionnement tire ses questions sur
// l'UNION des thématiques des titres choisis ensemble (voir
// habelec.plan_tirage_symboles), donc une question peut compter pour
// plusieurs titres à la fois — il n'y a pas de séparation stricte comme à
// l'examen réel. On reconstitue ici, pour un titre donné, le sous-ensemble
// des questions tirées qui relèvent de ses propres thématiques (via
// S.referentiel.gabaritsParSymbole + quotas), puis on applique la même
// règle que la session (seuil global + fondamentales) à ce sous-ensemble.
function evaluerTitrePositionnement(symboleCode, questions) {
  const gabarits = S.referentiel?.gabaritsParSymbole?.[symboleCode] || [];
  const themes = new Set((S.referentiel?.quotas || [])
    .filter(q => gabarits.includes(q.gabarit_code) && q.nb > 0)
    .map(q => q.theme_code));
  const sousEnsemble = (questions || []).filter(q => themes.has(q.theme_code));
  if (!sousEnsemble.length) return { statut: 'indetermine' };
  const bonnes = sousEnsemble.filter(q => q.correcte).length;
  const pct = bonnes / sousEnsemble.length;
  const fondEchouee = sousEnsemble.some(q => q.fondamentale && !q.correcte);
  const seuil = S.session?.seuil_global ?? 0.7;
  const exigerFond = S.session?.exiger_fondamentales ?? true;
  const valide = pct >= seuil && (!exigerFond || !fondEchouee);
  return { statut: valide ? 'valide' : 'echec', bonnes, total: sousEnsemble.length, pct: Math.round(pct * 100) };
}

function chipsTitresPositionnement(symboles, questions) {
  return (symboles || []).map(sy => {
    const r = evaluerTitrePositionnement(sy, questions);
    const classe = r.statut === 'valide' ? 'titre-vert-clair'
      : r.statut === 'echec' ? 'titre-rouge-clair' : 'titre-gris-clair';
    const info = r.statut === 'indetermine'
      ? 'Pas assez de questions propres à ce titre pour se prononcer'
      : `${r.bonnes} / ${r.total} sur les thématiques de ce titre (${r.pct} %)`
        + (r.statut === 'valide' ? ' — serait validé' : ' — ne serait pas validé');
    return `<span class="puce ${classe}" title="${esc(info)}">${esc(sy)}</span>`;
  }).join(' ');
}

async function voirPositionnements(id, nom, prenom) {
  ouvrirModale(`Positionnement — ${nom} ${prenom}`, '<p class="aide">Chargement…</p>');
  const { data, error } = await sb.from('positionnements')
    .select('id, symboles, nb_questions, nb_bonnes, questions, cree_le')
    .eq('stagiaire_id', id)
    .order('cree_le', { ascending: false });
  if (error) return $('#modale .corps-modale').replaceChildren(
    document.createRange().createContextualFragment(`<p class="erreur">${esc(error.message)}</p>`));

  if (!data || !data.length) {
    return $('#modale .corps-modale').replaceChildren(document.createRange().createContextualFragment(
      '<p class="aide">Aucun entraînement de positionnement enregistré pour ce stagiaire — il faut s\'être entraîné DANS cette session (code de session renseigné, puis son nom choisi) pour que le résultat soit conservé.</p>'));
  }

  const html = data.map((p, i) => {
    const ratees = (p.questions || []).filter(q => !q.correcte);
    const parTheme = {};
    ratees.forEach(q => { (parTheme[q.theme_code] ||= []).push(q); });
    const themesTries = Object.entries(parTheme).sort((a, b) => b[1].length - a[1].length);
    const pct = p.nb_questions ? Math.round((p.nb_bonnes / p.nb_questions) * 100) : 0;
    return `
      <details class="carte" ${i === 0 ? 'open' : ''}>
        <summary><b>${new Date(p.cree_le).toLocaleString('fr-FR')}</b> — ${chipsTitresPositionnement(p.symboles, p.questions)}
          — <b>${p.nb_bonnes} / ${p.nb_questions}</b> (${pct} %)</summary>
        ${ratees.length ? `
          <p class="aide"><b>${ratees.length} question(s) à revoir</b>, classées par thématique
            (celle où il y a le plus d'erreurs en premier) :</p>
          ${themesTries.map(([theme, qs]) => `
            <div class="bloc-theme-erreurs">
              <p><b>${esc(theme)}</b> — ${qs.length} erreur(s)</p>
              ${qs.map(q => `
                <div class="question-ratee">
                  <p>${esc(q.enonce)}${q.fondamentale ? ' <span class="puce fond">Question fondamentale</span>' : ''}</p>
                  <p class="ko">Réponse donnée : ${q.reponse_donnee?.length ? esc(q.reponse_donnee.join(', ')) : '<i>(aucune)</i>'}</p>
                  <p class="ok">Bonne réponse : ${esc((q.bonne_reponse || []).join(', '))}</p>
                  ${q.explication ? `<p class="explication">${esc(q.explication)}</p>` : ''}
                </div>`).join('')}
            </div>`).join('')}
        ` : '<p class="ok">✔ Toutes les questions ont été répondues correctement.</p>'}
      </details>`;
  }).join('');

  $('#modale .corps-modale').replaceChildren(document.createRange().createContextualFragment(
    '<p class="aide">Couleur des titres : <span class="puce titre-vert-clair">validé</span> '
    + '<span class="puce titre-rouge-clair">non validé</span> '
    + '<span class="puce titre-gris-clair">indéterminé</span> — estimation à partir des questions '
    + "tirées propres à ce titre (le QCM de positionnement mélange les thématiques quand plusieurs "
    + 'titres sont choisis ensemble, ce n\'est donc pas exactement la règle de l\'examen réel).</p>'
    + html));
}

/* ---------- Positionnements — vue de session (2026-09-21, demande de
 * Jeremy) : consulter un stagiaire à la fois (voirPositionnements) devenait
 * fastidieux avec beaucoup de stagiaires. Cette vue regroupe TOUS les
 * entraînements de positionnement de la session sur un seul affichage,
 * ouvert dans une modale (comme les autres consultations) pour ne jamais
 * gêner le tableau de bord de la session — accessible depuis le bloc QCM de
 * positionnement replié, pas depuis la barre d'actions principale.
 *
 * 2026-09-21 (précision de Jeremy) : une question ratée sur une tentative,
 * puis réussie sur une tentative suivante du même stagiaire, ne doit pas
 * continuer à ressortir dans le condensé comme si elle posait encore
 * problème — seule la DERNIÈRE tentative de chaque stagiaire compte par
 * défaut pour ce condensé. Les tentatives précédentes restent toutes
 * consultables (jamais supprimées de l'affichage) dans le détail par
 * stagiaire plus bas, et un filtre permet de repasser le condensé sur
 * "toutes les tentatives" pour une analyse plus large si besoin. */
const POSITIONNEMENT_SESSION = { data: [], nomParId: {} };

function condenserErreursPositionnement(donnees, nomParId) {
  const erreursParQuestion = {};
  donnees.forEach(p => {
    (p.questions || []).filter(q => !q.correcte).forEach(q => {
      const cle = q.question_id || q.enonce;
      const e = (erreursParQuestion[cle] ||= {
        enonce: q.enonce, theme_code: q.theme_code, fondamentale: q.fondamentale,
        explication: q.explication, bonne_reponse: q.bonne_reponse, nb: 0, stagiaires: new Set(),
      });
      e.nb += 1;
      e.stagiaires.add(nomParId[p.stagiaire_id] || '?');
    });
  });
  return Object.values(erreursParQuestion).sort((a, b) => b.nb - a.nb);
}

function rendreCondensePositionnementSession(filtre) {
  const conteneur = $('#condense-positionnement-session');
  if (!conteneur) return;
  const { data, nomParId } = POSITIONNEMENT_SESSION;
  // "Dernière tentative" = la plus récente tentative de CHAQUE stagiaire
  // (data est déjà triée du plus récent au plus ancien) — ainsi une erreur
  // corrigée depuis ne ressort plus, sans jamais toucher à l'historique.
  const donnees = filtre === 'toutes' ? data
    : Object.values(data.reduce((acc, p) => {
        if (!acc[p.stagiaire_id]) acc[p.stagiaire_id] = p; // premier = plus récent
        return acc;
      }, {}));
  const questionsTriees = condenserErreursPositionnement(donnees, nomParId);

  const html = questionsTriees.length ? `
    ${questionsTriees.map(e => `
      <div class="question-ratee">
        <p>${esc(e.enonce)}${e.fondamentale ? ' <span class="puce fond">Question fondamentale</span>' : ''}
          <span class="puce" title="Thématique">${esc(e.theme_code)}</span>
          <span class="puce alerte">${e.nb} échec(s)</span></p>
        <p class="ok">Bonne réponse : ${esc((e.bonne_reponse || []).join(', '))}</p>
        ${e.explication ? `<p class="explication">${esc(e.explication)}</p>` : ''}
        <p class="aide">Stagiaire(s) concerné(s) : ${esc([...e.stagiaires].join(', '))}</p>
      </div>`).join('')}
  ` : '<p class="ok">✔ Aucune question ratée sur le périmètre sélectionné.</p>';
  conteneur.innerHTML = `<p class="aide">${questionsTriees.length} question(s) concernée(s).</p>${html}`;
}

async function voirPositionnementsSession() {
  ouvrirModale('Positionnements — vue de session', '<p class="aide">Chargement…</p>');
  const s = S.session;
  const { data: stagiaires } = await sb.from('stagiaires')
    .select('id, nom, prenom, recyclage').eq('session_id', s.id).order('nom');
  const ids = (stagiaires || []).map(st => st.id);
  if (!ids.length) {
    return $('#modale .corps-modale').replaceChildren(document.createRange().createContextualFragment(
      '<p class="aide">Aucun stagiaire dans cette session.</p>'));
  }
  const nomParId = Object.fromEntries((stagiaires || []).map(st => [st.id, `${st.nom} ${st.prenom}`]));

  const { data, error } = await sb.from('positionnements')
    .select('id, stagiaire_id, symboles, nb_questions, nb_bonnes, questions, cree_le')
    .in('stagiaire_id', ids).order('cree_le', { ascending: false });
  if (error) return $('#modale .corps-modale').replaceChildren(
    document.createRange().createContextualFragment(`<p class="erreur">${esc(error.message)}</p>`));
  if (!data || !data.length) {
    return $('#modale .corps-modale').replaceChildren(document.createRange().createContextualFragment(
      "<p class=\"aide\">Aucun entraînement de positionnement enregistré pour cette session — il faut "
      + "s'être entraîné DANS cette session (code de session renseigné, puis son nom choisi) pour que le "
      + 'résultat soit conservé.</p>'));
  }
  POSITIONNEMENT_SESSION.data = data;
  POSITIONNEMENT_SESSION.nomParId = nomParId;

  // Détail par stagiaire, replié par défaut — TOUTES les tentatives, y
  // compris les anciennes, restent visibles ici quel que soit le filtre du
  // condensé ci-dessus (on peut toujours revenir dessus) ; la plus récente
  // est repérée explicitement, puisque c'est elle qui compte par défaut
  // dans le condensé.
  const parStagiaire = {};
  data.forEach(p => { (parStagiaire[p.stagiaire_id] ||= []).push(p); });
  const htmlParStagiaire = (stagiaires || [])
    .filter(st => parStagiaire[st.id])
    .map(st => {
      const tentatives = parStagiaire[st.id]; // déjà triées, plus récente en premier
      return `
        <details class="carte">
          <summary><b class="${st.recyclage ? 'nom-recyclage' : ''}" title="${st.recyclage ? 'Recyclage' : 'Formation initiale'}"
              >${esc(st.nom)} ${esc(st.prenom)}</b> — ${tentatives.length} tentative(s)</summary>
          ${tentatives.map((p, i) => {
            const pct = p.nb_questions ? Math.round((p.nb_bonnes / p.nb_questions) * 100) : 0;
            return `<p>${i === 0 ? '<span class="puce" title="Compte dans le condensé par défaut">actuelle</span> ' : ''}
              ${new Date(p.cree_le).toLocaleString('fr-FR')} — ${chipsTitresPositionnement(p.symboles, p.questions)}
              — <b>${p.nb_bonnes} / ${p.nb_questions}</b> (${pct} %)</p>`;
          }).join('')}
        </details>`;
    }).join('');

  $('#modale .corps-modale').replaceChildren(document.createRange().createContextualFragment(`
    <fieldset class="filtre-positionnement-session">
      <legend>Erreurs prises en compte dans le condensé ci-dessous</legend>
      <label class="case"><input type="radio" name="filtre-positionnement" value="derniere" checked>
        Dernière tentative de chaque stagiaire (recommandé — une erreur déjà corrigée depuis ne ressort plus)</label>
      <label class="case"><input type="radio" name="filtre-positionnement" value="toutes">
        Toutes les tentatives (analyse plus large, y compris les erreurs déjà corrigées depuis)</label>
    </fieldset>
    <details class="carte" open>
      <summary><b>Questions les plus ratées</b></summary>
      <div id="condense-positionnement-session"></div>
    </details>
    <p class="aide">Détail par stagiaire (replié), avec l'historique complet de ses tentatives :</p>
    ${htmlParStagiaire}`));

  rendreCondensePositionnementSession('derniere');
  $$('input[name=filtre-positionnement]').forEach(r =>
    r.addEventListener('change', () => rendreCondensePositionnementSession(r.value)));
}

/* ---------- QCM de rattrapage (2026-09-04, demande de Jeremy) ----------
 * Uniquement sur le(s) titre(s) en échec au premier passage — les titres
 * déjà validés ne sont pas repassés. Le premier passage reste visible dans
 * l'historique (voir voirCopie / genererPreuveExamenPdf, qui listent les
 * deux épreuves). La fonction SQL refuse elle-même si le premier passage
 * n'est pas encore corrigé, ou si aucun titre n'est en échec. */
async function proposerRattrapage(stagiaireId) {
  if (!confirmer('Générer un QCM de rattrapage, uniquement sur le(s) titre(s) en échec ?\n'
    + 'Les titres déjà validés ne seront pas repassés.')) return;
  try {
    await rpc('generer_qcm_rattrapage', { p_stagiaire_id: stagiaireId });
    toast('QCM de rattrapage généré');
    rendreDetailSession($('#contenu'));
  } catch (e) {
    // Le message SQL précise le cas (premier passage pas corrigé, rien en échec...)
    erreurSupabase('Génération du rattrapage', e);
  }
}

/* ---------- Saisie simplifiée : résultat de formateur externe --------
 * Demande de Jeremy (2026-08-27) : un formateur extérieur à BFS évalue le
 * stagiaire avec son propre système (ex. QUIZAFON) et fournit sa propre
 * attestation (modèle vu le 27/08 : titres évalués, note/total, % de
 * réussite, validation théorique oui/non, symboles validés en pratique).
 * La secrétaire ressaisit ce résultat ici — pas de QCM/pratique Habelec
 * pour ce stagiaire, juste le résultat final. habelec.enregistrer_evaluation_externe
 * écrit directement dans resultats_symbole ; "🏅 Générer le titre" fonctionne
 * ensuite sans aucune autre modification. */
// Colore le libellé d'un titre dans le formulaire "Résultat externe" (2026-08-28,
// demande de Jeremy) : rouge dès que le titre est coché (visé), vert si en plus
// la pratique est validée pour ce titre — repère visuel rapide, aucune incidence
// sur les données enregistrées (toujours lues depuis les checkboxes elles-mêmes).
function majCouleurTitreExterne(code) {
  const lib = document.getElementById(`lib-${code}`);
  if (!lib) return;
  const vise = document.querySelector(`input[name=symbole][value="${code}"]`)?.checked;
  const pratiqueValidee = document.getElementById(`prat-${code}`)?.checked;
  lib.className = !vise ? '' : (pratiqueValidee ? 'titre-externe-vert' : 'titre-externe-rouge');
}

async function saisirResultatExterne(id) {
  const { data: st, error } = await sb.from('stagiaires')
    .select('*, stagiaire_symboles(symbole_code)').eq('id', id).single();
  if (error) return erreurSupabase('Lecture du stagiaire', error);
  const symbolesVises = (st.stagiaire_symboles || []).map(x => x.symbole_code);
  const ev = st.evaluation_externe || {};
  // Pré-remplissage pratique : lu depuis resultats_symbole (pas stocké tel
  // quel dans evaluation_externe, qui ne garde que le résumé théorique).
  const { data: resultatsExistants } = await sb.from('resultats_symbole')
    .select('symbole_code, pratique_ok').eq('stagiaire_id', id);
  const symbolesValidesPratique = (resultatsExistants || [])
    .filter(r => r.pratique_ok).map(r => r.symbole_code);

  const parRole = {};
  S.referentiel.symboles.forEach(sy => (parRole[sy.role] ||= []).push(sy));

  ouvrirModale(`Résultat externe — ${st.nom} ${st.prenom}`, `
    <p class="aide">À utiliser uniquement pour un résultat fourni par un <b style="color:var(--rouge)">formateur/organisme
      extérieur à BFS</b> (son propre système de test théorique). Remplace directement le résultat
      du stagiaire, sans passer par le QCM ou la pratique Habelec.</p>
    <p class="aide">Coche « pratique validée » uniquement sur les titres réellement validés en
      pratique : non coché = non validé.</p>
    <form id="form-resultat-externe" class="formulaire">
      <label>Nom du formateur externe
        <input name="formateur_externe" value="${esc(ev.formateur || '')}" required></label>
      <fieldset><legend>Titres évalués (cocher aussi ceux validés en pratique)</legend>
        ${Object.entries(parRole).map(([role, liste]) => `
          <div class="groupe-symboles"><b>${esc(role)}</b>
            ${liste.map(sy => `<label class="case">
              <input type="checkbox" name="symbole" value="${sy.code}"
                ${symbolesVises.includes(sy.code) ? 'checked' : ''}
                onchange="document.getElementById('prat-${sy.code}').disabled = !this.checked; majCouleurTitreExterne('${sy.code}')">
              <span id="lib-${sy.code}" class="${symbolesVises.includes(sy.code)
                ? (symbolesValidesPratique.includes(sy.code) ? 'titre-externe-vert' : 'titre-externe-rouge') : ''}">${esc(sy.libelle)}</span>
              <label class="case" style="margin-left:8px">
                <input type="checkbox" id="prat-${sy.code}" name="pratique" value="${sy.code}"
                  ${!symbolesVises.includes(sy.code) ? 'disabled' : ''}
                  ${symbolesValidesPratique.includes(sy.code) ? 'checked' : ''}
                  onchange="majCouleurTitreExterne('${sy.code}')"> pratique validé</label>
            </label>`).join('')}
          </div>`).join('')}
      </fieldset>
      <fieldset><legend>Résultat théorique global</legend>
        <div class="grille-2">
          <label>Note obtenue <input type="number" step="1" min="0" name="note" value="${ev.note ?? ''}" required></label>
          <label>Total <input type="number" step="1" min="1" name="total" value="${ev.total ?? ''}" required></label>
        </div>
        <label class="case"><input type="checkbox" name="theorique_validee"
          ${ev.theorique_validee !== false ? 'checked' : ''}> Évaluation théorique validée</label>
      </fieldset>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-resultat-externe').addEventListener('submit', async ev2 => {
    ev2.preventDefault();
    const f = ev2.target;
    const symboles = $$('#form-resultat-externe input[name=symbole]:checked').map(i => i.value);
    const pratique = $$('#form-resultat-externe input[name=pratique]:checked').map(i => i.value);
    if (!symboles.length) return toast('Coche au moins un titre évalué', 'erreur');
    try {
      const { error } = await sb.rpc('enregistrer_evaluation_externe', {
        p_stagiaire_id: id,
        p_symboles_vises: symboles,
        p_symboles_valides_pratique: pratique,
        p_note: parseFloat(f.note.value),
        p_total: parseFloat(f.total.value),
        p_theorique_validee: f.theorique_validee.checked,
        p_formateur_externe: f.formateur_externe.value.trim(),
      });
      if (error) throw error;
      fermerModale();
      toast('Résultat externe enregistré');
      rendreDetailSession($('#contenu'));
    } catch (e) { erreurSupabase('Enregistrement du résultat externe', e); }
  });
}

/* ---------- Préconisation du formateur en cas d'échec (2026-08-28) ------
 * Demande de Jeremy : sur l'avis, en face d'un titre en échec (théorie et/ou
 * pratique non validées), le formateur doit pouvoir écrire une recomman-
 * dation libre (ex. "à représenter en pratique seule"). Enregistrée dans
 * resultats_symbole.preconisation, colonne dédiée jamais réécrite par
 * calculer_resultats() — voir habelec.enregistrer_preconisation(). */
async function saisirPreconisations(id) {
  const { data: st, error } = await sb.from('stagiaires')
    .select('*, stagiaire_symboles(symbole_code)').eq('id', id).single();
  if (error) return erreurSupabase('Lecture du stagiaire', error);
  const symbolesVises = (st.stagiaire_symboles || []).map(x => x.symbole_code);
  if (!symbolesVises.length) return toast('Aucun titre visé pour ce stagiaire', 'erreur');

  const { data: resultats } = await sb.from('resultats_symbole')
    .select('symbole_code, avis, preconisation').eq('stagiaire_id', id);
  const parSymbole = Object.fromEntries((resultats || []).map(r => [r.symbole_code, r]));

  const badgeAvis = avis => avis === 'favorable' ? '<span class="etat ok">validé</span>'
    : avis === 'defavorable' ? '<span class="etat ko">échec</span>'
    : '<span class="etat neutre">en attente</span>';

  ouvrirModale(`Préconisations — ${st.nom} ${st.prenom}`, `
    <p class="aide">À renseigner pour les titres en échec : ce texte s'affiche sur l'avis
      d'habilitation, dans le tableau "Détail par titre visé".</p>
    <form id="form-preconisations" class="formulaire">
      ${symbolesVises.map(code => {
        const r = parSymbole[code] || {};
        return `<label>${esc(libelleSymbole(code))} ${badgeAvis(r.avis)}
          <textarea name="p-${code}" rows="2" placeholder="Préconisation…">${esc(r.preconisation || '')}</textarea></label>`;
      }).join('')}
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-preconisations').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      for (const code of symbolesVises) {
        const { error } = await sb.rpc('enregistrer_preconisation', {
          p_stagiaire_id: id,
          p_symbole_code: code,
          p_texte: f[`p-${code}`].value,
        });
        if (error) throw error;
      }
      fermerModale();
      toast('Préconisations enregistrées');
    } catch (e) { erreurSupabase('Enregistrement des préconisations', e); }
  });
}

async function basculerOuverture() {
  const nouveau = S.session.statut === 'ouverte' ? 'theorie_close' : 'ouverte';
  const { error } = await sb.from('sessions_formation')
    .update({ statut: nouveau }).eq('id', S.session.id);
  if (error) return erreurSupabase('Changement de statut', error);
  S.session.statut = nouveau;
  toast(nouveau === 'ouverte' ? 'Accès stagiaires ouvert' : 'Accès stagiaires fermé');
  rendreDetailSession($('#contenu'));
}

/** Purge les infos personnelles des stagiaires (sauf nom/prénom). Irréversible :
 *  refusé côté base tant qu'un avis est encore en attente pour un stagiaire. */
// 2026-08-28 (demande de Jeremy) : snapshot JSON complet de la session,
// envoyé sur Drive AVANT la purge des infos personnelles faite par
// cloturer_session() côté base — pensé pour être réimportable après une
// purge de l'appli. Best-effort, jamais bloquant sur la clôture elle-même.
async function sauvegarderSessionJsonDrive(sessionId) {
  try {
    const { data: session } = await sb.from('sessions_formation').select('*').eq('id', sessionId).single();
    const { data: stagiaires } = await sb.from('stagiaires')
      .select('*, stagiaire_symboles(symbole_code)').eq('session_id', sessionId);
    const stagiaireIds = (stagiaires || []).map(s => s.id);
    const idsOuVide = stagiaireIds.length ? stagiaireIds : ['00000000-0000-0000-0000-000000000000'];
    const [{ data: resultats }, { data: epreuves }, { data: titres }] = await Promise.all([
      sb.from('resultats_symbole').select('*').in('stagiaire_id', idsOuVide),
      sb.from('epreuves_theoriques').select('*').in('stagiaire_id', idsOuVide),
      sb.from('titres_habilitation').select('*').in('stagiaire_id', idsOuVide),
    ]);
    const snapshot = {
      version_export: 1,
      exporte_le: new Date().toISOString(),
      session, stagiaires,
      resultats_symbole: resultats, epreuves_theoriques: epreuves, titres_habilitation: titres,
    };
    const contenuBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(snapshot, null, 2))));
    const { data, error } = await sb.functions.invoke('habelec-sauvegarder-drive', {
      body: {
        session_id: sessionId, nom_fichier: 'session.json', mime_type: 'application/json',
        contenu_base64: contenuBase64, nom_session: session?.intitule,
      },
    });
    if (error || data?.ok === false) console.warn('Sauvegarde Drive (session.json) ignorée :', error || data?.erreur);
  } catch (e) {
    console.warn('Sauvegarde Drive (session.json) ignorée :', e);
  }
}

async function cloturerSession() {
  if (!confirmer('Clôturer définitivement cette session ?\n'
    + 'Toutes les infos personnelles des stagiaires (date de naissance, entreprise, '
    + 'coordonnées...) seront supprimées, sauf nom et prénom. Action irréversible.')) return;
  try {
    await sauvegarderSessionJsonDrive(S.session.id);
    await rpc('cloturer_session', { p_session_id: S.session.id });
    toast('Session clôturée');
    await ouvrirSession(S.session.id);
  } catch (e) {
    erreurSupabase('Clôture de la session', e);
  }
}

async function ouvrirParametresSession() {
  // Le seuil de réussite n'est plus réglable ici depuis le 2026-09-09 —
  // c'est un réglage d'organisme (onglet Organisme, à côté de l'activation
  // des questions fondamentales), appliqué automatiquement à la création
  // de chaque nouvelle session.
  const duree = prompt('Durée maximale du QCM en minutes (vide = pas de limite) :',
    S.session.duree_max_min || '');
  if (duree === null) return;
  const { error } = await sb.from('sessions_formation').update({
    duree_max_min: duree ? parseInt(duree, 10) : null,
  }).eq('id', S.session.id);
  if (error) return erreurSupabase('Paramètres', error);
  await ouvrirSession(S.session.id);
}

/** Génère un sujet individuel pour chaque stagiaire de la session. */
async function genererTousLesQcm() {
  if (!confirmer('Générer (ou régénérer) un sujet pour chaque stagiaire ?\n'
    + 'Les sujets déjà commencés ne sont pas touchés.')) return;
  try {
    const res = await rpc('generer_qcm_session', { p_session_id: S.session.id });
    toast(`${res.length} sujet(s) généré(s)`);
    rendreDetailSession($('#contenu'));
  } catch (e) {
    // Le message d'erreur SQL indique précisément la thématique en manque
    erreurSupabase('Génération des QCM', e);
  }
}

/* ---------------------- fiche stagiaire ---------------------------- */
/* ---------- Envoi secrétariat : avis + preuve d'examen par email --------
 * Demande de Jeremy (2026-08-28) : un bouton sur le tableau de session
 * envoie, à l'adresse du secrétariat (configurée dans l'onglet Organisme —
 * organismes.email_secretariat), l'avis d'habilitation ET la preuve
 * d'examen de chaque stagiaire ayant déjà un titre généré — les PDF sont
 * (re)construits ici même (jsPDF, mêmes fonctions que les téléchargements
 * individuels) puis transmis en base64 à la fonction partagée Univers BFS
 * envoyer-mail (pièces jointes supportées depuis sa v2, 2026-09-08), qui se
 * charge de l'envoi SMTP (Gmail commun à toutes les briques BFS). Avant
 * cette date, une Edge Function dédiée habelec-envoyer-secretariat existait
 * mais a disparu du projet sans que le code ait été mis à jour — ce bouton
 * était donc cassé jusqu'à ce correctif. Convention de nommage demandée :
 * chaque fichier commence par le NOM du stagiaire, pour un tri alphabétique
 * automatique dans la boîte mail. */
/* ---------- ZIP global : tous les titres + toutes les preuves --------
 * (2026-09-04, demande de Jeremy) Sur le tableau général d'une session,
 * télécharge un seul fichier ZIP contenant l'avis d'habilitation ET la
 * preuve d'examen de chaque stagiaire ayant un titre généré — pratique
 * pour un archivage local rapide, sans passer par l'envoi email au
 * secrétariat. Réutilise les mêmes générateurs PDF (sauvegarder: false)
 * que envoyerSecretariat, juste ci-dessous. Nécessite JSZip (voir index.html).
 */
// 2026-09-08 (demande de Jeremy) : le ZIP ne se contente plus de re-zipper
// les titres déjà générés — il génère en masse le titre de TOUT stagiaire
// dont la théorie est corrigée mais qui n'a pas encore de titre (le bouton
// individuel 🏅 reste inchangé pour une régénération au cas par cas, avec sa
// modale de préconisation habituelle si besoin — voir genererTitrePdf).
async function telechargerZipTitres() {
  const s = S.session;
  const { data: stagiaires } = await sb.from('stagiaires')
    .select('id, nom, prenom').eq('session_id', s.id).order('nom');
  const ids = (stagiaires || []).map(st => st.id);
  if (!ids.length) return toast('Aucun stagiaire dans cette session', 'erreur');

  // Éligible = théorie initiale corrigée (même convention que voirCopie /
  // suivi de session — statut 'corrigee' ou 'terminee') — qu'un titre existe
  // déjà ou non, genererTitrePdf le (re)génère dans les deux cas.
  // 2026-09-08 (bug remonté par Jeremy, session FSEFAC) : un stagiaire évalué
  // par un formateur externe (evaluation_externe non nul) n'a JAMAIS de ligne
  // epreuves_theoriques — il était donc toujours exclu du ZIP, silencieusement,
  // même une fois son résultat externe saisi. On l'inclut maintenant aussi.
  const [{ data: epreuves }, { data: stagiairesExternes }] = await Promise.all([
    sb.from('epreuves_theoriques')
      .select('stagiaire_id, statut').in('stagiaire_id', ids).eq('type_epreuve', 'initiale'),
    sb.from('stagiaires')
      .select('id').in('id', ids).not('evaluation_externe', 'is', null),
  ]);
  const idsTheorieCorrigee = new Set((epreuves || [])
    .filter(e => e.statut === 'corrigee' || e.statut === 'terminee')
    .map(e => e.stagiaire_id));
  (stagiairesExternes || []).forEach(st => idsTheorieCorrigee.add(st.id));
  const eligibles = stagiaires.filter(st => idsTheorieCorrigee.has(st.id));
  if (!eligibles.length) {
    return toast("Aucun stagiaire n'a de théorie corrigée pour l'instant — corrige les copies (👁) "
      + 'avant de télécharger le ZIP.', 'erreur', 7000);
  }

  if (typeof JSZip === 'undefined') return toast('Bibliothèque ZIP indisponible (réseau ?)', 'erreur');

  toast(`Préparation du ZIP pour ${eligibles.length} stagiaire(s)…`);
  const zip = new JSZip();
  const echecs = [];
  for (const st of eligibles) {
    try {
      const avis = await genererTitrePdf(st.id, { sauvegarder: false, silencieux: true });
      if (!avis?.doc) { echecs.push({ st, raison: 'génération sans document' }); continue; }
      const preuve = await genererPreuveExamenPdf(st.id, { sauvegarder: false });
      zip.file(avis.nomFichier, avis.doc.output('arraybuffer'));
      zip.file(preuve.nomFichier, preuve.doc.output('arraybuffer'));
      // 2026-09-18 (demande de Jeremy) : copie de QCM complète de ce
      // stagiaire incluse elle aussi, pour archivage secrétariat.
      const copie = await genererCopieQcmPdf(st.id, { sauvegarder: false });
      if (copie?.doc) zip.file(copie.nomFichier, copie.doc.output('arraybuffer'));
    } catch (e) {
      DEBUG.erreur('telechargerZipTitres — génération PDF', e.message);
      echecs.push({ st, raison: e.message });
    }
  }

  // 2026-09-18 (demande de Jeremy) : récapitulatif de session (1 page,
  // titres validés/non validés + recommandations) inclus une seule fois.
  try {
    const recap = await genererRecapSessionPdf({ sauvegarder: false });
    if (recap?.doc) zip.file(recap.nomFichier, recap.doc.output('arraybuffer'));
  } catch (e) {
    DEBUG.erreur('telechargerZipTitres — récapitulatif de session', e.message);
  }

  if (!zip.files || !Object.keys(zip.files).length) {
    return toast('Aucun document généré — voir le journal de debug', 'erreur');
  }

  const contenu = await zip.generateAsync({ type: 'blob' });
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(contenu);
  lien.download = `${(s.numero_session_galaxy || s.code_acces || 'session')}-titres-preuves.zip`;
  lien.click();
  URL.revokeObjectURL(lien.href);

  const genereCount = eligibles.length - echecs.length;
  if (echecs.length) {
    toast(`ZIP généré pour ${genereCount} stagiaire(s). ${echecs.length} ignoré(s) : `
      + echecs.map(({ st, raison }) => `${st.nom} ${st.prenom} (${raison})`).join(' ; '), 'erreur', 10000);
  } else {
    toast(`ZIP généré pour ${genereCount} stagiaire(s)`);
  }
}

// 2026-09-10 (demande de Jeremy) : bouton de test de la sauvegarde Drive,
// pour vérifier la configuration (OAuth/compte de service, dossier racine…)
// sans avoir à envoyer un vrai mail au secrétariat à chaque essai. Envoie un
// petit fichier texte dans le dossier de LA session en cours, et affiche
// clairement le résultat (succès ou message d'erreur précis), contrairement
// à sauvegarderDocumentDrive (best-effort, silencieuse) utilisée ailleurs.
async function testerSauvegardeDrive() {
  const s = S.session;
  if (!s) return;
  toast('Test d\'envoi vers Google Drive…');
  try {
    const horodatage = new Date().toLocaleString('fr-FR');
    const texte = `Fichier de test — BFS Habelec\nSession : ${s.intitule || ''} `
      + `(n° Galaxy ${s.numero_session_galaxy || '—'})\nEnvoyé le ${horodatage}\n\n`
      + `Si tu vois ce fichier dans le bon dossier Drive, la connexion fonctionne.`;
    const contenuBase64 = btoa(unescape(encodeURIComponent(texte)));
    const { data, error } = await sb.functions.invoke('habelec-sauvegarder-drive', {
      body: {
        session_id: s.id,
        nom_fichier: `test-connexion-drive_${Date.now()}.txt`,
        mime_type: 'text/plain',
        contenu_base64: contenuBase64,
        nom_session: nomDossierSession(s),
      },
    });
    if (error) throw error;
    if (data?.ok === false) throw new Error(data.erreur || 'échec inconnu');
    toast('✅ Test réussi : fichier envoyé sur Google Drive', 'ok', 6000);
  } catch (e) {
    erreurSupabase('Test sauvegarde Drive', e);
  }
}

async function envoyerSecretariat() {
  const s = S.session;
  // 2026-09-08 (service mail commun Univers BFS) : l'ancienne Edge Function
  // habelec-envoyer-secretariat n'existe plus — l'envoi passe maintenant par
  // la fonction partagée envoyer-mail (pièces jointes supportées depuis sa
  // v2), avec le destinataire configuré dans l'onglet Organisme.
  const emailSecretariat = (S.organisme?.email_secretariat || '').trim();
  if (!emailSecretariat) {
    return toast("Adresse email du secrétariat non configurée — renseigne-la dans l'onglet "
      + 'Organisme avant d\'envoyer.', 'erreur', 7000);
  }
  const { data: stagiaires } = await sb.from('stagiaires')
    .select('id, nom, prenom').eq('session_id', s.id).order('nom');
  const ids = (stagiaires || []).map(st => st.id);
  if (!ids.length) return toast('Aucun stagiaire dans cette session', 'erreur');

  const { data: titres } = await sb.from('titres_habilitation')
    .select('stagiaire_id').in('stagiaire_id', ids);
  const idsAvecTitre = new Set((titres || []).map(t => t.stagiaire_id));
  const eligibles = stagiaires.filter(st => idsAvecTitre.has(st.id));
  if (!eligibles.length) {
    return toast("Aucun stagiaire n'a de titre généré pour l'instant — génère les titres (🏅) "
      + 'avant l\'envoi au secrétariat.', 'erreur', 7000);
  }

  ouvrirModale('Envoi secrétariat', `
    <p class="aide">Envoie à jour l'avis d'habilitation + la preuve d'examen de chaque stagiaire
      coché ci-dessous, dans un seul email au secrétariat (les copies de QCM et le récapitulatif
      restent disponibles sur le Drive de la session, sans être joints au mail pour ne pas le
      surcharger).
      Objet : <b>Habilitation électrique — ${esc(s.numero_session_galaxy || '—')}</b></p>
    <form id="form-envoi-secretariat" class="formulaire">
      <fieldset><legend>Stagiaires (${eligibles.length} avec titre généré)</legend>
        ${eligibles.map(st => `<label class="case">
          <input type="checkbox" name="stagiaire" value="${st.id}" checked> ${esc(st.nom)} ${esc(st.prenom)}</label>`).join('')}
      </fieldset>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Envoyer</button>
      </div>
    </form>`);

  $('#form-envoi-secretariat').addEventListener('submit', async ev => {
    ev.preventDefault();
    const idsChoisis = $$('#form-envoi-secretariat input[name=stagiaire]:checked').map(i => i.value);
    if (!idsChoisis.length) return toast('Coche au moins un stagiaire', 'erreur');

    fermerModale();
    toast(`Préparation de ${idsChoisis.length} dossier(s)…`);

    const piecesJointes = [];
    const echecs = [];
    const nomDossier = nomDossierSession(s);
    for (const id of idsChoisis) {
      try {
        const avis = await genererTitrePdf(id, { sauvegarder: false });
        if (!avis?.doc) { echecs.push(id); continue; }
        const preuve = await genererPreuveExamenPdf(id, { sauvegarder: false });
        piecesJointes.push(
          { nom: avis.nomFichier, base64: avis.doc.output('datauristring').split(',')[1] },
          { nom: preuve.nomFichier, base64: preuve.doc.output('datauristring').split(',')[1] },
        );
        // 2026-09-10 (demande de Jeremy) : sauvegarde Drive à l'envoi
        // secrétariat aussi — appelée ici (et non via sauvegarder:true, qui
        // relancerait un téléchargement local en double) et attendue
        // (await) une par une pour ne jamais avoir deux appels concurrents
        // qui créeraient chacun un dossier de session en double sur Drive.
        await sauvegarderDocumentDrive(s.id, avis.nomFichier, avis.doc, nomDossier);
        await sauvegarderDocumentDrive(s.id, preuve.nomFichier, preuve.doc, nomDossier);

        // 2026-09-18 (demande de Jeremy) : copie de QCM complète de ce
        // stagiaire — archivée sur Drive pour chaque stagiaire, mais
        // PAS jointe à l'email (2026-09-22, bug remonté par Jeremy : avec
        // plusieurs stagiaires, la somme des copies de QCM — documents
        // longs, question par question — fait dépasser le budget CPU de
        // la fonction d'envoi de mail côté serveur ; celle-ci plante alors
        // sans réponse exploitable, d'où l'absence de message de réussite
        // OU d'erreur, et aucun mail envoyé. Les copies restent disponibles
        // sur le Drive de la session, seulement plus en pièce jointe mail.)
        const copie = await genererCopieQcmPdf(id, { sauvegarder: false });
        if (copie?.doc) {
          await sauvegarderDocumentDrive(s.id, copie.nomFichier, copie.doc, nomDossier);
        }
      } catch (e) {
        DEBUG.erreur('envoyerSecretariat — génération PDF', e.message);
        echecs.push(id);
      }
    }
    if (!piecesJointes.length) {
      return toast('Aucun document généré — envoi annulé (voir le journal de debug)', 'erreur');
    }

    // 2026-09-18 (demande de Jeremy) : récapitulatif de session (1 page,
    // titres validés/non validés + recommandations) joint une seule fois,
    // pour l'ensemble des stagiaires de la session — pas par stagiaire.
    try {
      const recap = await genererRecapSessionPdf({ sauvegarder: false });
      if (recap?.doc) {
        piecesJointes.push({ nom: recap.nomFichier, base64: recap.doc.output('datauristring').split(',')[1] });
        await sauvegarderDocumentDrive(s.id, recap.nomFichier, recap.doc, nomDossier);
      }
    } catch (e) {
      DEBUG.erreur('envoyerSecretariat — récapitulatif de session', e.message);
    }

    const nomsInclus = eligibles.filter(st => idsChoisis.includes(st.id) && !echecs.includes(st.id))
      .map(st => `${st.nom} ${st.prenom}`);
    const sujet = `Habilitation électrique — ${s.numero_session_galaxy || '—'}`;
    const texte = `Bonjour,\n\nCi-joint l'avis d'habilitation et la preuve d'examen pour :\n`
      + nomsInclus.map(n => `  - ${n}`).join('\n')
      + `\n\nSession : ${s.intitule || ''} (n° Galaxy ${s.numero_session_galaxy || '—'})`
      + `\n\nLe récapitulatif de session (titres validés/non validés et recommandations) est également joint.`
      + `\n\nLes copies de QCM de chaque stagiaire sont disponibles sur le Drive de la session `
      + '(non jointes ici pour ne pas surcharger le mail).'
      + (echecs.length ? `\n\n${echecs.length} stagiaire(s) n'a/ont pas pu être inclus (erreur de génération).` : '')
      + '\n\n— Message généré automatiquement par Habelec.';

    // 2026-09-22 : garde-fou taille — même sans QCM en pièce jointe, avis +
    // preuve + récap de plusieurs stagiaires pourraient encore être trop
    // volumineux pour la fonction d'envoi (limite ~20 Mo côté serveur,
    // et surtout budget CPU limité). On avertit clairement plutôt que de
    // laisser la fonction planter sans réponse exploitable.
    const tailleEstimee = piecesJointes.reduce((s, p) => s + (p.base64?.length || 0), 0);
    if (tailleEstimee > 15 * 1024 * 1024) {
      return toast("Trop de documents pour un seul envoi (pièces jointes trop volumineuses) — "
        + 'décoche une partie des stagiaires et envoie en plusieurs fois.', 'erreur', 9000);
    }

    // 2026-09-22 (bug remonté par Jeremy — aucun message, ni succès ni erreur,
    // et aucun mail reçu) : filet de sécurité en plus du try/catch normal —
    // si l'appel ne se règle jamais (fonction serveur plantée en plein
    // traitement, sans réponse HTTP propre), on force malgré tout un message
    // d'erreur au bout de 25 s plutôt que de laisser l'utilisateur sans
    // aucun retour.
    let etabli = false;
    const delaiSecours = setTimeout(() => {
      if (!etabli) {
        etabli = true;
        toast("L'envoi au secrétariat ne répond pas (délai dépassé) — réessaie avec moins de "
          + 'stagiaires à la fois, ou contacte le support.', 'erreur', 9000);
        enregistrerStatutEnvoiSecretariat(s.id, 'echec', 'Délai dépassé (pas de réponse du serveur)');
      }
    }, 25000);

    try {
      const { data, error } = await sb.functions.invoke('envoyer-mail', {
        body: { a: emailSecretariat, sujet, texte, pieces_jointes: piecesJointes },
      });
      if (etabli) return;
      etabli = true;
      clearTimeout(delaiSecours);
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast(`Envoyé au secrétariat (${piecesJointes.length} fichier(s))`);
      // 2026-09-23 (demande de Jeremy) : la pastille du tableau de bord des
      // sessions ne se met à jour qu'ICI, une fois la réussite CONFIRMÉE
      // par la réponse du serveur — jamais au simple clic du bouton.
      enregistrerStatutEnvoiSecretariat(s.id, 'ok', null);
    } catch (e) {
      if (etabli) return;
      etabli = true;
      clearTimeout(delaiSecours);
      erreurSupabase('Envoi au secrétariat', e);
      enregistrerStatutEnvoiSecretariat(s.id, 'echec', e?.message || String(e));
    }
  });
}

async function enregistrerStatutEnvoiSecretariat(sessionId, statut, detail) {
  const { error } = await sb.from('sessions_formation').update({
    envoi_secretariat_statut: statut,
    envoi_secretariat_le: new Date().toISOString(),
    envoi_secretariat_detail: detail,
  }).eq('id', sessionId);
  // Best-effort : un échec d'enregistrement de CE statut n'empêche pas
  // l'utilisateur de continuer, on le journalise seulement.
  if (error) DEBUG.erreur('enregistrerStatutEnvoiSecretariat', error.message);
}


async function nouveauStagiaire() { await editerStagiaire(null); }

async function editerStagiaire(id) {
  let st = { nom: '', prenom: '', fonction: '', affectation: '', date_naissance: null, domaines: [], symboles: [] };
  if (id) {
    const { data } = await sb.from('stagiaires')
      .select('*, stagiaire_symboles(symbole_code)').eq('id', id).single();
    st = { ...data, symboles: (data.stagiaire_symboles || []).map(x => x.symbole_code) };
  }

  const parRole = {};
  S.referentiel.symboles.forEach(sy => (parRole[sy.role] ||= []).push(sy));

  ouvrirModale(`${id ? 'Modifier' : 'Ajouter'} un stagiaire`, `
    <form id="form-stagiaire" class="formulaire">
      <div class="grille-2">
        <label>Nom <input name="nom" required value="${esc(st.nom)}"></label>
        <label>Prénom <input name="prenom" required value="${esc(st.prenom)}"></label>
        <label>Fonction <input name="fonction" value="${esc(st.fonction)}"></label>
        <label>Affectation <input name="affectation" value="${esc(st.affectation)}"></label>
      </div>
      <label class="case"><input type="checkbox" name="recyclage" ${st.recyclage ? 'checked' : ''}>
        Recyclage <span class="aide">(coché = recyclage, décoché = formation initiale — affiché en
        bleu sur le QCM de positionnement)</span></label>
      <label>Entreprise (employeur du stagiaire)
        <input name="entreprise" value="${esc(st.entreprise || '')}"
          placeholder="Ex : Entreprise Client SARL — jamais BFS, l'organisme de formation">
      </label>
      <p class="aide">Utilisée sur l'avis et le titre d'habilitation (volet « L'EMPLOYEUR »). Peut
        aussi être saisie par le stagiaire lui-même à la connexion au QCM (dans ce cas elle écrase
        cette valeur) — et est purgée à la clôture de la session.</p>
      <label>Date de naissance
        <input name="date_naissance" type="date" max="${dateNaissanceMax()}"
          value="${esc(st.date_naissance || '')}">
      </label>
      <p class="aide">Normalement saisie par le stagiaire lui-même à la connexion au QCM — ce champ
        permet de la corriger si besoin (ex. date du jour saisie par erreur). Elle est purgée à la
        clôture de la session.</p>
      <fieldset><legend>Domaines de tension</legend>
        ${['TBT', 'BT', 'HTA', 'HTB'].map(d => `<label class="case">
          <input type="checkbox" name="domaine" value="${d}"
            ${st.domaines?.includes(d) ? 'checked' : ''}> ${d}</label>`).join('')}
      </fieldset>
      <fieldset><legend>Titres d'habilitation visés</legend>
        ${Object.entries(parRole).map(([role, liste]) => `
          <div class="groupe-symboles"><b>${esc(role)}</b>
            ${liste.map(sy => `<label class="case">
              <input type="checkbox" name="symbole" value="${sy.code}"
                ${st.symboles?.includes(sy.code) ? 'checked' : ''}> ${esc(sy.libelle)}</label>`).join('')}
          </div>`).join('')}
      </fieldset>
      <div id="apercu-plan" class="apercu"></div>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  // Aperçu en direct du nombre de questions que produira la sélection
  const majApercu = () => {
    const choisis = $$('#form-stagiaire input[name=symbole]:checked').map(i => i.value);
    $('#apercu-plan').innerHTML = apercuPlanTirage(choisis);
  };
  $$('#form-stagiaire input[name=symbole]').forEach(i => i.addEventListener('change', majApercu));
  majApercu();

  $('#form-stagiaire').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const donnees = {
      session_id: S.session.id,
      nom: f.nom.value.trim().toUpperCase(),
      prenom: f.prenom.value.trim(),
      fonction: f.fonction.value.trim(),
      affectation: f.affectation.value.trim(),
      entreprise: f.entreprise.value.trim(),
      date_naissance: f.date_naissance.value || null,
      domaines: $$('#form-stagiaire input[name=domaine]:checked').map(i => i.value),
      recyclage: f.recyclage.checked,
    };
    // 2026-09-18 (demande de Jeremy) : même sécurité que côté stagiaire —
    // évite qu'une correction manuelle réintroduise une date du jour.
    if (donnees.date_naissance && !dateNaissanceValide(donnees.date_naissance)) {
      return toast('Cette date de naissance donne moins de 16 ans — vérifie qu\'il ne s\'agit pas de '
        + 'la date du jour par erreur.', 'erreur', 7000);
    }
    const symboles = $$('#form-stagiaire input[name=symbole]:checked').map(i => i.value);
    try {
      let stagiaireId = id;
      if (id) {
        const { error } = await sb.from('stagiaires').update(donnees).eq('id', id);
        if (error) throw error;
        await sb.from('stagiaire_symboles').delete().eq('stagiaire_id', id);
        // 2026-09-05 (demande de Jeremy) : un titre décoché ici doit aussi
        // disparaître de resultats_symbole (statut pratique, avis,
        // préconisation...) — sinon une ligne orpheline y reste "en
        // attente" pour toujours (plus aucun écran ne permet de la
        // valider, puisque le titre n'est plus visé) et continue d'être
        // reprise par generer_titre au moment de générer le titre/avis.
        if (symboles.length) {
          await sb.from('resultats_symbole').delete().eq('stagiaire_id', id).not('symbole_code', 'in', `(${symboles.join(',')})`);
        } else {
          await sb.from('resultats_symbole').delete().eq('stagiaire_id', id);
        }
      } else {
        const { data, error } = await sb.from('stagiaires').insert(donnees).select().single();
        if (error) throw error;
        stagiaireId = data.id;
      }
      if (symboles.length) {
        const { error } = await sb.from('stagiaire_symboles')
          .insert(symboles.map(c => ({ stagiaire_id: stagiaireId, symbole_code: c })));
        if (error) throw error;
      }
      fermerModale();
      toast('Stagiaire enregistré');
      rendreDetailSession($('#contenu'));
    } catch (e) { erreurSupabase('Enregistrement du stagiaire', e); }
  });
}

/**
 * Aperçu du sujet que produira la sélection de titres.
 * Applique la même règle que la fonction SQL plan_tirage : pour une
 * thématique présente dans plusieurs gabarits, on retient le quota le plus
 * exigeant (max), pas la somme — le tronc commun n'est donc posé qu'une fois.
 */
function apercuPlanTirage(symboles) {
  if (!symboles.length) return '<i>Sélectionne au moins un titre visé.</i>';

  const gabarits = new Set();
  symboles.forEach(code =>
    (S.referentiel.gabaritsParSymbole[code] || []).forEach(g => gabarits.add(g)));

  const plan = {};
  (S.referentiel.quotas || [])
    .filter(q => gabarits.has(q.gabarit_code) && q.nb > 0)
    .forEach(q => {
      const p = plan[q.theme_code] ||= { nb: 0, fond: 0 };
      p.nb = Math.max(p.nb, q.nb);
      p.fond = Math.max(p.fond, q.nb_fondamentales);
    });

  const total = Object.values(plan).reduce((a, p) => a + p.nb, 0);
  const totalFond = Object.values(plan).reduce((a, p) => a + p.fond, 0);
  const somme = [...gabarits].reduce((a, g) =>
    a + (S.referentiel.gabarits.find(x => x.code === g)?.total_min || 0), 0);

  return `<b>Sujet prévu : ${total} questions</b> dont ${totalFond} fondamentale(s),
    sur ${gabarits.size} gabarit(s) d'évaluation.
    ${total < somme ? `<br><i>${somme - total} question(s) économisée(s) par le
      dédoublonnage du tronc commun.</i>` : ''}
    <ul class="plan">${Object.entries(plan).sort()
      .map(([t, p]) => `<li>${esc(libelleTheme(t))} : ${p.nb}
        ${p.fond ? `<span class="puce fond">dont ${p.fond} fondamentale(s)</span>` : ''}</li>`).join('')}
    </ul>`;
}

async function supprimerStagiaire(id) {
  if (!confirmer('Supprimer ce stagiaire et ses résultats ?')) return;
  const { error } = await sb.from('stagiaires').delete().eq('id', id);
  if (error) return erreurSupabase('Suppression', error);
  rendreDetailSession($('#contenu'));
}

/* ------------------- copie corrigée d'un stagiaire ----------------- */
// État d'édition (en mémoire, réinitialisé à chaque ouverture de modale) :
// quelles lignes sont actuellement ouvertes en saisie manuelle / en
// correction de clé. Permet de re-rendre voirCopie() sans perdre le mode
// édition en cours.
const EDITION_COPIE = { reponses: new Set(), cles: new Set() };

function toggleReponseFormateur(epreuveQuestionId, stagiaireId) {
  EDITION_COPIE.reponses.has(epreuveQuestionId)
    ? EDITION_COPIE.reponses.delete(epreuveQuestionId) : EDITION_COPIE.reponses.add(epreuveQuestionId);
  voirCopie(stagiaireId);
}
function toggleCorrectionCle(questionId, stagiaireId) {
  EDITION_COPIE.cles.has(questionId)
    ? EDITION_COPIE.cles.delete(questionId) : EDITION_COPIE.cles.add(questionId);
  voirCopie(stagiaireId);
}

async function enregistrerReponseFormateur(epreuveQuestionId, stagiaireId) {
  const choix = $$(`#rf-${epreuveQuestionId} input:checked`).map(i => i.value);
  if (!choix.length && !confirmer('Aucune case cochée : enregistrer une absence de réponse ?')) return;
  try {
    await rpc('formateur_repondre', { p_epreuve_question_id: epreuveQuestionId, p_reponses: choix });
    EDITION_COPIE.reponses.delete(epreuveQuestionId);
    toast('Réponse enregistrée et copie recalculée');
    voirCopie(stagiaireId);
  } catch (e) { erreurSupabase('Saisie de la réponse', e); }
}

async function enregistrerCorrectionCle(questionId, stagiaireId) {
  const bonnes = $$(`#cc-${questionId} input:checked`).map(i => i.value);
  if (!bonnes.length) return toast('Il faut cocher au moins une bonne réponse', 'erreur');
  if (!confirmer('Cette correction s\'applique à TOUTES les copies déjà corrigées qui contiennent '
    + 'cette question, dans tout l\'organisme. Continuer ?')) return;
  try {
    const n = await rpc('corriger_question_erronee', { p_question_id: questionId, p_bonnes_ids: bonnes });
    EDITION_COPIE.cles.delete(questionId);
    toast(`Clé corrigée — ${n} copie(s) recalculée(s)`);
    voirCopie(stagiaireId);
  } catch (e) { erreurSupabase('Correction de la clé', e); }
}

/* Journal des interventions manuelles de la session — traçabilité légale :
 * toute réponse saisie par le formateur ou clé de question corrigée doit
 * pouvoir être retrouvée après coup (qui, quand, avant/après). */
async function voirJournalSession(sessionId) {
  let lignes = [];
  try { lignes = await rpc('journal_session', { p_session_id: sessionId }); }
  catch (e) { return erreurSupabase('Journal de la session', e); }

  const LIBELLES_ACTION = {
    reponse_saisie_formateur: 'Réponse saisie par le formateur',
    cle_question_corrigee: 'Clé de question corrigée',
    generation: 'Titre d\'habilitation généré',
  };

  ouvrirModale('Journal des interventions', `
    <p class="aide">Historique des interventions manuelles sur cette session — conservé pour
      justifier tout écart avec la correction automatique.</p>
    <table class="tableau">
      <thead><tr><th>Date</th><th>Formateur</th><th>Stagiaire</th><th>Action</th><th>Détail</th></tr></thead>
      <tbody>${lignes.map(l => `<tr>
        <td>${new Date(l.horodatage).toLocaleString('fr-FR')}</td>
        <td>${esc(l.formateur)}</td>
        <td>${esc(l.stagiaire)}</td>
        <td>${esc(LIBELLES_ACTION[l.action] || l.action)}</td>
        <td>${detailJournal(l)}</td>
      </tr>`).join('') || `<tr><td colspan="5"><i>Aucune intervention manuelle enregistrée.</i></td></tr>`}</tbody>
    </table>
    <div class="pied-modale"><button onclick="fermerModale()">Fermer</button></div>`);
}

function detailJournal(l) {
  const d = l.details || {};
  if (l.action === 'reponse_saisie_formateur') {
    return `Question n°${esc(d.question_numero)} — avant : ${(d.avant || []).length} réponse(s),
      après : ${(d.apres || []).length} réponse(s)`;
  }
  if (l.action === 'cle_question_corrigee') {
    return `Question n°${esc(d.question_numero)} — « ${esc((d.question_enonce || '').slice(0, 80))} »`;
  }
  return esc(JSON.stringify(d));
}

// 2026-09-08 (demande de Jeremy) : un stagiaire peut avoir passé un
// rattrapage (type_epreuve = 'rattrapage', ne portant que les titres ratés
// au premier passage — voir generer_qcm_rattrapage côté SQL). L'ancien
// .maybeSingle() plantait dès qu'un rattrapage existait (2 lignes au lieu
// d'une), affichant à tort "Aucun sujet généré pour ce stagiaire" alors que
// les deux copies existaient bel et bien. On récupère les deux et on les
// affiche l'une sous l'autre, chacune avec son propre bilan et son propre
// détail de questions — rien n'est masqué ni fusionné.
async function voirCopie(stagiaireId) {
  const { data: eps } = await sb.from('epreuves_theoriques')
    .select('*').eq('stagiaire_id', stagiaireId).in('type_epreuve', ['initiale', 'rattrapage']);
  const epInit = (eps || []).find(e => e.type_epreuve === 'initiale');
  const epRatt = (eps || []).find(e => e.type_epreuve === 'rattrapage');
  if (!epInit) return toast('Aucun sujet généré pour ce stagiaire', 'erreur');
  const passages = [epInit, epRatt].filter(Boolean);
  const estCorrigee = e => e.statut === 'corrigee' || e.statut === 'terminee';

  const questionsParPassage = Object.fromEntries(await Promise.all(passages.map(async ep => {
    const { data: qs } = await sb.from('epreuve_questions')
      .select('*, questions(numero, theme_code, symboles_cibles, enonce, explication, image_url, choix_multiple, question_reponses(id, libelle, correcte)), reponses_stagiaire(reponses_ids, correcte)')
      .eq('epreuve_id', ep.id).order('position');
    return [ep.id, qs || []];
  })));

  // Préconisation obligatoire sur un titre en échec (2026-08-28, demande de
  // Jeremy) : demandée ici, au moment où le formateur valide la copie
  // corrigée — pas moyen de fermer cet écran sans l'avoir saisie pour
  // chaque titre non validé en théorie. Préremplie si déjà saisie
  // auparavant (ex. depuis "✏️" sur l'écran Session).
  const [{ data: stPourPrecon }, { data: resultatsPourPrecon }] = passages.some(estCorrigee)
    ? await Promise.all([
        sb.from('stagiaires').select('id, stagiaire_symboles(symbole_code)').eq('id', stagiaireId).single(),
        sb.from('resultats_symbole').select('symbole_code, preconisation').eq('stagiaire_id', stagiaireId),
      ])
    : [{ data: null }, { data: null }];
  const symbolesStagiairePourPrecon = (stPourPrecon?.stagiaire_symboles || []).map(x => x.symbole_code);
  const preconisationParSymbole = Object.fromEntries((resultatsPourPrecon || []).map(r => [r.symbole_code, r.preconisation]));

  // Détail par titre visé : le verdict global de chaque passage agrège tous
  // ses titres, mais un titre peut échouer seul sans invalider les autres
  // (tronc commun vs thème propre à un titre — voir theorie_gabarit_ok côté
  // SQL). On rejoue le même calcul par titre, PAR PASSAGE.
  const gabaritsVisesInit = epInit.gabarits || [];
  const gabaritsVisesRatt = epRatt?.gabarits || [];
  const verdictsInit = estCorrigee(epInit)
    ? Object.fromEntries(await Promise.all(gabaritsVisesInit.map(async g =>
        [g, await rpc('theorie_gabarit_ok', { p_epreuve_id: epInit.id, p_gabarit_code: g })
          .catch(e => { DEBUG.erreur('theorie_gabarit_ok — ' + g, e.message); return null; })])))
    : {};
  const verdictsRatt = epRatt && estCorrigee(epRatt)
    ? Object.fromEntries(await Promise.all(gabaritsVisesRatt.map(async g =>
        [g, await rpc('theorie_gabarit_ok', { p_epreuve_id: epRatt.id, p_gabarit_code: g })
          .catch(e => { DEBUG.erreur('theorie_gabarit_ok — ' + g, e.message); return null; })])))
    : {};
  // Verdict FINAL par titre visé, même règle que calculer_resultats() côté
  // SQL : le rattrapage l'emporte pour les titres qu'il couvre, dès lors
  // qu'il est corrigé — sinon on retombe sur le passage initial. Sert
  // uniquement à décider quels titres exigent encore une préconisation.
  const verdictFinalParTitre = Object.fromEntries(gabaritsVisesInit.map(g => [g,
    (epRatt && estCorrigee(epRatt) && gabaritsVisesRatt.includes(g)) ? verdictsRatt[g] : verdictsInit[g]]));

  // Pour chaque titre visé, les thèmes qui comptent dans son quota (tronc commun compris)
  const themesParTitre = Object.fromEntries(gabaritsVisesInit.map(g =>
    [g, new Set(S.referentiel.quotas.filter(q => q.gabarit_code === g && q.nb > 0).map(q => q.theme_code))]));

  const rendreQuestion = (q, ep) => {
    const donnees = q.reponses_stagiaire?.reponses_ids || [];
    const juste = q.reponses_stagiaire?.correcte;
    // 2026-09-05 (demande de Jeremy) : le bouton "Saisir la réponse à sa
    // place" ne doit pas dépendre juste d'un tableau vide, mais du fait
    // qu'AUCUN des ids enregistrés ne correspond à une proposition
    // actuelle de la question — sinon une réponse devenue orpheline (ex.
    // options d'une question modifiées depuis) s'affiche à l'écran comme
    // "toutes les cases décochées" sans que le bouton de re-saisie
    // n'apparaisse pour autant.
    const idsPropositionsValides = new Set(q.questions.question_reponses.map(r => r.id));
    const auMoinsUneReponseValide = donnees.some(id => idsPropositionsValides.has(id));
    const sansReponse = !auMoinsUneReponseValide;
    const gabaritsPassage = ep.gabarits || [];
    const titresConcernes = gabaritsPassage.filter(g => themesParTitre[g]?.has(q.theme_code));
    const editionReponse = EDITION_COPIE.reponses.has(q.id);
    const editionCle = EDITION_COPIE.cles.has(q.question_id);
    return `<li class="${sansReponse ? '' : juste ? 'juste' : 'faux'}">
      <div class="enonce">
        <span class="puce" title="Numéro de la question">${esc(codeAffiche(q.questions))}</span>
        ${esc(q.questions.enonce)}
        ${q.fondamentale ? '<span class="puce fond">fondamentale</span>' : ''}
        ${sansReponse ? '<span class="puce alerte">sans réponse</span>' : ''}
        ${titresConcernes.map(g => `<span class="puce" title="Compte pour ce titre">${esc(libelleGabarit(g))}</span>`).join('')}
      </div>
      ${q.questions.image_url ? `<img class="vignette-question" src="${esc(q.questions.image_url)}" alt="">` : ''}
      <ul>${q.questions.question_reponses.map(r => `
        <li class="${r.correcte ? 'bonne' : ''} ${donnees.includes(r.id) ? 'cochee' : ''}">
          ${donnees.includes(r.id) ? '☑' : '☐'} ${esc(r.libelle)}</li>`).join('')}</ul>
      ${q.questions.explication ? `<p class="explication">${esc(q.questions.explication)}</p>` : ''}

      <div class="actions-recorrection">
        ${sansReponse ? `<button type="button" class="lien" onclick="toggleReponseFormateur('${q.id}', '${stagiaireId}')">
          ${editionReponse ? 'Annuler la saisie' : '✎ Saisir la réponse à sa place'}</button>` : ''}
        <button type="button" class="lien" onclick="toggleCorrectionCle('${q.question_id}', '${stagiaireId}')">
          ${editionCle ? 'Annuler la correction' : '⚠ Cette question est erronée'}</button>
      </div>

      ${editionReponse ? `<div class="recorrection" id="rf-${q.id}">
        <p class="aide">Coche la ou les réponses que le stagiaire aurait dû donner.</p>
        ${q.questions.question_reponses.map(r => `
          <label class="case"><input type="${q.questions.choix_multiple ? 'checkbox' : 'radio'}"
            name="rf-${q.id}" value="${r.id}"> ${esc(r.libelle)}</label>`).join('')}
        <button type="button" class="principal" onclick="enregistrerReponseFormateur('${q.id}', '${stagiaireId}')">Enregistrer</button>
      </div>` : ''}

      ${editionCle ? `<div class="recorrection" id="cc-${q.question_id}">
        <p class="aide alerte">Coche la ou les VRAIES bonnes réponses. S'applique à toutes les copies
          déjà corrigées contenant cette question, dans tout l'organisme — recalcul automatique.</p>
        ${q.questions.question_reponses.map(r => `
          <label class="case"><input type="checkbox" name="cc-${q.question_id}" value="${r.id}"
            ${r.correcte ? 'checked' : ''}> ${esc(r.libelle)}</label>`).join('')}
        <button type="button" class="principal" onclick="enregistrerCorrectionCle('${q.question_id}', '${stagiaireId}')">Corriger la clé</button>
      </div>` : ''}
    </li>`;
  };

  const rendrePassage = (ep, titrePassage) => {
    const gabaritsPassage = ep.gabarits || [];
    const verdicts = ep === epInit ? verdictsInit : verdictsRatt;
    return `<div class="passage-copie">
      <h4>${esc(titrePassage)}</h4>
      <div class="bilan ${ep.reussie ? 'ok' : 'ko'}">
        ${ep.score_brut}/${ep.score_total} — ${Math.round((ep.taux || 0) * 100)} %
        · questions fondamentales : ${ep.fondamentales_ok ? 'toutes justes' : 'au moins une ratée'}
        · <b>${ep.reussie ? 'ADMIS' : 'NON ADMIS'}</b>
      </div>
      ${gabaritsPassage.length ? `<div class="detail-titres">
        <b>Détail par titre visé</b>
        <ul>${gabaritsPassage.map(g => {
          const ok = verdicts[g];
          return `<li class="${ok === true ? 'juste' : ok === false ? 'faux' : ''}">
            <span class="puce ${ok === true ? 'titre-vert-fonce' : ok === false ? 'titre-rouge' : ''}">
              ${esc(libelleGabarit(g))}</span>
            ${ok === true ? '✔ validé' : ok === false ? '✘ non validé' : 'en attente'}</li>`;
        }).join('')}</ul>
      </div>` : ''}
      <ol class="copie">${(questionsParPassage[ep.id] || []).map(q => rendreQuestion(q, ep)).join('')}</ol>
    </div>`;
  };

  const preconisationHtml = (() => {
    // Titres en échec au verdict FINAL (rattrapage compris) : préconisation
    // obligatoire avant de pouvoir fermer cette copie. On regroupe par
    // gabarit et on écrit le même texte sur chaque symbole visé rattaché à
    // ce gabarit (c'est là que preconisation est stockée).
    const gabaritsEnEchec = gabaritsVisesInit.filter(g => verdictFinalParTitre[g] === false);
    if (!gabaritsEnEchec.length) return '';
    const mapping = Object.fromEntries(gabaritsEnEchec.map(g => [g,
      symbolesStagiairePourPrecon.filter(sym => (S.referentiel.gabaritsParSymbole[sym] || []).includes(g))]));
    return `<div class="detail-titres precon-requise" id="precon-obligatoire" data-mapping='${esc(JSON.stringify(mapping))}'>
      <b>Préconisation (obligatoire pour valider un titre en échec)</b>
      <p class="aide">Ce texte s'affichera sur l'avis d'habilitation, dans le tableau "Détail par titre visé".</p>
      ${gabaritsEnEchec.map(g => {
        const symboles = mapping[g];
        const texteExistant = symboles.map(sym => preconisationParSymbole[sym]).find(Boolean) || '';
        return `<label>${esc(libelleGabarit(g))}
          <textarea id="precon-${g}" rows="2" required placeholder="Préconisation…">${esc(texteExistant)}</textarea></label>`;
      }).join('')}
    </div>`;
  })();

  ouvrirModale('Copie corrigée', `
    ${rendrePassage(epInit, 'Passage initial')}
    ${epRatt ? rendrePassage(epRatt, `Rattrapage — titre(s) repassé(s) : ${(epRatt.gabarits || []).map(libelleGabarit).join(', ')}`) : ''}
    ${preconisationHtml}
    <div class="pied-modale">
      <button class="lien" onclick="voirJournalSession('${S.session.id}')">🗂 Journal des interventions</button>
      <button onclick="fermerCopieCorrigee('${stagiaireId}')">Fermer</button>
    </div>`);
}

// Ferme la copie corrigée, sauf s'il reste au moins une préconisation
// obligatoire vide (2026-08-28, demande de Jeremy) : dans ce cas, bloque la
// fermeture, signale le(s) titre(s) concerné(s) et met le focus sur le
// premier champ à compléter, au lieu de laisser fermer silencieusement.
async function fermerCopieCorrigee(stagiaireId) {
  const zone = document.getElementById('precon-obligatoire');
  if (!zone) return fermerModale();

  const mapping = JSON.parse(zone.dataset.mapping || '{}');
  for (const g of Object.keys(mapping)) {
    const champ = document.getElementById(`precon-${g}`);
    if (champ && !champ.value.trim()) {
      toast(`Préconisation obligatoire pour ${libelleGabarit(g)} (titre en échec)`, 'erreur', 6000);
      champ.focus();
      return;
    }
  }

  try {
    for (const [g, symboles] of Object.entries(mapping)) {
      const texte = document.getElementById(`precon-${g}`).value.trim();
      for (const sym of symboles) {
        const { error } = await sb.rpc('enregistrer_preconisation', {
          p_stagiaire_id: stagiaireId, p_symbole_code: sym, p_texte: texte,
        });
        if (error) throw error;
      }
    }
    fermerModale();
  } catch (e) { erreurSupabase('Enregistrement de la préconisation', e); }
}

/* ============ 5. Import / export Excel des stagiaires =============== */
const COLONNES_STAGIAIRE = ['Nom', 'Prenom', 'Fonction', 'Affectation', 'Domaines'];

function modeleExcelStagiaires() {
  const symboles = S.referentiel.symboles.map(s => s.libelle);
  const entetes = [...COLONNES_STAGIAIRE, ...symboles];
  const exemple = ['DUPONT', 'Jean', 'Électricien', 'Atelier maintenance', 'TBT, BT',
    ...symboles.map(s => (s === 'B1V' || s === 'BR') ? 'x' : '')];
  const ws = XLSX.utils.aoa_to_sheet([entetes, exemple]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stagiaires');
  XLSX.writeFile(wb, 'modele_stagiaires.xlsx');
  toast('Modèle téléchargé — coche les titres avec un « x »');
}

/** Normalise un en-tête : minuscules, sans accents, sans espaces. */
function cleEntete(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function importerStagiairesExcel(input) {
  const fichier = input.files?.[0];
  if (!fichier) return;
  try {
    const buf = await fichier.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!lignes.length) return toast('Fichier vide', 'erreur');

    // Correspondance des colonnes par préfixe normalisé (tolère les variantes)
    const symbolesParCle = {};
    S.referentiel.symboles.forEach(s => { symbolesParCle[cleEntete(s.libelle)] = s.code; });

    let creees = 0, ignorees = 0;
    for (const ligne of lignes) {
      const val = nom => {
        const k = Object.keys(ligne).find(x => cleEntete(x).startsWith(cleEntete(nom)));
        return k ? String(ligne[k]).trim() : '';
      };
      const nom = val('Nom'), prenom = val('Prenom');
      if (!nom && !prenom) { ignorees++; continue; }

      const domaines = val('Domaines').split(/[,;/ ]+/)
        .map(d => d.trim().toUpperCase()).filter(d => ['TBT', 'BT', 'HTA', 'HTB'].includes(d));

      // 2026-09-28 (bug remonté par Jeremy) : la colonne "Entreprise" du
      // fichier Excel n'était jamais reprise à l'import — seuls Fonction et
      // Affectation l'étaient. Corrigé.
      const { data, error } = await sb.from('stagiaires').insert({
        session_id: S.session.id, nom: nom.toUpperCase(), prenom,
        fonction: val('Fonction'), affectation: val('Affectation'), entreprise: val('Entreprise'), domaines,
      }).select().single();
      if (error) { DEBUG.erreur('Import ligne', error.message); ignorees++; continue; }

      const coches = [];
      Object.entries(ligne).forEach(([col, v]) => {
        const code = symbolesParCle[cleEntete(col)];
        if (code && String(v).trim() && !/^(0|non|false)$/i.test(String(v).trim())) coches.push(code);
      });
      if (coches.length) {
        await sb.from('stagiaire_symboles')
          .insert(coches.map(c => ({ stagiaire_id: data.id, symbole_code: c })));
      }
      creees++;
    }
    toast(`${creees} stagiaire(s) importé(s)${ignorees ? `, ${ignorees} ligne(s) ignorée(s)` : ''}`);
    input.value = '';
    rendreDetailSession($('#contenu'));
  } catch (e) { erreurSupabase('Import Excel', e); }
}

/* ============ 6. Onglet Banque de questions ======================== */
async function rendreBanque(zone) {
  zone.innerHTML = '<p class="chargement">Analyse de la banque…</p>';
  const [{ data: couverture }, { data: compte }, { count: nbAValider }, { data: doublons }] = await Promise.all([
    sb.from('v_couverture_banque').select('*').order('gabarit_code').order('theme_code'),
    sb.from('questions').select('theme_code, fondamentale, active'),
    sb.from('questions').select('id', { count: 'exact', head: true }).eq('a_valider', true),
    sb.rpc('questions_doublons_probables', { p_seuil: 0.5 }),
  ]);
  const nbDoublons = doublons?.length || 0;

  const parTheme = {};
  (compte || []).filter(q => q.active).forEach(q => {
    parTheme[q.theme_code] ||= { total: 0, fond: 0 };
    parTheme[q.theme_code].total++;
    if (q.fondamentale) parTheme[q.theme_code].fond++;
  });

  const manques = (couverture || []).filter(c => !c.suffisant);
  const gabarits = [...new Set((couverture || []).map(c => c.gabarit_code))];

  zone.innerHTML = `
    <div class="barre-actions">
      <h2>Banque de questions</h2>
      <div>
        <label class="bouton-fichier" title="Importer un fichier GIFT (export Moodle)">⬆ Importer GIFT
          <input type="file" accept=".gift,.txt" hidden onchange="importerGift(this)"></label>
        <label class="bouton-fichier" title="Déposer plusieurs images à la fois, nommées d'après le numéro de la question (ex: 42.jpg)">
          🖼 Importer des images en masse
          <input type="file" accept="image/*" multiple hidden onchange="importerImagesEnMasse(this)"></label>
        <button onclick="listerAValider()">Questions à relire${nbAValider ? ` (${nbAValider})` : ''}</button>
        <button onclick="listerDoublons()">Doublons probables${nbDoublons ? ` (${nbDoublons})` : ''}</button>
        <button class="principal" onclick="editerQuestion(null)">+ Nouvelle question</button>
      </div>
    </div>

    <div class="carte ${manques.length ? 'alerte' : 'succes'}">
      ${manques.length
        ? `<b>${manques.length} manque(s) empêchent de générer certains titres.</b>
           <ul>${manques.map(m => `<li>${esc(m.gabarit)} — ${esc(m.theme)} :
             ${m.disponibles}/${m.requis} question(s), ${m.disponibles_fondamentales}/${m.requis_fondamentales} fondamentale(s)</li>`).join('')}</ul>`
        : `<b>Couverture complète.</b> Les ${gabarits.length} évaluations de l'Annexe D.3
           peuvent être générées dans les règles.`}
    </div>

    <h3>Questions disponibles par thématique</h3>
    <table class="tableau">
      <thead><tr><th>Thématique</th><th>Questions</th><th>dont fondamentales</th><th></th></tr></thead>
      <tbody>${S.referentiel.themes.map(t => {
        const c = parTheme[t.code] || { total: 0, fond: 0 };
        return `<tr>
          <td>${esc(t.libelle)} <code>${esc(t.code)}</code></td>
          <td>${c.total}</td><td>${c.fond}</td>
          <td><button class="lien" onclick="listerQuestions('${t.code}')">Voir</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function listerQuestions(themeCode) {
  const { data } = await sb.from('questions')
    .select('*, question_reponses(id, libelle, correcte, position)')
    .eq('theme_code', themeCode).order('cree_le');
  ouvrirModale(libelleTheme(themeCode), `
    <ol class="copie">${(data || []).map(q => `
      <li>
        <div class="enonce">
          <span class="puce" title="Numéro et famille de la question">${esc(codeAffiche(q))}</span>
          ${esc(q.enonce)}
          ${q.fondamentale ? '<span class="puce fond">fondamentale</span>' : ''}
          ${q.a_valider ? '<span class="puce alerte">à relire</span>' : '<span class="puce succes">validée</span>'}
          ${!q.active ? '<span class="puce">désactivée</span>' : ''}
          <button class="lien" title="Basculer à relire / validée"
            onclick="toggleAValider('${q.id}', ${!q.a_valider}, '${themeCode}')">${q.a_valider ? 'Marquer validée' : 'Marquer à relire'}</button>
          <button class="icone" title="Modifier" onclick="editerQuestion('${q.id}')">✎</button>
        </div>
        ${q.image_url ? `<img class="vignette-question" src="${esc(q.image_url)}" alt="Image de la question ${esc(codeAffiche(q))}">` : ''}
        <ul>${(q.question_reponses || []).sort((a, b) => a.position - b.position)
          .map(r => `<li class="${r.correcte ? 'bonne' : ''}">${r.correcte ? '✔' : '·'} ${esc(r.libelle)}</li>`).join('')}</ul>
      </li>`).join('') || '<i>Aucune question dans cette thématique.</i>'}</ol>
    <div class="pied-modale"><button onclick="fermerModale()">Fermer</button></div>`);
}

/* --------- Numérotation « Q{numéro}.{famille}.{thème} » (2026-08) ---------
 * La famille (NE / ELEC / COM) n'est jamais stockée : elle est recalculée
 * ici à partir du référentiel déjà en mémoire (S.referentiel), en miroir
 * exact de la fonction SQL question_famille() — même règle des deux côtés. */
function familleQuestion(q) {
  const gabaritsTheme = S.referentiel.quotas
    .filter(qt => qt.theme_code === q.theme_code && qt.nb > 0)
    .map(qt => qt.gabarit_code);
  let concernes = gabaritsTheme;
  if (q.symboles_cibles && q.symboles_cibles.length) {
    const accessibles = new Set();
    q.symboles_cibles.forEach(sym => (S.referentiel.gabaritsParSymbole[sym] || []).forEach(g => accessibles.add(g)));
    concernes = gabaritsTheme.filter(g => accessibles.has(g));
  }
  const familles = new Set(concernes.map(gc =>
    (S.referentiel.gabarits.find(g => g.code === gc) || {}).famille).filter(Boolean));
  if (familles.size === 0) return null;
  if (familles.size > 1) return 'COM';
  return [...familles][0] === 'non_elec' ? 'NE' : 'ELEC';
}

function codeAffiche(q) {
  const theme = S.referentiel.themes.find(t => t.code === q.theme_code);
  const court = theme?.code_court || q.theme_code;
  const fam = familleQuestion(q);
  return `Q${q.numero}` + (fam ? `.${fam}.${court}` : `.${court}`);
}

async function listerAValider() {
  const { data } = await sb.from('questions')
    .select('*, question_reponses(id, libelle, correcte, position)')
    .eq('a_valider', true).order('theme_code');
  if (!data?.length) return toast('Aucune question en attente de relecture');
  AVALIDER.donnees = data;

  const themesPresents = S.referentiel.themes.filter(t => data.some(q => q.theme_code === t.code));

  ouvrirModale(`Questions à relire (${data.length})`, `
    <p class="aide">Question classée automatiquement à l'import, ou remise "à relire" après
       correction d'une clé erronée pendant une session. Vérifie l'énoncé, les bonnes réponses
       et la thématique (menu déroulant), puis valide directement — pas besoin d'ouvrir la
       fiche complète sauf pour changer le texte ou les propositions elles-mêmes.</p>
    <div class="grille-3">
      <label>Recherche <input id="filtre-avalider-texte" type="search" placeholder="mot dans l'énoncé…"></label>
      <label>Thématique
        <select id="filtre-avalider-theme">
          <option value="">— toutes —</option>
          ${themesPresents.map(t => `<option value="${esc(t.code)}">${esc(t.libelle)}</option>`).join('')}
        </select></label>
      <label>Fondamentale
        <select id="filtre-avalider-fond">
          <option value="">— indifférent —</option>
          <option value="oui">Oui</option>
          <option value="non">Non</option>
        </select></label>
    </div>
    <ol class="copie" id="corps-a-valider"></ol>
    <p id="compte-avalider" class="aide"></p>
    <div class="pied-modale"><button onclick="fermerModale()">Fermer</button></div>`);

  ['filtre-avalider-texte', 'filtre-avalider-theme', 'filtre-avalider-fond']
    .forEach(id => $('#' + id).addEventListener('input', filtrerAValider));
  filtrerAValider();
}

// Filtrage 100% côté écran (2026-08-27, demande de Jeremy) : les questions
// à relire sont déjà toutes chargées en mémoire, inutile de refaire une
// requête à chaque frappe.
const AVALIDER = { donnees: [] };
function filtrerAValider() {
  const texte = ($('#filtre-avalider-texte')?.value || '').trim().toLowerCase();
  const theme = $('#filtre-avalider-theme')?.value || '';
  const fond = $('#filtre-avalider-fond')?.value || '';

  const visibles = AVALIDER.donnees.filter(q =>
    (!texte || q.enonce.toLowerCase().includes(texte))
    && (!theme || q.theme_code === theme)
    && (!fond || (fond === 'oui' ? q.fondamentale : !q.fondamentale)));

  // Énoncé complet + propositions (2026-08-27, 2e demande de Jeremy : il faut
  // voir toute la question pour la valider, pas juste un extrait tronqué) +
  // menu déroulant pour reclasser la thématique directement depuis la liste.
  $('#corps-a-valider').innerHTML = visibles.map(q => `<li id="ligne-avalider-${q.id}">
        <div class="enonce">${esc(q.enonce)}
          ${q.fondamentale ? '<span class="puce fond">fondamentale</span>' : ''}</div>
        ${q.image_url ? `<img class="vignette-question" src="${esc(q.image_url)}" alt="">` : ''}
        <ul>${(q.question_reponses || []).sort((a, b) => a.position - b.position)
          .map(r => `<li class="${r.correcte ? 'bonne' : ''}">${r.correcte ? '✔' : '·'} ${esc(r.libelle)}</li>`).join('')}</ul>
        <div class="ligne-actions-avalider">
          <label>Thématique
            <select id="theme-avalider-${q.id}">
              ${S.referentiel.themes.map(t => `<option value="${esc(t.code)}" ${t.code === q.theme_code ? 'selected' : ''}>${esc(t.libelle)}</option>`).join('')}
            </select></label>
          <button class="lien" onclick="editerQuestion('${q.id}')">Modifier</button>
          <button class="principal" onclick="validerRapide('${q.id}')">Valider</button>
        </div>
      </li>`).join('') || '<li class="vide">Aucune question ne correspond à ces filtres.</li>';
  $('#compte-avalider').textContent = `${visibles.length} / ${AVALIDER.donnees.length} question(s) affichée(s)`;
}


/* Validation rapide depuis la liste "à relire" (2026-08-27) : pas besoin
 * d'ouvrir la fiche complète quand l'énoncé est déjà correct en l'état —
 * pensé pour traiter le retard de relecture par petits lots. */
async function validerRapide(id) {
  try {
    const themeChoisi = document.getElementById(`theme-avalider-${id}`)?.value;
    const donnees = { a_valider: false, maj_le: new Date().toISOString() };
    if (themeChoisi) donnees.theme_code = themeChoisi;
    const { error } = await sb.from('questions').update(donnees).eq('id', id);
    if (error) throw error;
    AVALIDER.donnees = AVALIDER.donnees.filter(q => q.id !== id);
    document.getElementById(`ligne-avalider-${id}`)?.remove();
    if ($('#compte-avalider')) $('#compte-avalider').textContent =
      `${$$('#corps-a-valider li[id^="ligne-avalider-"]').length} / ${AVALIDER.donnees.length} question(s) affichée(s)`;
    toast('Question validée' + (themeChoisi ? ' — ' + esc(libelleTheme(themeChoisi)) : ''));
  } catch (e) { erreurSupabase('Validation de la question', e); }
}

/* --------- Doublons probables (2026-08-27, demande de Jeremy) ---------
 * Repère les énoncés très proches (similarité trigramme côté SQL, voir
 * questions_doublons_probables) pour accélérer la relecture des ~200
 * questions en attente — beaucoup sont des reformulations quasi
 * identiques venues de l'import Moodle + de la génération en masse.
 *
 * 2026-08-27 (bis) : certaines paires ne sont PAS des erreurs à corriger
 * mais des doublons volontaires (même question déclinée dans plusieurs
 * thématiques pour compter dans leurs quotas respectifs) — bouton "Lier"
 * pour les rattacher entre elles (habelec.lier_questions) : la fonction
 * SQL les exclut ensuite définitivement de cette liste, et toute future
 * modification de l'une se répercute automatiquement sur l'autre.
 * Affiche aussi l'énoncé complet + les réponses de chaque exemplaire,
 * pour contrôler sans avoir à ouvrir chaque question une par une. */
async function listerDoublons() {
  let paires;
  try { paires = await rpc('questions_doublons_probables', { p_seuil: 0.5 }); }
  catch (e) { return erreurSupabase('Détection des doublons', e); }
  if (!paires?.length) return toast('Aucun doublon probable détecté (hors questions déjà liées)');

  const carte = q => `
    <div class="enonce">${esc(q.enonce)}
      ${q.fondamentale ? '<span class="puce fond">fondamentale</span>' : ''}</div>
    ${q.image_url ? `<img class="vignette-question" src="${esc(q.image_url)}" alt="">` : ''}
    <ul>${(q.reponses || []).map(r => `<li class="${r.correcte ? 'bonne' : ''}">${r.correcte ? '✔' : '·'} ${esc(r.libelle)}</li>`).join('')}</ul>`;

  ouvrirModale(`Doublons probables (${paires.length})`, `
    <p class="aide">Deux questions dont l'énoncé se ressemble beaucoup — classées par
       ressemblance décroissante. Une ressemblance de 100% = énoncés identiques.
       Si c'est une erreur (même question par mégarde), désactive celle qui fait doublon.
       Si c'est volontaire (même question déclinée dans plusieurs thématiques), clique
       "Lier" : elles n'apparaîtront plus ici, et modifier l'une mettra l'autre à jour
       automatiquement (sauf la thématique, propre à chacune).</p>
    <table class="tableau"><thead><tr><th>Ressemblance</th><th>Question A</th><th>Question B</th></tr></thead>
      <tbody>${paires.map(p => `<tr id="ligne-doublon-${p.id_a}-${p.id_b}">
        <td><b>${Math.round(p.similarite * 100)}%</b></td>
        <td>${esc(codeAffiche({ numero: p.numero_a, theme_code: p.theme_a }))}
          ${carte({ enonce: p.enonce_a, fondamentale: p.fondamentale_a, image_url: p.image_a, reponses: p.reponses_a })}
          <button class="lien" onclick="editerQuestion('${p.id_a}')">Ouvrir</button>
          <button class="lien" onclick="desactiverDoublon('${p.id_a}', '${p.id_b}')">Désactiver celle-ci</button>
          <button class="lien" onclick="supprimerDoublon('${p.id_a}', '${p.id_b}')">Supprimer</button></td>
        <td>${esc(codeAffiche({ numero: p.numero_b, theme_code: p.theme_b }))}
          ${carte({ enonce: p.enonce_b, fondamentale: p.fondamentale_b, image_url: p.image_b, reponses: p.reponses_b })}
          <button class="lien" onclick="editerQuestion('${p.id_b}')">Ouvrir</button>
          <button class="lien" onclick="desactiverDoublon('${p.id_b}', '${p.id_a}')">Désactiver celle-ci</button>
          <button class="lien" onclick="supprimerDoublon('${p.id_b}', '${p.id_a}')">Supprimer</button></td>
      </tr><tr id="ligne-doublon-actions-${p.id_a}-${p.id_b}"><td></td>
        <td colspan="2">
          ${p.theme_a === p.theme_b
            ? '<span class="aide">Même thématique des deux côtés : probablement un vrai doublon à désactiver ci-dessus, pas à lier.</span>'
            : `<button class="principal" onclick="lierPaireDoublon('${p.id_a}', '${p.id_b}')">
                 Lier (pas un doublon — même question dans deux thématiques)</button>`}
          <button class="lien" onclick="ignorerPaireDoublon('${p.id_a}', '${p.id_b}')">
            Ce n'est pas un doublon (contenu différent)</button>
        </td>
      </tr>`).join('')}</tbody></table>
    <div class="pied-modale"><button onclick="fermerModale()">Fermer</button></div>`);
}

async function desactiverDoublon(idADesactiver, idAutre) {
  if (!confirmer('Désactiver cette question ? Elle ne sera plus utilisée dans les tirages, '
    + 'mais reste consultable dans la banque.')) return;
  try {
    const { error } = await sb.from('questions')
      .update({ active: false, maj_le: new Date().toISOString() }).eq('id', idADesactiver);
    if (error) throw error;
    document.getElementById(`ligne-doublon-${idADesactiver}-${idAutre}`)?.remove();
    document.getElementById(`ligne-doublon-${idAutre}-${idADesactiver}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idADesactiver}-${idAutre}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idAutre}-${idADesactiver}`)?.remove();
    toast('Question désactivée');
  } catch (e) { erreurSupabase('Désactivation de la question', e); }
}

/* 2026-08-27 : suppression définitive depuis "Doublons probables" — utile
 * pour un vrai doublon jamais encore utilisé dans un examen (sinon la base
 * refuse la suppression : une question déjà tirée dans une copie doit être
 * désactivée, pas supprimée, pour ne pas casser l'historique). Réservé aux
 * administrateurs (policy contenu_suppr). */
async function supprimerDoublon(idASupprimer, idAutre) {
  if (!confirmer('Supprimer DÉFINITIVEMENT cette question ? Contrairement à "Désactiver", '
    + 'impossible de revenir en arrière. Si elle a déjà servi dans une copie, la suppression '
    + 'sera refusée automatiquement — utilise "Désactiver celle-ci" dans ce cas.')) return;
  try {
    const { error } = await sb.from('questions').delete().eq('id', idASupprimer);
    if (error) {
      if (error.code === '23503') {
        return toast('Impossible : cette question a déjà été utilisée dans une copie — '
          + 'désactive-la plutôt (bouton "Désactiver celle-ci").', 'erreur');
      }
      throw error;
    }
    document.getElementById(`ligne-doublon-${idASupprimer}-${idAutre}`)?.remove();
    document.getElementById(`ligne-doublon-${idAutre}-${idASupprimer}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idASupprimer}-${idAutre}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idAutre}-${idASupprimer}`)?.remove();
    toast('Question supprimée');
  } catch (e) { erreurSupabase('Suppression de la question', e); }
}

async function lierPaireDoublon(idA, idB) {
  if (!confirmer('Lier ces deux questions ? Toute modification future de l\'une (énoncé, '
    + 'réponses, explication, image, fondamentale) sera automatiquement recopiée sur l\'autre. '
    + 'Seule la thématique reste propre à chacune. Elles n\'apparaîtront plus dans les doublons.')) return;
  try {
    const { error } = await sb.rpc('lier_questions', { p_id_a: idA, p_id_b: idB });
    if (error) throw error;
    document.getElementById(`ligne-doublon-${idA}-${idB}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idA}-${idB}`)?.remove();
    toast('Questions liées');
  } catch (e) { erreurSupabase('Liaison des questions', e); }
}

/* 2026-08-27 : certaines paires se ressemblent en surface (même début
 * d'énoncé générique, ex: "Le B1V doit :") sans être ni un doublon à
 * corriger, ni la même question à lier entre deux thématiques — juste
 * une coïncidence de formulation. Ce bouton écarte la paire définitivement
 * de cette liste, sans toucher aux deux questions. */
async function ignorerPaireDoublon(idA, idB) {
  try {
    const { error } = await sb.rpc('ignorer_doublon', { p_id_a: idA, p_id_b: idB });
    if (error) throw error;
    document.getElementById(`ligne-doublon-${idA}-${idB}`)?.remove();
    document.getElementById(`ligne-doublon-actions-${idA}-${idB}`)?.remove();
    toast('Paire écartée des doublons probables');
  } catch (e) { erreurSupabase('Mise à l\'écart de la paire', e); }
}

/* Bascule à relire / validée depuis la liste par thématique (2026-08-27) :
 * marquer une question à retraiter plus tard, indépendamment de toute
 * modification de son contenu — demande de Jeremy. */
async function toggleAValider(id, aValider, themeCode) {
  try {
    const { error } = await sb.from('questions').update({ a_valider: aValider, maj_le: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    toast(aValider ? 'Question marquée à relire' : 'Question marquée validée');
    await listerQuestions(themeCode);
  } catch (e) { erreurSupabase('Mise à jour de la question', e); }
}

async function editerQuestion(id) {
  let q = { theme_code: S.referentiel.themes[0]?.code, enonce: '', explication: '',
            fondamentale: false, active: true, reponses: [{ libelle: '', correcte: true }, { libelle: '', correcte: false }] };
  if (id) {
    const { data } = await sb.from('questions')
      .select('*, question_reponses(id, libelle, correcte, position)').eq('id', id).single();
    q = { ...data, reponses: (data.question_reponses || []).sort((a, b) => a.position - b.position) };
  }

  ouvrirModale(id ? `Modifier la question ${esc(codeAffiche(q))}` : 'Nouvelle question', `
    <form id="form-question" class="formulaire">
      <label>Thématique
        <select name="theme">${S.referentiel.themes.map(t =>
          `<option value="${t.code}" ${t.code === q.theme_code ? 'selected' : ''}>${esc(t.libelle)}</option>`).join('')}
        </select></label>
      ${id ? `<label>Image (facultative)
        ${q.image_url ? `<img class="vignette-question" src="${esc(q.image_url)}" alt="">` : '<i>Aucune image.</i>'}
        <input type="file" accept="image/*" onchange="televerserImageQuestion('${id}', this)"></label>` : ''}
      <label>Énoncé <textarea name="enonce" rows="2" required>${esc(q.enonce)}</textarea></label>
      <label>Explication affichée à la correction (facultatif)
        <textarea name="explication" rows="2">${esc(q.explication)}</textarea></label>
      <label class="case"><input type="checkbox" name="fondamentale" ${q.fondamentale ? 'checked' : ''}>
        Question fondamentale (son échec invalide le titre)</label>
      <label class="case"><input type="checkbox" name="active" ${q.active !== false ? 'checked' : ''}>
        Question active (utilisable dans les tirages)</label>
      <label class="case"><input type="checkbox" name="a_valider" ${q.a_valider ? 'checked' : ''}>
        Encore à relire (laisse coché si tu veux la retraiter plus tard malgré cet enregistrement)</label>
      <fieldset><legend>Propositions — coche celles qui sont justes</legend>
        <div id="reponses">${q.reponses.map((r, i) => ligneReponse(r, i)).join('')}</div>
        <button type="button" class="lien" onclick="ajouterReponse()">+ Ajouter une proposition</button>
      </fieldset>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-question').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const reponses = $$('#reponses .ligne-reponse').map((d, i) => ({
      libelle: d.querySelector('input[type=text]').value.trim(),
      correcte: d.querySelector('input[type=checkbox]').checked,
      position: i,
    })).filter(r => r.libelle);

    if (reponses.length < 2) return toast('Il faut au moins deux propositions', 'erreur');
    if (!reponses.some(r => r.correcte)) return toast('Il faut au moins une bonne réponse', 'erreur');

    const donnees = {
      theme_code: f.theme.value,
      enonce: f.enonce.value.trim(),
      explication: f.explication.value.trim() || null,
      fondamentale: f.fondamentale.checked,
      active: f.active.checked,
      choix_multiple: reponses.filter(r => r.correcte).length > 1,
      a_valider: f.a_valider.checked,
      origine: id ? undefined : 'saisie',
      maj_le: new Date().toISOString(),
    };
    try {
      let qid = id;
      if (id) {
        const { error } = await sb.from('questions').update(donnees).eq('id', id);
        if (error) throw error;
        // 2026-09-21 (bug remonté par Jeremy, Q289.ELEC.AP) : la policy RLS de
        // suppression exigeait auparavant un compte admin — pour un formateur
        // simple, ce delete était silencieusement ignoré (aucune erreur), et
        // les nouvelles réponses s'ajoutaient par-dessus les anciennes à
        // chaque enregistrement, au lieu de les remplacer -> doublons. La
        // policy a été corrigée côté base, mais on vérifie ici en plus,
        // explicitement, que la suppression a bien eu lieu avant de
        // réinsérer — pour ne plus jamais dupliquer en silence si ce droit
        // venait à changer à nouveau.
        const { error: erreurSuppr, count } = await sb.from('question_reponses')
          .delete({ count: 'exact' }).eq('question_id', id);
        if (erreurSuppr) throw erreurSuppr;
        if (!count) {
          const { count: restantes } = await sb.from('question_reponses')
            .select('id', { count: 'exact', head: true }).eq('question_id', id);
          if (restantes) throw new Error("Impossible de remplacer les anciennes réponses (droit refusé) — "
            + 'contacte un administrateur.');
        }
      } else {
        const { data, error } = await sb.from('questions').insert(donnees).select().single();
        if (error) throw error;
        qid = data.id;
      }
      const { error } = await sb.from('question_reponses')
        .insert(reponses.map(r => ({ ...r, question_id: qid })));
      if (error) throw error;
      toast('Question enregistrée');
      // On reste sur la liste de la thématique (plutôt que de revenir au tableau
      // général de la banque) : plus ergonomique pour relire/classer en série.
      rendreBanque($('#contenu'));
      await listerQuestions(donnees.theme_code);
    } catch (e) { erreurSupabase('Enregistrement de la question', e); }
  });
}

function ligneReponse(r = { libelle: '', correcte: false }) {
  return `<div class="ligne-reponse">
    <input type="checkbox" ${r.correcte ? 'checked' : ''} title="Réponse juste">
    <input type="text" value="${esc(r.libelle)}" placeholder="Libellé de la proposition">
    <button type="button" class="icone" title="Retirer"
      onclick="this.parentElement.remove()">✕</button></div>`;
}
function ajouterReponse() { $('#reponses').insertAdjacentHTML('beforeend', ligneReponse()); }

/* --------------------- Images des questions (2026-08) --------------------- */
async function televerserImageQuestion(questionId, input) {
  const fichier = input.files?.[0];
  if (!fichier) return;
  try {
    const url = await deposerImageQuestion(questionId, fichier);
    const { error } = await sb.from('questions').update({ image_url: url }).eq('id', questionId);
    if (error) throw error;
    toast('Image enregistrée');
    editerQuestion(questionId);
  } catch (e) { erreurSupabase('Import de l\'image', e); }
}

/** Dépose un fichier dans le bucket question-images sous un nom stable
 * (numéro de question + extension), avec upsert pour permettre le remplacement. */
async function deposerImageQuestion(questionId, fichier, numero) {
  const ext = (fichier.name.split('.').pop() || 'jpg').toLowerCase();
  const chemin = `${numero ?? questionId}.${ext}`;
  const { error } = await sb.storage.from('question-images')
    .upload(chemin, fichier, { upsert: true, cacheControl: '3600' });
  if (error) throw error;
  const { data } = sb.storage.from('question-images').getPublicUrl(chemin);
  return data.publicUrl + '?v=' + Date.now(); // évite le cache navigateur après remplacement
}

/** Import en masse : chaque fichier déposé doit être nommé d'après le numéro
 * de la question à illustrer (ex: "42.jpg", "Q42.png", "42 - schéma.jpg" —
 * seuls les chiffres en tête du nom sont lus). */
async function importerImagesEnMasse(input) {
  const fichiers = [...(input.files || [])];
  if (!fichiers.length) return;

  const { data: questions, error } = await sb.from('questions').select('id, numero');
  if (error) return erreurSupabase('Import en masse — lecture des numéros', error);
  const parNumero = Object.fromEntries((questions || []).map(q => [String(q.numero), q.id]));

  let ok = 0; const echecs = [];
  for (const fichier of fichiers) {
    const m = fichier.name.match(/^\D*(\d+)/);
    const numero = m ? m[1] : null;
    const questionId = numero && parNumero[numero];
    if (!questionId) { echecs.push(fichier.name); continue; }
    try {
      const url = await deposerImageQuestion(questionId, fichier, numero);
      const { error: errMaj } = await sb.from('questions').update({ image_url: url }).eq('id', questionId);
      if (errMaj) throw errMaj;
      ok++;
    } catch (e) { DEBUG.erreur('import image ' + fichier.name, e.message); echecs.push(fichier.name); }
  }
  input.value = '';
  toast(`${ok} image(s) importée(s)` + (echecs.length ? `, ${echecs.length} non associée(s) : ${echecs.join(', ')}` : ''),
    echecs.length ? 'erreur' : 'ok', 8000);
}

/* ---------------------- import GIFT (Moodle) ----------------------- */
/**
 * Lit un export GIFT et crée les questions correspondantes.
 * Format reconnu : ::Nom:: Énoncé { =bonne ~mauvaise } avec $CATEGORY.
 */
async function importerGift(input) {
  const fichier = input.files?.[0];
  if (!fichier) return;
  const texte = await fichier.text();
  const questions = analyserGift(texte);
  if (!questions.length) return toast('Aucune question reconnue dans ce fichier', 'erreur');

  const theme = prompt(
    'Thématique à affecter à ces ' + questions.length + ' question(s) :\n\n'
    + S.referentiel.themes.map(t => t.code + ' — ' + t.libelle).join('\n'),
    S.referentiel.themes[0]?.code);
  if (!theme || !S.referentiel.themes.some(t => t.code === theme)) {
    return toast('Code de thématique inconnu', 'erreur');
  }

  let ok = 0;
  for (const q of questions) {
    const { data, error } = await sb.from('questions').insert({
      theme_code: theme, enonce: q.enonce, origine: 'gift',
      reference_ext: 'gift:' + q.nom, a_valider: true,
      choix_multiple: q.reponses.filter(r => r.correcte).length > 1,
    }).select().single();
    if (error) { DEBUG.erreur('GIFT', error.message); continue; }
    await sb.from('question_reponses').insert(
      q.reponses.map((r, i) => ({ question_id: data.id, libelle: r.libelle, correcte: r.correcte, position: i })));
    ok++;
  }
  input.value = '';
  toast(`${ok} question(s) importée(s) — à relire dans « Questions à relire »`);
  rendreBanque($('#contenu'));
}

function analyserGift(texte) {
  const out = [];
  const bloc = /::([^:]+)::\s*([\s\S]*?)\{([\s\S]*?)\}/g;
  let m;
  while ((m = bloc.exec(texte)) !== null) {
    const [, nom, enonce, corps] = m;
    const reponses = [];
    corps.split(/\n/).forEach(l => {
      const t = l.trim();
      if (t.startsWith('=')) reponses.push({ libelle: t.slice(1).trim(), correcte: true });
      else if (t.startsWith('~')) reponses.push({ libelle: t.replace(/^~(%-?\d+%)?/, '').trim(), correcte: false });
    });
    if (reponses.length >= 2 && reponses.some(r => r.correcte)) {
      out.push({ nom: nom.trim(), enonce: enonce.trim().replace(/\s+/g, ' '), reponses });
    }
  }
  return out;
}

/* ============ 7. Onglet Mises en situation ========================== */
let SCENARIOS_CACHE = [];
// 2026-09-09 (demande de Jeremy) : quels titres sont dépliés (persiste entre
// deux rendus, sinon un ajout/modif/suppression refermait tout).
const SCENARIOS_OUVERTS = new Set();

function onToggleScenarioGabarit(code, ouvert) {
  if (ouvert) SCENARIOS_OUVERTS.add(code); else SCENARIOS_OUVERTS.delete(code);
}

async function rendreScenarios(zone) {
  // Même correctif "l'écran remonte tout seul" que pour l'évaluation pratique
  // (HE_pratique.js) : on repère le titre actuellement en haut de l'écran
  // avant de tout regénérer, puis on corrige le scroll pour qu'il y reste,
  // même si le nombre de scénarios affichés au-dessus a changé.
  const dejaAffiche = !!zone.querySelector('details[data-gabarit-code]');
  const scrollY = window.scrollY;
  let ancre = null;
  if (dejaAffiche) {
    let meilleure = null, meilleurEcart = Infinity;
    for (const d of zone.querySelectorAll('details[data-gabarit-code]')) {
      const ecart = Math.abs(d.getBoundingClientRect().top);
      if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleure = d; }
    }
    if (meilleure) ancre = { code: meilleure.dataset.gabaritCode, top: meilleure.getBoundingClientRect().top };
  } else {
    zone.innerHTML = '<p class="chargement">Chargement…</p>';
  }

  const { data } = await sb.from('scenarios_pratiques').select('*').order('gabarit_code').order('numero');
  SCENARIOS_CACHE = data || [];
  const parGabarit = {};
  SCENARIOS_CACHE.forEach(s => (parGabarit[s.gabarit_code] ||= []).push(s));

  zone.innerHTML = `
    <div class="barre-actions"><h2>Mises en situation pratiques</h2></div>
    <p class="aide">Ces scénarios servent de trame aux épreuves pratiques. Le barème
       appliqué est celui de la norme : A sans erreur, B erreur minime, C erreur majeure,
       D erreur grave — <b>aucun D et un seul C au maximum par mise en situation</b>.
       Chaque scénario porte un <b>numéro unique</b> (ex. « B0-3 ») : indiquez-le pour demander
       à un administrateur d'en supprimer un.</p>
    ${S.referentiel.gabarits.map(g => `
      <details data-gabarit-code="${esc(g.code)}" ${parGabarit[g.code]?.length ? '' : 'class="vide"'}
        ${SCENARIOS_OUVERTS.has(g.code) ? 'open' : ''}
        ontoggle="onToggleScenarioGabarit('${esc(g.code)}', this.open)">
        <summary>${esc(g.libelle)} <span class="puce">${parGabarit[g.code]?.length || 0} scénario(s)</span>
          <span class="puce">${g.mises_en_situation_min} situation(s) minimum</span></summary>
        <div class="barre-actions"><button onclick="ajouterScenario('${esc(g.code)}')">+ Ajouter un scénario</button></div>
        <table class="tableau"><thead><tr><th>N°</th><th>Intitulé</th><th>Contexte</th><th>Aléa</th>
          <th>Attendus</th><th>Motif d'arrêt</th><th></th></tr></thead>
          <tbody>${(parGabarit[g.code] || []).map(s => `<tr>
            <td><span class="puce">${esc(g.code)}-${s.numero}</span></td>
            <td>${esc(s.intitule)}</td><td>${esc(s.contexte_technique)}</td>
            <td>${esc(s.probleme_ou_alea)}</td><td>${esc(s.attendus_principaux)}</td>
            <td>${esc(s.motif_arret_obligatoire)}</td>
            <td><button class="lien" onclick="ajouterScenario('${esc(g.code)}', '${esc(s.id)}')">Modifier</button>
              <button class="lien" onclick="ajouterScenario('${esc(g.code)}', null, '${esc(s.id)}')">Dupliquer</button>
              ${S.vision === 'admin' ? `<button class="lien" onclick="supprimerScenario('${esc(s.id)}', '${esc(g.code)}-${s.numero}')">Supprimer</button>` : ''}</td></tr>`).join('')
            || `<tr><td colspan="7" class="vide">Aucun scénario enregistré — la grille normative reste utilisable telle quelle.</td></tr>`}
          </tbody></table>
        <h4>Savoir-faire évalués (tableau ${esc(g.tableau_savoir_faire || '')})</h4>
        <ol>${S.referentiel.savoirFaire.filter(sf => sf.gabarit_code === g.code)
          .map(sf => `<li>${esc(sf.libelle)}</li>`).join('')}</ol>
      </details>`).join('')}`;

  if (ancre) {
    const detailsApres = zone.querySelector(`details[data-gabarit-code="${CSS.escape(ancre.code)}"]`);
    if (detailsApres) window.scrollBy(0, detailsApres.getBoundingClientRect().top - ancre.top);
    else window.scrollTo(0, scrollY);
  }
}

// 2026-09-09 (demande de Jeremy) : formulaire d'ajout/modification d'une
// mise en situation pratique (table habelec.scenarios_pratiques). Les
// policies RLS existantes (contenu_ajout / contenu_maj) autorisent déjà
// tout formateur/secrétariat de l'organisme — aucune migration nécessaire.
function ajouterScenario(gabaritCode, scenarioId = null, dupliquerId = null) {
  const g = S.referentiel.gabarits.find(x => x.code === gabaritCode);
  const s = scenarioId ? SCENARIOS_CACHE.find(x => x.id === scenarioId) : null;
  const source = dupliquerId ? SCENARIOS_CACHE.find(x => x.id === dupliquerId) : null;
  const pre = s || source; // pré-remplissage : édition OU duplication
  const v = champ => esc((champ === 'intitule' && source ? `${source.intitule} (copie)` : pre?.[champ]) || '');

  let titreModale = 'Ajouter un scénario';
  if (s) titreModale = `Modifier le scénario ${esc(gabaritCode)}-${s.numero}`;
  else if (source) titreModale = `Dupliquer le scénario ${esc(gabaritCode)}-${source.numero}`;

  ouvrirModale(`${titreModale} — ${esc(g.libelle)}`, `
    <form id="form-scenario" class="formulaire">
      <label>Intitulé <span class="requis">*</span>
        <input name="intitule" required value="${v('intitule')}"></label>
      <div class="grille-2">
        <label>Rôle du stagiaire <input name="role" value="${v('role')}"></label>
        <label>Type d'activité <input name="type_activite" value="${v('type_activite')}"></label>
      </div>
      <label>Contexte technique <textarea name="contexte_technique" rows="2">${v('contexte_technique')}</textarea></label>
      <div class="grille-2">
        <label>Variation d'environnement <textarea name="variation_environnement" rows="2">${v('variation_environnement')}</textarea></label>
        <label>Variation documentaire <textarea name="variation_documentaire" rows="2">${v('variation_documentaire')}</textarea></label>
      </div>
      <label>Problème ou aléa <textarea name="probleme_ou_alea" rows="2">${v('probleme_ou_alea')}</textarea></label>
      <label>Attendus principaux <textarea name="attendus_principaux" rows="2">${v('attendus_principaux')}</textarea></label>
      <label>Motif d'arrêt obligatoire <textarea name="motif_arret_obligatoire" rows="2">${v('motif_arret_obligatoire')}</textarea></label>
      <label>Matériel nécessaire <textarea name="materiel_necessaire" rows="2">${v('materiel_necessaire')}</textarea></label>
      <label>Référence externe <span class="aide">(document, fiche source…)</span>
        <input name="reference_ext" value="${v('reference_ext')}"></label>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-scenario').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const donnees = {
      gabarit_code: gabaritCode,
      intitule: f.intitule.value.trim(),
      role: f.role.value.trim() || null,
      type_activite: f.type_activite.value.trim() || null,
      contexte_technique: f.contexte_technique.value.trim() || null,
      variation_environnement: f.variation_environnement.value.trim() || null,
      variation_documentaire: f.variation_documentaire.value.trim() || null,
      probleme_ou_alea: f.probleme_ou_alea.value.trim() || null,
      attendus_principaux: f.attendus_principaux.value.trim() || null,
      motif_arret_obligatoire: f.motif_arret_obligatoire.value.trim() || null,
      materiel_necessaire: f.materiel_necessaire.value.trim() || null,
      reference_ext: f.reference_ext.value.trim() || null,
    };
    if (!donnees.intitule) return toast('L\'intitulé est obligatoire', 'erreur');
    try {
      const { error } = s
        ? await sb.from('scenarios_pratiques').update(donnees).eq('id', s.id)
        : await sb.from('scenarios_pratiques').insert(donnees);
      if (error) throw error;
      fermerModale();
      toast(s ? 'Scénario modifié' : 'Scénario ajouté');
      rendreScenarios($('#contenu'));
    } catch (e) { erreurSupabase('Enregistrement du scénario', e); }
  });
}

async function supprimerScenario(id, identifiant) {
  if (!confirmer(`Supprimer définitivement le scénario ${identifiant} ?`)) return;
  const { error } = await sb.from('scenarios_pratiques').delete().eq('id', id);
  if (error) return erreurSupabase('Suppression du scénario', error);
  toast('Scénario supprimé');
  rendreScenarios($('#contenu'));
}

/* ============ 8. Onglet Organisme =================================== */
/* ---------------- Onglet Titres (admin) : réglage des MSP par titre ---- */
async function rendreTitres(zone) {
  const gabarits = [...(S.referentiel.gabarits || [])].sort((a, b) => a.code.localeCompare(b.code));
  zone.innerHTML = `
    <div class="barre-actions"><h2>Titres — mises en situation pratiques</h2>
      <button onclick="gererCatalogueCriteres()">📋 Catalogue des critères (E1-E15 / NE1-NE12)</button>
    </div>
    <p class="aide">Par défaut, chaque titre demande <b>1 mise en situation obligatoire</b> ;
       si elle échoue, <b>1 mise en situation de rattrapage</b> est proposée. Le titre est
       validé dès que l'une des deux (obligatoire ou rattrapage) est conforme. Ces deux
       nombres sont réglables ici, par titre.</p>
    <table class="tableau">
      <thead><tr><th>Titre</th><th>MSP obligatoire(s)</th><th>MSP de rattrapage</th><th>Critères évalués</th><th></th></tr></thead>
      <tbody>${gabarits.map(g => {
        const n = (S.referentiel.savoirFaire || []).filter(sf => sf.gabarit_code === g.code).length;
        const total = (S.referentiel.criteres || []).filter(c => c.famille === g.famille).length;
        return `
        <tr data-gabarit="${esc(g.code)}">
          <td>${esc(g.libelle)}</td>
          <td><input type="number" min="1" max="9" style="width:4em"
                value="${g.mises_en_situation_min}" data-champ="mises_en_situation_min"></td>
          <td><input type="number" min="0" max="9" style="width:4em"
                value="${g.mises_en_situation_rattrapage}" data-champ="mises_en_situation_rattrapage"></td>
          <td>${n}/${total} <button class="lien" onclick="gererCriteresGabarit('${esc(g.code)}')">Gérer</button></td>
          <td><button class="lien" onclick="enregistrerTitre('${esc(g.code)}')">Enregistrer</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

/* ---------- Critères pratiques par titre (2026-08) ---------------------
 * gabarit_savoir_faire est un sous-ensemble éditable du catalogue national
 * criteres_savoir_faire (E1..E15 / NE1..NE12) : quels critères comptent
 * réellement pour CE titre, réglable ici plutôt que figé dans le code. */
async function gererCriteresGabarit(gabaritCode) {
  const g = S.referentiel.gabarits.find(x => x.code === gabaritCode);
  const catalogue = (S.referentiel.criteres || []).filter(c => c.famille === g.famille)
    .sort((a, b) => a.numero - b.numero);
  const retenus = new Set((S.referentiel.savoirFaire || [])
    .filter(sf => sf.gabarit_code === gabaritCode).map(sf => sf.critere_code));

  ouvrirModale(`Critères pratiques — ${esc(g.libelle)}`, `
    <p class="aide">Coche les critères réellement évalués pour ce titre. Les autres
       critères du catalogue ${g.famille === 'elec' ? 'élec (E1-E15)' : 'non élec (NE1-NE12)'}
       ne seront pas proposés dans la grille de notation.</p>
    <form id="form-criteres-gabarit">
      ${catalogue.map(c => `<label class="case">
        <input type="checkbox" value="${esc(c.code)}" ${retenus.has(c.code) ? 'checked' : ''}>
        <span class="puce">${esc(c.code)}</span> ${esc(c.libelle)}</label>`).join('')}
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-criteres-gabarit').addEventListener('submit', async ev => {
    ev.preventDefault();
    const codes = $$('#form-criteres-gabarit input:checked').map(i => i.value);
    if (!codes.length) return toast('Il faut garder au moins un critère', 'erreur');
    try {
      await sb.from('gabarit_savoir_faire').delete().eq('gabarit_code', gabaritCode);
      const { error } = await sb.from('gabarit_savoir_faire').insert(
        codes.map(code => ({
          gabarit_code: gabaritCode, critere_code: code,
          position: catalogue.find(c => c.code === code).numero,
        })));
      if (error) throw error;
      fermerModale();
      toast('Critères mis à jour pour ce titre');
      await chargerReferentiel();
      rendreTitres($('#contenu'));
    } catch (e) { erreurSupabase('Enregistrement des critères', e); }
  });
}

async function gererCatalogueCriteres() {
  const parFamille = { elec: [], non_elec: [] };
  (S.referentiel.criteres || []).forEach(c => parFamille[c.famille]?.push(c));
  Object.values(parFamille).forEach(l => l.sort((a, b) => a.numero - b.numero));

  ouvrirModale('Catalogue des critères pratiques', `
    <p class="aide">Ce catalogue est national (2 listes fixes : élec E1-E15, non élec NE1-NE12).
       Modifier un libellé ici le change partout où ce critère est utilisé.</p>
    <form id="form-catalogue">
      ${['elec', 'non_elec'].map(fam => `
        <fieldset><legend>${fam === 'elec' ? 'Électricien (E1-E15)' : 'Non électricien (NE1-NE12)'}</legend>
          ${parFamille[fam].map(c => `<label style="display:block;margin:6px 0">
            <span class="puce">${esc(c.code)}</span>
            <input type="text" style="width:80%" value="${esc(c.libelle)}" data-code="${esc(c.code)}"></label>`).join('')}
        </fieldset>`).join('')}
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Enregistrer</button>
      </div>
    </form>`);

  $('#form-catalogue').addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      for (const input of $$('#form-catalogue input[data-code]')) {
        const libelle = input.value.trim();
        if (!libelle) continue;
        const { error } = await sb.from('criteres_savoir_faire')
          .update({ libelle }).eq('code', input.dataset.code);
        if (error) throw error;
      }
      fermerModale();
      toast('Catalogue mis à jour');
      await chargerReferentiel();
      rendreTitres($('#contenu'));
    } catch (e) { erreurSupabase('Enregistrement du catalogue', e); }
  });
}

async function enregistrerTitre(code) {
  const ligne = document.querySelector(`tr[data-gabarit="${CSS.escape(code)}"]`);
  const min = parseInt(ligne.querySelector('[data-champ=mises_en_situation_min]').value, 10);
  const rattrapage = parseInt(ligne.querySelector('[data-champ=mises_en_situation_rattrapage]').value, 10);
  if (!min || min < 1) return toast('Il faut au moins 1 mise en situation obligatoire', 'erreur');
  const { error } = await sb.from('gabarits')
    .update({ mises_en_situation_min: min, mises_en_situation_rattrapage: rattrapage || 0 })
    .eq('code', code);
  if (error) return erreurSupabase('Enregistrement du titre', error);
  toast('Titre enregistré');
  await chargerReferentiel();
}

// 2026-08-28 (compte de service Drive) : lit juste l'adresse email du
// compte de service dans la clé JSON collée, pour affichage dans l'onglet
// Organisme (aide Jeremy à savoir avec quelle adresse partager le dossier).
function extraireEmailCompteService(json) {
  try { return JSON.parse(json).client_email || ''; } catch { return ''; }
}

// 2026-09-10 (retour OAuth, cf. HE_config.js) : URI de redirection FIXE que
// la fonction habelec-drive-oauth-callback utilise pour échanger le code
// Google contre un refresh_token — doit être déclarée à l'identique dans
// Google Cloud Console (Identifiants → ID client OAuth → URI de redirection
// autorisées), sinon Google refuse l'échange. Construite avec la clé anon
// "historique" (JWT), car c'est celle que l'environnement des Edge
// Functions Supabase expose toujours sous SUPABASE_ANON_KEY, quel que soit
// le type de clé publique utilisé côté client (voir CONFIG.SUPABASE_ANON_KEY).
// Doit être identique à ce que Deno.env.get('SUPABASE_ANON_KEY') renvoie côté
// fonction Edge (habelec-drive-oauth-callback) : depuis le passage aux nouvelles
// clés Supabase, c'est la clé publique (sb_publishable_...), plus le vieux JWT.
const CLE_ANON_HISTORIQUE_EDGE = 'sb_publishable_UhkImOyooXPnAqTCNMJ4wA_VVqscCmK';
const URI_REDIRECTION_DRIVE = `${CONFIG.SUPABASE_URL}/functions/v1/habelec-drive-oauth-callback?apikey=${CLE_ANON_HISTORIQUE_EDGE}`;

function copierUriRedirectionDrive() {
  navigator.clipboard.writeText(URI_REDIRECTION_DRIVE);
  toast('URI de redirection copiée');
}

// Ouvre l'écran de consentement Google — l'utilisateur choisit son compte
// Google (celui qui a accès au Drive/dossier voulu), autorise l'accès, et
// habelec-drive-oauth-callback enregistre le refresh_token obtenu.
function connecterGoogleDrive(organismeId) {
  const clientId = document.querySelector('#form-organisme [name="drive_client_id"]')?.value.trim();
  if (!clientId) return toast('Renseigne et enregistre d\'abord l\'ID client OAuth ci-dessus', 'erreur');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: URI_REDIRECTION_DRIVE,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive',
    state: organismeId,
  });
  window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, '_blank');
}

async function rendreOrganisme(zone) {
  const o = S.organisme || {};
  zone.innerHTML = `
    <div class="barre-actions"><h2>Organisme</h2></div>
    <form id="form-organisme" class="formulaire carte">
      <div class="grille-2">
        <label>Raison sociale — Sèvremont / Bocage <input name="raison_sociale" required value="${esc(o.raison_sociale)}"></label>
        <label>Adresse — Sèvremont / Bocage <input name="adresse" value="${esc(o.adresse)}"></label>
        <label>Nom du signataire <input name="signataire_nom" value="${esc(o.signataire_nom)}"></label>
        <label>Fonction du signataire <input name="signataire_fonction" value="${esc(o.signataire_fonction)}"></label>
        <label>Validité des titres (années)
          <input name="validite_annees" type="number" min="1" max="5" value="${o.validite_annees || 3}"></label>
      </div>
      <fieldset><legend>Signature du représentant de l'organisme (apposée automatiquement sur
        l'avis d'habilitation — pas sur le titre, que l'employeur signe à la main)</legend>
        ${widgetSignature('signature-organisme', o.signature_data)}
      </fieldset>
      <fieldset><legend>Cachet — Sèvremont / Bocage Formation Sécurité (apposé automatiquement
        sur l'avis d'habilitation des sessions ayant lieu à Sèvremont)</legend>
        ${widgetImage('cachet-organisme', o.cachet_data)}
      </fieldset>
      <!-- 2026-09-03 (demande de Jeremy) : deuxième centre (Briec / Bretagne Formation
        Sécurité) — raison sociale, adresse et cachet propres, choisis automatiquement
        sur l'avis selon le lieu de la session (sessions_formation.lieu). -->
      <fieldset><legend>Raison sociale et cachet — Briec / Bretagne Formation Sécurité
        (utilisés automatiquement sur l'avis des sessions ayant lieu à Briec)</legend>
        <div class="grille-2">
          <label>Raison sociale <input name="raison_sociale_briec" value="${esc(o.raison_sociale_briec)}"></label>
          <label>Adresse <input name="adresse_briec" value="${esc(o.adresse_briec)}"></label>
        </div>
        ${widgetImage('cachet-organisme-briec', o.cachet_data_briec)}
      </fieldset>
      <fieldset><legend>Envoi secrétariat</legend>
        <label>Adresse email du secrétariat <input name="email_secretariat" type="email"
          value="${esc(o.email_secretariat)}" placeholder="ex : secretariat@bocage-securite.fr"></label>
        <p class="aide">Adresse qui recevra l'avis d'habilitation + la preuve d'examen quand tu utilises
          « Envoi secrétariat » depuis une session. Envoyé via le service mail commun Univers BFS
          (bfs.noreplay@gmail.com) — pas de configuration supplémentaire nécessaire ici.</p>
      </fieldset>
      <fieldset><legend>Règle de réussite</legend>
        <label>Seuil de réussite (% de bonnes réponses exigé)
          <input name="seuil_reussite_defaut" type="number" min="1" max="100" step="1"
            value="${Math.round((o.seuil_reussite_defaut ?? 0.70) * 100)}" style="width:6em"></label>
        <p class="aide">Appliqué automatiquement à chaque nouvelle session créée. Les sessions déjà
          créées gardent le seuil qu'elles avaient au moment de leur création (visible sur l'écran de
          la session) — ce réglage ne les modifie pas rétroactivement.</p>
        <label class="case"><input type="checkbox" name="fondamentales_actives" ${o.fondamentales_actives === false ? '' : 'checked'}>
          Activer les questions fondamentales (échec = titre non validé, badge affiché au stagiaire pendant l'examen)</label>
        <p class="aide">Décoche pour désactiver entièrement les questions fondamentales pour cet organisme :
          elles ne seront plus exigées pour valider un titre, et le badge "Question fondamentale" ne
          s'affichera plus pendant la passation. S'applique à toutes les sessions.</p>
      </fieldset>
      <fieldset><legend>Entraînement permanent (hors session, 2026-09-09)</legend>
        <p class="aide">Ce lien et ce QR code sont fixes : ils ne dépendent d'aucune session et
          fonctionnent en permanence. Le visiteur choisit ses titres visés et s'entraîne avec les
          réponses affichées immédiatement — rien n'est enregistré, aucun impact sur un dossier.
          À imprimer une fois pour toutes (affiche à l'accueil, plaquette commerciale...).</p>
        <label class="case"><input type="checkbox" name="entrainement_permanent_actif" ${o.entrainement_permanent_actif === false ? '' : 'checked'}>
          Activer l'accès d'entraînement permanent (hors session)</label>
        <div id="qr-entrainement-permanent"></div>
        <p id="qr-permanent-erreur" class="erreur-discrete" hidden></p>
        <div><code id="lien-entrainement-permanent"></code></div>
        <button type="button" class="lien" onclick="copierLienEntrainementPermanent()">Copier le lien</button>
        <button type="button" class="lien" onclick="telechargerQrEntrainementPermanent()">Télécharger l'image</button>
      </fieldset>
      <fieldset><legend>Sauvegarde automatique sur Google Drive — un
        dossier par session, avec les PDF des stagiaires et un fichier session.json
        réimportable en cas de purge</legend>
        <p class="aide">Méthode recommandée depuis le 2026-09-10 : connexion avec ton propre
          compte Google (OAuth), qui utilise ton quota de stockage personnel — fonctionne avec
          un Drive classique ou un Drive partagé. L'ancienne méthode "compte de service" ci-dessous
          ne fonctionne plus si ton organisation Google Workspace bloque la création de clés de
          compte de service (politique <code>iam.disableServiceAccountKeyCreation</code>).</p>
        <label>ID du dossier (ou Drive partagé) racine
          <input name="drive_dossier_racine_id" value="${esc(o.drive_dossier_racine_id)}"
            placeholder="ex : 1AbCdEfGhIjKlmnOpQrSt (dans l'URL du dossier, après /folders/)"></label>
        <div class="grille-2">
          <label>ID client OAuth (Google Cloud Console)
            <input name="drive_client_id" value="${esc(o.drive_client_id)}" placeholder="xxxx.apps.googleusercontent.com"></label>
          <label>Code secret du client OAuth
            <input name="drive_client_secret" placeholder="${o.drive_client_secret ? '•••••••• (déjà enregistré, laisser vide pour garder)' : 'colle ici le code secret (GOCSPX-...)'}"></label>
        </div>
        <p class="aide">1. Dans <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console → API et services → Identifiants</a>,
          crée un "ID client OAuth" de type <b>Application Web</b>.
          2. Dans "URI de redirection autorisées", ajoute EXACTEMENT :
          <code id="uri-redirection-drive">${esc(URI_REDIRECTION_DRIVE)}</code>
          <button type="button" class="lien" onclick="copierUriRedirectionDrive()">Copier</button>.
          3. Colle ci-dessus l'ID client et le code secret affichés par Google, puis clique
          "Enregistrer" en bas de ce formulaire.
          4. Clique ensuite sur "Connecter Google Drive" ci-dessous et autorise l'accès, avec le
          compte Google qui a accès au dossier/Drive partagé indiqué plus haut.</p>
        <p>Statut OAuth : ${o.drive_refresh_token
          ? '<span style="color:var(--vert);font-weight:700">✅ Connecté</span>'
          : '<span style="color:var(--rouge);font-weight:700">◻️ Non connecté</span>'}</p>
        <button type="button" onclick="connecterGoogleDrive('${esc(o.id)}')">🔗 Connecter Google Drive</button>

        <label class="case" style="margin-top:10px">
          <input type="checkbox" name="drive_bouton_test_actif" ${o.drive_bouton_test_actif ? 'checked' : ''}>
          Afficher le bouton « ☁️ Tester Drive » sur l'écran de session (envoie un petit fichier de
          test dans le dossier Drive de la session, sans envoyer aucun mail)</label>

        <details style="margin-top:14px">
          <summary>Autre méthode (avancée) : compte de service — nécessite un Drive PARTAGÉ (Workspace)</summary>
          <label>Clé JSON du compte de service Google
            <textarea name="drive_service_account_json" rows="3" placeholder="${o.drive_service_account_json ? '•••••••• (déjà enregistrée, laisser vide pour garder)' : 'Colle ici tout le contenu du fichier JSON téléchargé'}"></textarea>
          </label>
          <p class="aide">Utilisée seulement si aucune connexion OAuth n'est active ci-dessus.
            Nécessite un Drive PARTAGÉ (fonctionnalité Google Workspace) partagé en Éditeur avec
            l'adresse "client_email" de la clé — un compte de service n'a pas de quota de stockage
            propre sur un Drive personnel classique.</p>
          <p>Statut : ${o.drive_service_account_json
            ? '<span style="color:var(--vert);font-weight:700">✅ Configuré</span>' + (extraireEmailCompteService(o.drive_service_account_json) ? ` — compte de service : <code>${esc(extraireEmailCompteService(o.drive_service_account_json))}</code>` : '')
            : '<span style="color:var(--rouge);font-weight:700">◻️ Non configuré</span>'}</p>
        </details>
      </fieldset>
      <button class="principal" type="submit">Enregistrer</button>
    </form>`;

  activerSignature('signature-organisme');
  activerImage('cachet-organisme');
  activerImage('cachet-organisme-briec');

  // Lien fixe (aucun ?code= : voir tirage_positionnement, qui accepte
  // désormais un code vide) vers l'entraînement libre, hors de toute
  // session — 2026-09-09, demande de Jeremy.
  const lienEntrainementPermanent = location.origin + location.pathname + '#entrainement';
  $('#lien-entrainement-permanent').textContent = lienEntrainementPermanent;
  try {
    if (typeof QRCode === 'undefined') throw new Error('bibliothèque QRCode non chargée');
    $('#qr-entrainement-permanent').innerHTML = '';
    new QRCode($('#qr-entrainement-permanent'), { text: lienEntrainementPermanent, width: 160, height: 160 });
  } catch (e) {
    const p = $('#qr-permanent-erreur');
    if (p) { p.hidden = false; p.textContent = 'QR code indisponible (' + e.message + ')'; }
  }

  $('#form-organisme').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const driveJsonSaisi = f.drive_service_account_json.value.trim();
    const driveSecretSaisi = f.drive_client_secret.value.trim();
    const donnees = {
      raison_sociale: f.raison_sociale.value.trim(),
      adresse: f.adresse.value.trim(),
      raison_sociale_briec: f.raison_sociale_briec.value.trim(),
      adresse_briec: f.adresse_briec.value.trim(),
      signataire_nom: f.signataire_nom.value.trim(),
      signataire_fonction: f.signataire_fonction.value.trim(),
      validite_annees: parseInt(f.validite_annees.value, 10) || 3,
      signature_data: lireSignature('signature-organisme'),
      cachet_data: lireImage('cachet-organisme'),
      cachet_data_briec: lireImage('cachet-organisme-briec'),
      drive_dossier_racine_id: f.drive_dossier_racine_id.value.trim() || null,
      drive_client_id: f.drive_client_id.value.trim() || null,
      drive_bouton_test_actif: f.drive_bouton_test_actif.checked,
      fondamentales_actives: f.fondamentales_actives.checked,
      entrainement_permanent_actif: f.entrainement_permanent_actif.checked,
      seuil_reussite_defaut: Math.max(1, Math.min(100, parseInt(f.seuil_reussite_defaut.value, 10) || 70)) / 100,
      email_secretariat: f.email_secretariat.value.trim() || null,
    };
    // La clé JSON ne se réaffiche jamais (juste un repère en placeholder) —
    // on ne réécrit donc la colonne que si l'utilisateur a effectivement
    // recollé quelque chose (2026-08-28).
    if (driveJsonSaisi) {
      donnees.drive_service_account_json = driveJsonSaisi;
    }
    if (driveSecretSaisi) {
      donnees.drive_client_secret = driveSecretSaisi;
    }
    const { error } = await sb.from('organismes').update(donnees).eq('id', o.id);
    if (error) return erreurSupabase('Enregistrement', error);
    toast('Organisme enregistré');
    await chargerProfil();
  });
}

/* ============ 8 ter. Onglet Mon compte (tout formateur) ===============
 * Demande de Jeremy (2026-08-27) : chaque formateur enregistre sa propre
 * signature une fois, apposée automatiquement sur chaque avis d'habilitation
 * qu'il émet ensuite (S.profil.signature_data, lu dans genererTitrePdf) —
 * plus besoin de signer à la main à chaque avis. Accessible à tout
 * formateur authentifié (pas réservé à l'admin, chacun gère la sienne) ;
 * la policy form_self existante autorise déjà cette écriture. */
async function rendreMonCompte(zone) {
  const p = S.profil || {};
  zone.innerHTML = `
    <div class="barre-actions"><h2>Mon compte</h2></div>
    <form id="form-mon-compte" class="formulaire carte">
      <p>${esc(p.nom || '')} ${esc(p.prenom || '')} — ${esc(S.utilisateur?.email || '')}</p>
      <fieldset><legend>Ma signature (apposée automatiquement sur chaque avis d'habilitation
        que je délivre)</legend>
        ${widgetSignature('signature-formateur', p.signature_data)}
      </fieldset>
      <button class="principal" type="submit">Enregistrer</button>
    </form>`;

  activerSignature('signature-formateur');
  $('#form-mon-compte').addEventListener('submit', async ev => {
    ev.preventDefault();
    const { error } = await sb.from('formateurs').update({
      signature_data: lireSignature('signature-formateur'),
    }).eq('id', p.id);
    if (error) return erreurSupabase('Enregistrement', error);
    toast('Signature enregistrée');
    await chargerProfil();
  });
}

/* ============ 8 bis. Onglet Vérification (admin) ======================
 * Liste des titres délivrés avec leur numéro d'authenticité (HE-AAAA-
 * <n° session Galaxy>-NNN, voir patch_2026-08-26) + export Excel destiné
 * à alimenter la base externe de vérification consultée par les employeurs.
 * Demande de Jeremy (2026-08-26). Portée par la vue v_titres_verification
 * (RLS : même périmètre organisme que partout ailleurs). */
async function rendreVerification(zone) {
  zone.innerHTML = '<p class="chargement">Chargement des titres délivrés…</p>';
  const { data, error } = await sb.from('v_titres_verification').select('*')
    .order('delivre_le', { ascending: false });
  if (error) return erreurSupabase('Lecture des titres délivrés', error);

  S._titresVerification = data || [];
  afficherVerification(zone, '');

  zone.addEventListener('input', ev => {
    if (ev.target.id !== 'recherche-verification') return;
    afficherVerification(zone, ev.target.value);
    // Réaffiché en entier (innerHTML) à chaque frappe => on remet le focus
    // et le curseur en fin de texte, sinon le champ perd le focus.
    const champ = document.getElementById('recherche-verification');
    champ.focus();
    champ.setSelectionRange(champ.value.length, champ.value.length);
  });
}

function afficherVerification(zone, filtre) {
  const f = (filtre || '').trim().toLowerCase();
  const tout = S._titresVerification || [];
  const data = !f ? tout : tout.filter(t => [
    t.numero, t.nom, t.prenom, t.session, t.numero_session_galaxy,
  ].some(champ => (champ || '').toLowerCase().includes(f)));

  zone.innerHTML = `
    <div class="barre-actions"><h2>Vérification d'authenticité</h2>
      <button onclick="exporterTitresVerification()">⬇️ Exporter en Excel (${data.length})</button>
    </div>
    <p class="aide">Chaque titre délivré porte un numéro unique (ex. HE-2026-4521-001), imprimé sur
      l'avis et sur le titre remis au stagiaire. Cet export alimente la base externe de vérification
      d'authenticité consultée par les employeurs — à réexporter et retransmettre après chaque session.</p>
    <input type="search" id="recherche-verification" placeholder="Rechercher (nom, n° de vérification, session...)"
      value="${esc(filtre || '')}" style="margin-bottom:10px;max-width:340px">
    <table class="tableau">
      <thead><tr><th>N° de vérification</th><th>Nom</th><th>Prénom</th><th>Titres (symboles)</th><th>Session</th>
        <th>N° session Galaxy</th><th>Date de délivrance</th><th>À recycler avant</th><th></th></tr></thead>
      <tbody>${data.map(t => `
        <tr>
          <td>${esc(t.numero)}</td>
          <td>${esc(t.nom)}</td>
          <td>${esc(t.prenom)}</td>
          <td>${(t.symboles && t.symboles.length) ? t.symboles.map(c => esc(libelleSymbole(c))).join(', ') : '—'}</td>
          <td>${esc(t.session || '—')}</td>
          <td>${esc(t.numero_session_galaxy || '—')}</td>
          <td>${dateFr(t.delivre_le)}</td>
          <td>${dateFr(t.recycler_avant)}</td>
          <td><button class="icone" title="Purger ce titre (test, doublon...)"
                onclick="purgerTitreVerification('${t.id}')">🗑</button></td>
        </tr>`).join('') || '<tr><td colspan="9" class="vide">Aucun titre ne correspond.</td></tr>'}
      </tbody>
    </table>`;
}

async function purgerTitreVerification(id) {
  const t = (S._titresVerification || []).find(x => x.id === id);
  if (!confirm(`Purger définitivement le titre ${t?.numero || ''} (${t?.nom || ''} ${t?.prenom || ''}) ?\n\n`
    + 'Cette suppression est définitive — à réserver aux titres de test.')) return;
  const { error } = await sb.from('titres_habilitation').delete().eq('id', id);
  if (error) return erreurSupabase('Purge du titre', error);
  S._titresVerification = (S._titresVerification || []).filter(x => x.id !== id);
  toast('Titre purgé');
  afficherVerification($('#contenu'), document.getElementById('recherche-verification')?.value || '');
}

function exporterTitresVerification() {
  const data = S._titresVerification || [];
  if (!data.length) return toast('Rien à exporter');
  const lignes = data.map(t => ({
    'Numéro de vérification': t.numero,
    'Nom': t.nom,
    'Prénom': t.prenom,
    'Organisme': t.organisme,
    'Session': t.session,
    'N° session Galaxy': t.numero_session_galaxy,
    'Symboles': (t.symboles || []).join(', '),
    'Date de délivrance': dateFr(t.delivre_le),
    'À recycler avant': dateFr(t.recycler_avant),
  }));
  const ws = XLSX.utils.json_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Titres');
  XLSX.writeFile(wb, `export_verification_titres_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Export généré');
}

/* ============ 9. Onglet Comptes (admin) ============================= */
/* Rattache un compte auth.users déjà créé (Portail, ou une autre brique
 * Univers BFS) à Habelec, avec un rôle. Ne crée jamais de compte
 * auth.users lui-même — voir MEMOIRE_PROJET.md, la création du compte
 * brut est centralisée côté Portail. Idempotent côté serveur : cet écran
 * peut être soumis plusieurs fois sans risque d'écraser un formateur déjà
 * rattaché. */
async function rendreComptes(zone) {
  zone.innerHTML = '<p class="chargement">Chargement des comptes…</p>';
  const [{ data: formateurs, error: err1 }, { data: organismes, error: err2 }, comptesDisponibles] = await Promise.all([
    sb.from('formateurs').select('*, organismes(raison_sociale)').order('email'), // inclut organisme_externe (select *)
    sb.from('organismes').select('id, raison_sociale').order('raison_sociale'),
    // Comptes de tout l'Univers BFS pas encore rattachés à Habelec (2026-08-27,
    // demande de Jeremy) — pour le menu déroulant, évite la saisie manuelle.
    rpc('lister_comptes_univers_bfs').catch(e => { erreurSupabase('Liste des comptes disponibles', e); return []; }),
  ]);
  if (err1) return erreurSupabase('Lecture des comptes', err1);
  if (err2) return erreurSupabase('Lecture des organismes', err2);

  const optionsOrganisme = (organismes || []).map(o => `<option value="${esc(o.id)}">${esc(o.raison_sociale)}</option>`).join('');

  zone.innerHTML = `
    <div class="barre-actions"><h2>Comptes</h2></div>
    <p class="aide">Rattache ici un compte qui existe déjà quelque part dans
       l'Univers BFS (créé via le Portail, ou sur une autre application) à
       Habelec. Le compte doit déjà exister : ce premier formulaire ne crée
       aucun compte <code>auth.users</code>, il ajoute seulement une ligne
       dans <code>formateurs</code> pour l'autoriser ici.</p>
    <form id="form-rattacher-compte" class="formulaire carte">
      <div class="grille-2">
        <label>Compte existant (Univers BFS)
          <select id="select-compte-existant">
            <option value="">— choisir dans la liste, ou saisir un email ci-dessous —</option>
            ${(comptesDisponibles || []).map(c => `<option value="${esc(c.email)}">${esc(c.email)}</option>`).join('')}
          </select></label>
        <label>Email du compte à rattacher
          <input name="email" type="email" required autocomplete="off"></label>
        <label>Rôle
          <select name="role">
            <option value="formateur">Formateur</option>
            <option value="secretariat">Secrétariat</option>
            <option value="admin">Administrateur</option>
          </select></label>
        <label>Nom <input name="nom"></label>
        <label>Prénom <input name="prenom"></label>
        <label>Organisme
          <select name="organisme_id">
            <option value="">— aucun —</option>
            ${optionsOrganisme}
            <option value="__externe__">Organisme extérieur (préciser)…</option>
          </select></label>
        <label class="champ-organisme-externe" hidden>Nom de l'organisme extérieur
          <input name="organisme_externe" autocomplete="off"></label>
      </div>
      <button class="principal" type="submit">Rattacher</button>
    </form>

    <h3>Formateur externe à BFS (compte à créer)</h3>
    <p class="aide">Réservé à quelqu'un qui n'utilisera jamais aucune autre application de
       l'Univers BFS — sinon, fais-le créer via le Portail puis rattache-le ci-dessus.
       Un email d'invitation est envoyé à la personne pour qu'elle choisisse elle-même
       son mot de passe ; aucun mot de passe n'est généré ni affiché ici.</p>
    <form id="form-creer-externe" class="formulaire carte">
      <div class="grille-2">
        <label>Email <input name="email" type="email" required autocomplete="off"></label>
        <label>Rôle
          <select name="role">
            <option value="formateur">Formateur</option>
            <option value="secretariat">Secrétariat</option>
            <option value="admin">Administrateur</option>
          </select></label>
        <label>Nom <input name="nom" required></label>
        <label>Prénom <input name="prenom"></label>
        <label>Organisme
          <select name="organisme_id">
            <option value="">— aucun —</option>
            ${optionsOrganisme}
            <option value="__externe__">Organisme extérieur (préciser)…</option>
          </select></label>
        <label class="champ-organisme-externe" hidden>Nom de l'organisme extérieur
          <input name="organisme_externe" autocomplete="off"></label>
      </div>
      <button class="principal" type="submit">Créer le compte et l'inviter</button>
    </form>

    <table class="tableau">
      <thead><tr><th>Email</th><th>Nom</th><th>Rôle</th><th>Organisme</th><th>Rattaché le</th></tr></thead>
      <tbody>${(formateurs || []).map(f => `
        <tr>
          <td>${esc(f.email)}</td>
          <td>${esc([f.prenom, f.nom].filter(Boolean).join(' '))}</td>
          <td>${f.role === 'admin' ? 'Administrateur' : f.role === 'secretariat' ? 'Secrétariat' : 'Formateur'}</td>
          <td>${esc(f.organismes?.raison_sociale || f.organisme_externe || '—')}</td>
          <td>${dateFr(f.cree_le)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="vide">Aucun compte rattaché pour le moment.</td></tr>'}
      </tbody>
    </table>`;

  $('#select-compte-existant').addEventListener('change', ev => {
    if (ev.target.value) $('#form-rattacher-compte input[name="email"]').value = ev.target.value;
  });

  // Affiche le champ « nom de l'organisme extérieur » uniquement quand ce
  // choix est sélectionné, sur les deux formulaires (2026-09-08).
  $$('select[name="organisme_id"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const champ = sel.closest('form').querySelector('.champ-organisme-externe');
      champ.hidden = sel.value !== '__externe__';
      if (sel.value !== '__externe__') champ.querySelector('input').value = '';
    });
  });

  $('#form-rattacher-compte').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const email = f.email.value.trim();
    const organismeExterne = f.organisme_id.value === '__externe__' ? f.organisme_externe.value.trim() : '';
    if (f.organisme_id.value === '__externe__' && !organismeExterne) {
      return toast("Indique le nom de l'organisme extérieur, ou choisis « — aucun — »", 'erreur');
    }
    try {
      const [resultat] = await rpc('rattacher_formateur_par_email', {
        p_email:              email,
        p_nom:                f.nom.value.trim() || null,
        p_prenom:             f.prenom.value.trim() || null,
        p_role:               f.role.value,
        p_organisme_id:       f.organisme_id.value === '__externe__' ? null : (f.organisme_id.value || null),
        p_organisme_externe:  organismeExterne || null,
      });
      toast(resultat.deja_existant
        ? `${email} était déjà rattaché à Habelec — rien n'a été modifié`
        : `${email} rattaché à Habelec`);
      f.reset();
      rendreComptes($('#contenu'));
    } catch (e) { erreurSupabase('Rattachement du compte', e); }
  });

  $('#form-creer-externe').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const email = f.email.value.trim();
    const organismeExterne = f.organisme_id.value === '__externe__' ? f.organisme_externe.value.trim() : '';
    if (f.organisme_id.value === '__externe__' && !organismeExterne) {
      return toast("Indique le nom de l'organisme extérieur, ou choisis « — aucun — »", 'erreur');
    }
    const bouton = f.querySelector('button');
    bouton.disabled = true;
    try {
      // Edge Function dédiée (2026-08-27) : seul endroit détenant la clé
      // service_role côté Habelec — jamais dans ce fichier JS.
      const { data, error } = await sb.functions.invoke('habelec-creer-formateur-externe', {
        body: {
          email,
          nom:               f.nom.value.trim(),
          prenom:            f.prenom.value.trim() || null,
          role:              f.role.value,
          organisme_id:      f.organisme_id.value === '__externe__' ? null : (f.organisme_id.value || null),
          organisme_externe: organismeExterne || null,
        },
      });
      if (error) throw new Error(data?.error || error.message);
      toast(data.deja_existant_ailleurs
        ? `${email} existait déjà dans l'Univers BFS — rattaché à Habelec sans nouvel email envoyé`
        : `Compte créé, email d'invitation envoyé à ${email}`);
      f.reset();
      rendreComptes($('#contenu'));
    } catch (e) {
      erreurSupabase('Création du formateur externe', e);
    } finally {
      bouton.disabled = false;
    }
  });
}

/* ---------------- widget de signature manuscrite ------------------- */
function widgetSignature(id, valeur) {
  return `<div class="signature" id="${id}">
    <canvas width="480" height="150" ${valeur ? `data-initial="${esc(valeur)}"` : ''}></canvas>
    <button type="button" class="lien" onclick="effacerSignature('${id}')">Effacer</button>
  </div>`;
}

function activerSignature(id) {
  const zone = document.getElementById(id);
  if (!zone) return;
  const c = zone.querySelector('canvas');
  const ctx = c.getContext('2d');
  ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#123';
  if (c.dataset.initial) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = c.dataset.initial;
  }
  let trace = false;
  const pos = e => {
    const r = c.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return [(p.clientX - r.left) * c.width / r.width, (p.clientY - r.top) * c.height / r.height];
  };
  const debut = e => { trace = true; ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); };
  const bouge = e => { if (!trace) return; ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); };
  const fin = () => { trace = false; };
  ['mousedown', 'touchstart'].forEach(ev => c.addEventListener(ev, debut));
  ['mousemove', 'touchmove'].forEach(ev => c.addEventListener(ev, bouge));
  ['mouseup', 'mouseleave', 'touchend'].forEach(ev => c.addEventListener(ev, fin));
}

function effacerSignature(id) {
  const c = document.querySelector('#' + id + ' canvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function lireSignature(id) {
  const c = document.querySelector('#' + id + ' canvas');
  if (!c) return null;
  // Canvas vierge => on ne stocke rien
  const vide = document.createElement('canvas');
  vide.width = c.width; vide.height = c.height;
  return c.toDataURL() === vide.toDataURL() ? null : c.toDataURL('image/png');
}

/* -------------- widget d'upload d'image (cachet organisme) ---------- */
// Distinct du widget de signature ci-dessus : un cachet est une image
// existante (photo/scan du tampon), pas un tracé à la souris — simple
// input file, converti en dataURL et prévisualisé (2026-08-27).
function widgetImage(id, valeur) {
  return `<div class="image-upload" id="${id}">
    <img class="apercu" src="${esc(valeur || '')}" style="${valeur ? '' : 'display:none'}"
      alt="Aperçu">
    <input type="file" accept="image/*">
    <button type="button" class="lien" onclick="effacerImage('${id}')">Effacer</button>
  </div>`;
}

function activerImage(id) {
  const zone = document.getElementById(id);
  if (!zone) return;
  const input = zone.querySelector('input[type=file]');
  const img = zone.querySelector('img.apercu');
  input.addEventListener('change', () => {
    const fichier = input.files[0];
    if (!fichier) return;
    if (!fichier.type.startsWith('image/')) {
      toast('Ce fichier n\'est pas une image (PNG ou JPEG attendu)', 'erreur');
      input.value = '';
      return;
    }
    const lecteur = new FileReader();
    lecteur.onload = () => { img.src = lecteur.result; img.style.display = ''; };
    lecteur.readAsDataURL(fichier);
  });
}

function effacerImage(id) {
  const zone = document.getElementById(id);
  const img = zone.querySelector('img.apercu');
  img.src = ''; img.style.display = 'none';
  zone.querySelector('input[type=file]').value = '';
}

function lireImage(id) {
  const img = document.querySelector('#' + id + ' img.apercu');
  if (!img || !img.src || img.style.display === 'none') return null;
  return img.src.startsWith('data:') ? img.src : null;
}

/* ============ 9 bis. Onglet Mots de passe (admin + secrétariat) ======
 * Demande de Jeremy (2026-09-09) : la secrétaire doit pouvoir débloquer un
 * formateur qui a oublié son mot de passe, sans passer par l'administrateur
 * ni par la console Supabase. Utilise l'API standard Supabase Auth
 * (resetPasswordForEmail) : envoie au formateur un email contenant un lien
 * pour choisir lui-même un nouveau mot de passe. Ne nécessite aucune clé
 * privilégiée (service_role) et ne montre jamais le mot de passe actuel —
 * personne, pas même l'admin, ne peut le consulter. La liste des comptes
 * vient directement de la table formateurs (policy « form_lecture », déjà
 * en place : tout compte autorisé peut voir les autres comptes de son
 * organisme), donc aucun changement de sécurité côté base n'était requis. */
async function rendreMotsDePasse(zone) {
  zone.innerHTML = '<p class="aide">Chargement…</p>';
  const { data, error } = await sb.from('formateurs')
    .select('id, nom, prenom, email, role')
    .order('nom');
  if (error) return erreurSupabase('Chargement des comptes', error);

  zone.innerHTML = `
    <div class="barre-actions"><h2>Mots de passe</h2></div>
    <p class="aide">Envoie à un formateur un email (via le service mail commun Univers BFS)
      contenant un lien pour choisir lui-même un nouveau mot de passe. Le mot de passe actuel
      n'est jamais affiché ni connu de personne — c'est la seule façon de le réinitialiser.</p>
    <table class="tableau">
      <thead><tr><th>Nom</th><th>Prénom</th><th>Email</th><th>Rôle</th><th></th></tr></thead>
      <tbody>
        ${(data || []).map(f => `
          <tr>
            <td>${esc(f.nom)}</td><td>${esc(f.prenom)}</td><td>${esc(f.email || '—')}</td>
            <td>${f.role === 'admin' ? 'Administrateur' : f.role === 'secretariat' ? 'Secrétariat' : 'Formateur'}</td>
            <td>${f.email
              ? `<button onclick="envoyerReinitMotDePasse('${esc(f.email)}', this)">🔑 Envoyer un lien de réinitialisation</button>`
              : '<span class="aide">Pas d\'email connu</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function envoyerReinitMotDePasse(email, btn) {
  if (!email) return;
  if (!confirmer(`Envoyer un email de réinitialisation de mot de passe à ${email} ?`)) return;
  btn.disabled = true;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw error;
    toast(`Email de réinitialisation envoyé à ${email}`);
  } catch (e) {
    erreurSupabase('Envoi du lien de réinitialisation', e);
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------- modale générique ------------------------ */
function ouvrirModale(titre, contenuHtml) {
  fermerModale();
  const d = document.createElement('div');
  d.className = 'modale-fond';
  d.id = 'modale';
  d.innerHTML = `<div class="modale">
    <div class="entete-modale"><h3>${esc(titre)}</h3>
      <button class="icone" onclick="fermerModale()" title="Fermer">✕</button></div>
    <div class="corps-modale">${contenuHtml}</div></div>`;
  d.addEventListener('click', e => { if (e.target === d) fermerModale(); });
  document.body.appendChild(d);
}
function fermerModale() { document.getElementById('modale')?.remove(); }
