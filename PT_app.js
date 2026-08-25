// =========================================================================
// Pointage BFS — PT_app.js
// =========================================================================
// Métier : écran de connexion, navigation par onglets, bouton intelligent
// de pointage, saisie d'activité. Scinder par domaine (PT_planning.js,
// PT_export.js...) dès qu'un morceau devient gros et autonome.
// =========================================================================

const PT_TYPES_HORODATAGE = {
  arrivee: { suivant: 'pause_debut', label: 'Pointer le début de journée' },
  pause_debut: { suivant: 'pause_fin', label: 'Pointer le début de la pause méridienne' },
  pause_fin: { suivant: 'depart', label: 'Pointer la fin de la pause méridienne' },
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
  pause_debut: 'Début de pause méridienne',
  pause_fin: 'Fin de pause méridienne',
  depart: 'Départ',
  trajet_inter_site_debut: 'Départ trajet inter-agence',
  trajet_inter_site_fin: 'Arrivée trajet inter-agence',
};

// Catégories alignées sur la CCN IDCC 1516 (accord RTT 1999, art. 10.3) :
// Acte de Formation (AF), Préparation-Recherche (PR), Activités Connexes
// (AC), + Contrôle et Travaux divers propres à BFS. "acte_formation"
// impose ensuite de choisir une formation précise (table formations).
const PT_LABELS_ACTIVITE = {
  acte_formation: 'Action de formation',
  controle: 'Contrôle',
  preparation_recherche: 'Préparation / administratif',
  activite_connexe: 'Activité connexe',
  travaux_divers: 'Travaux divers',
  autre: 'Autre',
};

// Ordre d'affichage de la ventilation horaire : les trois catégories du
// Titre IV de la CCN d'abord (AF, PR, AC), puis les catégories propres à BFS.
const PT_ORDRE_CATEGORIES = [
  'acte_formation', 'preparation_recherche', 'activite_connexe',
  'controle', 'travaux_divers', 'autre',
];

// Plafonds du régime des formateurs D et E (CCN IDCC 1516, accord RTT du
// 6 décembre 1999, Titre IV). Valeurs imposées par la convention collective,
// donc constantes et non modifiables dans l'écran Paramètres — seul
// l'assujettissement d'un salarié l'est (profils.regime_formateur_de,
// Administration > Profils).
const PT_REGIME_DE = {
  ratioAfMax: 0.72,        // AF <= 72 % de (AF + PR)
  plafondAfAnnuel: 1120,   // heures d'acte de formation par an
  baseAnnuelle: 1565,      // heures annuelles de référence (1 600 h en régime général)
  moyenneHebdoAf: 25.2,    // moyenne hebdomadaire d'acte de formation
};

// Règle BFS (Jeremy, 2026-08-25) : un déplacement va au maximum du dimanche
// après-midi au vendredi soir. Un séjour ne doit donc jamais dépasser cinq
// nuits (dimanche, lundi, mardi, mercredi, jeudi) ni comporter de nuit de
// samedi. Un séjour qui déborde signale presque toujours un retour non
// pointé — et il gonfle silencieusement les jours de déplacement et les
// tickets resto du récap RH, d'où l'alerte.
const PT_DEPLACEMENT_MAX_NUITS = 5;

function ptEchapperHtml(texte) {
  const div = document.createElement('div');
  div.textContent = texte ?? '';
  return div.innerHTML;
}

// --- Widget de signature manuscrite (canvas, pointer events couvrent
// souris et tactile) — utilisé pour signer la demande de congé à l'envoi,
// comme sur le formulaire papier BFS. Retourne une petite API plutôt que de
// stocker l'état sur l'élément DOM directement.
function ptInitialiserSignature(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#080808';
  let dessineEnCours = false;
  let aDessine = false;

  const position = (evenement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (evenement.clientX - rect.left) * (canvas.width / rect.width),
      y: (evenement.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  canvas.addEventListener('pointerdown', (evenement) => {
    dessineEnCours = true;
    aDessine = true;
    const p = position(evenement);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(evenement.pointerId);
  });
  canvas.addEventListener('pointermove', (evenement) => {
    if (!dessineEnCours) return;
    const p = position(evenement);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const arreterDeDessiner = () => { dessineEnCours = false; };
  canvas.addEventListener('pointerup', arreterDeDessiner);
  canvas.addEventListener('pointercancel', arreterDeDessiner);
  canvas.addEventListener('pointerleave', arreterDeDessiner);

  return {
    estVide: () => !aDessine,
    effacer: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); aDessine = false; },
    dataUrl: () => canvas.toDataURL('image/png'),
  };
}

// --- Export PDF d'une demande de congé (reprend le formulaire papier BFS :
// identité, type, dates, statut/décision, signature). Utilisé côté
// technicien (sa propre demande) et côté admin/secrétariat (nomPrenom
// fourni explicitement car la ligne vient d'une jointure différente).
function ptExporterCongePdf(conge, nomPrenom) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Demande de congé — BFS', 14, 18);
  doc.setFontSize(11);
  let y = 32;
  const ligne = (label, valeur) => { doc.text(`${label} : ${valeur}`, 14, y); y += 8; };
  ligne('Nom', nomPrenom);
  ligne('Type de congé', PT_LABELS_CONGE[conge.type_conge] || conge.type_conge);
  ligne('Du', conge.date_debut);
  ligne('Au', conge.date_fin);
  if (conge.commentaire) ligne('Commentaire', conge.commentaire);
  const statut = PT_LABELS_STATUT_CONGE[conge.statut] || PT_LABELS_STATUT_CONGE.en_attente;
  ligne('Statut', statut.label);
  if (conge.date_decision) ligne('Décision le', new Date(conge.date_decision).toLocaleDateString('fr-FR'));
  y += 6;
  doc.text('Signature du technicien :', 14, y);
  if (conge.signature_technicien) {
    doc.addImage(conge.signature_technicien, 'PNG', 14, y + 4, 70, 26);
  } else {
    doc.text('(non signée)', 14, y + 10);
  }
  doc.save(`conge_${conge.date_debut}_${conge.type_conge}.pdf`);
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

  const rendus = {
    pointage: ptRenderOngletPointage,
    suivi: ptRenderOngletSuivi,
    admin: ptRenderOngletAdmin,
    secretariat: ptRenderOngletSecretariat,
  };
  (rendus[S.ongletActif] || ptRenderOngletPlaceholder)(document.getElementById('pt-contenu'));
}

function ptRenderOngletPlaceholder(conteneur) {
  conteneur.innerHTML = `<p>Écran à venir.</p>`;
}

// --- Onglet Suivi : historique jour par jour + récap mensuel/annuel ------
async function ptRenderOngletSuivi(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;

  const vues = [
    { id: 'jour', label: 'Jour par jour' },
    { id: 'recap', label: 'Récap mensuel' },
    { id: 'deplacements', label: 'Déplacements' },
    { id: 'conges', label: 'Congés' },
    { id: 'frais', label: 'Frais' },
  ];

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Suivi de mes pointages</h2>
      <div class="pt-suivi-onglets">
        ${vues.map((v) => `<button class="pt-btn ${S.suiviVue === v.id ? '' : 'pt-btn-secondaire'} pt-btn-petit" data-vue="${v.id}">${v.label}</button>`).join('')}
      </div>
      <div id="pt-suivi-contenu"></div>
    </section>`;

  document.querySelectorAll('.pt-suivi-onglets button').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      S.suiviVue = bouton.dataset.vue;
      ptRenderOngletSuivi(conteneur);
    });
  });

  const zoneContenu = document.getElementById('pt-suivi-contenu');
  const rendusSuivi = {
    recap: ptRenderRecapAnnuel,
    deplacements: ptRenderDeplacementsRecap,
    conges: ptRenderCongesSuivi,
    frais: ptRenderFraisSuivi,
  };
  await (rendusSuivi[S.suiviVue] || ptRenderSuiviJourParJour)(zoneContenu, conteneur);
}

async function ptRenderSuiviJourParJour(zoneContenu, conteneur) {
  // ptChargerCentres/ptChargerFormations nécessaires pour résoudre les
  // libellés (ptLibelleFormation/ptLibelleCentre) dans le détail matin/
  // après-midi ci-dessous — pas systématiquement chargés si on arrive
  // directement sur l'onglet Suivi sans passer par Pointage avant.
  await Promise.all([ptChargerHistoriqueSuivi(S.suiviNbJours), ptChargerCentres(), ptChargerFormations()]);
  const jours = ptRegrouperParJour(S.suiviHorodatages, S.suiviActivites, S.suiviNbJours);

  zoneContenu.innerHTML = `
    <p class="pt-info">Derniers ${S.suiviNbJours} jours, du plus récent au plus ancien. Vérifie qu'aucune journée n'est incomplète.</p>
    <ul class="pt-liste-suivi">
      ${jours.map((j) => `
        <li class="pt-jour-suivi">
          <div class="pt-jour-suivi-entete">
            <strong>${ptFormatDateCourte(j.date)}</strong>
            ${j.horodatages.length === 0
              ? '<span class="pt-badge">aucun pointage</span>'
              : j.complet
                ? `<span class="pt-badge pt-badge-ok">${j.heures.toFixed(2).replace('.', ',')} h</span>`
                : '<span class="pt-badge pt-badge-alerte">incomplet</span>'}
          </div>
          ${j.horodatages.length > 0
            ? `<div class="pt-jour-suivi-details">${j.horodatages.map((h) => `${ptFormatHeure(h.moment)} ${PT_LABELS_HORODATAGE[h.type_horodatage] || h.type_horodatage}`).join(' · ')}</div>`
            : ''}
          ${ptRenderActivitesMatinApresMidi(j)}
        </li>`).join('') || '<li class="pt-liste-vide">Aucune donnée sur cette période.</li>'}
    </ul>
    <button id="pt-btn-suivi-plus" class="pt-btn pt-btn-secondaire pt-btn-petit">Voir plus de jours</button>`;

  document.getElementById('pt-btn-suivi-plus').addEventListener('click', () => {
    S.suiviNbJours += 14;
    ptRenderSuiviJourParJour(zoneContenu, conteneur);
  });
}

// Sépare les activités du jour en Matin / Après-midi (demande Jeremy,
// 2026-08-06, section 31 du mémoire) — seuil = heure de début de la pause
// méridienne pointée ce jour-là si elle existe, sinon 13h00 par défaut.
// Chaque activité affichée avec son heure de début quand elle est connue
// (renseignée automatiquement par le formulaire fusionné, section 28/29 —
// les activités plus anciennes sans heure_debut apparaissent sans horaire).
function ptRenderActivitesMatinApresMidi(jour) {
  if (jour.activites.length === 0) return '';

  const pauseDebut = jour.horodatages.find((h) => h.type_horodatage === 'pause_debut');
  const seuil = pauseDebut ? ptFormatHeure(pauseDebut.moment) : '13:00';

  const activitesTriees = [...jour.activites].sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || ''));
  const matin = activitesTriees.filter((a) => !a.heure_debut || a.heure_debut.slice(0, 5) <= seuil);
  const apresMidi = activitesTriees.filter((a) => a.heure_debut && a.heure_debut.slice(0, 5) > seuil);

  const ligneActivite = (a) => {
    const heure = a.heure_debut
      ? `${a.heure_debut.slice(0, 5)}${a.heure_fin ? `-${a.heure_fin.slice(0, 5)}` : ''} — `
      : '';
    const categorie = PT_LABELS_ACTIVITE[a.type_activite] || a.type_activite;
    const detail = a.formation_code
      ? ` (${ptEchapperHtml(ptLibelleFormation(a.formation_code))})`
      : a.centre_code ? ` (${ptEchapperHtml(ptLibelleCentre(a.centre_code))})` : '';
    // Tâches saisies à la clôture du bloc (section 35 du mémoire).
    const taches = (a.details && a.details.length)
      ? ` : ${a.details.map((t) => ptEchapperHtml(t)).join(', ')}`
      : '';
    return `${heure}${categorie}${detail}${taches}`;
  };

  return `
    <div class="pt-jour-suivi-details">
      ${matin.length > 0 ? `<div><strong>Matin :</strong> ${matin.map(ligneActivite).join(' · ')}</div>` : ''}
      ${apresMidi.length > 0 ? `<div><strong>Après-midi :</strong> ${apresMidi.map(ligneActivite).join(' · ')}</div>` : ''}
    </div>`;
}

const PT_LABELS_MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// --- Ventilation CCN : bloc HTML partagé par le récap du salarié (onglet
// Suivi) et le récap RH admin — même tableau, mêmes chiffres, une seule
// implémentation. `regimeActif` = profils.regime_formateur_de du salarié
// concerné : il conditionne uniquement l'ajout du bloc de plafonds.
function ptFormatHeures(valeur) {
  return valeur.toFixed(2).replace('.', ',');
}

function ptDiversMois(m) {
  return (m.heuresParCategorie.controle || 0)
    + (m.heuresParCategorie.travaux_divers || 0)
    + (m.heuresParCategorie.autre || 0);
}

function ptRenderVentilationCcnHtml(recap, regimeActif, annee) {
  const ligne = (m, cellule) => `
    <tr>
      <${cellule}>${m.label}</${cellule}>
      <${cellule}>${ptFormatHeures(m.heuresParCategorie.acte_formation || 0)}</${cellule}>
      <${cellule}>${ptFormatHeures(m.heuresParCategorie.preparation_recherche || 0)}</${cellule}>
      <${cellule}>${ptFormatHeures(m.heuresParCategorie.activite_connexe || 0)}</${cellule}>
      <${cellule}>${ptFormatHeures(ptDiversMois(m))}</${cellule}>
      <${cellule}>${ptFormatHeures(m.heuresNonVentilees)}</${cellule}>
    </tr>`;

  const tableau = `
    <h3 class="pt-recap-mois-titre">Ventilation par catégorie (année ${annee})</h3>
    <p class="pt-info">Catégories de la CCN IDCC 1516 : AF = action de formation, PR = préparation / administratif, AC = activité connexe. « Divers » regroupe contrôle, travaux divers et autre. « Non ventilé » = heures pointées qu'aucune activité datée ne couvre — à réduire en saisissant systématiquement l'activité au moment du pointage.</p>
    <table class="pt-table-recap">
      <thead>
        <tr><th>Mois</th><th>AF</th><th>PR</th><th>AC</th><th>Divers</th><th>Non ventilé</th></tr>
      </thead>
      <tbody>${recap.mois.map((m) => ligne(m, 'td')).join('')}</tbody>
      <tfoot>${ligne({ ...recap.total, label: '<strong>Total</strong>' }, 'th')}</tfoot>
    </table>`;

  if (!regimeActif) return tableau;

  const d = recap.regimeDe;
  const badge = (depasse) => (depasse
    ? '<span class="pt-badge pt-badge-alerte">Dépassé</span>'
    : '<span class="pt-badge pt-badge-ok">Dans la limite</span>');

  return `${tableau}
    <h3 class="pt-recap-mois-titre">Régime formateur D/E — plafonds du Titre IV</h3>
    <p class="pt-info">Ce salarié est déclaré formateur D ou E (Administration &gt; Profils). Plafonds de l'accord RTT du 6 décembre 1999, Titre IV. Indicateurs calculés sur les heures ventilées de l'année affichée uniquement — un exercice incomplet donne donc des valeurs partielles.</p>
    <table class="pt-table-admin">
      <thead><tr><th>Indicateur</th><th>Constaté</th><th>Plafond</th><th>État</th></tr></thead>
      <tbody>
        <tr>
          <td>Part d'action de formation (AF / AF+PR)</td>
          <td>${d.ratioAf === null ? '—' : `${(d.ratioAf * 100).toFixed(1).replace('.', ',')} %`}</td>
          <td>${(PT_REGIME_DE.ratioAfMax * 100).toFixed(0)} %</td>
          <td>${d.ratioAf === null ? '—' : badge(d.ratioDepasse)}</td>
        </tr>
        <tr>
          <td>Heures d'action de formation</td>
          <td>${ptFormatHeures(d.af)} h</td>
          <td>${PT_REGIME_DE.plafondAfAnnuel} h/an</td>
          <td>${badge(d.plafondAfDepasse)}</td>
        </tr>
        <tr>
          <td>Total des heures travaillées</td>
          <td>${ptFormatHeures(recap.total.heures)} h</td>
          <td>${PT_REGIME_DE.baseAnnuelle} h/an</td>
          <td>${badge(d.baseAnnuelleDepassee)}</td>
        </tr>
      </tbody>
    </table>`;
}

async function ptRenderRecapAnnuel(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Calcul en cours…</p>`;
  const recap = await ptCalculerRecapAnnee(S.suiviAnnee);

  zoneContenu.innerHTML = `
    <div class="pt-suivi-annee-nav">
      <button id="pt-annee-prec" class="pt-btn pt-btn-secondaire pt-btn-petit">« ${S.suiviAnnee - 1}</button>
      <strong>${S.suiviAnnee}</strong>
      <button id="pt-annee-suiv" class="pt-btn pt-btn-secondaire pt-btn-petit">${S.suiviAnnee + 1} »</button>
    </div>
    <div class="pt-admin-actions">
      <button id="pt-btn-recap-pdf" class="pt-btn pt-btn-secondaire pt-btn-petit">Exporter PDF</button>
      <button id="pt-btn-recap-excel" class="pt-btn pt-btn-secondaire pt-btn-petit">Exporter Excel</button>
    </div>
    <p class="pt-info">RTT dispo = estimation (heures 35-39h/semaine accumulées, moins RTT pris convertis à 7h/jour), calculée depuis le 1er janvier de l'année affichée — sans solde reporté des années précédentes. Jours de déplacement = nuits chez un client + nuits inter-agence détectées.</p>
    <table class="pt-table-recap">
      <thead>
        <tr><th>Mois</th><th>Heures</th><th>Jours dépl.</th><th>RTT pris (j)</th><th>RTT dispo (h)</th></tr>
      </thead>
      <tbody>
        ${recap.mois.map((m) => `
          <tr>
            <td>${m.label}</td>
            <td>${m.heures.toFixed(2).replace('.', ',')}</td>
            <td>${m.joursDeplacement}</td>
            <td>${m.rttPrisJours}</td>
            <td>${m.rttDispoHeures.toFixed(2).replace('.', ',')}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>${recap.total.heures.toFixed(2).replace('.', ',')}</strong></td>
          <td><strong>${recap.total.joursDeplacement}</strong></td>
          <td><strong>${recap.total.rttPrisJours}</strong></td>
          <td><strong>${recap.total.rttDispoHeures.toFixed(2).replace('.', ',')}</strong></td>
        </tr>
      </tfoot>
    </table>
    ${ptRenderVentilationCcnHtml(recap, Boolean(S.profil.regime_formateur_de), S.suiviAnnee)}`;

  document.getElementById('pt-annee-prec').addEventListener('click', () => {
    S.suiviAnnee -= 1;
    ptRenderRecapAnnuel(zoneContenu, conteneur);
  });
  document.getElementById('pt-annee-suiv').addEventListener('click', () => {
    S.suiviAnnee += 1;
    ptRenderRecapAnnuel(zoneContenu, conteneur);
  });
  document.getElementById('pt-btn-recap-pdf').addEventListener('click', () => ptExporterRecapPdf(recap, S.suiviAnnee));
  document.getElementById('pt-btn-recap-excel').addEventListener('click', () => ptExporterRecapExcel(recap, S.suiviAnnee));
}

// --- Lignes de la ventilation CCN pour les exports (PDF et Excel, récap
// salarié et récap RH) — une seule source, comme pour l'affichage.
function ptLignesVentilationPdf(recap) {
  const ligne = (m) => [
    m.label,
    ptFormatHeures(m.heuresParCategorie.acte_formation || 0),
    ptFormatHeures(m.heuresParCategorie.preparation_recherche || 0),
    ptFormatHeures(m.heuresParCategorie.activite_connexe || 0),
    ptFormatHeures(ptDiversMois(m)),
    ptFormatHeures(m.heuresNonVentilees),
  ];
  return {
    body: recap.mois.map(ligne),
    foot: [ligne({ ...recap.total, label: 'Total' })],
  };
}

function ptLignesVentilationExcel(recap) {
  const ligne = (m) => ({
    Mois: m.label,
    'AF (action de formation)': Number((m.heuresParCategorie.acte_formation || 0).toFixed(2)),
    'PR (préparation)': Number((m.heuresParCategorie.preparation_recherche || 0).toFixed(2)),
    'AC (activité connexe)': Number((m.heuresParCategorie.activite_connexe || 0).toFixed(2)),
    Divers: Number(ptDiversMois(m).toFixed(2)),
    'Non ventilé': Number(m.heuresNonVentilees.toFixed(2)),
  });
  return [...recap.mois.map(ligne), ligne({ ...recap.total, label: 'Total' })];
}

function ptLignesRegimeDe(recap) {
  const d = recap.regimeDe;
  const etat = (depasse) => (depasse ? 'Dépassé' : 'Dans la limite');
  return [
    ["Part d'action de formation (AF / AF+PR)",
      d.ratioAf === null ? '—' : `${(d.ratioAf * 100).toFixed(1).replace('.', ',')} %`,
      `${(PT_REGIME_DE.ratioAfMax * 100).toFixed(0)} %`,
      d.ratioAf === null ? '—' : etat(d.ratioDepasse)],
    ["Heures d'action de formation",
      `${ptFormatHeures(d.af)} h`,
      `${PT_REGIME_DE.plafondAfAnnuel} h/an`,
      etat(d.plafondAfDepasse)],
    ['Total des heures travaillées',
      `${ptFormatHeures(recap.total.heures)} h`,
      `${PT_REGIME_DE.baseAnnuelle} h/an`,
      etat(d.baseAnnuelleDepassee)],
  ];
}

// Ajoute au document PDF la ventilation CCN puis, si le salarié y est
// assujetti, les plafonds du Titre IV. Renvoie le document pour la forme.
function ptAjouterVentilationPdf(doc, recap, regimeActif) {
  const ventilation = ptLignesVentilationPdf(recap);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 10,
    head: [['Mois', 'AF', 'PR', 'AC', 'Divers', 'Non ventilé']],
    body: ventilation.body,
    foot: ventilation.foot,
    styles: { fontSize: 8 },
  });
  if (!regimeActif) return doc;
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Régime formateur D/E', 'Constaté', 'Plafond', 'État']],
    body: ptLignesRegimeDe(recap),
    styles: { fontSize: 8 },
  });
  return doc;
}

// --- Export du récap annuel (reprend l'onglet "Récap Annuel" du fichier
// Excel de référence, cf. MEMOIRE_PROJET.md section 14) --------------------
function ptExporterRecapPdf(recap, annee) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Récap annuel ${annee} — ${S.profil.prenom} ${S.profil.nom}`, 14, 16);
  doc.autoTable({
    startY: 24,
    head: [['Mois', 'Heures', 'Jours dépl.', 'RTT pris (j)', 'RTT dispo (h)']],
    body: recap.mois.map((m) => [
      m.label,
      m.heures.toFixed(2).replace('.', ','),
      String(m.joursDeplacement),
      String(m.rttPrisJours),
      m.rttDispoHeures.toFixed(2).replace('.', ','),
    ]),
    foot: [[
      'Total',
      recap.total.heures.toFixed(2).replace('.', ','),
      String(recap.total.joursDeplacement),
      String(recap.total.rttPrisJours),
      recap.total.rttDispoHeures.toFixed(2).replace('.', ','),
    ]],
    styles: { fontSize: 9 },
  });
  ptAjouterVentilationPdf(doc, recap, Boolean(S.profil.regime_formateur_de));
  doc.save(`recap_${annee}_${S.profil.nom}.pdf`);
}

