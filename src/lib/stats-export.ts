/**
 * Nom de fichier d'export des statistiques. Module partagé (ni server ni
 * client) : importable depuis la page serveur comme depuis le bouton client.
 */
export function statsFileName(fromDay: string, toDay: string): string {
  return `stats-${fromDay}-${toDay}.csv`;
}
