// =========================================================================
// Pointage BFS — PT_app.js
// =========================================================================
// Métier : écran de connexion, navigation par onglets, bouton intelligent
// de pointage, saisie d'activité. Scinder par domaine (PT_planning.js,
// PT_export.js...) dès qu'un morceau devient gros et autonome.
// =========================================================================

const PT_TYPES_HORODATAGE = {
  arrivee: { suivant: 'pause_debut', label: 'Pointer le début de journée' },
  pause_debut: { suivant: 'pause_fin', label: 'Pointer le début de pause' },
  pause_fin: { suivant: 'depart', label: 'Pointer la fin de pause' },
  depart: { suivant: null, label: 'Pointer la fin de journée' },
};

// Trajet entre deux lieux de travail (ex. BFS 85 <-> BFS 29) : indépendant
// de la séquence arrivée/pause/départ, peut se pointer à tout moment de la
// journée (matin, après-midi, soir après formation) et même un jour non
// ouvré (ex. dimanche). Assimilé à du temps de travail effectif par la CCN.
const PT_TYPES_TRAJET = {
  trajet_inter_site_debut: { suivant: 'trajet_inter_site_fin', label: 'Pointer le départ (trajet inter-agence)' },
  trajet_inter_site_fin: { suivant: 'trajet_inter_site_debut', label: 'Pointer l\'arrivée (trajet inter-agence)' },
};

const PT_LABELS_HORODATAGE = {
  arrivee: 'Arrivée',
  pause_debut: 'Début de pause',
  pause_fin: 'Fin de pause',
  depart: 'Départ',
  trajet_inter_site_debut: 'Départ trajet inter-agence',
  trajet_inter_site_fin: 'Arrivée trajet inter-agence',
};

const PT_LABELS_ACTIVITE = {
  formation: 'Formation',
  controle: 'Contrôle',
  travaux_divers: 'Travaux divers',
  developpement_pedagogique: 'Développement pédagogique',
  autre: 'Autre',
};

function ptEchapperHtml(texte) {
  const div = document.createElement('div');
  div.textContent = texte ?? '';
  return div.innerHTML;
}

// --- Point d'entrée ---------------------------------------------------
async function ptInit() {
  const conteneur = document.getElementById('app');
  try {
    await ptChargerSession();
    if (!S.session) {
      ptRenderLogin(conteneur);
      return;
    }
    await Promise.all([ptChargerProfil(), ptChargerParametres()]);
    if (!S.profil) {
      conteneur.innerHTML = `
        <div class="pt-message-erreur">
          Ton compte est connecté mais n'a pas encore de profil Pointage BFS.
          Contacte un administrateur pour qu'il te crée un accès.
          <button id="pt-btn-deconnexion" class="pt-btn pt-btn-secondaire">Se déconnecter</button>
        </div>`;
      document.getElementById('pt-btn-deconnexion').addEventListener('click', async () => {
        await ptDeconnecter();
        ptInit();
      });
      return;
    }
    ptRenderApp(conteneur);
  } catch (erreur) {
    PT_DEBUG.log(`Échec de l'initialisation : ${erreur.message}`, true);
    conteneur.innerHTML = `<div class="pt-message-erreur">Une erreur est survenue au chargement. Vérifie ta connexion et recharge la page.</div>`;
  }
}

// --- Écran de connexion -------------------------------------------------
function ptRenderLogin(conteneur) {
  conteneur.innerHTML = `
    <div class="pt-login">
      <h1>Pointage BFS</h1>
      <form id="pt-form-login">
        <label>Email
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label>Mot de passe
          <input type="password" name="motDePasse" required autocomplete="current-password" />
        </label>
        <button type="submit" class="pt-btn">Se connecter</button>
        <p id="pt-login-erreur" class="pt-message-erreur" hidden></p>
      </form>
    </div>`;

  document.getElementById('pt-form-login').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const erreurEl = document.getElementById('pt-login-erreur');
    erreurEl.hidden = true;
    try {
      await ptConnecter(formulaire.get('email'), formulaire.get('motDePasse'));
      ptInit();
    } catch (erreur) {
      erreurEl.textContent = 'Connexion impossible : vérifie l\'email et le mot de passe.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec de connexion : ${erreur.message}`, true);
    }
  });
}

