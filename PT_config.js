// =========================================================================
// Pointage BFS — PT_config.js
// =========================================================================
// SEUL fichier à modifier pour raccorder l'application à Supabase.
// Ne jamais y mettre la clé "service_role" — uniquement la clé
// publishable/anon.
// =========================================================================

const PT_CONFIG = {
  SUPABASE_URL: 'https://dqraobwozowtnrieitkp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_UhkImOyooXPnAqTCNMJ4wA_VVqscCmK',
  SUPABASE_SCHEMA: 'pointage',

  // Clés de stockage local — toujours préfixées "pointage_", jamais "bfs_".
  STORAGE_KEY_AUTH: 'pointage_auth',

  // Version du cache du service worker — à incrémenter à chaque mise en ligne.
  // Doit rester synchronisée avec la constante VERSION_CACHE de
  // PT_service-worker.js (le service worker ne peut pas lire ce fichier).
  VERSION_CACHE: 'pointage-v13',
};
