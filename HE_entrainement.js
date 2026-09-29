/* =====================================================================
   HE_entrainement.js — QCM de positionnement (entraînement libre)
   (2026-09-03, demande de Jeremy)

   Route #entrainement (à ne pas confondre avec #stagiaire, l'examen réel) :
   le stagiaire choisit le(s) titre(s) visé(s) et s'entraîne sur des
   questions tirées sur les mêmes bases que l'examen (Annexe D.3), mais
   avec la bonne réponse et l'explication affichées immédiatement après
   chaque question. Rien n'est enregistré côté serveur — aucun impact sur
   le dossier du stagiaire ni sur son évaluation officielle. Accessible par
   un QR code distinct de celui de l'examen, avec le code d'une session
   (juste pour retrouver l'intitulé affiché à l'écran) — ou, depuis le
   2026-09-09 (demande de Jeremy), totalement hors session : en laissant
   le code vide (ou via le lien permanent #entrainement sans ?code=,
   affiché dans l'onglet Organisme), pour un accès d'entraînement
   permanent, valable en toutes circonstances.

   2026-09-09 (demande de Jeremy) : quand ce QCM de positionnement est fait
   DANS une session (code renseigné), il est désormais lié au stagiaire qui
   s'entraîne (choix de son nom, comme à l'accueil de l'examen réel) et le
   résultat est conservé (habelec.enregistrer_positionnement) pour que le
   formateur puisse le consulter et repérer des axes d'amélioration (voir
   HE_app.js, action "📊 Positionnement"). Hors session (accès permanent,
   code vide), rien n'est identifiable ni conservé — comme avant.
   ===================================================================== */

const ENT = { code: null, jeton: null, session: null, questions: [], index: 0, symboles: null, stagiaires: null };

// 2026-09-29 (demande de Jeremy) : certains stagiaires actualisent la page
// par erreur pendant le QCM de positionnement et perdent leur progression.
// On la met en cache dans le navigateur (localStorage) le temps de finir,
// sur le même principe que le cache de l'examen réel (voir HE_qcm.js).
const CLE_CACHE_ENTRAINEMENT = 'habelec_cache_entrainement';

function sauvegarderCacheEntrainement() {
  try {
    localStorage.setItem(CLE_CACHE_ENTRAINEMENT, JSON.stringify({
      code: ENT.code, jeton: ENT.jeton, session: ENT.session,
      symbolesChoisis: ENT.symbolesChoisis, questions: ENT.questions, index: ENT.index,
    }));
  } catch (e) { /* silencieux — le cache n'est qu'un confort, jamais bloquant */ }
}

function restaurerCacheEntrainement() {
  try {
    const brut = localStorage.getItem(CLE_CACHE_ENTRAINEMENT);
    if (!brut) return false;
    const c = JSON.parse(brut);
    if (!c || !Array.isArray(c.questions) || !c.questions.length) return false;
    ENT.code = c.code; ENT.jeton = c.jeton; ENT.session = c.session;
    ENT.symbolesChoisis = c.symbolesChoisis; ENT.questions = c.questions;
    ENT.index = c.index || 0;
    return true;
  } catch (e) { return false; }
}

function effacerCacheEntrainement() {
  try { localStorage.removeItem(CLE_CACHE_ENTRAINEMENT); } catch (e) { /* silencieux */ }
}

async function ecranEntrainement(cible) {
  const codePrerempli = new URLSearchParams(location.hash.split('?')[1] || '').get('code');
  if (!ENT.code && codePrerempli) ENT.code = codePrerempli.toUpperCase();
  if (ENT.questions.length) return rendreQuestionEntrainement(cible);
  if (restaurerCacheEntrainement()) return rendreQuestionEntrainement(cible);

  // 2026-09-04 (correctif) : la liste des titres ne peut pas venir de
  // S.referentiel ici — ce visiteur n'a pas de compte, et les SELECT
  // directs sur les tables de référence sont soumis aux policies RLS (qui
  // n'autorisent pas le rôle anonyme). On passe par une fonction dédiée,
  // sécurisée et strictement en lecture seule (liste_symboles_public).
  if (!ENT.symboles) {
    cible.innerHTML = '<div class="stagiaire-accueil"><p class="sous-titre">Chargement…</p></div>';
    try {
      ENT.symboles = await rpc('liste_symboles_public');
    } catch (e) {
      ENT.symboles = [];
      erreurSupabase('Chargement des titres', e);
    }
  }
  rendreChoixTitresEntrainement(cible);
}