// --- Coquille applicative : navigation + contenu de l'onglet actif -----
function ptRenderApp(conteneur) {
  const onglets = PT_ONGLETS_PAR_ROLE[S.profil.role] || [];
  if (!onglets.find((o) => o.id === S.ongletActif)) S.ongletActif = onglets[0]?.id;

  conteneur.innerHTML = `
    <header class="pt-header">
      <div class="pt-header-titre">Pointage BFS</div>
      <div class="pt-header-utilisateur">
        ${ptEchapperHtml(S.profil.prenom)} ${ptEchapperHtml(S.profil.nom)}
        <button id="pt-btn-deconnexion" class="pt-btn pt-btn-secondaire pt-btn-petit">Déconnexion</button>
      </div>
    </header>
    <nav class="pt-nav">
      ${onglets.map((o) => `<button class="pt-nav-item ${o.id === S.ongletActif ? 'pt-nav-item-actif' : ''}" data-onglet="${o.id}">${o.label}</button>`).join('')}
    </nav>
    <main id="pt-contenu" class="pt-contenu"></main>`;

  document.getElementById('pt-btn-deconnexion').addEventListener('click', async () => {
    await ptDeconnecter();
    ptInit();
  });

  document.querySelectorAll('.pt-nav-item').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      S.ongletActif = bouton.dataset.onglet;
      ptRenderApp(conteneur);
    });
  });

  const rendus = { pointage: ptRenderOngletPointage, admin: ptRenderOngletPlaceholder, secretariat: ptRenderOngletPlaceholder };
  (rendus[S.ongletActif] || ptRenderOngletPlaceholder)(document.getElementById('pt-contenu'));
}

function ptRenderOngletPlaceholder(conteneur) {
  conteneur.innerHTML = `<p>Écran à venir.</p>`;
}

