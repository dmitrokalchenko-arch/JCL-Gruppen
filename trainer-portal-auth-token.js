// Reine Auswahllogik für den Authorization-Token bei der Verwaltung von
// Trainerportal-Zugang (manage-trainer-account). Keine Browser-APIs (kein
// document/sessionStorage/fetch) — bewusst so gehalten, damit diese Datei
// unverändert sowohl im Browser (globale Funktionen, wie jede andere
// Funktion in app.js) als auch in Node-Tests (require) funktioniert.
//
// BUGFIX (Diagnose-Sitzung "Fehler beim Speichern des Portalzugangs"):
// admin-pin-login liefert eine gültige, korrekt scoped Admin PIN Session.
// Existiert im selben Browser-Tab zusätzlich noch eine ALTE/fremde
// Supabase-Auth-Sitzung (z. B. Rest einer früheren Trainer-Auth-Anmeldung),
// hatte diese bisher Vorrang — der Request ging serverseitig über Path A
// (Auth JWT) statt Path B (Admin PIN Session), traf dort die falsche
// Identität und wurde korrekt mit 403 {"error":"forbidden"} abgelehnt,
// obwohl der eingeloggte Administrator und seine PIN-Session gültig waren.
//
// Reihenfolge jetzt: Admin PIN Session zuerst, Supabase Auth JWT nur als
// Fallback, wenn keine PIN Session existiert.

function resolveAdminAuthToken({ adminPinToken, authAccessToken }) {
  if (adminPinToken) {
    return { token: adminPinToken, source: 'pin' };
  }
  if (authAccessToken) {
    return { token: authAccessToken, source: 'auth' };
  }
  return { token: null, source: null };
}

// Erkennt genau den Fall "lokal vorhandene Admin PIN Session, die der
// Server als abgelaufen/ungültig zurückweist" — NUR wenn der gesendete
// Token tatsächlich aus der PIN-Session stammte (tokenSource === 'pin').
// Bei tokenSource === 'auth' ist derselbe Fehlercode ein anderes Problem
// (abgelaufener/ungültiger Auth-JWT-Fallback) und wird hier bewusst nicht
// behandelt, um nichts an bestehendem Verhalten für diesen Fall zu ändern.
function isExpiredAdminPinSessionError({ tokenSource, httpStatus, errorCode }) {
  return tokenSource === 'pin' && httpStatus === 401 && errorCode === 'invalid_or_expired_token';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveAdminAuthToken, isExpiredAdminPinSessionError };
}