function ptExporterRecapExcel(recap, annee) {
  const lignes = recap.mois.map((m) => ({
    Mois: m.label,
    Heures: Number(m.heures.toFixed(2)),
    'Jours déplacement': m.joursDeplacement,
    'RTT pris (j)': m.rttPrisJours,
    'RTT dispo (h)': Number(m.rttDispoHeures.toFixed(2)),
  }));
  lignes.push({
    Mois: 'Total',
    Heures: Number(recap.total.heures.toFixed(2)),
    'Jours déplacement': recap.total.joursDeplacement,
    'RTT pris (j)': recap.total.rttPrisJours,
    'RTT dispo (h)': Number(recap.total.rttDispoHeures.toFixed(2)),
  });
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignes), `Récap ${annee}`);
  XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(ptLignesVentilationExcel(recap)), 'Ventilation CCN');
  XLSX.writeFile(classeur, `recap_${annee}_${S.profil.nom}.xlsx`);
}

async function ptChargerHistoriqueSuivi(nbJours) {
  const dateDebut = new Date();
  dateDebut.setDate(dateDebut.getDate() - nbJours);
  const dateDebutIso = dateDebut.toLocaleDateString('sv-SE');

  const [horodatages, activites] = await Promise.all([
    ptSupabase
      .from('horodatages')
      .select('date, moment, type_horodatage')
      .eq('technicien_id', S.session.user.id)
      .in('type_horodatage', ['arrivee', 'pause_debut', 'pause_fin', 'depart'])
      .gte('date', dateDebutIso)
      .order('moment', { ascending: true }),
    ptSupabase
      .from('activites')
      .select('date, type_activite, heure_debut, heure_fin, formation_code, centre_code, commentaire, details')
      .eq('technicien_id', S.session.user.id)
      .gte('date', dateDebutIso),
  ]);
  if (horodatages.error) throw horodatages.error;
  if (activites.error) throw activites.error;
  S.suiviHorodatages = horodatages.data;
  S.suiviActivites = activites.data;
}

// Regroupe les horodatages/activités par jour et calcule le total d'heures
// effectives (arrivée -> départ, moins la pause) quand la journée a ses
// 4 horodatages principaux.
function ptRegrouperParJour(horodatages, activites, nbJours) {
  const jours = [];
  for (let i = 0; i < nbJours; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateIso = date.toLocaleDateString('sv-SE');

    const horodatagesJour = horodatages.filter((h) => h.date === dateIso);
    const activitesJour = activites.filter((a) => a.date === dateIso);
    const { heures, complet } = ptCalculerHeuresJour(horodatagesJour);

    jours.push({ date: dateIso, horodatages: horodatagesJour, activites: activitesJour, heures, complet });
  }
  return jours;
}

function ptCalculerHeuresJour(horodatagesJour) {
  const trouver = (type) => horodatagesJour.find((h) => h.type_horodatage === type);
  const arrivee = trouver('arrivee');
  const depart = trouver('depart');
  if (!arrivee || !depart) return { heures: null, complet: false };

  let totalMs = new Date(depart.moment) - new Date(arrivee.moment);
  const pauseDebut = trouver('pause_debut');
  const pauseFin = trouver('pause_fin');
  if (pauseDebut && pauseFin) {
    totalMs -= new Date(pauseFin.moment) - new Date(pauseDebut.moment);
  }
  return { heures: totalMs / 3_600_000, complet: true };
}

function ptFormatDateCourte(dateIso) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// --- Ventilation des heures par catégorie CCN (AF / PR / AC) -------------
// Les activités sont enregistrées avec une heure de début mais, depuis la
// fusion pointage/activité (mémoire, sections 28/29), sans heure de fin. La
// durée d'une activité se déduit donc du contexte : elle court jusqu'à
// l'activité suivante, ou jusqu'à la fin du bloc de travail dans lequel elle
// commence (pause méridienne ou fin de journée). C'est fiable parce que la
// fusion garantit exactement une activité par bloc de travail.

// Bornes des blocs de travail réels d'une journée, en millisecondes :
// [arrivée -> début de pause] et [fin de pause -> départ], ou un bloc unique
// si aucune pause méridienne n'a été pointée. Journée incomplète = aucun
// bloc, cohérent avec ptCalculerHeuresJour qui ne compte pas ces jours-là.
function ptBlocsTravailJour(horodatagesJour) {
  const trouver = (type) => horodatagesJour.find((h) => h.type_horodatage === type);
  const arrivee = trouver('arrivee');
  const depart = trouver('depart');
  if (!arrivee || !depart) return [];

  const ms = (h) => new Date(h.moment).getTime();
  const pauseDebut = trouver('pause_debut');
  const pauseFin = trouver('pause_fin');
  if (pauseDebut && pauseFin) {
    return [[ms(arrivee), ms(pauseDebut)], [ms(pauseFin), ms(depart)]];
  }
  return [[ms(arrivee), ms(depart)]];
}

function ptMsHeureDuJour(dateIso, heure) {
  if (!heure) return null;
  const valeur = new Date(`${dateIso}T${heure}`).getTime();
  return Number.isNaN(valeur) ? null : valeur;
}

// Renvoie { parCategorie: { type_activite: heures }, heuresVentilees }.
// Une activité sans heure de début ne peut pas être placée dans un bloc :
// elle est ignorée ici et ressort dans les heures "non ventilées" du récap
// (heures pointées moins heures ventilées), plutôt que d'être attribuée
// arbitrairement à une catégorie.
function ptVentilerHeuresJour(horodatagesJour, activitesJour) {
  const parCategorie = {};
  const blocs = ptBlocsTravailJour(horodatagesJour);
  if (!blocs.length) return { parCategorie, heuresVentilees: 0 };

  const activites = activitesJour
    .map((a) => ({
      type: a.type_activite,
      debutMs: ptMsHeureDuJour(a.date, a.heure_debut),
      finMs: ptMsHeureDuJour(a.date, a.heure_fin),
    }))
    .filter((a) => a.debutMs !== null)
    .sort((x, y) => x.debutMs - y.debutMs);

  // Curseur : une activité ne peut pas empiéter sur la précédente. Protège
  // du double comptage si deux activités portent la même heure de début
  // (double saisie), ce qui gonflerait le total ventilé au-delà des heures
  // réellement pointées.
  let curseur = 0;

  for (let i = 0; i < activites.length; i += 1) {
    const activite = activites[i];
    // Bloc dans lequel l'activité commence ; à défaut (activité saisie juste
    // avant l'arrivée pointée), le premier bloc qui n'est pas déjà terminé.
    const blocDeDepart = blocs.find(([debut, fin]) => activite.debutMs >= debut && activite.debutMs < fin)
      || blocs.find(([, fin]) => activite.debutMs < fin);
    if (!blocDeDepart) continue;

    // Fin de l'activité. Sans heure de fin saisie, on s'arrête volontairement
    // au bout du bloc de départ : prolonger jusqu'au soir attribuerait des
    // heures d'après-midi à une catégorie que le salarié n'a pas confirmée.
    // Sous-estimer se voit dans la colonne "non ventilé" ; surestimer
    // fausserait silencieusement les plafonds du régime D/E.
    let fin = activite.finMs ?? blocDeDepart[1];
    const suivante = activites[i + 1];
    if (suivante && suivante.debutMs > activite.debutMs && suivante.debutMs < fin) {
      fin = suivante.debutMs;
    }

    // Intersection avec chaque bloc de travail : une activité dont l'heure de
    // fin a été saisie de part et d'autre de la pause méridienne compte sur
    // les deux blocs, sans jamais compter la pause elle-même.
    for (const [blocDebut, blocFin] of blocs) {
      const debutEffectif = Math.max(activite.debutMs, blocDebut, curseur);
      const finEffective = Math.min(fin, blocFin);
      if (finEffective <= debutEffectif) continue;
      parCategorie[activite.type] = (parCategorie[activite.type] || 0)
        + (finEffective - debutEffectif) / 3_600_000;
    }
    curseur = Math.max(curseur, fin);
  }

  const heuresVentilees = Object.values(parCategorie).reduce((somme, v) => somme + v, 0);
  return { parCategorie, heuresVentilees };
}

// Indicateurs du Titre IV, calculés à partir du total annuel ventilé. Le
// ratio ne porte que sur AF et PR (les catégories propres à BFS — contrôle,
// travaux divers, autre — n'entrent pas dans ce rapport conventionnel).
function ptIndicateursRegimeDe(total) {
  const af = total.heuresParCategorie.acte_formation || 0;
  const pr = total.heuresParCategorie.preparation_recherche || 0;
  const ac = total.heuresParCategorie.activite_connexe || 0;
  const baseRatio = af + pr;
  return {
    af,
    pr,
    ac,
    ratioAf: baseRatio > 0 ? af / baseRatio : null,
    ratioDepasse: baseRatio > 0 && af / baseRatio > PT_REGIME_DE.ratioAfMax,
    plafondAfDepasse: af > PT_REGIME_DE.plafondAfAnnuel,
    baseAnnuelleDepassee: total.heures > PT_REGIME_DE.baseAnnuelle,
  };
}

// --- Récap annuel/mensuel (heures, jours de déplacement, RTT) ------------
const PT_HEURES_JOUR_RTT = 7; // conversion jours -> heures pour les RTT pris (approximation documentée)

function ptLundiDeLaSemaine(dateIso) {
  const d = new Date(`${dateIso}T00:00:00`);
  const jour = (d.getDay() + 6) % 7; // lundi = 0 ... dimanche = 6
  d.setDate(d.getDate() - jour);
  return d.toLocaleDateString('sv-SE');
}

