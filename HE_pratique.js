/* =====================================================================
   HE_pratique.js — épreuve pratique (savoir-faire)

   Barème imposé par la NF C18-510 § D.3 :
     A = sans erreur
     B = erreur acceptable (minime)
     C = erreur majeure (risque de mise en danger)
     D = erreur grave (comportement dangereux)
   Critère d'acceptation : aucun D et un seul C au maximum pour chaque
   mise en situation. La grille est celle des tableaux D.2 à D.12.

   Validation du titre (2026-08) : chaque gabarit définit un nombre de mises
   en situation obligatoires (par défaut 1) et un nombre de rattrapage (par
   défaut 1), réglables par titre depuis l'onglet admin « Titres ». Le
   rattrapage n'est utile qu'en cas d'échec des obligatoires ; le titre est
   validé dès qu'une mise en situation obligatoire OU de rattrapage est
   conforme. Logique dupliquée côté SQL dans epreuve_pratique_conforme().
   ===================================================================== */

const NOTES = {
  A: 'Sans erreur',
  B: 'Erreur acceptable (minime)',
  C: 'Erreur majeure (risque de mise en danger)',
  D: 'Erreur grave (comportement dangereux)',
};

async function ouvrirPratique(stagiaireId) {
  const { data, error } = await sb.from('stagiaires')
    .select('*, stagiaire_symboles(symbole_code)').eq('id', stagiaireId).single();
  if (error) return erreurSupabase('Ouverture du stagiaire', error);
  S.stagiaire = data;
  S.ecran = 'pratique';
  ecranFormateur($('#ecran'));
}