function rendreChoixTitresEntrainement(cible) {
  const symboles = (ENT.symboles || []).slice()
    .sort((a, b) => (a.libelle || '').localeCompare(b.libelle || ''));
  cible.innerHTML = `
    <div class="stagiaire-accueil">
      <h1>QCM de positionnement</h1>
      <p class="sous-titre">Entraînement libre — la bonne réponse s'affiche après chaque question.
        Ça ne compte pas pour ton évaluation officielle.</p>
      <form id="form-entrainement" class="carte">
        <label>Code de la session <span class="aide">(facultatif — laisse vide pour un entraînement libre, hors de toute session)</span>
          <input name="code" maxlength="10" autocapitalize="characters" autocomplete="off"
                 value="${esc(ENT.code || '')}" class="saisie-code"></label>
        <fieldset><legend>Titre(s) visé(s)</legend>
          ${symboles.length
            ? symboles.map(sy => `
                <label class="case"><input type="checkbox" name="symbole" value="${esc(sy.code)}"> ${esc(sy.libelle)}</label>`).join('')
            : '<p class="aide">Impossible de charger la liste des titres — vérifie ta connexion et recharge la page.</p>'}
        </fieldset>
        <button class="principal" type="submit">Continuer</button>
      </form>
    </div>`;

  $('#form-entrainement').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const symboles = $$('input[name="symbole"]:checked').map(i => i.value);
    if (!symboles.length) return toast('Choisis au moins un titre', 'erreur');
    ENT.symbolesChoisis = symboles;
    ENT.code = f.code.value.trim().toUpperCase() || null;
    ENT.jeton = null;
    if (ENT.code) {
      // Dans une session : on demande qui s'entraîne, pour pouvoir lier et
      // conserver le résultat (le formateur pourra ensuite le consulter).
      try {
        ENT.stagiaires = await rpc('liste_stagiaires_session', { p_code: ENT.code });
      } catch (e) {
        return erreurSupabase('Chargement de la liste des stagiaires', e);
      }
      if (!ENT.stagiaires.length) return toast('Aucun stagiaire dans cette session', 'erreur');
      return rendreChoixStagiaireEntrainement($('#ecran'));
    }
    await lancerTirageEntrainement();
  });
}

function rendreChoixStagiaireEntrainement(cible) {
  cible.innerHTML = `
    <div class="stagiaire-accueil">
      <h1>Qui s'entraîne ?</h1>
      <p class="sous-titre">Ton résultat sera visible par ton formateur, pour t'aider à progresser —
        ça ne compte toujours pas pour ton évaluation officielle.</p>
      <div class="grille-noms">
        ${ENT.stagiaires.map(s => `
          <button class="nom${s.recyclage ? ' nom-recyclage' : ''}" title="${s.recyclage ? 'Recyclage' : 'Formation initiale'}"
            onclick="choisirStagiaireEntrainement('${esc(s.jeton)}')">${esc(s.nom)} ${esc(s.prenom)}</button>`).join('')}
      </div>
    </div>`;
}

async function choisirStagiaireEntrainement(jeton) {
  ENT.jeton = jeton;
  await lancerTirageEntrainement();
}

async function lancerTirageEntrainement() {
  effacerCacheEntrainement();
  try {
    const res = await rpc('tirage_positionnement', { p_code: ENT.code, p_symboles: ENT.symbolesChoisis });
    ENT.questions = (res.questions || []).map(q => ({ ...q, choix: [], corrige: false }));
    ENT.session = res.session;
    ENT.index = 0;
    if (!ENT.questions.length) return toast('Aucune question disponible pour ce choix', 'erreur');
    sauvegarderCacheEntrainement();
    rendreQuestionEntrainement($('#ecran'));
  } catch (e) { erreurSupabase('Tirage du QCM de positionnement', e); }
}

function reponseCorrecte(q) {
  const bonnesIds = q.reponses.filter(r => r.correcte).map(r => r.id);
  return bonnesIds.length > 0
    && bonnesIds.every(id => q.choix.includes(id))
    && q.choix.every(id => bonnesIds.includes(id));
}