function ptElargirPlage(dateDebutIso, dateFinIso) {
  const dates = [];
  const d = new Date(`${dateDebutIso}T00:00:00`);
  const fin = new Date(`${dateFinIso}T00:00:00`);
  while (d <= fin) {
    dates.push(d.toLocaleDateString('sv-SE'));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// technicienId par défaut = l'utilisateur connecté (usage technicien, onglet
// Suivi) ; passé explicitement pour le récap RH admin (n'importe quel
// salarié, cf. ptRenderAdminRh, section 24 du mémoire).
async function ptCalculerRecapAnnee(annee, technicienId = S.session.user.id) {
  const debutAnnee = `${annee}-01-01`;
  const finAnnee = `${annee}-12-31`;

  const [horodatagesRes, deplacementsRes, congesRes, trajetsRes, activitesRes] = await Promise.all([
    ptSupabase.from('horodatages').select('date, moment, type_horodatage')
      .eq('technicien_id', technicienId)
      .in('type_horodatage', ['arrivee', 'pause_debut', 'pause_fin', 'depart'])
      .gte('date', debutAnnee).lte('date', finAnnee),
    // nuitees_* et commentaire servent au regroupement en séjours, nécessaire
    // au contrôle de la règle dimanche-vendredi (ptSejoursAnormaux).
    ptSupabase.from('deplacements').select('date_aller, date_retour, nuitees_avec_petit_dej, nuitees_sans_petit_dej, commentaire')
      .eq('technicien_id', technicienId)
      .gte('date_aller', debutAnnee).lte('date_aller', finAnnee),
    // Tous types de congés accordés (pas seulement RTT) : nécessaire au
    // détail "congés pris par type" du récap RH (ticket resto/bulletin de
    // paie), en plus du calcul RTT dispo qui n'utilise que le sous-type rtt.
    ptSupabase.from('conges').select('type_conge, date_debut, date_fin')
      .eq('technicien_id', technicienId)
      .eq('statut', 'accorde')
      .lte('date_debut', finAnnee).gte('date_fin', debutAnnee),
    ptSupabase.from('horodatages').select('date, moment, type_horodatage')
      .eq('technicien_id', technicienId)
      .in('type_horodatage', ['trajet_inter_site_debut', 'trajet_inter_site_fin'])
      .order('moment', { ascending: true }),
    // Activités de l'année : servent à ventiler les heures par catégorie CCN
    // (AF/PR/AC), et donc aux plafonds du régime formateur D/E.
    ptSupabase.from('activites').select('date, type_activite, heure_debut, heure_fin')
      .eq('technicien_id', technicienId)
      .gte('date', debutAnnee).lte('date', finAnnee),
  ]);
  for (const res of [horodatagesRes, deplacementsRes, congesRes, trajetsRes, activitesRes]) {
    if (res.error) throw res.error;
  }

  // 1. Heures effectives par jour, puis regroupées par semaine (clé = lundi).
  const joursUniques = [...new Set(horodatagesRes.data.map((h) => h.date))];
  const heuresParSemaine = {}; // lundi -> total heures
  for (const dateIso of joursUniques) {
    const { heures, complet } = ptCalculerHeuresJour(horodatagesRes.data.filter((h) => h.date === dateIso));
    if (!complet) continue;
    const lundi = ptLundiDeLaSemaine(dateIso);
    heuresParSemaine[lundi] = (heuresParSemaine[lundi] || 0) + heures;
  }

  // 1bis. Jours travaillés (au moins une arrivée pointée ce jour-là) — sert
  // de base au comptage des tickets resto. Règle exacte (journée complète,
  // exclusion des jours de déplacement...) pas encore tranchée avec Jeremy,
  // affiché comme un simple décompte de jours pointés pour l'instant.
  const joursTravaillesSet = new Set(horodatagesRes.data.filter((h) => h.type_horodatage === 'arrivee').map((h) => h.date));

  // 1ter. Ventilation des heures par catégorie CCN, jour par jour. Calculée
  // une seule fois ici puis agrégée par mois dans la boucle ci-dessous.
  const ventilationParJour = {};
  for (const dateIso of joursUniques) {
    ventilationParJour[dateIso] = ptVentilerHeuresJour(
      horodatagesRes.data.filter((h) => h.date === dateIso),
      activitesRes.data.filter((a) => a.date === dateIso),
    );
  }

  // 2. Jours de déplacement : nuitées manuelles (deplacements) + nuits
  // inter-agence calculées automatiquement, sur l'ensemble de l'historique
  // des trajets (nécessaire pour détecter un séjour en cours à cheval sur
  // l'année affichée).
  const datesDeplacement = new Set();
  for (const d of deplacementsRes.data) {
    for (const date of ptElargirPlage(d.date_aller, d.date_retour || d.date_aller)) datesDeplacement.add(date);
  }
  const sejours = ptCalculerSejoursInterAgence(trajetsRes.data);
  for (const s of sejours) {
    const finSejour = s.dateDepart ? ptJourPrecedent(s.dateDepart) : ptDateDuJour();
    for (const date of ptElargirPlage(s.dateArrivee, finSejour)) datesDeplacement.add(date);
  }

  // 2bis. Tickets resto : paramétrable dans Administration > Paramètres
  // (deux règles indépendantes et cumulables, décidé avec Jeremy) —
  // ticket_resto_jour_travaille (jour pointé) et ticket_resto_jour_deplacement
  // (nuit chez un client ou inter-agence). Un jour qui coche les deux cases
  // ne compte qu'une fois (Set), pas de double ticket le même jour.
  const ticketsRestoDates = new Set();
  if (ptParametreActif('ticket_resto_jour_travaille')) {
    for (const date of joursTravaillesSet) ticketsRestoDates.add(date);
  }
  if (ptParametreActif('ticket_resto_jour_deplacement')) {
    for (const date of datesDeplacement) ticketsRestoDates.add(date);
  }

  // 3. Congés accordés par type : dates -> type_conge (pour le RTT pris, et
  // pour le détail "congés pris par type" du récap RH). Si deux congés se
  // chevauchent sur une même date (ne devrait pas arriver), le dernier
  // rencontré l'emporte — cas non géré finement, pas rencontré en pratique.
  const datesRttPrises = new Set();
  const typeCongeParDate = {};
  for (const c of congesRes.data) {
    for (const date of ptElargirPlage(c.date_debut, c.date_fin)) {
      typeCongeParDate[date] = c.type_conge;
      if (c.type_conge === 'rtt') datesRttPrises.add(date);
    }
  }

  // 4. Construction des 12 mois + cumul du solde RTT dispo + congés par
  // type + jours travaillés.
  const mois = [];
  let cumulAccumule = 0;
  let cumulPris = 0;
  for (let m = 0; m < 12; m += 1) {
    const premierJourMois = new Date(annee, m, 1);
    const dernierJourMois = new Date(annee, m + 1, 0);

    let heuresMois = 0;
    const heuresParCategorieMois = {};
    let heuresVentileesMois = 0;
    for (const dateIso of joursUniques) {
      const d = new Date(`${dateIso}T00:00:00`);
      if (d >= premierJourMois && d <= dernierJourMois) {
        heuresMois += ptCalculerHeuresJour(horodatagesRes.data.filter((h) => h.date === dateIso)).heures || 0;
        const ventilation = ventilationParJour[dateIso];
        for (const [categorie, heures] of Object.entries(ventilation.parCategorie)) {
          heuresParCategorieMois[categorie] = (heuresParCategorieMois[categorie] || 0) + heures;
        }
        heuresVentileesMois += ventilation.heuresVentilees;
      }
    }

    let rttAccumuleMois = 0;
    for (const [lundiIso, totalSemaine] of Object.entries(heuresParSemaine)) {
      const lundi = new Date(`${lundiIso}T00:00:00`);
      if (lundi.getFullYear() === annee && lundi.getMonth() === m) {
        rttAccumuleMois += Math.min(Math.max(totalSemaine - 35, 0), 4);
      }
    }

    let joursDeplacementMois = 0;
    let rttPrisJoursMois = 0;
    let joursTravaillesMois = 0;
    let ticketsRestoMois = 0;
    const congesParTypeMois = {};
    for (let jour = 1; jour <= dernierJourMois.getDate(); jour += 1) {
      const dateIso = new Date(annee, m, jour).toLocaleDateString('sv-SE');
      if (datesDeplacement.has(dateIso)) joursDeplacementMois += 1;
      if (datesRttPrises.has(dateIso)) rttPrisJoursMois += 1;
      if (joursTravaillesSet.has(dateIso)) joursTravaillesMois += 1;
      if (ticketsRestoDates.has(dateIso)) ticketsRestoMois += 1;
      const typeConge = typeCongeParDate[dateIso];
      if (typeConge) congesParTypeMois[typeConge] = (congesParTypeMois[typeConge] || 0) + 1;
    }

    cumulAccumule += rttAccumuleMois;
    cumulPris += rttPrisJoursMois * PT_HEURES_JOUR_RTT;

    mois.push({
      label: PT_LABELS_MOIS[m],
      heures: heuresMois,
      joursDeplacement: joursDeplacementMois,
      rttPrisJours: rttPrisJoursMois,
      rttDispoHeures: cumulAccumule - cumulPris,
      joursTravailles: joursTravaillesMois,
      ticketsResto: ticketsRestoMois,
      congesParType: congesParTypeMois,
      heuresParCategorie: heuresParCategorieMois,
      // Heures pointées qu'aucune activité ne couvre (activité sans heure de
      // début, ou saisie antérieure à la fusion pointage/activité). Jamais
      // négatif : un arrondi ne doit pas produire une ligne aberrante.
      heuresNonVentilees: Math.max(heuresMois - heuresVentileesMois, 0),
    });
  }

  const total = mois.reduce((acc, m) => ({
    heures: acc.heures + m.heures,
    joursDeplacement: acc.joursDeplacement + m.joursDeplacement,
    rttPrisJours: acc.rttPrisJours + m.rttPrisJours,
    rttDispoHeures: mois[mois.length - 1].rttDispoHeures,
    joursTravailles: acc.joursTravailles + m.joursTravailles,
    ticketsResto: acc.ticketsResto + m.ticketsResto,
  }), { heures: 0, joursDeplacement: 0, rttPrisJours: 0, rttDispoHeures: 0, joursTravailles: 0, ticketsResto: 0 });

  // Total des congés par type sur l'année entière (toutes dates confondues,
  // pas seulement celles qui tombent dans un mois du récap ci-dessus).
  const congesParTypeTotal = {};
  for (const type of Object.values(typeCongeParDate)) {
    congesParTypeTotal[type] = (congesParTypeTotal[type] || 0) + 1;
  }
  total.congesParType = congesParTypeTotal;

  // Ventilation cumulée sur l'année (somme des douze mois).
  const heuresParCategorieTotal = {};
  let heuresNonVentileesTotal = 0;
  for (const m of mois) {
    for (const [categorie, heures] of Object.entries(m.heuresParCategorie)) {
      heuresParCategorieTotal[categorie] = (heuresParCategorieTotal[categorie] || 0) + heures;
    }
    heuresNonVentileesTotal += m.heuresNonVentilees;
  }
  total.heuresParCategorie = heuresParCategorieTotal;
  total.heuresNonVentilees = heuresNonVentileesTotal;

  // Séjours qui débordent la règle « dimanche après-midi -> vendredi soir ».
  // Calculés ici pour que le récap RH et le récap du salarié affichent la
  // même alerte, à partir exactement des séjours qui alimentent les
  // colonnes "jours de déplacement" et "tickets resto" ci-dessus.
  const sejoursAnormaux = ptSejoursAnormaux(
    ptRegrouperSejoursClient(deplacementsRes.data),
    sejours,
    annee,
  );

  return { mois, total, regimeDe: ptIndicateursRegimeDe(total), sejoursAnormaux };
}

// --- Contrôle des séjours (règle dimanche après-midi -> vendredi soir) ---
// Les nuits d'un séjour vont de la date d'aller à la veille du retour. Pour
// un séjour encore ouvert, on compte jusqu'à aujourd'hui : c'est exactement
// ce que fait le récap, donc l'alerte reflète le chiffre réellement compté.
function ptNuitsDuSejour(sejour) {
  const finNuits = sejour.dateRetour ? ptJourPrecedent(sejour.dateRetour) : ptDateDuJour();
  if (finNuits < sejour.dateAller) return [];
  return ptElargirPlage(sejour.dateAller, finNuits);
}

function ptAnomaliesSejour(sejour) {
  const anomalies = [];
  const nuits = ptNuitsDuSejour(sejour);
  if (!sejour.dateRetour) anomalies.push('retour non pointé');
  if (nuits.length > PT_DEPLACEMENT_MAX_NUITS) {
    anomalies.push(`${nuits.length} nuits comptées, maximum ${PT_DEPLACEMENT_MAX_NUITS}`);
  }
  const samedis = nuits.filter((date) => new Date(`${date}T00:00:00`).getDay() === 6);
  if (samedis.length) {
    anomalies.push(`${samedis.length} nuit(s) de samedi, hors règle dimanche-vendredi`);
  }
  return anomalies;
}

// Séjours anormaux d'une année, tous types confondus. Renvoie une liste
// prête à afficher : type, dates, nuits comptées et motifs.
function ptSejoursAnormaux(sejoursClient, sejoursInterAgence, annee) {
  const tous = [
    ...sejoursClient.map((s) => ({ type: 'client', dateAller: s.dateAller, dateRetour: s.dateRetour })),
    ...sejoursInterAgence.map((s) => ({ type: 'inter_agence', dateAller: s.dateArrivee, dateRetour: s.dateDepart })),
  ];
  return tous
    .filter((s) => new Date(`${s.dateAller}T00:00:00`).getFullYear() === annee)
    .map((s) => ({ ...s, nuits: ptNuitsDuSejour(s).length, anomalies: ptAnomaliesSejour(s) }))
    .filter((s) => s.anomalies.length > 0)
    .sort((a, b) => b.dateAller.localeCompare(a.dateAller));
}

// Bloc d'alerte partagé par le Récap RH admin et l'onglet Suivi du salarié.
function ptRenderAlerteSejoursHtml(sejoursAnormaux, ouCorriger) {
  if (!sejoursAnormaux.length) return '';
  return `
    <div class="pt-alerte">
      <strong>${sejoursAnormaux.length} déplacement(s) hors règle</strong> — un déplacement va au maximum du dimanche après-midi au vendredi soir (${PT_DEPLACEMENT_MAX_NUITS} nuits). Les jours de déplacement et les tickets resto ci-dessous sont donc surévalués. ${ptEchapperHtml(ouCorriger)}
      <ul>
        ${sejoursAnormaux.map((s) => `
          <li>${s.type === 'inter_agence' ? 'Inter-agence' : 'Client'} — du ${s.dateAller} au ${s.dateRetour || 'aujourd\'hui'} : ${s.nuits} nuit(s) — ${ptEchapperHtml(s.anomalies.join(' ; '))}</li>`).join('')}
      </ul>
    </div>`;
}

function ptJourPrecedent(dateIso) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('sv-SE');
}

function ptJourSuivant(dateIso) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('sv-SE');
}