async function rendrePratique(zone) {
  const st = S.stagiaire;
  // Ré-affichage après une note/un commentaire (grille déjà à l'écran) : on garde le
  // contenu existant pendant le rechargement au lieu de tout effacer, et on restaure
  // la position de scroll à la fin — sans quoi la page remontait en haut à chaque
  // clic sur une note (le "trou" du message de chargement fait perdre le repère
  // au navigateur). Seul le tout premier chargement affiche le message d'attente.
  const dejaAffiche = !!zone.querySelector('.epreuve');
  const scrollY = window.scrollY;
  // 2026-09-09 (demande de Jeremy) : le simple "restaurer le même scrollY" ne
  // suffisait pas quand une épreuve vient d'être validée — les cartes sont
  // retriées (les épreuves closes descendent en bas), donc à pixel égal
  // c'est un autre contenu qui se retrouve sous les yeux du formateur, ce
  // qui donne l'impression que l'écran "remonte" tout seul. On repère plutôt
  // la carte actuellement en haut de l'écran (par son id) et, après le
  // nouveau rendu, on corrige le scroll pour que CETTE carte reste au même
  // endroit visuellement, même si sa position dans la liste a changé.
  let ancre = null;
  if (dejaAffiche) {
    let meilleure = null, meilleurEcart = Infinity;
    for (const c of zone.querySelectorAll('.epreuve[data-epreuve-id]')) {
      const ecart = Math.abs(c.getBoundingClientRect().top);
      if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleure = c; }
    }
    if (meilleure) ancre = { id: meilleure.dataset.epreuveId, top: meilleure.getBoundingClientRect().top };
  }
  if (!dejaAffiche) zone.innerHTML = '<p class="chargement">Préparation des grilles…</p>';

  // Mode hors-ligne (2026-08) : source de lecture selon la connectivité —
  // voir HE_offline.js. En ligne, on lit le serveur et on rafraîchit le
  // cache local à chaque succès ; hors-ligne (ou si le réseau tombe pendant
  // la lecture), on retombe sur ce cache. Sans cache disponible hors-ligne,
  // rien à afficher pour ce stagiaire tant qu'il n'a pas été ouvert en ligne.
  let epreuves, scenarios, theorieOkParSymbole;

  if (navigator.onLine) {
    try {
      // Crée les épreuves manquantes (une par gabarit visé) et pré-remplit les grilles
      await rpc('preparer_pratiques', { p_stagiaire_id: st.id });

      const { data, error } = await sb.from('epreuves_pratiques')
        .select(`*, gabarits(libelle, mises_en_situation_min, mises_en_situation_rattrapage,
                   tableau_savoir_faire, competences),
                 mises_en_situation(id, numero, intitule, commentaire, scenario_id,
                   evaluations_savoir_faire(id, note, commentaire,
                     gabarit_savoir_faire(id, position, criteres_savoir_faire(code, libelle))))`)
        .eq('stagiaire_id', st.id).order('gabarit_code');
      if (error) throw error;
      epreuves = data;

      const { data: scen } = await sb.from('scenarios_pratiques').select('*').eq('actif', true);
      scenarios = scen || [];

      // Un titre dont la théorie a échoué n'a plus besoin d'être évalué en pratique
      // (sauf rattrapage théorique à venir) : la carte du titre passe en orange
      // plutôt qu'en rouge, pour signaler « optionnel » et non « à faire ».
      const { data: resultats } = await sb.from('resultats_symbole')
        .select('symbole_code, theorie_ok').eq('stagiaire_id', st.id);
      theorieOkParSymbole = Object.fromEntries((resultats || []).map(r => [r.symbole_code, r.theorie_ok]));

      HorsLigne.enregistrerSnapshot(st.id, { epreuves, scenarios, theorieOkParSymbole });
    } catch (e) {
      const snap = HorsLigne.lireSnapshot(st.id);
      if (!snap) return erreurSupabase('Lecture des épreuves pratiques', e);
      ({ epreuves, scenarios, theorieOkParSymbole } = snap);
      toast('Connexion perdue — grilles rechargées depuis la dernière sauvegarde locale', 'erreur', 6000);
    }
  } else {
    const snap = HorsLigne.lireSnapshot(st.id);
    if (!snap) {
      zone.innerHTML = `<div class="ecran-vide"><h1>Hors connexion</h1>
        <p>Aucune donnée locale pour ${esc(st.prenom)} ${esc(st.nom)} : ouvre son écran pratique une
        première fois en ligne avant de perdre le réseau.</p>
        <button class="lien" onclick="retour('session')">← Retour à la session</button></div>`;
      return;
    }
    ({ epreuves, scenarios, theorieOkParSymbole } = snap);
  }

  // Cache des scénarios par id (2026-08-28, demande de Jeremy) : sert au popup
  // "Consignes" ci-dessous, pour lire directement contexte/aléa/attendus sans
  // requête réseau supplémentaire au clic (utilisable aussi hors-ligne).
  S._scenariosParId = Object.fromEntries((scenarios || []).map(s => [s.id, s]));

  const symbolesStagiaire = (st.stagiaire_symboles || []).map(x => x.symbole_code);
  const theorieEchoueePourGabarit = gabaritCode => symbolesStagiaire.some(sym =>
    (S.referentiel.gabaritsParSymbole[sym] || []).includes(gabaritCode) && theorieOkParSymbole[sym] === false);

  zone.innerHTML = `
    ${S.pratiqueSoloMode ? '' : `<button class="lien" onclick="retour('session')">← Retour à la session</button>`}
    <div class="barre-actions">
      <h2>Évaluation pratique — ${esc(st.prenom)} ${esc(st.nom)}</h2>
      <button class="principal" ${navigator.onLine ? '' : 'disabled title="Indisponible hors-ligne"'}
        onclick="genererTitrePdf('${st.id}')">🏅 Générer le titre</button>
    </div>
    <p class="aide">Barème normatif : <b>A</b> sans erreur · <b>B</b> erreur minime ·
       <b>C</b> erreur majeure · <b>D</b> erreur grave.
       Critère d'acceptation : <b>aucun D et un seul C au maximum par mise en situation</b>.</p>
    ${[...(epreuves || [])]
      // Même logique que pour les mises en situation à l'intérieur d'un titre :
      // les épreuves encore à faire remontent en haut, celles déjà closes —
      // validées OU en échec, une fois « Valider cette épreuve » cliqué —
      // descendent en bas. Avant : seule une réussite faisait descendre la
      // carte, un échec validé restait donc coincé en haut avec les épreuves
      // pas commencées (signalé comme un blocage par le formateur).
      .sort((a, b) => ((a.reussie !== null) - (b.reussie !== null)) || a.gabarit_code.localeCompare(b.gabarit_code))
      .map(ep => carteEpreuve(ep, scenarios || [], theorieEchoueePourGabarit(ep.gabarit_code))).join('')}`;

  if (ancre) {
    const carteApres = zone.querySelector(`.epreuve[data-epreuve-id="${CSS.escape(ancre.id)}"]`);
    if (carteApres) window.scrollBy(0, carteApres.getBoundingClientRect().top - ancre.top);
    else window.scrollTo(0, scrollY);
  } else if (dejaAffiche) {
    window.scrollTo(0, scrollY);
  }
}

