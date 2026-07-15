const CATS = {
  relaxation: { label: 'Relaxation & repos', color: 'var(--green)', cls: 'relaxation' },
  pursuit: { label: 'Poursuite fluide', color: 'var(--purple)', cls: 'pursuit' },
  training: { label: 'Accommodation et vergence', color: 'var(--teal)', cls: 'training' },
  saccade: { label: 'Saccades & clignement', color: 'var(--amber)', cls: 'saccade' },
  peripheral: { label: 'Vision périphérique', color: 'var(--bright)', cls: 'peripheral' },
  breath: { label: 'Respiration & récupération', color: '#50a0e0', cls: 'breath' },
  neck: { label: 'Nuque & posture', color: '#c08af0', cls: 'neck' }
};

function makeExercise(id, cat, ico, name, dur, anim, source, desc, tip, evidence = 'Confort') {
  return {
    id,
    cat,
    ico,
    name,
    dur,
    anim,
    source,
    desc,
    tip,
    evidence,
    breakDesc: desc,
    breakTip: tip,
    contraindications: 'Arrêter en cas de douleur, de vision double persistante, de vertige ou d’aggravation des symptômes.'
  };
}

const EX = [
  makeExercise('distance-gaze', 'relaxation', '🔭', 'Regard lointain', '20 sec', 'depth', 'Règle 20-20-20', 'Fixe le centre et laisse la mise au point se relâcher vers le lointain.', 'Regarde ensuite un vrai point au loin si tu peux.', 'Fort'),
  makeExercise('deep-sky', 'relaxation', '🌌', 'Ciel profond', '20 sec', 'depth', 'Ergonomie visuelle', 'Utilise le ciel étoilé comme repère pour relâcher la focalisation de près.', 'Aucun effort, juste distance et respiration.', 'Fort'),
  makeExercise('palming', 'relaxation', '🤲', 'Palming', '30 sec', 'palm', 'Pratique de confort', 'Couvre doucement les yeux fermés avec les paumes, sans pression.', 'Cherche le noir et la chaleur, jamais la compression.', 'Prudence'),
  makeExercise('green-drift', 'relaxation', '🌿', 'Dérive verte', '30 sec', 'nature', 'Restauration attentionnelle', 'Laisse le regard dériver sur un mouvement organique et doux.', 'C’est un exercice de repos, pas de performance.', 'Modéré'),
  makeExercise('pendulum', 'relaxation', '🕰', 'Pendule', '25 sec', 'pendule', 'Rythme de relaxation', 'Suis le pendule avec un regard souple et la tête immobile.', 'Tu peux synchroniser la respiration avec le balancement.'),

  makeExercise('infinity', 'pursuit', '∞', 'Infini', '30 sec', 'infinity', 'Poursuite fluide', 'Suis la boucle uniquement avec les yeux.', 'La continuité compte plus que la précision.'),
  makeExercise('slow-circles', 'pursuit', '↻', 'Cercles lents', '20 sec', 'rotation', 'Mobilité oculaire', 'Suis la cible sur le cercle sans te précipiter.', 'Réduis mentalement le cercle si ça tire un peu.'),
  makeExercise('butterfly', 'pursuit', '🦋', 'Papillon', '30 sec', 'butterfly', 'Poursuite en 4 quadrants', 'Traverse les quatre quadrants avec une poursuite douce.', 'Observe les zones plus difficiles sans forcer.'),
  makeExercise('bounce', 'pursuit', '⚽', 'Balle souple', '30 sec', 'bounce', 'Suivi dynamique', 'Suis le point pendant ses rebonds dans le cadre.', 'Si c’est trop stimulant, passe ensuite sur une relaxation.'),
  makeExercise('wave', 'pursuit', '〰', 'Vague', '20 sec', 'wave', 'Poursuite horizontale', 'Suis la vague comme une ligne de lecture calme.', 'Garde les épaules et la mâchoire relâchées.'),

  makeExercise('near-far', 'training', '↔', 'Proche-loin', '30 sec', 'nearfar', 'Souplesse accommodative', 'Alterne la mise au point entre la cible proche et la cible lointaine.', 'Attends une netteté confortable avant de changer.', 'Modéré'),
  makeExercise('soft-focus', 'training', '◉', 'Focus doux', '25 sec', 'softfocus', 'Relâchement de focus', 'Observe le point devenir flou puis net sans forcer.', 'L’objectif est le relâchement, pas le contrôle.', 'Modéré'),
  makeExercise('convergence', 'training', '◎', 'Convergence', '20 sec', 'convergence', 'Exercice de vergence', 'Suis l’objet quand il s’approche puis laisse-le repartir.', 'Arrête avant toute gêne ou vision double persistante.', 'Modéré'),
  makeExercise('spiral', 'training', '🌀', 'Spirale', '30 sec', 'spiral', 'Dynamique accommodative', 'Suis la spirale pendant qu’elle s’élargit puis se resserre.', 'En cas de vertige, arrête et prends une pause passive.'),
  makeExercise('brock', 'training', '🔗', 'Brock string', '30 sec', 'brock', 'Repère orthoptique', 'Déplace l’attention perle après perle avec la tête bien fixe.', 'C’est une version légère de confort, pas un traitement médical.', 'Modéré'),

  makeExercise('clock-saccade', 'saccade', '⚡', 'Saccades horloge', '20 sec', 'saccade', 'Pratique saccadique', 'Saute de point en point uniquement avec les yeux.', 'Des sauts courts et propres suffisent.'),
  makeExercise('star-saccade', 'saccade', '⭐', 'Saccades étoile', '20 sec', 'star', 'Saccades amples', 'Trace l’étoile de point en point.', 'Ajoute une relaxation juste après si besoin.'),
  makeExercise('cardinal', 'saccade', '✛', 'Directions cardinales', '25 sec', 'cardinal', 'Mobilité directionnelle', 'Pars du centre, va dans la direction, puis reviens au centre.', 'Une amplitude confortable suffit.'),
  makeExercise('blink', 'saccade', '👁', 'Clignement complet', '30 sec', 'blink', 'Recommandations TFOS', 'Cligne lentement et complètement, puis garde les yeux fermés un instant.', 'Ne serre jamais les paupières.', 'Fort'),
  makeExercise('blink-tempo', 'saccade', '◷', 'Tempo de clignement', '25 sec', 'blink', 'Complétude du clignement', 'Alterne des clignements complets lents et moyens.', 'L’objectif est la fermeture complète, pas la vitesse.', 'Fort'),

  makeExercise('peripheral-halo', 'peripheral', '◌', 'Halo périphérique', '20 sec', 'peripheral', 'Ouverture attentionnelle', 'Garde le centre fixe et remarque les halos autour.', 'Ne poursuis pas les signaux périphériques avec les yeux.', 'Modéré'),
  makeExercise('field-expansion', 'peripheral', '◎', 'Expansion du champ', '20 sec', 'field', 'Conscience périphérique', 'Maintiens le centre stable pendant que les anneaux s’ouvrent.', 'Une attention large suffit.'),
  makeExercise('quiet-periphery', 'peripheral', '✺', 'Périphérie calme', '20 sec', 'peripheral', 'Reset visuel', 'Garde la fixation centrale et remarque doucement l’activité en bordure.', 'C’est un exercice d’attention, pas un test de netteté.', 'Modéré'),

  makeExercise('breath-look', 'breath', '◡', 'Respiration et regard', '40 sec', 'breathlook', 'Réinitialisation respiratoire', 'Inspire en regardant au loin, expire les yeux doucement fermés.', 'Tu peux allonger l’expiration si c’est confortable.', 'Modéré'),
  makeExercise('stillness', 'breath', '☾', 'Pause immobile', '20 sec', 'stillness', 'Micro-pause', 'Prends une pause presque immobile et relâche tout le visage.', 'Parfois, le meilleur exercice consiste à ne rien faire.', 'Prudence'),
  makeExercise('dark-rest', 'breath', '☾', 'Repos sombre', '20 sec', 'stillness', 'Pause passive', 'Repose-toi les yeux fermés ou mi-clos avec une stimulation minimale.', 'Utile quand toute animation semble déjà trop intense.', 'Prudence'),

  makeExercise('neck-turns', 'neck', '↔', 'Rotation douce', '30 sec', 'neckturn', 'Mobilité cervicale douce', 'Tourne lentement la tête à droite puis à gauche, sans aller en amplitude maximale.', 'Garde les épaules basses et reviens au centre entre chaque côté.', 'Prudence'),
  makeExercise('neck-tilts', 'neck', '◜', 'Inclinaisons latérales', '30 sec', 'necktilt', 'Relâchement trapèzes', 'Incline doucement l’oreille vers l’épaule, à droite puis à gauche, sans tirer avec la main.', 'Le mouvement doit rester léger, respiré et sans douleur.', 'Prudence'),
  makeExercise('chin-nod', 'neck', '⌄', 'Menton poitrine', '25 sec', 'chinnod', 'Mobilité cervicale contrôlée', 'Descends doucement le menton vers la poitrine, puis reviens à une position neutre.', 'Évite de pousser la tête vers l’arrière ; reste dans une amplitude confortable.', 'Prudence'),
  makeExercise('shoulder-reset', 'neck', '⌁', 'Épaules arrière', '30 sec', 'shoulder', 'Reset postural', 'Roule doucement les épaules vers l’arrière puis relâche la nuque et la mâchoire.', 'Pense “large et bas” plutôt que “fort et haut”.', 'Prudence')
];

window.VisuData = { CATS, EX };