// --- Récap des déplacements : regroupé par mois puis par séjour, comme le
// fichier Excel de référence (une ligne par voyage, pas par nuit) ---------
async function ptRenderDeplacementsRecap(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Calcul en cours…</p>`;
  const annee = S.suiviAnnee;
  const finAnnee = `${annee}-12-31`;

  const [deplacementsRes, trajetsRes] = await Promise.all([
    // id demandé : nécessaire aux boutons de correction/suppression.
    ptSupabase.from('deplacements').select('id, date_aller, date_retour, nuitees_avec_petit_dej, nuitees_sans_petit_dej, commentaire')
      .eq('technicien_id', S.session.user.id)
      .gte('date_aller', `${annee}-01-01`).lte('date_aller', finAnnee)
      .order('date_aller', { ascending: true }),
    // Historique complet (pas seulement l'année) : nécessaire pour que la
    // parité maison/away de ptCalculerSejoursInterAgence reste correcte.
    ptSupabase.from('horodatages').select('id, date, moment, type_horodatage')
      .eq('technicien_id', S.session.user.id)
      .in('type_horodatage', ['trajet_inter_site_debut', 'trajet_inter_site_fin'])
      .lte('date', finAnnee)
      .order('moment', { ascending: true }),
  ]);
  if (deplacementsRes.error) throw deplacementsRes.error;
  if (trajetsRes.error) throw trajetsRes.error;

  const voyagesClient = ptRegrouperSejoursClient(deplacementsRes.data);
  const sejoursInterAgence = ptCalculerSejoursInterAgence(trajetsRes.data);
  const voyagesInterAgence = sejoursInterAgence
    .filter((s) => new Date(s.dateArrivee).getFullYear() === annee)
    .map((s) => ({
      type: 'inter_agence',
      idArrivee: s.idArrivee,
      idDepart: s.idDepart,
      dateAller: s.dateArrivee,
      dateRetour: s.dateDepart,
      nuits: s.nuits,
      nuiteesAvecPetitDej: null,
      nuiteesSansPetitDej: null,
      commentaire: s.dateDepart ? '' : 'En cours',
    }));

  const sejoursAnormaux = ptSejoursAnormaux(voyagesClient, sejoursInterAgence, annee);

  const tousLesVoyages = [...voyagesClient, ...voyagesInterAgence]
    .sort((a, b) => a.dateAller.localeCompare(b.dateAller));

  // Clé stable pour retrouver le voyage depuis un bouton, et contrôle de la
  // règle dimanche-vendredi ligne par ligne.
  tousLesVoyages.forEach((voyage, index) => {
    voyage.cle = String(index);
    voyage.anomalies = ptAnomaliesSejour(voyage);
  });

  const parMois = {};
  for (const v of tousLesVoyages) {
    const m = new Date(`${v.dateAller}T00:00:00`).getMonth();
    (parMois[m] ||= []).push(v);
  }

  zoneContenu.innerHTML = `
    <div class="pt-suivi-annee-nav">
      <button id="pt-annee-prec" class="pt-btn pt-btn-secondaire pt-btn-petit">« ${annee - 1}</button>
      <strong>${annee}</strong>
      <button id="pt-annee-suiv" class="pt-btn pt-btn-secondaire pt-btn-petit">${annee + 1} »</button>
    </div>
    ${ptRenderAlerteSejoursHtml(sejoursAnormaux, 'Corrige-les avec les boutons de la colonne Action ci-dessous.')}
    <p id="pt-deplacement-erreur" class="pt-message-erreur" hidden></p>
    ${PT_LABELS_MOIS.map((label, m) => {
      const voyagesMois = parMois[m];
      if (!voyagesMois) return '';
      return `
        <h3 class="pt-recap-mois-titre">${label}</h3>
        <div class="pt-table-scroll">
        <table class="pt-table-recap">
          <thead><tr><th>Type</th><th>Du</th><th>Au</th><th>Nuitées</th><th>Avec p-déj</th><th>Sans p-déj</th><th>Commentaire</th><th>Action</th></tr></thead>
          <tbody>
            ${voyagesMois.map((v) => `
              <tr${v.anomalies.length ? ' class="pt-ligne-anomalie"' : ''}>
                <td>${v.type === 'inter_agence' ? 'Inter-agence' : 'Client'}</td>
                <td>${v.dateAller}</td>
                <td>${v.dateRetour || 'en cours'}</td>
                <td>${v.nuits}${v.anomalies.length ? ' <span class="pt-badge pt-badge-alerte" title="' + ptEchapperHtml(v.anomalies.join(' ; ')) + '">!</span>' : ''}</td>
                <td>${v.nuiteesAvecPetitDej ?? '—'}</td>
                <td>${v.nuiteesSansPetitDej ?? '—'}</td>
                <td>${ptEchapperHtml(v.commentaire || '')}</td>
                <td class="pt-deplacement-actions">${ptActionsVoyageHtml(v)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>`;
    }).join('') || '<p class="pt-liste-vide">Aucun déplacement sur cette année.</p>'}

    <form id="pt-form-retour-trajet" hidden class="pt-form-activite">
      <h3 class="pt-recap-mois-titre" id="pt-form-retour-titre"></h3>
      <label>Date du retour <input type="date" name="date" required /></label>
      <label>Heure de départ de l'autre agence <input type="time" name="heure_depart" required /></label>
      <label>Heure d'arrivée <input type="time" name="heure_arrivee" required /></label>
      <div class="pt-admin-actions">
        <button type="submit" class="pt-btn pt-btn-petit">Enregistrer</button>
        <button type="button" id="pt-form-retour-annuler" class="pt-btn pt-btn-secondaire pt-btn-petit">Annuler</button>
      </div>
    </form>`;

  const erreurEl = document.getElementById('pt-deplacement-erreur');
  const signalerErreur = (message, erreur) => {
    erreurEl.textContent = message;
    erreurEl.hidden = false;
    PT_DEBUG.log(`${message} : ${erreur.message}`, true);
  };
  const recharger = () => ptRenderDeplacementsRecap(zoneContenu, conteneur);
  const voyageParCle = (cle) => tousLesVoyages.find((v) => v.cle === cle);

  document.getElementById('pt-annee-prec').addEventListener('click', () => {
    S.suiviAnnee -= 1;
    recharger();
  });
  document.getElementById('pt-annee-suiv').addEventListener('click', () => {
    S.suiviAnnee += 1;
    recharger();
  });

  // --- Suppression -------------------------------------------------------
  // Séjour client : on supprime les lignes deplacements qui le composent.
  // Séjour inter-agence EN COURS : on supprime le seul horodatage d'arrivée
  // qui l'a ouvert — la parité maison/away reste équilibrée. Un séjour déjà
  // clos ne se supprime pas (il faudrait retirer les quatre horodatages du
  // aller-retour sans casser la parité des séjours suivants) : on corrige
  // sa date de retour à la place.
  zoneContenu.querySelectorAll('.pt-voyage-supprimer').forEach((bouton) => {
    bouton.addEventListener('click', async () => {
      const voyage = voyageParCle(bouton.dataset.cle);
      if (!voyage) return;
      bouton.disabled = true;
      try {
        if (voyage.type === 'client') {
          await ptSupprimerSejourClient(voyage.ids);
        } else {
          await ptSupprimerOuvertureSejourInterAgence(voyage.idArrivee);
        }
        recharger();
      } catch (erreur) {
        signalerErreur('Échec de la suppression du déplacement.', erreur);
        bouton.disabled = false;
      }
    });
  });

  // --- Clôture d'un séjour en cours / correction d'une date de retour ----
  const formRetour = document.getElementById('pt-form-retour-trajet');
  const titreRetour = document.getElementById('pt-form-retour-titre');
  let voyageEnCoursDeCorrection = null;

  zoneContenu.querySelectorAll('.pt-voyage-retour').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const voyage = voyageParCle(bouton.dataset.cle);
      if (!voyage) return;
      voyageEnCoursDeCorrection = voyage;
      titreRetour.textContent = voyage.dateRetour
        ? `Corriger le retour du séjour commencé le ${voyage.dateAller}`
        : `Clôturer le séjour commencé le ${voyage.dateAller}`;
      formRetour.reset();
      // Valeur de départ : le vendredi de la semaine du départ, conforme à
      // la règle dimanche après-midi -> vendredi soir.
      formRetour.elements.date.value = voyage.dateRetour || ptVendrediDeLaSemaine(voyage.dateAller);
      formRetour.elements.heure_depart.value = '17:00';
      formRetour.elements.heure_arrivee.value = '19:00';
      formRetour.hidden = false;
      formRetour.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.getElementById('pt-form-retour-annuler').addEventListener('click', () => {
    formRetour.hidden = true;
    voyageEnCoursDeCorrection = null;
  });

  formRetour.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    if (!voyageEnCoursDeCorrection) return;
    const champs = new FormData(evenement.target);
    const dateRetour = champs.get('date');
    const momentDepart = new Date(`${dateRetour}T${champs.get('heure_depart')}:00`);
    const momentArrivee = new Date(`${dateRetour}T${champs.get('heure_arrivee')}:00`);
    if (momentArrivee <= momentDepart) {
      signalerErreur('L\'heure d\'arrivée doit être postérieure à l\'heure de départ.', new Error('ordre des heures'));
      return;
    }
    const boutonSubmit = formRetour.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;
    try {
      if (voyageEnCoursDeCorrection.dateRetour) {
        await ptCorrigerRetourInterAgence(voyageEnCoursDeCorrection.idDepart, dateRetour, momentDepart);
      } else {
        await ptCloturerSejourInterAgence(dateRetour, momentDepart, momentArrivee);
      }
      recharger();
    } catch (erreur) {
      signalerErreur('Échec de l\'enregistrement du retour.', erreur);
      boutonSubmit.disabled = false;
    }
  });
}

// Boutons proposés selon le type de séjour et son état. Un séjour dont on ne
// connaît pas l'identifiant en base (cas théorique : appelant qui n'a pas
// demandé la colonne id) n'affiche aucune action plutôt qu'un bouton qui
// échouerait.
function ptActionsVoyageHtml(voyage) {
  if (voyage.type === 'client') {
    return voyage.ids && voyage.ids.length
      ? `<button type="button" class="pt-btn pt-btn-secondaire pt-btn-petit pt-voyage-supprimer" data-cle="${voyage.cle}">Supprimer</button>`
      : '';
  }
  if (!voyage.dateRetour) {
    return `
      <button type="button" class="pt-btn pt-btn-petit pt-voyage-retour" data-cle="${voyage.cle}">Pointer le retour</button>
      ${voyage.idArrivee ? `<button type="button" class="pt-btn pt-btn-secondaire pt-btn-petit pt-voyage-supprimer" data-cle="${voyage.cle}">Supprimer</button>` : ''}`;
  }
  return voyage.idDepart
    ? `<button type="button" class="pt-btn pt-btn-secondaire pt-btn-petit pt-voyage-retour" data-cle="${voyage.cle}">Corriger le retour</button>`
    : '';
}

// Vendredi de la semaine d'une date donnée — proposition par défaut du
// formulaire de retour, conforme à la règle dimanche après-midi -> vendredi
// soir. Un séjour parti le dimanche rentre le vendredi qui suit.
function ptVendrediDeLaSemaine(dateIso) {
  const date = new Date(`${dateIso}T00:00:00`);
  const jour = date.getDay(); // 0 = dimanche ... 6 = samedi
  const joursJusquAuVendredi = jour === 0 ? 5 : (5 - jour + 7) % 7;
  date.setDate(date.getDate() + joursJusquAuVendredi);
  return date.toLocaleDateString('sv-SE');
}

async function ptSupprimerSejourClient(ids) {
  const { error } = await ptSupabase.from('deplacements').delete().in('id', ids);
  if (error) throw error;
}

async function ptSupprimerOuvertureSejourInterAgence(idArrivee) {
  const { error } = await ptSupabase.from('horodatages').delete().eq('id', idArrivee);
  if (error) throw error;
}

// Clôture d'un séjour en cours : deux horodatages, le départ de l'autre
// agence puis l'arrivée. Les deux sont nécessaires — la détection des
// séjours alterne départ/arrivée, n'en poser qu'un déséquilibrerait tous les
// séjours suivants.
async function ptCloturerSejourInterAgence(dateRetour, momentDepart, momentArrivee) {
  await ptEnregistrerHorodatage('trajet_inter_site_debut', { manuel: true, moment: momentDepart, date: dateRetour });
  await ptEnregistrerHorodatage('trajet_inter_site_fin', { manuel: true, moment: momentArrivee, date: dateRetour });
}

// Correction d'un séjour déjà clos : on déplace l'horodatage de départ qui
// le referme, sans toucher au reste (la parité est préservée).
async function ptCorrigerRetourInterAgence(idDepart, dateRetour, momentDepart) {
  const { error } = await ptSupabase
    .from('horodatages')
    .update({ date: dateRetour, moment: momentDepart.toISOString(), source: 'manuel', saisi_a_posteriori: true })
    .eq('id', idDepart);
  if (error) throw error;
}

// Fusionne les lignes de nuitées consécutives (saisies nuit par nuit via
// les boutons rapides) en un seul séjour, comme une ligne par voyage dans
// l'Excel de référence.
function ptRegrouperSejoursClient(deplacements) {
  const nuits = deplacements
    .map((d) => ({ id: d.id ?? null, date: d.date_aller, avec: d.nuitees_avec_petit_dej || 0, sans: d.nuitees_sans_petit_dej || 0, commentaire: d.commentaire }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const sejours = [];
  for (const nuit of nuits) {
    const dernier = sejours[sejours.length - 1];
    if (dernier && ptJourSuivant(dernier.dernierNuitDate) === nuit.date) {
      dernier.nuiteesAvecPetitDej += nuit.avec;
      dernier.nuiteesSansPetitDej += nuit.sans;
      dernier.nuits += 1;
      dernier.dernierNuitDate = nuit.date;
      dernier.dateRetour = ptJourSuivant(nuit.date);
      if (nuit.id !== null) dernier.ids.push(nuit.id);
      if (nuit.commentaire && !dernier.commentaire.includes(nuit.commentaire)) {
        dernier.commentaire = dernier.commentaire ? `${dernier.commentaire}, ${nuit.commentaire}` : nuit.commentaire;
      }
    } else {
      sejours.push({
        type: 'client',
        // Lignes deplacements composant le séjour : permet de supprimer un
        // séjour entier depuis l'onglet Suivi. Vide si l'appelant n'a pas
        // demandé la colonne id.
        ids: nuit.id !== null ? [nuit.id] : [],
        dateAller: nuit.date,
        dernierNuitDate: nuit.date,
        dateRetour: ptJourSuivant(nuit.date),
        nuits: 1,
        nuiteesAvecPetitDej: nuit.avec,
        nuiteesSansPetitDej: nuit.sans,
        commentaire: nuit.commentaire || '',
      });
    }
  }
  return sejours;
}

// --- Congés : demande + historique -----------------------------------
const PT_LABELS_CONGE = {
  maladie: 'Maladie',
  conge: 'Congé',
  deces: 'Décès',
  autres: 'Autres',
  convention_sdis: 'Convention SDIS',
  conge_parental: 'Congé parental',
  conges_sans_solde: 'Congés sans solde',
  rtt: 'RTT',
};

const PT_LABELS_STATUT_CONGE = {
  en_attente: { label: 'En attente', classe: '' },
  accorde: { label: 'Accordé', classe: 'pt-badge-ok' },
  refuse: { label: 'Refusé', classe: 'pt-badge-alerte' },
};

async function ptRenderCongesSuivi(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data, error } = await ptSupabase
    .from('conges')
    .select('*')
    .eq('technicien_id', S.session.user.id)
    .order('date_debut', { ascending: false });
  if (error) throw error;

  zoneContenu.innerHTML = `
    <form id="pt-form-conge" class="pt-form-activite">
      <label>Type de congé
        <select name="type_conge">
          ${Object.entries(PT_LABELS_CONGE).map(([valeur, libelle]) => `<option value="${valeur}">${libelle}</option>`).join('')}
        </select>
      </label>
      <label>Date de début <input type="date" name="date_debut" required /></label>
      <label>Date de fin <input type="date" name="date_fin" required /></label>
      <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
      <label>Signature (obligatoire, comme sur le formulaire papier)
        <canvas id="pt-signature-conge" class="pt-signature-canvas" width="400" height="150"></canvas>
      </label>
      <button type="button" id="pt-btn-signature-effacer" class="pt-btn pt-btn-secondaire pt-btn-petit">Effacer la signature</button>
      <button type="submit" class="pt-btn pt-btn-petit">Envoyer la demande</button>
      <p id="pt-conge-erreur" class="pt-message-erreur" hidden></p>
    </form>

    <h3 class="pt-recap-mois-titre">Mes demandes</h3>
    <ul class="pt-liste-suivi">
      ${data.map((c) => {
        const statut = PT_LABELS_STATUT_CONGE[c.statut] || PT_LABELS_STATUT_CONGE.en_attente;
        return `
          <li class="pt-jour-suivi" data-id="${c.id}">
            <div class="pt-jour-suivi-entete">
              <strong>${PT_LABELS_CONGE[c.type_conge] || c.type_conge}</strong>
              <span class="pt-badge ${statut.classe}">${statut.label}</span>
            </div>
            <div class="pt-jour-suivi-details">${c.date_debut} → ${c.date_fin}${c.commentaire ? ` — ${ptEchapperHtml(c.commentaire)}` : ''}</div>
            <button class="pt-btn pt-btn-secondaire pt-btn-petit pt-btn-conge-pdf" data-id="${c.id}">Télécharger le PDF</button>
          </li>`;
      }).join('') || '<li class="pt-liste-vide">Aucune demande envoyée.</li>'}
    </ul>`;

  const signature = ptInitialiserSignature(document.getElementById('pt-signature-conge'));
  document.getElementById('pt-btn-signature-effacer').addEventListener('click', () => signature.effacer());

  document.getElementById('pt-form-conge').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const erreurEl = document.getElementById('pt-conge-erreur');
    erreurEl.hidden = true;
    if (formulaire.get('date_fin') < formulaire.get('date_debut')) {
      erreurEl.textContent = 'La date de fin doit être après la date de début.';
      erreurEl.hidden = false;
      return;
    }
    if (signature.estVide()) {
      erreurEl.textContent = 'Signature obligatoire avant l\'envoi.';
      erreurEl.hidden = false;
      return;
    }
    try {
      await ptAjouterConge({
        type_conge: formulaire.get('type_conge'),
        date_debut: formulaire.get('date_debut'),
        date_fin: formulaire.get('date_fin'),
        commentaire: formulaire.get('commentaire') || null,
        signature_technicien: signature.dataUrl(),
      });
      ptRenderCongesSuivi(zoneContenu, conteneur);
    } catch (erreur) {
      erreurEl.textContent = 'Échec de l\'envoi de la demande.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec ajout congé : ${erreur.message}`, true);
    }
  });

  zoneContenu.querySelectorAll('.pt-btn-conge-pdf').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const conge = data.find((c) => c.id === Number(bouton.dataset.id));
      if (conge) ptExporterCongePdf(conge, `${S.profil.prenom} ${S.profil.nom}`);
    });
  });
}

