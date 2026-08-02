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
  await Promise.all([ptChargerHorodatagesJour(), ptChargerActivitesJour()]);

  const prochaine = ptProchaineAction(S.horodatagesJour);
  const alerte = ptVerifierAlertePause(S.horodatagesJour);

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Aujourd'hui — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>

      ${alerte ? `<p class="pt-alerte">${ptEchapperHtml(alerte)}</p>` : ''}

      <ul class="pt-liste-horodatages">
        ${S.horodatagesJour.map((h) => `<li>${ptFormatHeure(h.moment)} — ${ptEchapperHtml(h.type_horodatage)}${h.saisi_a_posteriori ? ' <span class="pt-badge">saisi à la main</span>' : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucun pointage pour l\'instant.</li>'}
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
          </select>
        </label>
        <label>Heure
          <input type="time" name="heure" required />
        </label>
        <button type="submit" class="pt-btn pt-btn-petit">Valider</button>
      </form>
    </section>

    <section class="pt-carte">
      <h2>Activité du jour</h2>
      <ul class="pt-liste-activites">
        ${S.activitesJour.map((a) => `<li><strong>${PT_LABELS_ACTIVITE[a.type_activite] || a.type_activite}</strong>${a.heure_debut ? ` — ${a.heure_debut.slice(0, 5)}` : ''}${a.heure_fin ? `–${a.heure_fin.slice(0, 5)}` : ''}${a.commentaire ? ` — ${ptEchapperHtml(a.commentaire)}` : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucune activité renseignée.</li>'}
      </ul>
      <form id="pt-form-activite" class="pt-form-activite">
        <label>Type
          <select name="type_activite">
            ${Object.entries(PT_LABELS_ACTIVITE).map(([valeur, libelle]) => `<option value="${valeur}">${libelle}</option>`).join('')}
          </select>
        </label>
        <label>Début <input type="time" name="heure_debut" /></label>
        <label>Fin <input type="time" name="heure_fin" /></label>
        <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
        <button type="submit" class="pt-btn pt-btn-petit">Ajouter l'activité</button>
      </form>
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

// --- Logique du bouton intelligent -----------------------------------
function ptProchaineAction(horodatages) {
  if (horodatages.length === 0) return { type: 'arrivee', label: PT_TYPES_HORODATAGE.arrivee.label };
  const dernier = horodatages[horodatages.length - 1];
  const config = PT_TYPES_HORODATAGE[dernier.type_horodatage];
  if (!config || !config.suivant) return null;
  return { type: config.suivant, label: PT_TYPES_HORODATAGE[config.suivant].label };
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

document.addEventListener('DOMContentLoaded', ptInit);