function carteEpreuve(ep, scenarios, theorieEchouee) {
  const dispo = scenarios.filter(s => s.gabarit_code === ep.gabarit_code);
  const min = ep.gabarits.mises_en_situation_min;
  const rattrapage = ep.gabarits.mises_en_situation_rattrapage || 0;
  const mises = ep.mises_en_situation || [];
  const obligatoires = mises.filter(m => m.numero <= min);
  const obligatoiresCompletes = obligatoires.length === min &&
    obligatoires.every(m => miseComplete(m));
  const obligatoiresConformes = obligatoiresCompletes && obligatoires.every(m => miseConforme(m));
  const obligatoiresEchouees = obligatoiresCompletes && !obligatoiresConformes;
  const total = mises.length;

  // Le rattrapage n'a de sens qu'après échec des obligatoires : tant que ce n'est
  // pas le cas, on masque les mises de rattrapage encore vides (créées par erreur
  // ou par anticipation) pour ne pas encombrer l'écran d'une grille inutile. Une
  // mise de rattrapage déjà notée reste affichée même si les obligatoires finissent
  // par être conformes (traçabilité de ce qui a été fait).
  const rattrapagesExistants = mises.filter(m => m.numero > min);
  const rattrapagesAffiches = rattrapagesExistants.filter(m =>
    obligatoiresEchouees || (m.evaluations_savoir_faire || []).some(l => l.note));
  const misesAffichees = [...obligatoires, ...rattrapagesAffiches];

  const peutAjouter = total < min || (obligatoiresEchouees && total < min + rattrapage);
  const badgeOrange = theorieEchouee && ep.reussie !== true;
  return `
    <section class="carte epreuve" data-epreuve-id="${esc(ep.id)}">
      <div class="entete-epreuve">
        <h3>${esc(ep.gabarits.libelle)}</h3>
        ${badgeOrange
          ? `<span class="etat avertissement" title="La théorie de ce titre a échoué : la pratique n'est pas nécessaire, sauf si un rattrapage théorique est prévu.">
              ⚠ Théorie non validée — pratique optionnelle</span>`
          : `<span class="etat ${ep.reussie === true ? 'ok' : ep.reussie === false ? 'ko' : 'neutre'}">
              ${ep.reussie === true ? 'Validée' : ep.reussie === false ? 'Non validée' : 'En cours'}
              ${ep.__provisoire ? ' (provisoire, hors-ligne)' : ''}</span>`}
      </div>
      <p class="aide">Compétences à évaluer :
        ${(ep.gabarits.competences || []).map(c => `<span class="puce">${esc(c)}</span>`).join(' ')}
        · ${min} mise(s) en situation obligatoire(s)${rattrapage
          ? ` + ${rattrapage} de rattrapage si échec` : ''}</p>

      ${[...misesAffichees]
        // Les mises « à faire » remontent en haut, les « faites » (grille complète,
        // conforme ou non) descendent en bas — à numéro de mise égal on garde
        // l'ordre chronologique. Rejoue automatiquement si une note est modifiée.
        .sort((a, b) => (miseComplete(a) - miseComplete(b)) || (a.numero - b.numero))
        .map(m => grilleMise(m, dispo, m.numero <= min)).join('')}

      <div class="pied-epreuve">
        ${peutAjouter ? `<button class="lien" onclick="ajouterMise('${ep.id}', ${total + 1}, '${ep.gabarit_code}')">
          + Ajouter une mise en situation${total >= min ? ' de rattrapage' : ''}</button>`
          : obligatoiresConformes && rattrapage
            ? `<span class="aide">Mise(s) en situation obligatoire(s) conforme(s) — rattrapage non nécessaire.</span>`
          : !obligatoiresCompletes
            ? ''
            : `<span class="aide">Nombre maximal de mises en situation atteint (${min + rattrapage}).</span>`}
        <label class="plein">Observations générales
          <textarea rows="2" onchange="majObservations('${ep.id}', this.value)">${esc(ep.observations)}</textarea></label>
        ${ep.reussie === false ? recommandationEchec(ep) : ''}
        <button class="principal" onclick="cloturerEpreuve('${ep.id}')">Valider cette épreuve</button>
      </div>
    </section>`;
}

const RECOMMANDATIONS_ECHEC = [
  'Repasser l\'épreuve pratique',
  'Refaire toute la formation',
  'Repasser l\'épreuve théorique et pratique',
];