async function ptAjouterConge(champs) {
  const { error } = await ptSupabase.from('conges').insert({
    technicien_id: S.session.user.id,
    statut: 'en_attente',
    ...champs,
  });
  if (error) throw error;
}

// --- Frais : demande de remboursement côté technicien (mêmes conventions
// que ptRenderCongesSuivi : statut initial 'en_attente', décision réservée
// à admin/secrétariat — écran Secrétariat, section 19 du mémoire). Notes de
// service BFS : justificatif numéroté, à transmettre avant le 1er du mois
// suivant (mémoire section 4) — rappelé à l'écran, pas encore bloquant.
async function ptRenderFraisSuivi(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data, error } = await ptSupabase
    .from('frais')
    .select('*')
    .eq('technicien_id', S.session.user.id)
    .order('date', { ascending: false });
  if (error) throw error;

  zoneContenu.innerHTML = `
    <p class="pt-info">Justificatif numéroté, à transmettre avant le 1er du mois suivant (note de service BFS).</p>
    <form id="pt-form-frais" class="pt-form-activite">
      <label>Date <input type="date" name="date" required /></label>
      <label>N° justificatif <input type="text" name="numero_justificatif" maxlength="50" /></label>
      <label>Montant (€) <input type="number" name="montant" min="0" step="0.01" required /></label>
      <label>Type de frais <input type="text" name="type_frais" maxlength="100" placeholder="Ex. repas, péage, hôtel" /></label>
      <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
      <button type="submit" class="pt-btn pt-btn-petit">Envoyer</button>
      <p id="pt-frais-erreur" class="pt-message-erreur" hidden></p>
    </form>

    <h3 class="pt-recap-mois-titre">Mes frais</h3>
    <ul class="pt-liste-suivi">
      ${data.map((f) => {
        const statut = PT_LABELS_STATUT_FRAIS[f.statut] || PT_LABELS_STATUT_FRAIS.en_attente;
        return `
          <li class="pt-jour-suivi">
            <div class="pt-jour-suivi-entete">
              <strong>${Number(f.montant).toFixed(2).replace('.', ',')} €${f.type_frais ? ` — ${ptEchapperHtml(f.type_frais)}` : ''}</strong>
              <span class="pt-badge ${statut.classe}">${statut.label}</span>
            </div>
            <div class="pt-jour-suivi-details">${f.date}${f.numero_justificatif ? ` — Justificatif n°${ptEchapperHtml(f.numero_justificatif)}` : ''}${f.commentaire ? ` — ${ptEchapperHtml(f.commentaire)}` : ''}</div>
          </li>`;
      }).join('') || '<li class="pt-liste-vide">Aucun frais envoyé.</li>'}
    </ul>`;

  document.getElementById('pt-form-frais').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const erreurEl = document.getElementById('pt-frais-erreur');
    erreurEl.hidden = true;
    try {
      await ptAjouterFrais({
        date: formulaire.get('date'),
        numero_justificatif: formulaire.get('numero_justificatif') || null,
        montant: Number(formulaire.get('montant')),
        type_frais: formulaire.get('type_frais') || null,
        commentaire: formulaire.get('commentaire') || null,
      });
      ptRenderFraisSuivi(zoneContenu, conteneur);
    } catch (erreur) {
      erreurEl.textContent = 'Échec de l\'envoi du frais.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec ajout frais : ${erreur.message}`, true);
    }
  });
}

async function ptAjouterFrais(champs) {
  const { error } = await ptSupabase.from('frais').insert({
    technicien_id: S.session.user.id,
    statut: 'en_attente',
    ...champs,
  });
  if (error) throw error;
}

// --- Onglet Administration : congés, profils, paramètres ------------------
const PT_LABELS_ROLE = { technicien: 'Technicien', admin: 'Admin', secretariat: 'Secrétariat' };

const PT_LABELS_PARAMETRE = {
  geoloc_active: 'Géolocalisation activée',
  trajet_compte_heures_conducteur: 'Trajet compté en heures — conducteur véhicule de service',
  trajet_compte_heures_passager: 'Trajet compté en heures — passager',
  trajet_compte_heures_vehicule_perso: 'Trajet compté en heures — véhicule personnel',
  ticket_resto_jour_travaille: 'Ticket resto — jour travaillé',
  ticket_resto_jour_deplacement: 'Ticket resto — jour de déplacement',
};

async function ptRenderOngletAdmin(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;

  const vues = [
    { id: 'conges', label: 'Congés' },
    { id: 'profils', label: 'Profils' },
    { id: 'parametres', label: 'Paramètres' },
    { id: 'rh', label: 'Récap RH' },
  ];

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Administration</h2>
      <div class="pt-suivi-onglets">
        ${vues.map((v) => `<button class="pt-btn ${S.adminVue === v.id ? '' : 'pt-btn-secondaire'} pt-btn-petit" data-vue="${v.id}">${v.label}</button>`).join('')}
      </div>
      <div id="pt-admin-contenu"></div>
    </section>`;

  document.querySelectorAll('.pt-suivi-onglets button').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      S.adminVue = bouton.dataset.vue;
      ptRenderOngletAdmin(conteneur);
    });
  });

  const zoneContenu = document.getElementById('pt-admin-contenu');
  const rendusAdmin = {
    conges: ptRenderAdminConges,
    profils: ptRenderAdminProfils,
    parametres: ptRenderAdminParametres,
    rh: ptRenderAdminRh,
  };
  await (rendusAdmin[S.adminVue] || ptRenderAdminConges)(zoneContenu, conteneur);
}

// --- Congés : décision (accordé/refusé) sur les demandes de tous les
// techniciens. La RLS autorise déjà admin/secretariat à modifier
// statut/decideur_id/date_decision (schema_reference.sql) ; jusqu'ici aucun
// écran ne l'exploitait (backlog section 16).
async function ptRenderAdminConges(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data, error } = await ptSupabase
    .from('conges')
    .select('*, technicien:profils!technicien_id(nom, prenom)')
    .order('date_debut', { ascending: false });
  if (error) throw error;

  const enAttente = data.filter((c) => c.statut === 'en_attente');
  const decides = data.filter((c) => c.statut !== 'en_attente');

  const ptLigneConge = (c, avecActions) => {
    const statut = PT_LABELS_STATUT_CONGE[c.statut] || PT_LABELS_STATUT_CONGE.en_attente;
    return `
      <li class="pt-jour-suivi" data-id="${c.id}">
        <div class="pt-jour-suivi-entete">
          <strong>${ptEchapperHtml(c.technicien?.prenom || '')} ${ptEchapperHtml(c.technicien?.nom || '')} — ${PT_LABELS_CONGE[c.type_conge] || c.type_conge}</strong>
          <span class="pt-badge ${statut.classe}">${statut.label}</span>
        </div>
        <div class="pt-jour-suivi-details">${c.date_debut} → ${c.date_fin}${c.commentaire ? ` — ${ptEchapperHtml(c.commentaire)}` : ''}</div>
        <div class="pt-admin-actions">
          ${avecActions ? `
            <button class="pt-btn pt-btn-petit pt-btn-accorder" data-id="${c.id}">Accorder</button>
            <button class="pt-btn pt-btn-secondaire pt-btn-petit pt-btn-refuser" data-id="${c.id}">Refuser</button>` : ''}
          <button class="pt-btn pt-btn-secondaire pt-btn-petit pt-btn-conge-pdf" data-id="${c.id}">PDF</button>
        </div>
      </li>`;
  };

  zoneContenu.innerHTML = `
    <h3 class="pt-recap-mois-titre">En attente (${enAttente.length})</h3>
    <ul class="pt-liste-suivi">
      ${enAttente.map((c) => ptLigneConge(c, true)).join('') || '<li class="pt-liste-vide">Aucune demande en attente.</li>'}
    </ul>

    <h3 class="pt-recap-mois-titre">Décidées</h3>
    <ul class="pt-liste-suivi">
      ${decides.map((c) => ptLigneConge(c, false)).join('') || '<li class="pt-liste-vide">Aucune demande décidée.</li>'}
    </ul>
    <p id="pt-conges-admin-erreur" class="pt-message-erreur" hidden></p>`;

  const decider = async (bouton, statut) => {
    bouton.disabled = true;
    const erreurEl = document.getElementById('pt-conges-admin-erreur');
    erreurEl.hidden = true;
    try {
      await ptDeciderConge(Number(bouton.dataset.id), statut);
      ptRenderAdminConges(zoneContenu, conteneur);
    } catch (erreur) {
      erreurEl.textContent = 'Échec de l\'enregistrement de la décision.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec décision congé : ${erreur.message}`, true);
      bouton.disabled = false;
    }
  };

  zoneContenu.querySelectorAll('.pt-btn-accorder').forEach((bouton) => {
    bouton.addEventListener('click', () => decider(bouton, 'accorde'));
  });
  zoneContenu.querySelectorAll('.pt-btn-refuser').forEach((bouton) => {
    bouton.addEventListener('click', () => decider(bouton, 'refuse'));
  });
  zoneContenu.querySelectorAll('.pt-btn-conge-pdf').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const conge = data.find((c) => c.id === Number(bouton.dataset.id));
      if (conge) ptExporterCongePdf(conge, `${conge.technicien?.prenom || ''} ${conge.technicien?.nom || ''}`);
    });
  });
}

async function ptDeciderConge(id, statut) {
  const { error } = await ptSupabase
    .from('conges')
    .update({ statut, decideur_id: S.session.user.id, date_decision: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// --- Profils : rôle, agence de rattachement, actif/inactif — jusqu'ici
// modifiable uniquement en SQL manuel (backlog section 12). Chaque
// changement est enregistré immédiatement (pas de bouton "Enregistrer").
async function ptRenderAdminProfils(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data, error } = await ptSupabase.from('profils').select('*').order('nom', { ascending: true });
  if (error) throw error;

  zoneContenu.innerHTML = `
    <p class="pt-info">Rôle, agence de rattachement (sert au calcul automatique des nuits inter-agence) et statut actif/inactif. Chaque changement est enregistré immédiatement.</p>
    <p class="pt-info">Régime D/E : à cocher pour un salarié classé formateur D ou E (CCN IDCC 1516, accord RTT du 06/12/1999, Titre IV). Sa ventilation horaire est alors comparée aux plafonds du Titre IV : part d'action de formation limitée à ${(PT_REGIME_DE.ratioAfMax * 100).toFixed(0)} % de AF+PR, ${PT_REGIME_DE.plafondAfAnnuel} h d'action de formation par an, base annuelle de ${PT_REGIME_DE.baseAnnuelle} h. Décoché = régime général (1 600 h, RTT 35-39 h).</p>
    <table class="pt-table-admin">
      <thead><tr><th>Nom</th><th>Rôle</th><th>Agence</th><th>Régime D/E</th><th>Actif</th></tr></thead>
      <tbody>
        ${data.map((p) => `
          <tr>
            <td>${ptEchapperHtml(p.prenom)} ${ptEchapperHtml(p.nom)}</td>
            <td>
              <select class="pt-profil-role" data-id="${p.id}">
                ${Object.entries(PT_LABELS_ROLE).map(([v, l]) => `<option value="${v}" ${p.role === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </td>
            <td>
              <select class="pt-profil-agence" data-id="${p.id}">
                <option value="" ${!p.agence_rattachement ? 'selected' : ''}>—</option>
                <option value="BFS_85" ${p.agence_rattachement === 'BFS_85' ? 'selected' : ''}>BFS 85</option>
                <option value="BFS_29" ${p.agence_rattachement === 'BFS_29' ? 'selected' : ''}>BFS 29</option>
              </select>
            </td>
            <td>
              <input type="checkbox" class="pt-profil-regime-de" data-id="${p.id}" ${p.regime_formateur_de ? 'checked' : ''} title="Formateur D/E (CCN IDCC 1516, Titre IV)" />
            </td>
            <td>
              <input type="checkbox" class="pt-profil-actif" data-id="${p.id}" ${p.actif ? 'checked' : ''} />
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p id="pt-profils-erreur" class="pt-message-erreur" hidden></p>`;

  const gererErreur = (erreur) => {
    const erreurEl = document.getElementById('pt-profils-erreur');
    erreurEl.textContent = 'Échec de l\'enregistrement. Réessaie.';
    erreurEl.hidden = false;
    PT_DEBUG.log(`Échec modification profil : ${erreur.message}`, true);
  };

  zoneContenu.querySelectorAll('.pt-profil-role').forEach((select) => {
    select.addEventListener('change', async () => {
      try { await ptModifierProfil(select.dataset.id, { role: select.value }); }
      catch (erreur) { gererErreur(erreur); }
    });
  });
  zoneContenu.querySelectorAll('.pt-profil-agence').forEach((select) => {
    select.addEventListener('change', async () => {
      try { await ptModifierProfil(select.dataset.id, { agence_rattachement: select.value || null }); }
      catch (erreur) { gererErreur(erreur); }
    });
  });
  zoneContenu.querySelectorAll('.pt-profil-regime-de').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      try {
        await ptModifierProfil(checkbox.dataset.id, { regime_formateur_de: checkbox.checked });
        // Si l'admin modifie son propre régime, rafraîchir S.profil pour que
        // son propre onglet Suivi affiche (ou masque) les plafonds sans avoir
        // à recharger la page.
        if (checkbox.dataset.id === S.session.user.id) await ptChargerProfil();
      } catch (erreur) { gererErreur(erreur); }
    });
  });
  zoneContenu.querySelectorAll('.pt-profil-actif').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      try { await ptModifierProfil(checkbox.dataset.id, { actif: checkbox.checked }); }
      catch (erreur) { gererErreur(erreur); }
    });
  });
}

async function ptModifierProfil(id, champs) {
  const { error } = await ptSupabase.from('profils').update(champs).eq('id', id);
  if (error) throw error;
}

// --- Paramètres globaux (geoloc, comptage des heures de trajet par mode) —
// éditables sans redéploiement (schema_reference.sql, table parametres).
async function ptRenderAdminParametres(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data, error } = await ptSupabase.from('parametres').select('*').order('cle');
  if (error) throw error;

  zoneContenu.innerHTML = `
    <p class="pt-info">Modifiable sans redéploiement. Prend effet à la prochaine action des techniciens.</p>
    <ul class="pt-liste-suivi">
      ${data.map((p) => `
        <li class="pt-jour-suivi">
          <div class="pt-jour-suivi-entete">
            <strong>${ptEchapperHtml(PT_LABELS_PARAMETRE[p.cle] || p.cle)}</strong>
            <select class="pt-parametre-valeur" data-cle="${p.cle}">
              <option value="true" ${p.valeur === 'true' ? 'selected' : ''}>Activé</option>
              <option value="false" ${p.valeur !== 'true' ? 'selected' : ''}>Désactivé</option>
            </select>
          </div>
          ${p.description ? `<div class="pt-jour-suivi-details">${ptEchapperHtml(p.description)}</div>` : ''}
        </li>`).join('')}
    </ul>
    <p id="pt-parametres-erreur" class="pt-message-erreur" hidden></p>`;

  zoneContenu.querySelectorAll('.pt-parametre-valeur').forEach((select) => {
    select.addEventListener('change', async () => {
      const erreurEl = document.getElementById('pt-parametres-erreur');
      erreurEl.hidden = true;
      try {
        await ptModifierParametre(select.dataset.cle, select.value);
        await ptChargerParametres(); // recharge S.parametres pour le reste de l'appli (ex. geoloc_active)
      } catch (erreur) {
        erreurEl.textContent = 'Échec de l\'enregistrement. Réessaie.';
        erreurEl.hidden = false;
        PT_DEBUG.log(`Échec modification paramètre : ${erreur.message}`, true);
      }
    });
  });
}