// --- Onglet Pointage : bouton intelligent + activités --------------------
async function ptRenderOngletPointage(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;
  await Promise.all([
    ptChargerHorodatagesJour(),
    ptChargerActivitesJour(),
    ptChargerCentres(),
    ptChargerDeplacementsRecents(),
  ]);

  const horodatagesPrincipaux = S.horodatagesJour.filter((h) => h.type_horodatage in PT_TYPES_HORODATAGE);
  const horodatagesTrajet = S.horodatagesJour.filter((h) => h.type_horodatage in PT_TYPES_TRAJET);

  const prochaine = ptProchaineAction(horodatagesPrincipaux);
  const alerte = ptVerifierAlertePause(horodatagesPrincipaux);
  const prochainTrajet = ptProchaineActionTrajet(horodatagesTrajet);

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Aujourd'hui — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>

      ${alerte ? `<p class="pt-alerte">${ptEchapperHtml(alerte)}</p>` : ''}

      <ul class="pt-liste-horodatages">
        ${S.horodatagesJour.map((h) => `<li>${ptFormatHeure(h.moment)} — ${PT_LABELS_HORODATAGE[h.type_horodatage] || ptEchapperHtml(h.type_horodatage)}${h.saisi_a_posteriori ? ' <span class="pt-badge">saisi à la main</span>' : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucun pointage pour l\'instant.</li>'}
      </ul>

      ${prochaine
        ? `<button id="pt-btn-pointer" class="pt-btn pt-btn-grand">${ptEchapperHtml(prochaine.label)}</button>`
        : `<p class="pt-info">Journée déjà bouclée. Utilise la saisie manuelle ci-dessous si besoin d'une correction.</p>`}

      <button id="pt-btn-saisie-manuelle" class="pt-btn pt-btn-secondaire pt-btn-petit">Saisir un horodatage manquant</button>
      <form id="pt-form-manuel" hidden class="pt-form-manuel">
        <label>Type
          <select name="type">
            <option value="arrivee">Arrivée</option>
            <option value="pause_debut">Début de pause</option>
            <option value="pause_fin">Fin de pause</option>
            <option value="depart">Départ</option>
            <option value="trajet_inter_site_debut">Départ trajet inter-agence</option>
            <option value="trajet_inter_site_fin">Arrivée trajet inter-agence</option>
          </select>
        </label>
        <label>Heure
          <input type="time" name="heure" required />
        </label>
        <button type="submit" class="pt-btn pt-btn-petit">Valider</button>
      </form>
    </section>

    <section class="pt-carte">
      <h2>Trajet inter-agence</h2>
      <p class="pt-info">Trajet entre deux lieux de travail (ex. BFS 85 ↔ BFS 29) : peut se pointer à tout moment, y compris un jour non ouvré. Compte comme temps de travail effectif (règle CCN).</p>
      <button id="pt-btn-trajet" class="pt-btn pt-btn-grand">${ptEchapperHtml(prochainTrajet.label)}</button>
    </section>

    <section class="pt-carte">
      <h2>Activité du jour</h2>
      <ul class="pt-liste-activites">
        ${S.activitesJour.map((a) => `<li><strong>${PT_LABELS_ACTIVITE[a.type_activite] || a.type_activite}</strong>${a.centre_code ? ` — ${ptEchapperHtml(ptLibelleCentre(a.centre_code))}` : ''}${a.heure_debut ? ` — ${a.heure_debut.slice(0, 5)}` : ''}${a.heure_fin ? `–${a.heure_fin.slice(0, 5)}` : ''}${a.commentaire ? ` — ${ptEchapperHtml(a.commentaire)}` : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucune activité renseignée.</li>'}
      </ul>
      <form id="pt-form-activite" class="pt-form-activite">
        <label>Type
          <select name="type_activite">
            ${Object.entries(PT_LABELS_ACTIVITE).map(([valeur, libelle]) => `<option value="${valeur}">${libelle}</option>`).join('')}
          </select>
        </label>
        <label>Centre
          <select name="centre_code">
            <option value="">—</option>
            ${S.centres.map((c) => `<option value="${c.code}">${ptEchapperHtml(c.libelle)}</option>`).join('')}
          </select>
        </label>
        <label>Début <input type="time" name="heure_debut" /></label>
        <label>Fin <input type="time" name="heure_fin" /></label>
        <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
        <button type="submit" class="pt-btn pt-btn-petit">Ajouter l'activité</button>
      </form>
    </section>

    <section class="pt-carte">
      <h2>Nuit en déplacement</h2>
      <p class="pt-info">À utiliser le soir, quand tu es en déplacement avec nuitée (ex. départ dimanche pour la Vendée).</p>
      <label>Destination <input type="text" id="pt-nuitee-commentaire" maxlength="100" placeholder="Ex. Vendée" /></label>
      <div class="pt-nuitee-boutons">
        <button id="pt-btn-nuitee-avec" class="pt-btn pt-btn-petit">+ Nuitée avec petit-déj</button>
        <button id="pt-btn-nuitee-sans" class="pt-btn pt-btn-secondaire pt-btn-petit">+ Nuitée sans petit-déj</button>
      </div>
      <ul class="pt-liste-activites">
        ${S.deplacementsRecents.map((d) => `<li>${d.date_aller}${d.nuitees_avec_petit_dej ? ` — ${d.nuitees_avec_petit_dej} nuitée(s) avec petit-déj` : ''}${d.nuitees_sans_petit_dej ? ` — ${d.nuitees_sans_petit_dej} nuitée(s) sans petit-déj` : ''}${d.commentaire ? ` — ${ptEchapperHtml(d.commentaire)}` : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucune nuitée récente.</li>'}
      </ul>
    </section>`;

  const boutonPointer = document.getElementById('pt-btn-pointer');
  if (boutonPointer) {
    boutonPointer.addEventListener('click', async () => {
      boutonPointer.disabled = true;
      try {
        await ptEnregistrerHorodatage(prochaine.type);
        ptRenderOngletPointage(conteneur);
      } catch (erreur) {
        PT_DEBUG.log(`Échec de l'enregistrement du pointage : ${erreur.message}`, true);
        boutonPointer.disabled = false;
      }
    });
  }

  document.getElementById('pt-btn-trajet').addEventListener('click', async (evenement) => {
    evenement.target.disabled = true;
    try {
      await ptEnregistrerHorodatage(prochainTrajet.type);
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de l'enregistrement du trajet inter-agence : ${erreur.message}`, true);
      evenement.target.disabled = false;
    }
  });

  document.getElementById('pt-btn-nuitee-avec').addEventListener('click', async () => {
    try {
      await ptAjouterNuitee(true, document.getElementById('pt-nuitee-commentaire').value);
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de l'ajout de nuitée : ${erreur.message}`, true);
    }
  });

  document.getElementById('pt-btn-nuitee-sans').addEventListener('click', async () => {
    try {
      await ptAjouterNuitee(false, document.getElementById('pt-nuitee-commentaire').value);
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de l'ajout de nuitée : ${erreur.message}`, true);
    }
  });

  document.getElementById('pt-btn-saisie-manuelle').addEventListener('click', () => {
    document.getElementById('pt-form-manuel').hidden = false;
  });

  document.getElementById('pt-form-manuel').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const [heures, minutes] = formulaire.get('heure').split(':');
    const moment = new Date();
    moment.setHours(Number(heures), Number(minutes), 0, 0);
    try {
      await ptEnregistrerHorodatage(formulaire.get('type'), { manuel: true, moment });
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de la saisie manuelle : ${erreur.message}`, true);
    }
  });

  document.getElementById('pt-form-activite').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    try {
      await ptAjouterActivite({
        type_activite: formulaire.get('type_activite'),
        centre_code: formulaire.get('centre_code') || null,
        heure_debut: formulaire.get('heure_debut') || null,
        heure_fin: formulaire.get('heure_fin') || null,
        commentaire: formulaire.get('commentaire') || null,
      });
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de l'ajout d'activité : ${erreur.message}`, true);
    }
  });
}

