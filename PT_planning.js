// =========================================================================
// Pointage BFS — PT_planning.js
// =========================================================================
// Module Planning (section 79 du mémoire) : grille Technicien x Jour, une
// semaine à la fois, gérée par le secrétariat/admin (glisser-déposer),
// lecture seule côté technicien (sa propre semaine). Adapté d'un module
// "chronogramme de formation" d'une autre appli (Évaluation_Sdis) — même
// principe de glisser-déposer HTML5 natif, axes de grille différents (ici
// Technicien x Jour plutôt que Jour x Demi-journée d'une session unique) et
// dates réelles plutôt que des libellés relatifs "J1"/"J2".
// Isolé dans son propre fichier, comme PT_app.js le fait déjà pour les
// autres onglets, et chargé après PT_app.js dans index.html : dépend de
// ptSupabase, S, ptEchapperHtml, ptParametreActif, ptChargerCentres,
// PT_DEBUG (tous définis dans PT_core.js/PT_app.js).
// Onglet visible seulement si le paramètre 'planning_actif' est activé
// (Administration > Paramètres) — voir PT_ONGLETS_CONDITIONNELS dans
// PT_core.js et le filtrage dans ptRenderApp (PT_app.js).
// =========================================================================

const PT_LABELS_TYPE_PLANNING = {
  formation_client: 'Formation client',
  formation_interne: 'Formation interne',
  trajet_inter_agence: 'Trajet inter-agence',
  absence: 'Absence / congé',
  autre: 'Autre',
};

const PT_LABELS_DEMI_PLANNING = { matin: 'Matin', apres_midi: 'Après-midi' };

// État propre au module : semaine affichée (lundi ISO), blocs chargés pour
// cette semaine, techniciens actifs (gestion uniquement), congés accordés
// recouvrant la semaine (pour l'alerte visuelle de conflit).
const SP = {
  lundi: null, // calculé à la première ouverture de l'onglet
  blocs: [],
  techniciens: [],
  congesParTechnicienJour: {}, // `${technicien_id}|${date}` -> type_conge
};

function ptPlanningFormatDateCourte(dateIso) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Les 5 jours ouvrés de la semaine dont `lundiIso` est le lundi — le
// planning BFS ne couvre pas le week-end pour cette v1 (les trajets
// inter-agence du week-end restent gérés via Pointage, pas ce module).
function ptPlanningJoursSemaine(lundiIso) {
  const lundi = new Date(`${lundiIso}T00:00:00`);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(lundi);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString('sv-SE');
  });
}

function ptPlanningSemaineSuivante(lundiIso, delta) {
  const lundi = new Date(`${lundiIso}T00:00:00`);
  lundi.setDate(lundi.getDate() + delta * 7);
  return lundi.toLocaleDateString('sv-SE');
}

async function ptChargerPlanningSemaine(lundiIso, technicienId = null) {
  const jours = ptPlanningJoursSemaine(lundiIso);
  let requete = ptSupabase.from('planning_blocs').select('*')
    .gte('date', jours[0]).lte('date', jours[jours.length - 1])
    .order('ordre', { ascending: true });
  if (technicienId) requete = requete.eq('technicien_id', technicienId);
  const { data, error } = await requete;
  if (error) throw error;
  SP.blocs = data;
}

async function ptChargerCongesSemaine(lundiIso, technicienId = null) {
  const jours = ptPlanningJoursSemaine(lundiIso);
  let requete = ptSupabase.from('conges').select('technicien_id, type_conge, date_debut, date_fin')
    .eq('statut', 'accorde')
    .lte('date_debut', jours[jours.length - 1]).gte('date_fin', jours[0]);
  if (technicienId) requete = requete.eq('technicien_id', technicienId);
  const { data, error } = await requete;
  if (error) throw error;
  SP.congesParTechnicienJour = {};
  for (const c of data) {
    for (const dateIso of ptElargirPlage(c.date_debut, c.date_fin)) {
      if (jours.includes(dateIso)) SP.congesParTechnicienJour[`${c.technicien_id}|${dateIso}`] = c.type_conge;
    }
  }
}

function ptPlanningBlocsCellule(technicienId, dateIso, demi) {
  return SP.blocs.filter((b) => b.technicien_id === technicienId && b.date === dateIso && b.demi_journee === demi)
    .sort((a, b) => a.ordre - b.ordre);
}

// --- Dispatch par rôle ----------------------------------------------------
async function ptRenderOngletPlanning(conteneur) {
  if (!SP.lundi) SP.lundi = ptLundiDeLaSemaine(ptDateDuJour());
  if (S.profil.role === 'technicien') {
    await ptRenderPlanningTechnicien(conteneur);
  } else {
    await ptRenderPlanningGestion(conteneur);
  }
}