async function ptModifierParametre(cle, valeur) {
  const { error } = await ptSupabase.from('parametres').update({ valeur, updated_at: new Date().toISOString() }).eq('cle', cle);
  if (error) throw error;
}

// --- Récap RH : par salarié, base de préparation des bulletins de paie
// (heures, RTT, jours travaillés, tickets resto, congés pris par type).
// Réutilise ptCalculerRecapAnnee (partagé avec l'onglet Suivi du
// technicien), paramétré sur le technicien choisi plutôt que l'utilisateur
// connecté. Demande de Jeremy (2026-08-06) : l'admin doit pouvoir gérer
// l'aspect RH (bulletins de paie, retrait congé, ticket resto), pas
// seulement l'administratif applicatif.
async function ptRenderAdminRh(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  // regime_formateur_de est chargé ici pour conditionner l'affichage des
  // plafonds du Titre IV au salarié sélectionné (et non à l'admin connecté).
  const { data: profils, error } = await ptSupabase.from('profils').select('id, nom, prenom, regime_formateur_de').order('nom');
  if (error) throw error;
  if (!profils.length) {
    zoneContenu.innerHTML = '<p class="pt-liste-vide">Aucun salarié.</p>';
    return;
  }
  if (!S.adminRhTechnicienId) S.adminRhTechnicienId = profils[0].id;

  zoneContenu.innerHTML = `
    <label>Salarié
      <select id="pt-rh-select-technicien">
        ${profils.map((p) => `<option value="${p.id}" ${p.id === S.adminRhTechnicienId ? 'selected' : ''}>${ptEchapperHtml(p.prenom)} ${ptEchapperHtml(p.nom)}</option>`).join('')}
      </select>
    </label>
    <div id="pt-rh-recap"></div>`;

  document.getElementById('pt-rh-select-technicien').addEventListener('change', (evenement) => {
    S.adminRhTechnicienId = evenement.target.value;
    ptRenderAdminRh(zoneContenu, conteneur);
  });

  const technicien = profils.find((p) => p.id === S.adminRhTechnicienId);
  await ptAfficherRecapRh(document.getElementById('pt-rh-recap'), zoneContenu, conteneur, technicien);
}

async function ptAfficherRecapRh(zoneRecap, zoneContenu, conteneur, technicien) {
  zoneRecap.innerHTML = `<p>Calcul en cours…</p>`;
  const recap = await ptCalculerRecapAnnee(S.adminRhAnnee, S.adminRhTechnicienId);
  const nomPrenom = `${technicien.prenom} ${technicien.nom}`;

  zoneRecap.innerHTML = `
    <div class="pt-suivi-annee-nav">
      <button id="pt-rh-annee-prec" class="pt-btn pt-btn-secondaire pt-btn-petit">« ${S.adminRhAnnee - 1}</button>
      <strong>${S.adminRhAnnee}</strong>
      <button id="pt-rh-annee-suiv" class="pt-btn pt-btn-secondaire pt-btn-petit">${S.adminRhAnnee + 1} »</button>
    </div>
    <div class="pt-admin-actions">
      <button id="pt-rh-btn-pdf" class="pt-btn pt-btn-secondaire pt-btn-petit">Exporter PDF</button>
      <button id="pt-rh-btn-excel" class="pt-btn pt-btn-secondaire pt-btn-petit">Exporter Excel</button>
    </div>
    ${ptRenderAlerteSejoursHtml(recap.sejoursAnormaux, 'Le salarié corrige lui-même dans Suivi > Déplacements ; le secrétariat peut aussi le faire depuis Gestion > Déplacements.')}
    <p class="pt-info">Base de préparation des bulletins de paie : heures, RTT, jours de déplacement, jours travaillés, tickets resto (règle paramétrable dans Paramètres) et congés pris par type.</p>
    <table class="pt-table-recap">
      <thead>
        <tr><th>Mois</th><th>Heures</th><th>Jours dépl.</th><th>RTT pris (j)</th><th>RTT dispo (h)</th><th>Jours trav.</th><th>Tickets resto</th></tr>
      </thead>
      <tbody>
        ${recap.mois.map((m) => `
          <tr>
            <td>${m.label}</td>
            <td>${m.heures.toFixed(2).replace('.', ',')}</td>
            <td>${m.joursDeplacement}</td>
            <td>${m.rttPrisJours}</td>
            <td>${m.rttDispoHeures.toFixed(2).replace('.', ',')}</td>
            <td>${m.joursTravailles}</td>
            <td>${m.ticketsResto}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>${recap.total.heures.toFixed(2).replace('.', ',')}</strong></td>
          <td><strong>${recap.total.joursDeplacement}</strong></td>
          <td><strong>${recap.total.rttPrisJours}</strong></td>
          <td><strong>${recap.total.rttDispoHeures.toFixed(2).replace('.', ',')}</strong></td>
          <td><strong>${recap.total.joursTravailles}</strong></td>
          <td><strong>${recap.total.ticketsResto}</strong></td>
        </tr>
      </tfoot>
    </table>

    <h3 class="pt-recap-mois-titre">Congés pris par type (année ${S.adminRhAnnee})</h3>
    <table class="pt-table-admin">
      <thead><tr><th>Type</th><th>Jours</th></tr></thead>
      <tbody>
        ${Object.entries(PT_LABELS_CONGE).map(([type, label]) => `
          <tr><td>${label}</td><td>${recap.total.congesParType[type] || 0}</td></tr>`).join('')}
      </tbody>
    </table>
    ${ptRenderVentilationCcnHtml(recap, Boolean(technicien.regime_formateur_de), S.adminRhAnnee)}`;

  document.getElementById('pt-rh-annee-prec').addEventListener('click', () => {
    S.adminRhAnnee -= 1;
    ptAfficherRecapRh(zoneRecap, zoneContenu, conteneur, technicien);
  });
  document.getElementById('pt-rh-annee-suiv').addEventListener('click', () => {
    S.adminRhAnnee += 1;
    ptAfficherRecapRh(zoneRecap, zoneContenu, conteneur, technicien);
  });
  const regimeActif = Boolean(technicien.regime_formateur_de);
  document.getElementById('pt-rh-btn-pdf').addEventListener('click', () => ptExporterRecapRhPdf(recap, nomPrenom, S.adminRhAnnee, regimeActif));
  document.getElementById('pt-rh-btn-excel').addEventListener('click', () => ptExporterRecapRhExcel(recap, nomPrenom, S.adminRhAnnee, regimeActif));
}

function ptExporterRecapRhPdf(recap, nomPrenom, annee, regimeActif = false) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Récap RH ${annee} — ${nomPrenom}`, 14, 16);
  doc.autoTable({
    startY: 24,
    head: [['Mois', 'Heures', 'Jours dépl.', 'RTT pris (j)', 'RTT dispo (h)', 'Jours trav.', 'Tickets resto']],
    body: recap.mois.map((m) => [
      m.label,
      m.heures.toFixed(2).replace('.', ','),
      String(m.joursDeplacement),
      String(m.rttPrisJours),
      m.rttDispoHeures.toFixed(2).replace('.', ','),
      String(m.joursTravailles),
      String(m.ticketsResto),
    ]),
    foot: [[
      'Total',
      recap.total.heures.toFixed(2).replace('.', ','),
      String(recap.total.joursDeplacement),
      String(recap.total.rttPrisJours),
      recap.total.rttDispoHeures.toFixed(2).replace('.', ','),
      String(recap.total.joursTravailles),
      String(recap.total.ticketsResto),
    ]],
    styles: { fontSize: 8 },
  });
  const yApresTableau = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.text('Congés pris par type :', 14, yApresTableau);
  doc.autoTable({
    startY: yApresTableau + 4,
    head: [['Type', 'Jours']],
    body: Object.entries(PT_LABELS_CONGE).map(([type, label]) => [label, String(recap.total.congesParType[type] || 0)]),
    styles: { fontSize: 9 },
  });
  ptAjouterVentilationPdf(doc, recap, regimeActif);
  doc.save(`recap_rh_${annee}_${nomPrenom.replace(/\s+/g, '_')}.pdf`);
}

function ptExporterRecapRhExcel(recap, nomPrenom, annee, regimeActif = false) {
  const lignesMois = recap.mois.map((m) => ({
    Mois: m.label,
    Heures: Number(m.heures.toFixed(2)),
    'Jours déplacement': m.joursDeplacement,
    'RTT pris (j)': m.rttPrisJours,
    'RTT dispo (h)': Number(m.rttDispoHeures.toFixed(2)),
    'Jours travaillés': m.joursTravailles,
    'Tickets resto': m.ticketsResto,
  }));
  lignesMois.push({
    Mois: 'Total',
    Heures: Number(recap.total.heures.toFixed(2)),
    'Jours déplacement': recap.total.joursDeplacement,
    'RTT pris (j)': recap.total.rttPrisJours,
    'RTT dispo (h)': Number(recap.total.rttDispoHeures.toFixed(2)),
    'Jours travaillés': recap.total.joursTravailles,
    'Tickets resto': recap.total.ticketsResto,
  });
  const lignesConges = Object.entries(PT_LABELS_CONGE).map(([type, label]) => ({
    Type: label,
    Jours: recap.total.congesParType[type] || 0,
  }));

  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignesMois), 'Récap mensuel');
  XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignesConges), 'Congés par type');
  XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(ptLignesVentilationExcel(recap)), 'Ventilation CCN');
  if (regimeActif) {
    const lignesRegime = ptLignesRegimeDe(recap).map(([indicateur, constate, plafond, etat]) => ({
      Indicateur: indicateur, Constaté: constate, Plafond: plafond, État: etat,
    }));
    XLSX.utils.book_append_sheet(classeur, XLSX.utils.json_to_sheet(lignesRegime), 'Régime D-E');
  }
  XLSX.writeFile(classeur, `recap_rh_${annee}_${nomPrenom.replace(/\s+/g, '_')}.xlsx`);
}

// --- Onglet Secrétariat : congés/déplacements/frais pour tous les
// techniciens, lecture seule sur les pointages (rôle défini section 1 du
// mémoire). La RLS autorise déjà secretariat sur conges/deplacements/frais
// (schema_reference.sql) ; aucune écriture sur profils/horodatages/activites.
const PT_LABELS_STATUT_FRAIS = {
  en_attente: { label: 'En attente', classe: '' },
  rembourse: { label: 'Remboursé', classe: 'pt-badge-ok' },
  refuse: { label: 'Refusé', classe: 'pt-badge-alerte' },
};

async function ptRenderOngletSecretariat(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;

  const vues = [
    { id: 'conges', label: 'Congés' },
    { id: 'deplacements', label: 'Déplacements' },
    { id: 'frais', label: 'Frais' },
    { id: 'pointages', label: 'Pointages (lecture seule)' },
  ];

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Gestion — Secrétariat</h2>
      <div class="pt-suivi-onglets">
        ${vues.map((v) => `<button class="pt-btn ${S.secretariatVue === v.id ? '' : 'pt-btn-secondaire'} pt-btn-petit" data-vue="${v.id}">${v.label}</button>`).join('')}
      </div>
      <div id="pt-secretariat-contenu"></div>
    </section>`;

  document.querySelectorAll('.pt-suivi-onglets button').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      S.secretariatVue = bouton.dataset.vue;
      ptRenderOngletSecretariat(conteneur);
    });
  });

  const zoneContenu = document.getElementById('pt-secretariat-contenu');
  const rendusSecretariat = {
    conges: ptRenderAdminConges, // même logique de décision que côté admin (rôles autorisés identiques par la RLS)
    deplacements: ptRenderSecretariatDeplacements,
    frais: ptRenderSecretariatFrais,
    pointages: ptRenderSecretariatPointages,
  };
  await (rendusSecretariat[S.secretariatVue] || ptRenderAdminConges)(zoneContenu, conteneur);
}

// --- Déplacements : vue/ajout pour tous les techniciens (secrétariat a
// lecture/écriture complète, cf. RLS deplacements_*). ------------------------
async function ptRenderSecretariatDeplacements(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const [profilsRes, deplacementsRes] = await Promise.all([
    ptSupabase.from('profils').select('id, nom, prenom').order('nom'),
    ptSupabase.from('deplacements').select('*, technicien:profils!technicien_id(nom, prenom)').order('date_aller', { ascending: false }).limit(60),
  ]);
  if (profilsRes.error) throw profilsRes.error;
  if (deplacementsRes.error) throw deplacementsRes.error;

  zoneContenu.innerHTML = `
    <form id="pt-form-deplacement-secretariat" class="pt-form-activite">
      <label>Technicien
        <select name="technicien_id" required>
          ${profilsRes.data.map((p) => `<option value="${p.id}">${ptEchapperHtml(p.prenom)} ${ptEchapperHtml(p.nom)}</option>`).join('')}
        </select>
      </label>
      <label>Date aller <input type="date" name="date_aller" required /></label>
      <label>Date retour <input type="date" name="date_retour" /></label>
      <label>Nuitées avec petit-déj <input type="number" name="nuitees_avec_petit_dej" min="0" value="0" /></label>
      <label>Nuitées sans petit-déj <input type="number" name="nuitees_sans_petit_dej" min="0" value="0" /></label>
      <label>Mode de trajet
        <select name="mode_trajet">
          <option value="">—</option>
          <option value="conducteur_vehicule_service">Conducteur véhicule de service</option>
          <option value="passager">Passager</option>
          <option value="vehicule_personnel">Véhicule personnel</option>
        </select>
      </label>
      <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
      <button type="submit" class="pt-btn pt-btn-petit">Ajouter</button>
      <p id="pt-deplacement-secretariat-erreur" class="pt-message-erreur" hidden></p>
    </form>

    <h3 class="pt-recap-mois-titre">Derniers déplacements (tous techniciens)</h3>
    <ul class="pt-liste-suivi">
      ${deplacementsRes.data.map((d) => `
        <li class="pt-jour-suivi" data-id="${d.id}">
          <div class="pt-jour-suivi-entete">
            <strong>${ptEchapperHtml(d.technicien?.prenom || '')} ${ptEchapperHtml(d.technicien?.nom || '')}</strong>
            <button class="pt-btn pt-btn-secondaire pt-btn-petit pt-btn-supprimer-deplacement" data-id="${d.id}">Supprimer</button>
          </div>
          <div class="pt-jour-suivi-details">${d.date_aller} → ${d.date_retour || d.date_aller}${d.nuitees_avec_petit_dej ? ` — ${d.nuitees_avec_petit_dej} nuitée(s) avec p-déj` : ''}${d.nuitees_sans_petit_dej ? ` — ${d.nuitees_sans_petit_dej} nuitée(s) sans p-déj` : ''}${d.commentaire ? ` — ${ptEchapperHtml(d.commentaire)}` : ''}</div>
        </li>`).join('') || '<li class="pt-liste-vide">Aucun déplacement récent.</li>'}
    </ul>`;

  document.getElementById('pt-form-deplacement-secretariat').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const erreurEl = document.getElementById('pt-deplacement-secretariat-erreur');
    erreurEl.hidden = true;
    try {
      await ptAjouterDeplacementPourTechnicien({
        technicien_id: formulaire.get('technicien_id'),
        date_aller: formulaire.get('date_aller'),
        date_retour: formulaire.get('date_retour') || null,
        nuitees_avec_petit_dej: Number(formulaire.get('nuitees_avec_petit_dej')) || 0,
        nuitees_sans_petit_dej: Number(formulaire.get('nuitees_sans_petit_dej')) || 0,
        mode_trajet: formulaire.get('mode_trajet') || null,
        commentaire: formulaire.get('commentaire') || null,
      });
      ptRenderSecretariatDeplacements(zoneContenu, conteneur);
    } catch (erreur) {
      erreurEl.textContent = 'Échec de l\'ajout du déplacement.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec ajout déplacement (secrétariat) : ${erreur.message}`, true);
    }
  });

  zoneContenu.querySelectorAll('.pt-btn-supprimer-deplacement').forEach((bouton) => {
    bouton.addEventListener('click', async () => {
      bouton.disabled = true;
      try {
        await ptSupprimerDeplacement(Number(bouton.dataset.id));
        ptRenderSecretariatDeplacements(zoneContenu, conteneur);
      } catch (erreur) {
        PT_DEBUG.log(`Échec suppression déplacement : ${erreur.message}`, true);
        bouton.disabled = false;
      }
    });
  });
}