function ptLibelleCentre(code) {
  return S.centres.find((c) => c.code === code)?.libelle || code;
}

// --- Logique du bouton intelligent -----------------------------------
function ptProchaineAction(horodatages) {
  if (horodatages.length === 0) return { type: 'arrivee', label: PT_TYPES_HORODATAGE.arrivee.label };
  const dernier = horodatages[horodatages.length - 1];
  const config = PT_TYPES_HORODATAGE[dernier.type_horodatage];
  if (!config || !config.suivant) return null;
  return { type: config.suivant, label: PT_TYPES_HORODATAGE[config.suivant].label };
}

// Trajet inter-agence : toggle indépendant de la séquence principale,
// basé uniquement sur le dernier événement de trajet du jour.
function ptProchaineActionTrajet(horodatagesTrajet) {
  if (horodatagesTrajet.length === 0) {
    return { type: 'trajet_inter_site_debut', label: PT_TYPES_TRAJET.trajet_inter_site_debut.label };
  }
  const dernier = horodatagesTrajet[horodatagesTrajet.length - 1];
  const config = PT_TYPES_TRAJET[dernier.type_horodatage];
  return { type: config.suivant, label: PT_TYPES_TRAJET[config.suivant].label };
}

// Règle CCN IDCC 1516 (accord RTT du 6 décembre 1999, titre II art. 2) :
// aucune période de travail effectif ne peut excéder 6h consécutives.
function ptVerifierAlertePause(horodatages) {
  const dernierDepartPause = [...horodatages].reverse().find((h) => h.type_horodatage === 'pause_fin');
  const arrivee = horodatages.find((h) => h.type_horodatage === 'arrivee');
  const depart = horodatages.find((h) => h.type_horodatage === 'depart');
  if (!arrivee || depart) return null;

  const debutTrancheEnCours = dernierDepartPause ? new Date(dernierDepartPause.moment) : new Date(arrivee.moment);
  const heuresEcoulees = (Date.now() - debutTrancheEnCours.getTime()) / 3_600_000;
  if (heuresEcoulees > 6) {
    return `Plus de 6h sans pause détectées (règle conventionnelle). Pense à pointer une pause.`;
  }
  return null;
}