// --- Vue technicien : lecture seule, sa propre semaine --------------------
async function ptRenderPlanningTechnicien(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;
  await Promise.all([
    ptChargerPlanningSemaine(SP.lundi, S.session.user.id),
    ptChargerCentres(),
  ]);
  const jours = ptPlanningJoursSemaine(SP.lundi);

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Mon planning</h2>
      <div class="pt-suivi-annee-nav">
        <button id="pt-planning-semaine-prec" class="pt-btn pt-btn-secondaire pt-btn-petit">« Semaine préc.</button>
        <strong>Semaine du ${ptPlanningFormatDateCourte(jours[0])}</strong>
        <button id="pt-planning-semaine-suiv" class="pt-btn pt-btn-secondaire pt-btn-petit">Semaine suiv. »</button>
      </div>
      <div class="pt-planning-grille pt-planning-grille-technicien">
        ${jours.map((dateIso) => `
          <div class="pt-planning-jour-colonne">
            <div class="pt-planning-entete-jour">${ptPlanningFormatDateCourte(dateIso)}</div>
            ${['matin', 'apres_midi'].map((demi) => `
              <div class="pt-planning-demi-lecture">
                <div class="pt-planning-demi-label">${PT_LABELS_DEMI_PLANNING[demi]}</div>
                ${ptPlanningBlocsCellule(S.session.user.id, dateIso, demi).map((b) => ptPlanningRenduBloc(b, true)).join('')
                  || '<p class="pt-liste-vide">—</p>'}
              </div>`).join('')}
          </div>`).join('')}
      </div>
    </section>`;

  document.getElementById('pt-planning-semaine-prec').addEventListener('click', () => {
    SP.lundi = ptPlanningSemaineSuivante(SP.lundi, -1);
    ptRenderPlanningTechnicien(conteneur);
  });
  document.getElementById('pt-planning-semaine-suiv').addEventListener('click', () => {
    SP.lundi = ptPlanningSemaineSuivante(SP.lundi, 1);
    ptRenderPlanningTechnicien(conteneur);
  });
}

// --- Rendu d'un bloc (partagé lecture seule / édition) ---------------------
function ptPlanningRenduBloc(b, lectureSeule) {
  const horaire = b.heure_debut ? `${b.heure_debut.slice(0, 5)}${b.heure_fin ? `-${b.heure_fin.slice(0, 5)}` : ''}` : '';
  return `
    <div class="pt-bloc-planning pt-bloc-planning-${b.type}" ${lectureSeule ? '' : `draggable="true" ondragstart='event.dataTransfer.setData("text/plain", "${b.id}")'`}>
      <div class="pt-bloc-planning-libelle">${ptEchapperHtml(b.libelle)}</div>
      ${b.centre_code ? `<div class="pt-bloc-planning-detail">📍 ${ptEchapperHtml(ptLibelleCentre(b.centre_code))}</div>` : ''}
      ${horaire ? `<div class="pt-bloc-planning-detail">🕐 ${ptEchapperHtml(horaire)}</div>` : ''}
      ${!lectureSeule && b.commentaire ? `<div class="pt-bloc-planning-detail">🗒 ${ptEchapperHtml(b.commentaire)}</div>` : ''}
      ${lectureSeule ? '' : `
        <div class="pt-bloc-planning-actions">
          <span onclick="ptPlanningFormBloc(${b.id})" title="Modifier">✏️</span>
          <span onclick="ptPlanningSupprimerBloc(${b.id})" title="Supprimer">🗑️</span>
        </div>`}
    </div>`;
}

// --- Vue secrétariat/admin : grille éditable, tous techniciens -------------
async function ptRenderPlanningGestion(conteneur) {
  conteneur.innerHTML = `<p>Chargement…</p>`;
  const { data: techniciens, error: erreurProfils } = await ptSupabase
    .from('profils').select('id, prenom, nom').eq('role', 'technicien').eq('actif', true).order('nom');
  if (erreurProfils) throw erreurProfils;
  SP.techniciens = techniciens;

  await Promise.all([
    ptChargerPlanningSemaine(SP.lundi),
    ptChargerCongesSemaine(SP.lundi),
    ptChargerCentres(),
  ]);
  _ptRenderGrillePlanningGestion(conteneur);
}

function _ptRenderGrillePlanningGestion(conteneur) {
  const jours = ptPlanningJoursSemaine(SP.lundi);

  conteneur.innerHTML = `
    <section class="pt-carte">
      <h2>Planning</h2>
      <div class="pt-suivi-annee-nav">
        <button id="pt-planning-semaine-prec" class="pt-btn pt-btn-secondaire pt-btn-petit">« Semaine préc.</button>
        <strong>Semaine du ${ptPlanningFormatDateCourte(jours[0])}</strong>
        <button id="pt-planning-semaine-suiv" class="pt-btn pt-btn-secondaire pt-btn-petit">Semaine suiv. »</button>
      </div>
      <p class="pt-info">Glisse-dépose un bloc d'une case à l'autre pour le réaffecter (autre jour, autre demi-journée, autre salarié). 🏖 = congé accordé ce jour-là.</p>
      <div class="pt-table-scroll">
        <table class="pt-table-planning">
          <thead>
            <tr>
              <th>Salarié</th>
              ${jours.map((dateIso) => `<th colspan="2">${ptPlanningFormatDateCourte(dateIso)}</th>`).join('')}
            </tr>
            <tr>
              <th></th>
              ${jours.map(() => `<th>Matin</th><th>Après-midi</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${SP.techniciens.map((t) => `
              <tr>
                <td><strong>${ptEchapperHtml(t.prenom)} ${ptEchapperHtml(t.nom)}</strong></td>
                ${jours.map((dateIso) => ['matin', 'apres_midi'].map((demi) => {
                  const enConge = SP.congesParTechnicienJour[`${t.id}|${dateIso}`];
                  return `
                    <td class="pt-planning-cellule${enConge ? ' pt-planning-cellule-conge' : ''}"
                        ondragover="event.preventDefault(); this.classList.add('pt-planning-survol')"
                        ondragleave="this.classList.remove('pt-planning-survol')"
                        ondrop="ptPlanningDeposer(event, '${t.id}', '${dateIso}', '${demi}')">
                      ${enConge ? `<span class="pt-badge pt-badge-conge">🏖 ${ptEchapperHtml(PT_LABELS_CONGE[enConge] || enConge)}</span>` : ''}
                      ${ptPlanningBlocsCellule(t.id, dateIso, demi).map((b) => ptPlanningRenduBloc(b, false)).join('')}
                      <button type="button" class="pt-btn-ajout-bloc" onclick="ptPlanningFormBloc(null, '${t.id}', '${dateIso}', '${demi}')">+ Ajouter</button>
                    </td>`;
                }).join('')).join('')}
              </tr>`).join('') || '<tr><td colspan="99" class="pt-liste-vide">Aucun salarié actif.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div id="pt-planning-form"></div>
    </section>`;

  document.getElementById('pt-planning-semaine-prec').addEventListener('click', async () => {
    SP.lundi = ptPlanningSemaineSuivante(SP.lundi, -1);
    await Promise.all([ptChargerPlanningSemaine(SP.lundi), ptChargerCongesSemaine(SP.lundi)]);
    _ptRenderGrillePlanningGestion(conteneur);
  });
  document.getElementById('pt-planning-semaine-suiv').addEventListener('click', async () => {
    SP.lundi = ptPlanningSemaineSuivante(SP.lundi, 1);
    await Promise.all([ptChargerPlanningSemaine(SP.lundi), ptChargerCongesSemaine(SP.lundi)]);
    _ptRenderGrillePlanningGestion(conteneur);
  });

  // Conservé pour que le formulaire (ptPlanningFormBloc) sache où se
  // réafficher après enregistrement/suppression — un seul conteneur de
  // référence pour tout le module le temps de l'onglet.
  SP.conteneurActif = conteneur;
}

// --- Formulaire d'ajout/modification d'un bloc ----------------------------
function ptPlanningFormBloc(blocId, technicienId, dateIso, demi) {
  const b = blocId ? SP.blocs.find((x) => x.id === blocId) : null;
  const tId = b ? b.technicien_id : technicienId;
  const dIso = b ? b.date : dateIso;
  const dmi = b ? b.demi_journee : demi;
  const technicien = SP.techniciens.find((t) => t.id === tId);

  document.getElementById('pt-planning-form').innerHTML = `
    <div class="pt-carte" style="background:#f7f7f9">
      <h3>${b ? 'Modifier le bloc' : 'Nouveau bloc'} — ${ptEchapperHtml(technicien ? `${technicien.prenom} ${technicien.nom}` : '')} — ${ptPlanningFormatDateCourte(dIso)} ${PT_LABELS_DEMI_PLANNING[dmi] || ''}</h3>
      <label>Type
        <select id="pf-planning-type">
          ${Object.entries(PT_LABELS_TYPE_PLANNING).map(([v, l]) => `<option value="${v}" ${b?.type === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <label>Libellé (visible du salarié) <input id="pf-planning-libelle" value="${b ? ptEchapperHtml(b.libelle) : ''}" maxlength="150" /></label>
      <label>Lieu
        <select id="pf-planning-centre">
          <option value="">—</option>
          ${S.centres.map((c) => `<option value="${c.code}" ${b?.centre_code === c.code ? 'selected' : ''}>${ptEchapperHtml(c.libelle)}</option>`).join('')}
        </select>
      </label>
      <label>Horaire précis (facultatif — sinon Matin/Après-midi suffit)</label>
      <div class="pt-ligne-horaire-planning">
        <input id="pf-planning-heure-debut" type="time" value="${b?.heure_debut ? b.heure_debut.slice(0, 5) : ''}" />
        <input id="pf-planning-heure-fin" type="time" value="${b?.heure_fin ? b.heure_fin.slice(0, 5) : ''}" />
      </div>
      <label>Commentaire (réservé au secrétariat/admin, jamais montré au salarié) <textarea id="pf-planning-commentaire">${b && b.commentaire ? ptEchapperHtml(b.commentaire) : ''}</textarea></label>
      <button type="button" class="pt-btn" onclick="ptPlanningEnregistrerBloc(${blocId || 'null'}, '${tId}', '${dIso}', '${dmi}')">Enregistrer</button>
      <button type="button" class="pt-btn pt-btn-secondaire" onclick="document.getElementById('pt-planning-form').innerHTML=''">Annuler</button>
    </div>`;
  document.getElementById('pt-planning-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function ptPlanningEnregistrerBloc(blocId, technicienId, dateIso, demi) {
  const libelle = document.getElementById('pf-planning-libelle').value.trim();
  if (!libelle) { PT_DEBUG.log('Libellé obligatoire pour un bloc de planning.', true); return; }
  const payload = {
    type: document.getElementById('pf-planning-type').value,
    libelle,
    centre_code: document.getElementById('pf-planning-centre').value || null,
    heure_debut: document.getElementById('pf-planning-heure-debut').value || null,
    heure_fin: document.getElementById('pf-planning-heure-fin').value || null,
    commentaire: document.getElementById('pf-planning-commentaire').value.trim() || null,
  };
  try {
    if (blocId) {
      const { error } = await ptSupabase.from('planning_blocs').update(payload).eq('id', blocId);
      if (error) throw error;
    } else {
      const ordre = ptPlanningBlocsCellule(technicienId, dateIso, demi).length;
      const { error } = await ptSupabase.from('planning_blocs').insert({
        ...payload,
        technicien_id: technicienId,
        date: dateIso,
        demi_journee: demi,
        ordre,
        created_by: S.session.user.id,
      });
      if (error) throw error;
    }
    await Promise.all([ptChargerPlanningSemaine(SP.lundi), ptChargerCongesSemaine(SP.lundi)]);
    _ptRenderGrillePlanningGestion(SP.conteneurActif);
  } catch (erreur) {
    PT_DEBUG.log(`Échec de l'enregistrement du bloc de planning : ${erreur.message}`, true);
  }
}

async function ptPlanningSupprimerBloc(blocId) {
  if (!confirm('Supprimer ce bloc du planning ?')) return;
  try {
    const { error } = await ptSupabase.from('planning_blocs').delete().eq('id', blocId);
    if (error) throw error;
    await Promise.all([ptChargerPlanningSemaine(SP.lundi), ptChargerCongesSemaine(SP.lundi)]);
    _ptRenderGrillePlanningGestion(SP.conteneurActif);
  } catch (erreur) {
    PT_DEBUG.log(`Échec de la suppression du bloc de planning : ${erreur.message}`, true);
  }
}

// Glisser-déposer : déplace un bloc existant vers une autre case
// (technicien et/ou jour et/ou demi-journée différents).
async function ptPlanningDeposer(evenement, technicienId, dateIso, demi) {
  evenement.preventDefault();
  evenement.currentTarget.classList.remove('pt-planning-survol');
  const blocId = Number(evenement.dataTransfer.getData('text/plain'));
  if (!blocId) return;
  const ordre = ptPlanningBlocsCellule(technicienId, dateIso, demi).length;
  try {
    const { error } = await ptSupabase.from('planning_blocs')
      .update({ technicien_id: technicienId, date: dateIso, demi_journee: demi, ordre })
      .eq('id', blocId);
    if (error) throw error;
    await Promise.all([ptChargerPlanningSemaine(SP.lundi), ptChargerCongesSemaine(SP.lundi)]);
    _ptRenderGrillePlanningGestion(SP.conteneurActif);
  } catch (erreur) {
    PT_DEBUG.log(`Échec du déplacement du bloc de planning : ${erreur.message}`, true);
  }
}