async function ptAjouterDeplacementPourTechnicien(champs) {
  const { error } = await ptSupabase.from('deplacements').insert(champs);
  if (error) throw error;
}

async function ptSupprimerDeplacement(id) {
  const { error } = await ptSupabase.from('deplacements').delete().eq('id', id);
  if (error) throw error;
}

// --- Frais : vue/ajout/décision pour tous les techniciens -----------------
async function ptRenderSecretariatFrais(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const [profilsRes, fraisRes] = await Promise.all([
    ptSupabase.from('profils').select('id, nom, prenom').order('nom'),
    ptSupabase.from('frais').select('*, technicien:profils!technicien_id(nom, prenom)').order('date', { ascending: false }).limit(60),
  ]);
  if (profilsRes.error) throw profilsRes.error;
  if (fraisRes.error) throw fraisRes.error;

  zoneContenu.innerHTML = `
    <form id="pt-form-frais-secretariat" class="pt-form-activite">
      <label>Technicien
        <select name="technicien_id" required>
          ${profilsRes.data.map((p) => `<option value="${p.id}">${ptEchapperHtml(p.prenom)} ${ptEchapperHtml(p.nom)}</option>`).join('')}
        </select>
      </label>
      <label>Date <input type="date" name="date" required /></label>
      <label>N° justificatif <input type="text" name="numero_justificatif" maxlength="50" /></label>
      <label>Montant (€) <input type="number" name="montant" min="0" step="0.01" required /></label>
      <label>Type de frais <input type="text" name="type_frais" maxlength="100" /></label>
      <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
      <button type="submit" class="pt-btn pt-btn-petit">Ajouter</button>
      <p id="pt-frais-secretariat-erreur" class="pt-message-erreur" hidden></p>
    </form>

    <h3 class="pt-recap-mois-titre">Derniers frais (tous techniciens)</h3>
    <ul class="pt-liste-suivi">
      ${fraisRes.data.map((f) => `
        <li class="pt-jour-suivi" data-id="${f.id}">
          <div class="pt-jour-suivi-entete">
            <strong>${ptEchapperHtml(f.technicien?.prenom || '')} ${ptEchapperHtml(f.technicien?.nom || '')} — ${Number(f.montant).toFixed(2).replace('.', ',')} €</strong>
            <select class="pt-frais-statut" data-id="${f.id}">
              ${Object.entries(PT_LABELS_STATUT_FRAIS).map(([v, l]) => `<option value="${v}" ${f.statut === v ? 'selected' : ''}>${l.label}</option>`).join('')}
            </select>
          </div>
          <div class="pt-jour-suivi-details">${f.date}${f.numero_justificatif ? ` — Justificatif n°${ptEchapperHtml(f.numero_justificatif)}` : ''}${f.type_frais ? ` — ${ptEchapperHtml(f.type_frais)}` : ''}${f.commentaire ? ` — ${ptEchapperHtml(f.commentaire)}` : ''}</div>
        </li>`).join('') || '<li class="pt-liste-vide">Aucun frais récent.</li>'}
    </ul>`;

  document.getElementById('pt-form-frais-secretariat').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = new FormData(evenement.target);
    const erreurEl = document.getElementById('pt-frais-secretariat-erreur');
    erreurEl.hidden = true;
    try {
      await ptAjouterFraisPourTechnicien({
        technicien_id: formulaire.get('technicien_id'),
        date: formulaire.get('date'),
        numero_justificatif: formulaire.get('numero_justificatif') || null,
        montant: Number(formulaire.get('montant')),
        type_frais: formulaire.get('type_frais') || null,
        commentaire: formulaire.get('commentaire') || null,
      });
      ptRenderSecretariatFrais(zoneContenu, conteneur);
    } catch (erreur) {
      erreurEl.textContent = 'Échec de l\'ajout du frais.';
      erreurEl.hidden = false;
      PT_DEBUG.log(`Échec ajout frais (secrétariat) : ${erreur.message}`, true);
    }
  });

  zoneContenu.querySelectorAll('.pt-frais-statut').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await ptModifierStatutFrais(Number(select.dataset.id), select.value);
      } catch (erreur) {
        PT_DEBUG.log(`Échec modification statut frais : ${erreur.message}`, true);
      }
    });
  });
}

async function ptAjouterFraisPourTechnicien(champs) {
  const { error } = await ptSupabase.from('frais').insert(champs);
  if (error) throw error;
}

async function ptModifierStatutFrais(id, statut) {
  const { error } = await ptSupabase.from('frais').update({ statut }).eq('id', id);
  if (error) throw error;
}

// --- Pointages : lecture seule, technicien par technicien (rôle défini
// section 1 du mémoire — secrétariat ne peut pas écrire sur
// horodatages/activites, la RLS le confirme). Réutilise la logique de
// regroupement par jour de l'onglet Suivi, appliquée à un technicien choisi.
async function ptRenderSecretariatPointages(zoneContenu, conteneur) {
  zoneContenu.innerHTML = `<p>Chargement…</p>`;
  const { data: profils, error } = await ptSupabase.from('profils').select('id, nom, prenom').order('nom');
  if (error) throw error;
  if (!profils.length) {
    zoneContenu.innerHTML = '<p class="pt-liste-vide">Aucun technicien.</p>';
    return;
  }
  if (!S.secretariatTechnicienId) S.secretariatTechnicienId = profils[0].id;

  zoneContenu.innerHTML = `
    <label>Technicien
      <select id="pt-secretariat-select-technicien">
        ${profils.map((p) => `<option value="${p.id}" ${p.id === S.secretariatTechnicienId ? 'selected' : ''}>${ptEchapperHtml(p.prenom)} ${ptEchapperHtml(p.nom)}</option>`).join('')}
      </select>
    </label>
    <div id="pt-secretariat-pointages-liste"></div>`;

  document.getElementById('pt-secretariat-select-technicien').addEventListener('change', (evenement) => {
    S.secretariatTechnicienId = evenement.target.value;
    S.secretariatNbJours = 14;
    ptRenderSecretariatPointages(zoneContenu, conteneur);
  });

  await ptAfficherPointagesTechnicien(document.getElementById('pt-secretariat-pointages-liste'), zoneContenu, conteneur);
}

async function ptAfficherPointagesTechnicien(zoneListe, zoneContenu, conteneur) {
  // Centres et formations nécessaires pour résoudre les libellés affichés
  // par ptRenderActivitesMatinApresMidi (même rendu que l'onglet Suivi).
  const [{ horodatages, activites }] = await Promise.all([
    ptChargerHistoriquePointageTechnicien(S.secretariatTechnicienId, S.secretariatNbJours),
    ptChargerCentres(),
    ptChargerFormations(),
  ]);
  const jours = ptRegrouperParJour(horodatages, activites, S.secretariatNbJours);

  zoneListe.innerHTML = `
    <p class="pt-info">Lecture seule — les ${S.secretariatNbJours} derniers jours, du plus récent au plus ancien.</p>
    <ul class="pt-liste-suivi">
      ${jours.map((j) => `
        <li class="pt-jour-suivi">
          <div class="pt-jour-suivi-entete">
            <strong>${ptFormatDateCourte(j.date)}</strong>
            ${j.horodatages.length === 0
              ? '<span class="pt-badge">aucun pointage</span>'
              : j.complet
                ? `<span class="pt-badge pt-badge-ok">${j.heures.toFixed(2).replace('.', ',')} h</span>`
                : '<span class="pt-badge pt-badge-alerte">incomplet</span>'}
          </div>
          ${j.horodatages.length > 0
            ? `<div class="pt-jour-suivi-details">${j.horodatages.map((h) => `${ptFormatHeure(h.moment)} ${PT_LABELS_HORODATAGE[h.type_horodatage] || h.type_horodatage}`).join(' · ')}</div>`
            : ''}
          ${ptRenderActivitesMatinApresMidi(j)}
        </li>`).join('') || '<li class="pt-liste-vide">Aucune donnée sur cette période.</li>'}
    </ul>
    <button id="pt-btn-secretariat-plus" class="pt-btn pt-btn-secondaire pt-btn-petit">Voir plus de jours</button>`;

  document.getElementById('pt-btn-secretariat-plus').addEventListener('click', () => {
    S.secretariatNbJours += 14;
    ptAfficherPointagesTechnicien(zoneListe, zoneContenu, conteneur);
  });
}

async function ptChargerHistoriquePointageTechnicien(technicienId, nbJours) {
  const dateDebut = new Date();
  dateDebut.setDate(dateDebut.getDate() - nbJours);
  const dateDebutIso = dateDebut.toLocaleDateString('sv-SE');

  const [horodatages, activites] = await Promise.all([
    ptSupabase.from('horodatages').select('date, moment, type_horodatage')
      .eq('technicien_id', technicienId)
      .in('type_horodatage', ['arrivee', 'pause_debut', 'pause_fin', 'depart'])
      .gte('date', dateDebutIso)
      .order('moment', { ascending: true }),
    // Mêmes colonnes que ptChargerHistoriqueSuivi : le secrétariat voit le
    // même détail matin/après-midi et les mêmes tâches que le salarié.
    ptSupabase.from('activites')
      .select('date, type_activite, heure_debut, heure_fin, formation_code, centre_code, commentaire, details')
      .eq('technicien_id', technicienId)
      .gte('date', dateDebutIso),
  ]);
  if (horodatages.error) throw horodatages.error;
  if (activites.error) throw activites.error;
  return { horodatages: horodatages.data, activites: activites.data };
}