async function ptEnregistrerHorodatage(type, options = {}) {
  const { manuel = false, moment = new Date() } = options;
  const geoloc = manuel ? { latitude: null, longitude: null } : await ptCapturerGeoloc();
  const { error } = await ptSupabase.from('horodatages').insert({
    technicien_id: S.session.user.id,
    date: ptDateDuJour(),
    moment: moment.toISOString(),
    type_horodatage: type,
    source: manuel ? 'manuel' : 'bouton',
    saisi_a_posteriori: manuel,
    latitude: geoloc.latitude,
    longitude: geoloc.longitude,
  });
  if (error) throw error;
}

// --- Chargement des données du jour ------------------------------------
async function ptChargerHorodatagesJour() {
  const { data, error } = await ptSupabase
    .from('horodatages')
    .select('*')
    .eq('technicien_id', S.session.user.id)
    .eq('date', ptDateDuJour())
    .order('moment', { ascending: true });
  if (error) throw error;
  S.horodatagesJour = data;
}

async function ptChargerActivitesJour() {
  const { data, error } = await ptSupabase
    .from('activites')
    .select('*')
    .eq('technicien_id', S.session.user.id)
    .eq('date', ptDateDuJour())
    .order('heure_debut', { ascending: true });
  if (error) throw error;
  S.activitesJour = data;
}

async function ptAjouterActivite(champs) {
  const { error } = await ptSupabase.from('activites').insert({
    technicien_id: S.session.user.id,
    date: ptDateDuJour(),
    ...champs,
  });
  if (error) throw error;
}

// --- Nuitées en déplacement ---------------------------------------------
// Chaque clic crée une ligne "deplacement" d'une nuit (date_aller =
// date_retour = aujourd'hui). Pour un déplacement de plusieurs nuits,
// plusieurs lignes s'accumulent — l'admin/secrétariat pourra les
// consolider plus tard si besoin (backlog).
async function ptChargerDeplacementsRecents() {
  const trenteJoursAvant = new Date();
  trenteJoursAvant.setDate(trenteJoursAvant.getDate() - 30);
  const { data, error } = await ptSupabase
    .from('deplacements')
    .select('*')
    .eq('technicien_id', S.session.user.id)
    .gte('date_aller', trenteJoursAvant.toLocaleDateString('sv-SE'))
    .order('date_aller', { ascending: false })
    .limit(10);
  if (error) throw error;
  S.deplacementsRecents = data;
}

async function ptAjouterNuitee(avecPetitDej, commentaire) {
  const aujourdHui = ptDateDuJour();
  const { error } = await ptSupabase.from('deplacements').insert({
    technicien_id: S.session.user.id,
    date_aller: aujourdHui,
    date_retour: aujourdHui,
    nuitees_avec_petit_dej: avecPetitDej ? 1 : 0,
    nuitees_sans_petit_dej: avecPetitDej ? 0 : 1,
    commentaire: commentaire || null,
  });
  if (error) throw error;
}

document.addEventListener('DOMContentLoaded', ptInit);