function rendreQuestionEntrainement(cible) {
  const qs = ENT.questions;
  const q = qs[ENT.index];

  cible.innerHTML = `
    <div class="passation">
      <header class="entete-passation">
        <div>${esc(ENT.session || '')} — entraînement</div>
        <div class="progression">
          <div class="jauge"><div style="width:${(ENT.index / qs.length) * 100}%"></div></div>
          <span>Question ${ENT.index + 1}/${qs.length}</span>
        </div>
      </header>

      <article class="question">
        <div class="numero">Question ${ENT.index + 1} sur ${qs.length}
          ${q.fondamentale ? '<span class="puce fond">Question fondamentale</span>' : ''}</div>
        <h2>${esc(q.enonce)}${q.choix_multiple
          ? ` <span class="badge-nb-reponses">(${q.reponses.filter(r => r.correcte).length} RÉPONSES)</span>` : ''}</h2>
        ${q.image_url ? `<img class="vignette-question-qcm" src="${esc(q.image_url)}" alt="Illustration de la question">` : ''}
        ${q.choix_multiple ? `<p class="aide">Coche exactement ${q.reponses.filter(r => r.correcte).length} réponse(s).</p>` : ''}
        <div class="propositions">${q.reponses.map(r => {
          const cochee = q.choix.includes(r.id);
          let classe = 'proposition';
          if (q.corrige) {
            if (r.correcte) classe += ' bonne';
            else if (cochee) classe += ' mauvaise';
          } else if (cochee) classe += ' choisie';
          return `<label class="${classe}">
            <input type="${q.choix_multiple ? 'checkbox' : 'radio'}" name="rep" value="${r.id}"
              ${cochee ? 'checked' : ''} ${q.corrige ? 'disabled' : ''}>
            <span>${esc(r.libelle)}</span></label>`;
        }).join('')}</div>
        ${q.corrige ? `<div class="correction-entrainement">
          <p>${reponseCorrecte(q) ? '<b class="ok">✔ Bonne réponse</b>' : '<b class="ko">✘ Réponse incorrecte</b>'}</p>
          ${q.explication ? `<p class="explication">${esc(q.explication)}</p>` : ''}
        </div>` : ''}
      </article>

      <footer class="pied-passation">
        <button ${ENT.index === 0 ? 'disabled' : ''} onclick="naviguerEntrainement(-1)">← Précédente</button>
        ${!q.corrige
          ? `<button class="principal" onclick="corrigerQuestionEntrainement()">Vérifier</button>`
          : ENT.index === qs.length - 1
            ? `<button class="principal" onclick="finEntrainement()">Voir le résultat</button>`
            : `<button class="principal" onclick="naviguerEntrainement(1)">Suivante →</button>`}
      </footer>
    </div>`;

  $$('.propositions input').forEach(i => i.addEventListener('change', () => {
    q.choix = $$('.propositions input:checked').map(x => x.value);
    sauvegarderCacheEntrainement();
  }));
}

function corrigerQuestionEntrainement() {
  const q = ENT.questions[ENT.index];
  if (!q.choix.length) return toast('Choisis au moins une réponse', 'erreur');
  q.corrige = true;
  sauvegarderCacheEntrainement();
  rendreQuestionEntrainement($('#ecran'));
}

function naviguerEntrainement(delta) {
  ENT.index = Math.max(0, Math.min(ENT.questions.length - 1, ENT.index + delta));
  sauvegarderCacheEntrainement();
  rendreQuestionEntrainement($('#ecran'));
}

async function finEntrainement() {
  effacerCacheEntrainement();
  const qs = ENT.questions;
  const bonnes = qs.filter(reponseCorrecte).length;
  const fondEchouees = qs.filter(q => q.fondamentale && !reponseCorrecte(q)).length;

  $('#ecran').innerHTML = `
    <div class="stagiaire-accueil">
      <h1>Résultat de l'entraînement</h1>
      <div class="carte">
        <p><b>${bonnes} / ${qs.length}</b> bonnes réponses (${Math.round(bonnes / qs.length * 100)} %)</p>
        ${fondEchouees ? `<p class="ko">${fondEchouees} question(s) fondamentale(s) ratée(s)</p>` : ''}
        ${ENT.jeton
          ? '<p class="aide">Résultat transmis à ton formateur (n\'a aucun impact sur ton évaluation officielle).</p>'
          : '<p class="aide">Cet entraînement n\'est pas enregistré et n\'a aucun impact sur ton évaluation officielle.</p>'}
        <button class="principal" onclick="recommencerEntrainement()">Recommencer</button>
      </div>
    </div>`;

  // Conservation du résultat uniquement quand l'entraînement a été fait
  // DANS une session, avec un stagiaire identifié (voir en-tête de fichier).
  if (ENT.jeton) {
    const questionsPourFormateur = qs.map(q => ({
      question_id: q.question_id,
      theme_code: q.theme_code,
      enonce: q.enonce,
      fondamentale: q.fondamentale,
      choix_multiple: q.choix_multiple,
      explication: q.explication || null,
      correcte: reponseCorrecte(q),
      reponse_donnee: q.reponses.filter(r => q.choix.includes(r.id)).map(r => r.libelle),
      bonne_reponse: q.reponses.filter(r => r.correcte).map(r => r.libelle),
    }));
    try {
      await rpc('enregistrer_positionnement', {
        p_jeton: ENT.jeton, p_symboles: ENT.symbolesChoisis, p_questions: questionsPourFormateur,
      });
    } catch (e) {
      // Ne bloque jamais l'affichage du résultat au stagiaire pour un souci
      // d'enregistrement côté serveur — juste un journal technique.
      DEBUG.erreur('Enregistrement du positionnement', e.message || e);
    }
  }
}

function recommencerEntrainement() {
  effacerCacheEntrainement();
  ENT.questions = [];
  ENT.index = 0;
  ENT.jeton = null;
  ecranEntrainement($('#ecran'));
}