// --- Onglet Pointage : bouton intelligent et activités --------------------
async function ptRenderOngletPointage(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;
  await Promise.all([
    ptChargerHorodatagesJour(),
    ptChargerCentres(),
    ptChargerFormations(),
    ptChargerDeplacementsRecents(),
    ptChargerHorodatagesTrajetTous(),
    ptChargerActiviteBlocEnCours(),
  ]);

  const horodatagesPrincipaux = S.horodatagesJour.filter((h) => h.type_horodatage in PT_TYPES_HORODATAGE);

  const prochaine = ptProchaineAction(horodatagesPrincipaux);
  const alerte = ptVerifierAlertePause(horodatagesPrincipaux);
  // Fusion demandée par Jeremy (2026-08-06, sections 28/29 du mémoire) : au
  // début d'un bloc de travail — arrivée du matin OU retour de pause l'après-
  // midi, qui peut avoir une activité différente du matin — le bouton
  // embarque directement la catégorie d'activité, pour ne pas remplir le
  // pointage puis l'activité séparément. Ne s'applique pas au début de pause
  // ni à la fin de journée (rien à démarrer). Le formulaire "Activité du
  // jour" séparé a été retiré (section 32 du mémoire) : il faisait doublon
  // dès qu'il n'y avait qu'une seule activité par bloc — la saisie passe
  // désormais uniquement par ce formulaire fusionné.
  const demarrageBlocTravail = Boolean(prochaine) && (prochaine.type === 'arrivee' || prochaine.type === 'pause_fin');
  // Symétrique de la fusion ci-dessus (demande Jeremy, 2026-08-25) : à la
  // clôture d'un bloc — début de pause méridienne OU fin de journée — le
  // salarié détaille ce qu'il a réellement fait. Au démarrage il ne le sait
  // pas encore, à la clôture si. Le détail est obligatoire, sauf pour une
  // action de formation où la formation sélectionnée décrit déjà le bloc.
  const clotureBlocTravail = Boolean(prochaine) && (prochaine.type === 'pause_debut' || prochaine.type === 'depart');
  const activiteBloc = S.activiteBlocEnCours;
  const clotureAvecTaches = clotureBlocTravail && Boolean(activiteBloc) && activiteBloc.type_activite !== 'acte_formation';
  // Bug corrigé (2026-08-06, section 25 du mémoire) : le bouton trajet
  // inter-agence doit regarder tout l'historique récent (S.horodatagesTrajetTous,
  // déjà chargé pour le calcul des séjours), pas seulement les pointages du
  // jour — sinon un séjour à cheval sur plusieurs jours (départ pointé un
  // jour précédent, pas encore de retour) fait croire qu'aucun trajet n'est
  // en cours et propose de repartir au lieu de rentrer.
  const prochainTrajet = ptProchaineActionTrajet(S.horodatagesTrajetTous);
  // Libellé du bouton contextualisé (demande Jeremy, 2026-08-06, section 26
  // du mémoire) : "Pointer le départ (départ/arrivée)" pour un aller,
  // "Pointer le retour (départ/arrivée)" dès qu'un séjour est en cours —
  // évite l'ambiguïté du libellé générique "trajet inter-agence" une fois
  // arrivé à l'autre agence.
  const enDeplacementInterAgence = ptEnDeplacementInterAgence(S.horodatagesTrajetTous);
  const labelBoutonTrajet = ptLabelBoutonTrajet(prochainTrajet.type, enDeplacementInterAgence);
  const sejoursInterAgence = S.profil.agence_rattachement
    ? ptCalculerSejoursInterAgence(S.horodatagesTrajetTous)
    : [];

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Aujourd'hui — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>

      ${alerte ? `<p class="pt-alerte">${ptEchapperHtml(alerte)}</p>` : ''}

      <ul class="pt-liste-horodatages">
        ${S.horodatagesJour.map((h) => `<li>${ptFormatHeure(h.moment)} — ${PT_LABELS_HORODATAGE[h.type_horodatage] || ptEchapperHtml(h.type_horodatage)}${h.saisi_a_posteriori ? ' <span class="pt-badge">saisi à la main</span>' : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucun pointage pour l\'instant.</li>'}
      </ul>

      ${prochaine
        ? (demarrageBlocTravail
            ? `<form id="pt-form-debut-journee" class="pt-form-activite">
                 <p class="pt-info">Pointage et activité en un seul geste : indique ce sur quoi tu démarres.</p>
                 <label>Catégorie
                   <select name="type_activite" id="pt-debut-activite-type">
                     ${Object.entries(PT_LABELS_ACTIVITE).map(([valeur, libelle]) => `<option value="${valeur}">${libelle}</option>`).join('')}
                   </select>
                 </label>
                 <label id="pt-debut-activite-formation-champ">Formation
                   <select name="formation_code">
                     <option value="">—</option>
                     ${S.formations.map((f) => `<option value="${f.code}">${ptEchapperHtml(f.libelle)}</option>`).join('')}
                   </select>
                 </label>
                 <label>Centre
                   <select name="centre_code">
                     <option value="">—</option>
                     ${S.centres.map((c) => `<option value="${c.code}">${ptEchapperHtml(c.libelle)}</option>`).join('')}
                   </select>
                 </label>
                 <label>Commentaire <input type="text" name="commentaire" maxlength="200" /></label>
                 <button type="submit" class="pt-btn pt-btn-grand">${ptEchapperHtml(prochaine.label)}</button>
               </form>`
            : clotureAvecTaches
              ? `<form id="pt-form-cloture-bloc" class="pt-form-activite">
                   <p class="pt-info">Avant de pointer, précise ce que tu as fait depuis ${activiteBloc.heure_debut ? ptEchapperHtml(activiteBloc.heure_debut.slice(0, 5)) : 'le début du bloc'} (${ptEchapperHtml(PT_LABELS_ACTIVITE[activiteBloc.type_activite] || activiteBloc.type_activite)}). Ajoute autant de lignes que nécessaire.</p>
                   <div class="pt-tache-ajout">
                     <input type="text" id="pt-tache-saisie" maxlength="150" placeholder="Ex. nettoyage engins" />
                     <button type="button" id="pt-btn-ajouter-tache" class="pt-btn pt-btn-secondaire pt-btn-petit">Ajouter</button>
                   </div>
                   <ul id="pt-taches-liste" class="pt-liste-taches"></ul>
                   <p id="pt-cloture-erreur" class="pt-message-erreur" hidden></p>
                   <button type="submit" class="pt-btn pt-btn-grand">${ptEchapperHtml(prochaine.label)}</button>
                 </form>`
              : `<button id="pt-btn-pointer" class="pt-btn pt-btn-grand">${ptEchapperHtml(prochaine.label)}</button>`)
        : `<p class="pt-info">Journée déjà bouclée. Utilise la saisie manuelle ci-dessous si besoin d'une correction.</p>`}

      <button id="pt-btn-saisie-manuelle" class="pt-btn pt-btn-secondaire pt-btn-petit">Saisir un horodatage manquant</button>
      <form id="pt-form-manuel" hidden class="pt-form-manuel">
        <label>Type
          <select name="type">
            <option value="arrivee">Arrivée</option>
            <option value="pause_debut">Début de pause méridienne</option>
            <option value="pause_fin">Fin de pause méridienne</option>
            <option value="depart">Départ</option>
            <option value="trajet_inter_site_debut">Départ trajet inter-agence (aller ou retour)</option>
            <option value="trajet_inter_site_fin">Arrivée trajet inter-agence (aller ou retour)</option>
          </select>
        </label>
        <label>Date <input type="date" name="date" value="${ptDateDuJour()}" required /></label>
        <label>Heure
          <input type="time" name="heure" required />
        </label>
        <button type="submit" class="pt-btn pt-btn-petit">Valider</button>
      </form>
    </section>

    <section class="pt-carte">
      <h2>Trajet inter-agence</h2>
      ${enDeplacementInterAgence ? '<span class="pt-badge pt-badge-ok">Déplacement en cours</span>' : ''}
      <p class="pt-info">Trajet entre deux lieux de travail (ex. BFS 85 ↔ BFS 29) : peut se pointer à tout moment, y compris un jour non ouvré. Compte comme temps de travail effectif (règle CCN).</p>
      <button id="pt-btn-trajet" class="pt-btn pt-btn-grand">${ptEchapperHtml(labelBoutonTrajet)}</button>
    </section>

    <section class="pt-carte">
      <h2>Nuits inter-agence (calcul automatique)</h2>
      ${S.profil.agence_rattachement
        ? `<p class="pt-info">Calculé à partir de tes trajets pointés et de ton agence de rattachement (${ptEchapperHtml(ptLibelleCentre(S.profil.agence_rattachement))}).</p>
           <ul class="pt-liste-activites">
             ${sejoursInterAgence.map((s) => `<li>Arrivée le ${s.dateArrivee} ${s.dateDepart ? `— retour le ${s.dateDepart}` : '— en cours'} — ${s.nuits} nuit(s)</li>`).join('') || '<li class="pt-liste-vide">Aucun séjour inter-agence détecté récemment.</li>'}
           </ul>`
        : `<p class="pt-info">Ton agence de rattachement n'est pas encore renseignée par l'admin — le calcul automatique n'est pas actif.</p>`}
    </section>

    <section class="pt-carte">
      <h2>Nuit en déplacement chez un client</h2>
      <p class="pt-info">Pour un déplacement chez un client (centre Intra), à utiliser le soir quand tu as une nuitée (ex. départ dimanche pour la Vendée). Pas besoin pour un trajet entre BFS 85 et BFS 29 : ça se calcule automatiquement ci-dessus.</p>
      <label>Destination <input type="text" id="pt-nuitee-commentaire" maxlength="100" placeholder="Ex. client XYZ" /></label>
      <div class="pt-nuitee-boutons">
        <button id="pt-btn-nuitee-avec" class="pt-btn pt-btn-petit">+ Nuitée avec petit-déj</button>
        <button id="pt-btn-nuitee-sans" class="pt-btn pt-btn-secondaire pt-btn-petit">+ Nuitée sans petit-déj</button>
      </div>
      <ul class="pt-liste-activites">
        ${S.deplacementsRecents.map((d) => `<li>${d.date_aller}${d.nuitees_avec_petit_dej ? ` — ${d.nuitees_avec_petit_dej} nuitée(s) avec petit-déj` : ''}${d.nuitees_sans_petit_dej ? ` — ${d.nuitees_sans_petit_dej} nuitée(s) sans petit-déj` : ''}${d.commentaire ? ` — ${ptEchapperHtml(d.commentaire)}` : ''}</li>`).join('') || '<li class="pt-liste-vide">Aucune nuitée récente.</li>'}
      </ul>
    </section>`;

  if (demarrageBlocTravail) {
    const formDebutJournee = document.getElementById('pt-form-debut-journee');
    const champTypeDebut = document.getElementById('pt-debut-activite-type');
    const champFormationDebut = document.getElementById('pt-debut-activite-formation-champ');
    const majAffichageFormationDebut = () => {
      champFormationDebut.style.display = champTypeDebut.value === 'acte_formation' ? '' : 'none';
    };
    majAffichageFormationDebut();
    champTypeDebut.addEventListener('change', majAffichageFormationDebut);

    formDebutJournee.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const formulaire = new FormData(evenement.target);
      const boutonSubmit = formDebutJournee.querySelector('button[type="submit"]');
      boutonSubmit.disabled = true;
      try {
        // Bug corrigé (2026-08-06, section 30 du mémoire) : type codé en dur
        // à 'arrivee' au lieu de prochaine.type — cassait le retour de pause
        // (qui doit enregistrer 'pause_fin'), provoquant une boucle
        // arrivée/début de pause sans fin.
        await ptEnregistrerHorodatage(prochaine.type);
        await ptAjouterActivite({
          type_activite: formulaire.get('type_activite'),
          formation_code: formulaire.get('type_activite') === 'acte_formation' ? (formulaire.get('formation_code') || null) : null,
          centre_code: formulaire.get('centre_code') || null,
          heure_debut: new Date().toTimeString().slice(0, 5),
          heure_fin: null,
          commentaire: formulaire.get('commentaire') || null,
        });
        ptRenderOngletPointage(conteneur);
      } catch (erreur) {
        PT_DEBUG.log(`Échec du démarrage de journée : ${erreur.message}`, true);
        boutonSubmit.disabled = false;
      }
    });
  } else if (clotureAvecTaches) {
    const formCloture = document.getElementById('pt-form-cloture-bloc');
    const champTache = document.getElementById('pt-tache-saisie');
    const listeTaches = document.getElementById('pt-taches-liste');
    const erreurCloture = document.getElementById('pt-cloture-erreur');
    // Copie : on ne modifie S.activiteBlocEnCours qu'une fois l'enregistrement
    // réussi (le rendu est relancé derrière et rechargera la valeur réelle).
    const taches = [...(activiteBloc.details || [])];

    const rendreTaches = () => {
      listeTaches.innerHTML = taches.length
        ? taches.map((tache, index) => `<li>${ptEchapperHtml(tache)} <button type="button" class="pt-tache-retirer" data-index="${index}" title="Retirer cette tâche">✕</button></li>`).join('')
        : '<li class="pt-liste-vide">Aucune tâche ajoutée pour l\'instant.</li>';
      listeTaches.querySelectorAll('.pt-tache-retirer').forEach((bouton) => {
        bouton.addEventListener('click', () => {
          taches.splice(Number(bouton.dataset.index), 1);
          rendreTaches();
        });
      });
    };

    const ajouterTache = () => {
      const valeur = champTache.value.trim();
      if (!valeur) return;
      taches.push(valeur);
      champTache.value = '';
      erreurCloture.hidden = true;
      rendreTaches();
      champTache.focus();
    };

    rendreTaches();
    document.getElementById('pt-btn-ajouter-tache').addEventListener('click', ajouterTache);
    // Entrée dans le champ = ajouter une tâche, surtout pas soumettre le
    // formulaire (ce qui pointerait la pause par accident).
    champTache.addEventListener('keydown', (evenement) => {
      if (evenement.key !== 'Enter') return;
      evenement.preventDefault();
      ajouterTache();
    });

    formCloture.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      // Tolérance : une tâche tapée mais pas encore validée par "Ajouter" ne
      // doit pas être perdue au moment de pointer.
      if (champTache.value.trim()) ajouterTache();
      if (!taches.length) {
        erreurCloture.textContent = 'Ajoute au moins une tâche avant de pointer.';
        erreurCloture.hidden = false;
        champTache.focus();
        return;
      }
      const boutonSubmit = formCloture.querySelector('button[type="submit"]');
      boutonSubmit.disabled = true;
      try {
        // Les tâches d'abord : si le pointage échoue, le détail est déjà
        // enregistré et le salarié peut repointer sans tout resaisir.
        await ptCloturerBlocActivite(activiteBloc.id, taches);
        await ptEnregistrerHorodatage(prochaine.type);
        ptRenderOngletPointage(conteneur);
      } catch (erreur) {
        erreurCloture.textContent = 'Échec de l\'enregistrement. Réessaie.';
        erreurCloture.hidden = false;
        PT_DEBUG.log(`Échec de la clôture de bloc : ${erreur.message}`, true);
        boutonSubmit.disabled = false;
      }
    });
  } else {
    const boutonPointer = document.getElementById('pt-btn-pointer');
    if (boutonPointer) {
      boutonPointer.addEventListener('click', async () => {
        boutonPointer.disabled = true;
        try {
          // Clôture d'un bloc d'action de formation (ou bloc sans activité
          // rattachée) : pas de tâches à saisir, mais l'heure de fin est
          // renseignée quand même pour que la ventilation horaire soit
          // exacte plutôt que déduite.
          if (clotureBlocTravail && activiteBloc) {
            await ptCloturerBlocActivite(activiteBloc.id, activiteBloc.details || []);
          }
          await ptEnregistrerHorodatage(prochaine.type);
          ptRenderOngletPointage(conteneur);
        } catch (erreur) {
          PT_DEBUG.log(`Échec de l'enregistrement du pointage : ${erreur.message}`, true);
          boutonPointer.disabled = false;
        }
      });
    }
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
    const dateChoisie = formulaire.get('date');
    // new Date('AAAA-MM-JJTHH:MM:00') est interprété en heure locale (pas de
    // suffixe "Z"), cohérent avec le reste de l'appli qui raisonne en heure
    // de Paris (cf. ptDateDuJour).
    const moment = new Date(`${dateChoisie}T${formulaire.get('heure')}:00`);
    try {
      await ptEnregistrerHorodatage(formulaire.get('type'), { manuel: true, moment, date: dateChoisie });
      ptRenderOngletPointage(conteneur);
    } catch (erreur) {
      PT_DEBUG.log(`Échec de la saisie manuelle : ${erreur.message}`, true);
    }
  });

}

function ptLibelleCentre(code) {
  return S.centres.find((c) => c.code === code)?.libelle || code;
}

function ptLibelleFormation(code) {
  return S.formations.find((f) => f.code === code)?.libelle || code;
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

// Un séjour à l'autre agence est en cours dès que le nombre d'arrivées
// pointées ("trajet_inter_site_fin") est impair : chaque arrivée ouvre un
// séjour, chaque nouvelle arrivée suivante le referme. Ne dépend pas de
// l'agence de rattachement (contrairement à ptCalculerSejoursInterAgence) :
// c'est une simple alternance, symétrique quelle que soit l'agence de
// départ, donc utilisable même si agence_rattachement n'est pas renseigné.
function ptEnDeplacementInterAgence(horodatagesTrajetTous) {
  const nombreArrivees = horodatagesTrajetTous.filter((h) => h.type_horodatage === 'trajet_inter_site_fin').length;
  return nombreArrivees % 2 === 1;
}

// Libellé du bouton trajet inter-agence, contextualisé : "départ" pour un
// aller (pas de séjour en cours), "retour" dès qu'un séjour est en cours —
// dans les deux cas, précise s'il s'agit de pointer le départ ou l'arrivée
// de cette étape.
function ptLabelBoutonTrajet(typeAction, enDeplacementInterAgence) {
  const phase = enDeplacementInterAgence ? 'retour' : 'départ';
  const etape = typeAction === 'trajet_inter_site_debut' ? 'départ' : 'arrivée';
  return `Pointer le ${phase} (${etape})`;
}

// Calcule les séjours "à l'autre agence" à partir de l'historique des
// trajets inter-site pointés et de l'agence de rattachement du salarié.
// Hypothèse (décidée avec Jeremy) : le centre de chaque trajet est déduit
// par alternance, pas ressaisi à chaque pointage — le 1er trajet du jour
// (toutes dates confondues) part de l'agence de rattachement. Peut se
// désynchroniser si un pointage de trajet est oublié.
function ptCalculerSejoursInterAgence(horodatagesTrajetTous) {
  const sejours = [];
  let position = 'maison'; // 'maison' = agence de rattachement, 'away' = l'autre agence
  let dateArriveeAway = null;
  // id de l'horodatage d'arrivée qui a ouvert le séjour : permet de proposer
  // la suppression d'un séjour fantôme dans l'onglet Suivi (l'id n'est
  // présent que si l'appelant a demandé la colonne, sinon undefined —
  // l'affichage s'adapte).
  let idArriveeAway = null;

  for (const evenement of horodatagesTrajetTous) {
    const dateEvenement = evenement.date;
    if (evenement.type_horodatage === 'trajet_inter_site_fin') {
      if (position === 'maison') {
        position = 'away';
        dateArriveeAway = dateEvenement;
        idArriveeAway = evenement.id ?? null;
      } else {
        position = 'maison';
      }
    } else if (evenement.type_horodatage === 'trajet_inter_site_debut') {
      if (position === 'away' && dateArriveeAway) {
        const nuits = ptNombreJoursEntre(dateArriveeAway, dateEvenement);
        sejours.push({
          dateArrivee: dateArriveeAway,
          dateDepart: dateEvenement,
          nuits,
          idArrivee: idArriveeAway,
          idDepart: evenement.id ?? null,
        });
        dateArriveeAway = null;
        idArriveeAway = null;
      }
    }
  }

  // Séjour toujours en cours (pas encore de trajet retour pointé).
  if (position === 'away' && dateArriveeAway) {
    const nuits = ptNombreJoursEntre(dateArriveeAway, ptDateDuJour());
    sejours.push({ dateArrivee: dateArriveeAway, dateDepart: null, nuits, idArrivee: idArriveeAway, idDepart: null });
  }

  return sejours.reverse(); // le plus récent en premier
}

function ptNombreJoursEntre(dateDebutIso, dateFinIso) {
  const jour = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((new Date(dateFinIso) - new Date(dateDebutIso)) / jour));
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
    return `Plus de 6h sans pause détectées (règle conventionnelle). Pense à pointer la pause méridienne.`;
  }
  return null;
}

// "date" par défaut = aujourd'hui, mais surchageable pour rattraper un
// oubli sur un jour précédent (ex. retour de trajet inter-agence non pointé
// sur le moment, cf. MEMOIRE_PROJET.md section 27) — avant ce correctif,
// la ligne était toujours enregistrée avec la date du jour même quand
// "moment" pointait vers une date passée, ce qui cassait tous les calculs
// qui filtrent par colonne "date".
async function ptEnregistrerHorodatage(type, options = {}) {
  const { manuel = false, moment = new Date(), date = ptDateDuJour() } = options;
  const geoloc = manuel ? { latitude: null, longitude: null } : await ptCapturerGeoloc();
  const { error } = await ptSupabase.from('horodatages').insert({
    technicien_id: S.session.user.id,
    date,
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

// --- Clôture d'un bloc de travail : détail des tâches réalisées ----------
// L'activité du bloc en cours est celle du jour dont l'heure de fin n'est
// pas encore renseignée (une seule à la fois, la fusion pointage/activité
// garantissant une activité par bloc). Sert au formulaire de clôture affiché
// avant la pause méridienne et avant la fin de journée.
async function ptChargerActiviteBlocEnCours() {
  const { data, error } = await ptSupabase
    .from('activites')
    .select('id, type_activite, formation_code, centre_code, commentaire, details, heure_debut')
    .eq('technicien_id', S.session.user.id)
    .eq('date', ptDateDuJour())
    .is('heure_fin', null)
    .order('heure_debut', { ascending: false })
    .limit(1);
  if (error) throw error;
  S.activiteBlocEnCours = data[0] || null;
  return S.activiteBlocEnCours;
}

// Renseigne les tâches ET l'heure de fin du bloc. L'heure de fin rend la
// ventilation horaire AF/PR/AC exacte au lieu d'être déduite du contexte
// (cf. ptVentilerHeuresJour, MEMOIRE_PROJET.md section 34).
async function ptCloturerBlocActivite(id, details) {
  const { error } = await ptSupabase
    .from('activites')
    .update({ details, heure_fin: new Date().toTimeString().slice(0, 5) })
    .eq('id', id);
  if (error) throw error;
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
// Historique complet (180 derniers jours) des trajets inter-agence, utilisé
// par ptCalculerSejoursInterAgence pour reconstituer les séjours par
// alternance depuis l'agence de rattachement.
async function ptChargerHorodatagesTrajetTous() {
  const centQuatreVingtJoursAvant = new Date();
  centQuatreVingtJoursAvant.setDate(centQuatreVingtJoursAvant.getDate() - 180);
  const { data, error } = await ptSupabase
    .from('horodatages')
    .select('date, moment, type_horodatage')
    .eq('technicien_id', S.session.user.id)
    .in('type_horodatage', ['trajet_inter_site_debut', 'trajet_inter_site_fin'])
    .gte('date', centQuatreVingtJoursAvant.toLocaleDateString('sv-SE'))
    .order('moment', { ascending: true });
  if (error) throw error;
  S.horodatagesTrajetTous = data;
}

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