// Suite à donner communiquée au client en cas d'échec : liste de préréglages
// + champ libre, plutôt qu'un texte saisi à la main à chaque fois (2026-08,
// demande explicite après un échec HE Manœuvre non accompagné de préconisation).
function recommandationEchec(ep) {
  const valeur = ep.recommandation || '';
  const estPreset = RECOMMANDATIONS_ECHEC.includes(valeur);
  return `
    <label class="plein">Recommandation suite à échec (transmise au client)
      <select onchange="if(this.value==='__autre__'){this.nextElementSibling.hidden=false;this.nextElementSibling.focus();}else{this.nextElementSibling.hidden=true;majRecommandation('${ep.id}', this.value);}">
        <option value="">— à préciser —</option>
        ${RECOMMANDATIONS_ECHEC.map(r => `<option value="${esc(r)}" ${valeur === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        <option value="__autre__" ${valeur && !estPreset ? 'selected' : ''}>Autre (préciser)…</option>
      </select>
      <input type="text" placeholder="Préciser la recommandation…" value="${esc(!estPreset ? valeur : '')}"
        ${valeur && !estPreset ? '' : 'hidden'}
        onchange="majRecommandation('${ep.id}', this.value)"></label>`;
}

async function majRecommandation(epreuveId, texte) {
  const { error } = await sb.from('epreuves_pratiques')
    .update({ recommandation: texte || null }).eq('id', epreuveId);
  if (error) return erreurSupabase('Enregistrement de la recommandation', error);
  toast('Recommandation enregistrée');
}

// Filtre défensif : une ligne evaluations_savoir_faire dont le gabarit_savoir_faire
// pointé a disparu (résidu d'une migration du référentiel non nettoyé) ne doit pas
// planter tout l'écran pratique — on l'ignore à l'affichage plutôt que de crasher.
const ligneValide = l => !!l.gabarit_savoir_faire;

// Toutes les lignes de la grille ont-elles une note ? (indépendant du verdict
// conforme/non conforme — sert à trier les mises « à faire » avant les « faites ».)
function miseComplete(m) {
  const lignes = (m.evaluations_savoir_faire || []).filter(ligneValide);
  return lignes.length > 0 && lignes.every(l => l.note);
}

function miseConforme(m) {
  const lignes = (m.evaluations_savoir_faire || []).filter(ligneValide);
  const nbC = lignes.filter(l => l.note === 'C').length;
  const nbD = lignes.filter(l => l.note === 'D').length;
  return miseComplete(m) && nbD === 0 && nbC <= 1;
}

function grilleMise(m, scenarios, obligatoire) {
  const orphelines = (m.evaluations_savoir_faire || []).filter(l => !ligneValide(l)).length;
  const lignes = (m.evaluations_savoir_faire || []).filter(ligneValide)
    .sort((a, b) => a.gabarit_savoir_faire.position - b.gabarit_savoir_faire.position);
  const nbC = lignes.filter(l => l.note === 'C').length;
  const nbD = lignes.filter(l => l.note === 'D').length;
  const complet = lignes.length > 0 && lignes.every(l => l.note);
  const conforme = complet && nbD === 0 && nbC <= 1;

  return `
    <div class="mise ${complet ? (conforme ? 'conforme' : 'non-conforme') : ''}">
      <div class="entete-mise">
        <b>Mise en situation ${m.numero} <span class="puce">${obligatoire ? 'obligatoire' : 'rattrapage'}</span></b>
        <select onchange="appliquerScenario('${m.id}', this.value)">
          <option value="">— scénario libre —</option>
          ${scenarios.map(s => `<option value="${s.id}" ${s.id === m.scenario_id ? 'selected' : ''}>
            ${esc(s.intitule)}</option>`).join('')}
        </select>
        ${(() => {
          // Fiche MSP téléchargeable (2026-08-27, demande de Jeremy) : reliée
          // au scénario choisi via reference_ext (sans le suffixe -exec/-cdc,
          // le PDF est commun aux deux rôles). MSP_RESSOURCES vient de
          // HE_msp_ressources.js — absent tant qu'aucune fiche n'existe pour
          // ce scénario, ce qui est le cas normal pour la plupart d'entre eux.
          const scenario = scenarios.find(s => s.id === m.scenario_id);
          const ref = scenario?.reference_ext?.replace(/-(exec|cdc)$/, '');
          const ressource = ref && typeof MSP_RESSOURCES !== 'undefined' ? MSP_RESSOURCES[ref] : null;
          return `${ressource
            ? `<button type="button" class="lien" onclick="telechargerRessourceMsp('${ref}')">📄 Fiche MSP</button>`
            : ''}${m.scenario_id
            ? `<button type="button" class="lien" onclick="afficherConsignesMsp('${m.scenario_id}')">📋 Consignes</button>`
            : ''}`;
        })()}
        <span class="verdict">${complet
          ? (conforme ? '✔ conforme' : `✘ non conforme (${nbD} D, ${nbC} C)`)
          : 'à compléter'}</span>
        ${orphelines ? `<span class="etat avertissement" title="Critères obsolètes (référentiel modifié après la création de cette mise en situation) : recrée la mise en situation pour repartir sur la grille à jour.">
          ⚠ ${orphelines} critère(s) obsolète(s) ignoré(s)</span>` : ''}
      </div>
      <table class="tableau grille">
        <thead><tr><th>Savoir-faire évalué</th>
          ${Object.keys(NOTES).map(n => `<th title="${esc(NOTES[n])}">${n}</th>`).join('')}
          <th>Commentaire</th></tr></thead>
        <tbody>${lignes.map(l => `
          <tr>
            <td><span class="puce">${esc(l.gabarit_savoir_faire.criteres_savoir_faire.code)}</span> ${esc(l.gabarit_savoir_faire.criteres_savoir_faire.libelle)}</td>
            ${Object.keys(NOTES).map(n => `<td class="case-note ${n}">
              <input type="radio" name="n-${l.id}" value="${n}" ${l.note === n ? 'checked' : ''}
                title="${esc(NOTES[n])}" onchange="noter('${l.id}', '${n}')"></td>`).join('')}
            <td><input type="text" value="${esc(l.commentaire)}" placeholder="…"
              onchange="commenterLigne('${l.id}', this.value)"></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/* --------------------- mode hors-ligne : accès au cache ---------------- *
 * Localise une ligne (épreuve / mise / évaluation) dans le snapshot du
 * stagiaire actuellement affiché, pour la modifier en mémoire avant de la
 * remettre en cache — voir HE_offline.js pour la file d'attente elle-même.
 * ------------------------------------------------------------------------ */
function trouverDansCache(quoi, id) {
  const snap = HorsLigne.lireSnapshot(S.stagiaire.id);
  if (!snap) return null;
  for (const ep of snap.epreuves || []) {
    if (quoi === 'epreuve' && ep.id === id) return { snap, ep };
    for (const m of ep.mises_en_situation || []) {
      if (quoi === 'mise' && m.id === id) return { snap, ep, m };
      for (const l of m.evaluations_savoir_faire || []) {
        if (quoi === 'ligne' && l.id === id) return { snap, ep, m, l };
      }
    }
  }
  return null;
}

async function noter(ligneId, note) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('ligne', ligneId);
    if (!trouve) return toast('Ligne introuvable dans les données locales', 'erreur');
    const valeurAvant = { note: trouve.l.note };
    trouve.l.note = note;
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.ecrireChamp({
      table: 'evaluations_savoir_faire', pk: ligneId, champs: { note }, valeurAvant,
      libelle: 'Note ' + note + ' — ' + trouve.l.gabarit_savoir_faire.criteres_savoir_faire.code,
      stagiaireId: S.stagiaire.id,
    });
    return rendrePratique($('#contenu'));
  }
  const { error } = await sb.from('evaluations_savoir_faire')
    .update({ note }).eq('id', ligneId);
  if (error) return erreurSupabase('Notation', error);
  rendrePratique($('#contenu'));
}

async function commenterLigne(ligneId, texte) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('ligne', ligneId);
    if (!trouve) return toast('Ligne introuvable dans les données locales', 'erreur');
    const valeurAvant = { commentaire: trouve.l.commentaire };
    trouve.l.commentaire = texte;
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.ecrireChamp({
      table: 'evaluations_savoir_faire', pk: ligneId, champs: { commentaire: texte }, valeurAvant,
      libelle: 'Commentaire — ' + trouve.l.gabarit_savoir_faire.criteres_savoir_faire.code,
      stagiaireId: S.stagiaire.id,
    });
    return;
  }
  await sb.from('evaluations_savoir_faire').update({ commentaire: texte }).eq('id', ligneId);
}

async function majObservations(epreuveId, texte) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('epreuve', epreuveId);
    if (!trouve) return toast('Épreuve introuvable dans les données locales', 'erreur');
    const valeurAvant = { observations: trouve.ep.observations };
    trouve.ep.observations = texte;
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.ecrireChamp({
      table: 'epreuves_pratiques', pk: epreuveId, champs: { observations: texte }, valeurAvant,
      libelle: 'Observations — ' + trouve.ep.gabarits.libelle, stagiaireId: S.stagiaire.id,
    });
    return;
  }
  await sb.from('epreuves_pratiques').update({ observations: texte }).eq('id', epreuveId);
}

async function appliquerScenario(miseId, scenarioId) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('mise', miseId);
    if (!trouve) return toast('Mise en situation introuvable dans les données locales', 'erreur');
    const valeurAvant = { scenario_id: trouve.m.scenario_id, intitule: trouve.m.intitule };
    const maj = { scenario_id: scenarioId || null };
    if (scenarioId) {
      const scenario = (trouve.snap.scenarios || []).find(s => s.id === scenarioId);
      if (scenario) maj.intitule = scenario.intitule;
    }
    Object.assign(trouve.m, maj);
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.ecrireChamp({
      table: 'mises_en_situation', pk: miseId, champs: maj, valeurAvant,
      libelle: 'Scénario — mise en situation ' + trouve.m.numero, stagiaireId: S.stagiaire.id,
    });
    return rendrePratique($('#contenu'));
  }
  const maj = { scenario_id: scenarioId || null };
  if (scenarioId) {
    const { data } = await sb.from('scenarios_pratiques').select('intitule').eq('id', scenarioId).single();
    if (data) maj.intitule = data.intitule;
  }
  const { error } = await sb.from('mises_en_situation').update(maj).eq('id', miseId);
  if (error) return erreurSupabase('Choix du scénario', error);
  rendrePratique($('#contenu'));
}

async function ajouterMise(epreuveId, numero, gabaritCode) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('epreuve', epreuveId);
    if (!trouve) return toast('Épreuve introuvable dans les données locales', 'erreur');
    const miseId = crypto.randomUUID();
    const lignesRef = S.referentiel.savoirFaire.filter(sf => sf.gabarit_code === gabaritCode);
    const nouvelleMise = {
      id: miseId, numero, intitule: 'Mise en situation ' + numero, commentaire: '', scenario_id: null,
      evaluations_savoir_faire: lignesRef.map(sf => ({
        id: crypto.randomUUID(), note: null, commentaire: '',
        gabarit_savoir_faire: { id: sf.id, position: sf.position, criteres_savoir_faire: sf.criteres_savoir_faire },
        __savoir_faire_id: sf.id,
      })),
    };
    trouve.ep.mises_en_situation = [...(trouve.ep.mises_en_situation || []), nouvelleMise];
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.inserer({
      table: 'mises_en_situation',
      lignes: [{ id: miseId, epreuve_id: epreuveId, numero, intitule: nouvelleMise.intitule }],
      libelle: 'Ajout mise en situation ' + numero, stagiaireId: S.stagiaire.id,
    });
    HorsLigne.inserer({
      table: 'evaluations_savoir_faire',
      lignes: nouvelleMise.evaluations_savoir_faire.map(l => ({
        id: l.id, mise_en_situation_id: miseId, savoir_faire_id: l.__savoir_faire_id,
      })),
      libelle: 'Grille — mise en situation ' + numero, stagiaireId: S.stagiaire.id,
    });
    return rendrePratique($('#contenu'));
  }
  const { data, error } = await sb.from('mises_en_situation')
    .insert({ epreuve_id: epreuveId, numero, intitule: 'Mise en situation ' + numero })
    .select().single();
  if (error) return erreurSupabase('Ajout de la mise en situation', error);
  const lignes = S.referentiel.savoirFaire.filter(sf => sf.gabarit_code === gabaritCode);
  await sb.from('evaluations_savoir_faire')
    .insert(lignes.map(sf => ({ mise_en_situation_id: data.id, savoir_faire_id: sf.id })));
  rendrePratique($('#contenu'));
}

// Réplique en JS, pour l'usage hors-ligne uniquement, la règle SQL de
// epreuve_pratique_conforme() (voir supabase/_fonctions.sql) : obligatoires
// conformes, sinon une seule mise de rattrapage conforme suffit. Retourne
// null si les obligatoires ne sont pas toutes complètes (rien à décider).
function conformiteLocale(ep) {
  const min = ep.gabarits.mises_en_situation_min;
  const rattrapage = ep.gabarits.mises_en_situation_rattrapage || 0;
  const mises = ep.mises_en_situation || [];
  const obligatoires = mises.filter(m => m.numero <= min);
  if (obligatoires.length < min || !obligatoires.every(m => miseComplete(m))) return null;
  if (obligatoires.every(m => miseConforme(m))) return true;
  const rattrapages = mises.filter(m => m.numero > min && m.numero <= min + rattrapage);
  return rattrapages.some(m => miseConforme(m));
}

async function cloturerEpreuve(epreuveId) {
  if (!navigator.onLine) {
    const trouve = trouverDansCache('epreuve', epreuveId);
    if (!trouve) return toast('Épreuve introuvable dans les données locales', 'erreur');
    const verdict = conformiteLocale(trouve.ep);
    if (verdict === null) {
      return toast('Mise(s) en situation obligatoire(s) pas toutes complètes', 'erreur');
    }
    trouve.ep.reussie = verdict;
    trouve.ep.__provisoire = true;
    HorsLigne.enregistrerSnapshot(S.stagiaire.id, trouve.snap);
    HorsLigne.appellerRpc({
      nomRpc: 'cloturer_pratique', params: { p_epreuve_id: epreuveId },
      libelle: 'Clôture — ' + trouve.ep.gabarits.libelle, stagiaireId: S.stagiaire.id,
    });
    toast((verdict ? 'Épreuve pratique validée' : 'Épreuve pratique non validée')
      + ' — provisoire, à confirmer à la reconnexion', verdict ? 'ok' : 'erreur');
    return rendrePratique($('#contenu'));
  }
  try {
    const ok = await rpc('cloturer_pratique', { p_epreuve_id: epreuveId });
    toast(ok ? 'Épreuve pratique validée' : 'Épreuve pratique non validée', ok ? 'ok' : 'erreur');
    rendrePratique($('#contenu'));
  } catch (e) { erreurSupabase('Validation de l\'épreuve', e); }
}

/* -------- Fiche MSP téléchargeable (2026-08-27, demande de Jeremy) ------
 * Le PDF est embarqué en base64 dans HE_msp_ressources.js (MSP_RESSOURCES),
 * même principe que LOGO_BFS dans HE_pdf.js — pas de bucket de stockage à
 * gérer. Téléchargement déclenché via un <a> temporaire, comme ailleurs
 * dans l'appli pour les exports. */
function telechargerRessourceMsp(ref) {
  const ressource = typeof MSP_RESSOURCES !== 'undefined' ? MSP_RESSOURCES[ref] : null;
  if (!ressource) return toast('Fiche MSP indisponible', 'erreur');
  const a = document.createElement('a');
  a.href = ressource.data;
  a.download = ressource.fichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ===================================================================
   Pratique multiple (2026-10-01, demande de Jeremy) : évaluer 2 stagiaires
   en parallèle (ex. 2 armoires électriques côte à côte).

   L'écran pratique existant s'appuie entièrement sur un état global unique
   (S.stagiaire, utilisé par la notation, le cache hors-ligne, le scroll…) :
   dédoubler cet écran en 2 colonnes dans la même page aurait fait se
   marcher dessus les 2 évaluations à chaque clic. Solution retenue : 2
   <iframe>, chacune chargée sur la route dédiée #pratique-solo?id=... —
   2 contextes JavaScript totalement indépendants, mais la même session
   Supabase (partagée via le localStorage du site), donc pas de reconnexion
   à faire. Volontairement réservé aux écrans larges (tablette/PC) — voir
   styles.css — une colonne par iframe devient illisible sur téléphone.
   =================================================================== */

async function choisirPratiqueMultiple() {
  const s = S.session;
  const { data: stagiaires, error } = await sb.from('stagiaires')
    .select('id, nom, prenom').eq('session_id', s.id).order('nom');
  if (error) return erreurSupabase('Chargement des stagiaires', error);
  if (!stagiaires || stagiaires.length < 2) {
    return toast('Il faut au moins 2 stagiaires dans la session pour une évaluation en parallèle', 'erreur');
  }

  const options = stagiaires.map(st => `<option value="${st.id}">${esc(st.nom)} ${esc(st.prenom)}</option>`).join('');
  ouvrirModale('Évaluer 2 stagiaires en parallèle', `
    <p class="aide">Ouvre 2 grilles d'évaluation pratique côte à côte, totalement indépendantes
      l'une de l'autre — pratique pour suivre 2 stagiaires en même temps (ex. 2 armoires électriques).
      Réservé aux écrans larges (tablette/PC).</p>
    <form id="form-pratique-multiple" class="formulaire">
      <label>Stagiaire 1 <select name="st1" required>
        <option value="">— choisir —</option>${options}</select></label>
      <label>Stagiaire 2 <select name="st2" required>
        <option value="">— choisir —</option>${options}</select></label>
      <div class="pied-modale">
        <button type="button" onclick="fermerModale()">Annuler</button>
        <button type="submit" class="principal">Ouvrir les 2 grilles</button>
      </div>
    </form>`);

  $('#form-pratique-multiple').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.target;
    if (!f.st1.value || !f.st2.value) return toast('Choisis les 2 stagiaires', 'erreur');
    if (f.st1.value === f.st2.value) return toast('Choisis 2 stagiaires différents', 'erreur');
    const st1 = stagiaires.find(st => st.id === f.st1.value);
    const st2 = stagiaires.find(st => st.id === f.st2.value);
    fermerModale();
    S.pratiqueMultiple = [st1, st2];
    S.ecran = 'pratique-multiple';
    ecranFormateur($('#ecran'));
  });
}

function rendrePratiqueMultiple(zone) {
  const [st1, st2] = S.pratiqueMultiple || [];
  if (!st1 || !st2) {
    zone.innerHTML = `<div class="ecran-vide"><p>Aucun stagiaire sélectionné.</p>
      <button class="lien" onclick="retour('session')">← Retour à la session</button></div>`;
    return;
  }
  // location.pathname + location.search (sans le #...) : chaque iframe
  // recharge l'application sur sa propre route #pratique-solo, indépendante
  // de celle de la fenêtre principale.
  const base = location.pathname + location.search;
  zone.innerHTML = `
    <button class="lien" onclick="retour('session')">← Retour à la session</button>
    <p class="aide">Évaluation en parallèle — les 2 colonnes sont totalement indépendantes,
      comme 2 onglets distincts. Non disponible sur petit écran.</p>
    <div class="pratique-multiple">
      <iframe src="${base}#pratique-solo?id=${encodeURIComponent(st1.id)}"
        title="${esc(st1.nom)} ${esc(st1.prenom)}"></iframe>
      <iframe src="${base}#pratique-solo?id=${encodeURIComponent(st2.id)}"
        title="${esc(st2.nom)} ${esc(st2.prenom)}"></iframe>
    </div>`;
}

// Écran pratique d'UN SEUL stagiaire, sans la coquille (onglets/en-tête) de
// l'espace formateur — destiné à être chargé dans une <iframe> par l'écran
// ci-dessus. Appelé directement par router() (HE_core.js) sur #pratique-solo.
async function ecranPratiqueSolo(cible) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const id = params.get('id');
  if (!id) {
    cible.innerHTML = '<div class="ecran-vide"><p>Stagiaire manquant dans le lien.</p></div>';
    return;
  }
  const { data, error } = await sb.from('stagiaires')
    .select('*, stagiaire_symboles(symbole_code)').eq('id', id).single();
  if (error) {
    cible.innerHTML = `<div class="ecran-vide"><p>${esc(error.message)}</p></div>`;
    return;
  }
  S.stagiaire = data;
  S.pratiqueSoloMode = true;
  cible.innerHTML = '<main id="contenu" class="pratique-solo"></main>';
  rendrePratique($('#contenu'));
}

/* -------- Popup Consignes MSP (2026-08-28, demande de Jeremy) -----------
 * Complément du bouton "Fiche MSP" ci-dessus : plutôt que de rouvrir le PDF
 * complet (peu pratique sur téléphone/tablette pendant l'évaluation sur le
 * terrain), un popup résume juste les consignes à donner au stagiaire et ce
 * qui est attendu à SON niveau. Le scénario choisi (m.scenario_id) est déjà
 * spécifique au rôle de la mise en situation — le PDF, lui, détaille les
 * deux rôles (Exécutant ET Chef de chantier) côte à côte, ce que Jeremy a
 * explicitement voulu éviter ici pour simplifier la lecture sur mobile. */
function afficherConsignesMsp(scenarioId) {
  const s = (S._scenariosParId || {})[scenarioId];
  if (!s) return toast('Consignes indisponibles pour ce scénario', 'erreur');

  const puces = texte => (texte || '')
    .split(';').map(t => t.trim()).filter(Boolean)
    .map(t => `<li>${esc(t)}</li>`).join('') || '<li>—</li>';

  ouvrirModale(`Consignes — ${esc(s.intitule)}`, `
    <div class="consignes-msp">
      <p class="aide">Niveau évalué : <b>${esc(s.role || '—')}</b></p>

      <h4>Situation à donner au stagiaire</h4>
      <p>${esc(s.contexte_technique || '—')}</p>
      ${s.variation_environnement ? `<p><b>Lieu :</b> ${esc(s.variation_environnement)}</p>` : ''}
      ${s.variation_documentaire ? `<p><b>Documents fournis :</b> ${esc(s.variation_documentaire)}</p>` : ''}

      <h4>Aléa à déclencher en cours de mise en situation</h4>
      <p>${esc(s.probleme_ou_alea || '—')}</p>

      <h4>Attendus à ce niveau</h4>
      <ul>${puces(s.attendus_principaux)}</ul>

      ${s.motif_arret_obligatoire ? `<h4>Motif d'arrêt obligatoire</h4>
      <ul>${puces(s.motif_arret_obligatoire)}</ul>` : ''}

      ${s.materiel_necessaire ? `<p><b>Matériel nécessaire :</b> ${esc(s.materiel_necessaire)}</p>` : ''}
    </div>
    <div class="pied-modale">
      <button type="button" class="principal" onclick="fermerModale()">Fermer</button>
    </div>`);
}
